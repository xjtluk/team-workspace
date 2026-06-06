/**
 * Provider 健康度追踪模块
 *
 * 每个 provider 维护一个 health score（0-100），根据调用结果动态调整：
 * - 成功 → +5（上限 100）
 * - 429 限流 → -20
 * - JSON 截断 → -30
 * - 超时 → -10
 * - 401/403 认证失败 → -40
 *
 * 路由时按 score 排序，score < 30 的 provider 被临时跳过。
 * 每小时自动恢复 +5，防止长期惩罚。
 *
 * 持久化：每 5 分钟写入 .cache/provider-health.json，进程重启时加载。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', '..', '.cache');
const CACHE_FILE = join(CACHE_DIR, 'provider-health.json');

// 内存中的健康度数据
const healthMap = new Map();

// ── 配置 ──
const INITIAL_SCORE = 100;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
const THRESHOLD = 30;         // 低于此分数的 provider 被跳过
const RECOVERY_INTERVAL = 60 * 60 * 1000; // 1 小时
const RECOVERY_AMOUNT = 5;
const PERSIST_INTERVAL = 5 * 60 * 1000;   // 5 分钟

// ── 分数调整规则 ──
const SCORE_DELTA = {
  success:     +5,
  rate_limit:  -20,   // 429
  truncation:  -30,   // JSON 截断
  timeout:     -10,
  auth_error:  -40,   // 401/403
  unknown:     -15,
};

/**
 * 获取 provider 的健康度信息
 */
function getHealth(providerName) {
  if (!healthMap.has(providerName)) {
    healthMap.set(providerName, {
      score: INITIAL_SCORE,
      lastFailed: 0,
      consecutiveFailures: 0,
      lastSuccess: 0,
      totalCalls: 0,
      totalFailures: 0,
    });
  }
  return healthMap.get(providerName);
}

/**
 * 报告一次调用结果，更新 score
 * @param {string} providerName - provider 名称
 * @param {'success'|'rate_limit'|'truncation'|'timeout'|'auth_error'|'unknown'} result - 结果类型
 * @param {string} [detail] - 详情（用于日志）
 */
function report(providerName, result, detail = '') {
  const health = getHealth(providerName);
  const delta = SCORE_DELTA[result] || SCORE_DELTA.unknown;

  health.score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, health.score + delta));
  health.totalCalls++;

  if (result === 'success') {
    health.consecutiveFailures = 0;
    health.lastSuccess = Date.now();
  } else {
    health.consecutiveFailures++;
    health.lastFailed = Date.now();
    health.totalFailures++;
  }

  console.log(`[Health] ${providerName}: ${result} (${delta > 0 ? '+' : ''}${delta}) → score=${health.score} streak=${health.consecutiveFailures} ${detail}`);
}

/**
 * 获取所有候选 provider，按 score 降序排列
 * @param {string[]} providerNames - 候选 provider 名称列表
 * @returns {{ name: string, score: number, available: boolean }[]}
 */
function rankProviders(providerNames) {
  // 先触发过期恢复
  recoverStale();

  return providerNames
    .map(name => {
      const h = getHealth(name);
      return {
        name,
        score: h.score,
        available: h.score >= THRESHOLD,
        consecutiveFailures: h.consecutiveFailures,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * 选择最优 provider
 * @param {string[]} candidates - 候选 provider 名称
 * @returns {{ selected: string, all: object[] }} - 选中的 provider 和完整排名
 */
function selectBest(candidates) {
  const ranked = rankProviders(candidates);
  const available = ranked.filter(r => r.available);

  if (available.length > 0) {
    return { selected: available[0].name, all: ranked };
  }

  // 所有 provider 都低于阈值 → 选 score 最高的 + 强制恢复到 50
  const best = ranked[0];
  if (best) {
    console.log(`[Health] 所有 provider score < ${THRESHOLD}，强制恢复 ${best.name} 到 50`);
    const h = getHealth(best.name);
    h.score = 50;
    return { selected: best.name, all: ranked };
  }

  return { selected: null, all: ranked };
}

/**
 * 恢复长时间未失败的 provider 的 score
 */
function recoverStale() {
  const now = Date.now();
  for (const [name, health] of healthMap) {
    if (health.score < MAX_SCORE && health.lastFailed > 0) {
      const elapsed = now - health.lastFailed;
      if (elapsed > RECOVERY_INTERVAL) {
        const recoveries = Math.floor(elapsed / RECOVERY_INTERVAL);
        const bonus = recoveries * RECOVERY_AMOUNT;
        health.score = Math.min(MAX_SCORE, health.score + bonus);
        health.lastFailed = now; // 重置计时
        if (bonus > 0) {
          console.log(`[Health] ${name}: 自动恢复 +${bonus} → score=${health.score}`);
        }
      }
    }
  }
}

/**
 * 强制重置某个 provider 的 score
 */
function resetScore(providerName, newScore = INITIAL_SCORE) {
  const health = getHealth(providerName);
  health.score = newScore;
  health.consecutiveFailures = 0;
  console.log(`[Health] ${name}: score 强制重置为 ${newScore}`);
}

/**
 * 获取所有 provider 的健康状态摘要（用于日志/调试）
 */
function getSummary() {
  const result = {};
  for (const [name, health] of healthMap) {
    result[name] = { ...health };
  }
  return result;
}

// ── 持久化 ──

function persist() {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const data = {};
    for (const [name, health] of healthMap) {
      data[name] = health;
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Health] 持久化失败:', e.message);
  }
}

function load() {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      for (const [name, health] of Object.entries(data)) {
        healthMap.set(name, health);
      }
      console.log(`[Health] 已加载 ${healthMap.size} 个 provider 健康数据`);
    }
  } catch (e) {
    console.warn('[Health] 加载缓存失败:', e.message);
  }
}

// 启动时加载 + 定时持久化
load();
setInterval(persist, PERSIST_INTERVAL);

export { report, selectBest, rankProviders, getHealth, getSummary, resetScore };
