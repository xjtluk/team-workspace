#!/usr/bin/env node
/**
 * BKS Team Workspace 进程守护 — PM2 替代方案
 *
 * 功能：
 *   1. 启动所有服务（server + 3 个 Agent）
 *   2. 崩溃自动重启（指数退避）
 *   3. 健康检查 + 告警日志
 *   4. 优雅退出（SIGINT/SIGTERM）
 *
 * 用法：
 *   node scripts/watchdog.mjs
 *   node scripts/watchdog.mjs --no-cx    # 不启动 CX
 */

import { spawn, execSync } from 'child_process';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = 'D:/BKS/projects/team-workspace';
const LOG_DIR = join(PROJECT_DIR, 'logs');
const PID_FILE = join(PROJECT_DIR, '.watchdog.pid');

// ── 服务定义 ──
const SERVICES = [
  {
    name: 'workspace-server',
    script: 'server/index.js',
    args: [],
    env: { NODE_ENV: 'production', PORT: '3210' },
    maxRestarts: 20,
    enabled: true,
  },
  {
    name: 'cc-listener',
    script: 'start-cc.mjs',
    args: [],
    env: { NODE_ENV: 'production' },
    maxRestarts: 20,
    enabled: true,
  },
  // xiaoma-listener 已停用 — 小马AI不再需要，只保留真实小马(Marvis)
  // {
  //   name: 'xiaoma-listener',
  //   script: 'start-xiaoma.mjs',
  //   ...
  // },
  {
    name: 'cx-listener',
    script: 'start-cx.mjs',
    args: [],
    env: { NODE_ENV: 'production' },
    maxRestarts: 20,
    enabled: !process.argv.includes('--no-cx'),
  },
];

// ── 日志函数 ──
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function log(level, service, message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] [${level}] [${service}] ${message}`;
  console.log(line);
  try {
    appendFileSync(join(LOG_DIR, 'watchdog.log'), line + '\n');
  } catch {}
}

// ── 进程管理 ──
const processes = new Map(); // name → { proc, restarts, lastCrash }

function startService(service) {
  const scriptPath = join(PROJECT_DIR, service.script);
  const mergedEnv = { ...process.env, ...service.env };

  log('INFO', service.name, `启动: node ${service.script}`);

  const proc = spawn('node', [scriptPath, ...service.args], {
    cwd: PROJECT_DIR,
    env: mergedEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const state = {
    proc,
    restarts: 0,
    lastCrash: 0,
    startTime: Date.now(),
  };
  processes.set(service.name, state);

  // 日志输出
  const logFile = join(LOG_DIR, `${service.name}.log`);
  const logStream = (data) => {
    const text = data.toString();
    process.stdout.write(`[${service.name}] ${text}`);
    try { appendFileSync(logFile, text); } catch {}
  };
  proc.stdout.on('data', logStream);
  proc.stderr.on('data', logStream);

  // 崩溃处理
  proc.on('exit', (code, signal) => {
    const uptime = Math.round((Date.now() - state.startTime) / 1000);
    log('WARN', service.name, `进程退出 (code=${code}, signal=${signal}, uptime=${uptime}s)`);

    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      log('INFO', service.name, '正常停止，不重启');
      return;
    }

    state.restarts++;
    if (state.restarts > service.maxRestarts) {
      log('ERROR', service.name, `重启次数超限 (${state.restarts}/${service.maxRestarts})，停止守护`);
      return;
    }

    // 指数退避：10s, 20s, 40s, 80s... 最大 5 分钟
    const delay = Math.min(10000 * Math.pow(2, state.restarts - 1), 300000);
    log('INFO', service.name, `${delay / 1000}s 后重启 (第 ${state.restarts} 次)`);

    state.lastCrash = Date.now();
    setTimeout(() => {
      const newState = startService(service);
      newState.restarts = state.restarts;
    }, delay);
  });

  proc.on('error', (err) => {
    log('ERROR', service.name, `启动失败: ${err.message}`);
  });

  return state;
}

// ── 健康检查 ──
function healthCheck() {
  for (const [name, state] of processes) {
    if (state.proc.killed || state.proc.exitCode !== null) {
      log('WARN', name, '进程已退出，等待自动重启');
    }
  }
}

// ── 主流程 ──
log('INFO', 'watchdog', '=== BKS Team Workspace Watchdog 启动 ===');
log('INFO', 'watchdog', `项目目录: ${PROJECT_DIR}`);
log('INFO', 'watchdog', `服务数量: ${SERVICES.filter(s => s.enabled).length}`);

// 写 PID 文件
writeFileSync(PID_FILE, JSON.stringify({
  pid: process.pid,
  startTime: Date.now(),
  services: SERVICES.filter(s => s.enabled).map(s => s.name),
}), 'utf8');

// 启动所有服务
for (const service of SERVICES) {
  if (service.enabled) {
    startService(service);
  } else {
    log('INFO', service.name, '已禁用，跳过');
  }
}

// 定期进程健康检查（每 60 秒）
setInterval(healthCheck, 60000);

// HTTP 健康探针（每 30 秒）
const HEALTH_URL = 'http://localhost:3210/api/health';
let healthFailCount = 0;
const HEALTH_FAIL_THRESHOLD = 5; // 连续失败 5 次触发重启

async function httpHealthCheck() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      if (healthFailCount > 0) {
        log('INFO', 'watchdog', `健康检查恢复 (连续失败 ${healthFailCount} 次后)`);
      }
      healthFailCount = 0;
    } else {
      healthFailCount++;
      log('WARN', 'watchdog', `健康检查失败: HTTP ${res.status} (连续第 ${healthFailCount} 次)`);
    }
  } catch (err) {
    healthFailCount++;
    log('WARN', 'watchdog', `健康检查异常: ${err.message} (连续第 ${healthFailCount} 次)`);

    if (healthFailCount >= HEALTH_FAIL_THRESHOLD) {
      log('ERROR', 'watchdog', `连续 ${healthFailCount} 次健康检查失败，重启 workspace-server`);
      const state = processes.get('workspace-server');
      if (state && !state.proc.killed) {
        state.proc.kill('SIGTERM');
      }
      healthFailCount = 0;
    }
  }
}
setInterval(httpHealthCheck, 30000);

// ── Agent 心跳健康检查（每 60 秒）──
const agentUnhealthyCount = new Map(); // agentId → 连续 unhealthy 次数
const AGENT_UNHEALTHY_THRESHOLD = 2;   // 连续 2 次 unhealthy 触发重启

async function agentHealthCheck() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return;
    const data = await res.json();
    if (!data.agents) return;

    for (const [agentId, info] of Object.entries(data.agents)) {
      // 只监控 cc 和 cx
      if (agentId !== 'cc' && agentId !== 'cx') continue;

      if (!info.healthy) {
        const count = (agentUnhealthyCount.get(agentId) || 0) + 1;
        agentUnhealthyCount.set(agentId, count);
        log('WARN', agentId, `Agent 无心跳 (${count}/${AGENT_UNHEALTHY_THRESHOLD})`);

        if (count >= AGENT_UNHEALTHY_THRESHOLD) {
          log('ERROR', agentId, `连续 ${count} 次无心跳，触发重启`);
          const state = processes.get(`${agentId}-listener`);
          if (state && !state.proc.killed && state.proc.exitCode === null) {
            state.proc.kill('SIGTERM');
          }
          agentUnhealthyCount.set(agentId, 0);
        }
      } else {
        if (agentUnhealthyCount.has(agentId)) {
          log('INFO', agentId, '心跳恢复正常');
          agentUnhealthyCount.delete(agentId);
        }
      }
    }
  } catch {}
}
setInterval(agentHealthCheck, 60000);

// 每日数据库备份（每 24 小时）
let lastBackupDate = '';
function dailyBackup() {
  const today = new Date().toISOString().substring(0, 10);
  if (today === lastBackupDate) return;
  lastBackupDate = today;
  log('INFO', 'watchdog', '执行每日数据库备份...');
  try {
    execSync('node scripts/backup-db.mjs', { cwd: PROJECT_DIR, windowsHide: true });
    log('INFO', 'watchdog', '每日备份完成');
  } catch (err) {
    log('ERROR', 'watchdog', `每日备份失败: ${err.message}`);
  }
}
setInterval(dailyBackup, 60 * 60 * 1000); // 每小时检查一次，每天只执行一次

// 优雅退出
function shutdown(signal) {
  log('INFO', 'watchdog', `收到 ${signal}，正在关闭所有服务...`);
  for (const [name, state] of processes) {
    if (!state.proc.killed && state.proc.exitCode === null) {
      log('INFO', name, '发送 SIGTERM');
      state.proc.kill('SIGTERM');
    }
  }
  // 5 秒后强制退出
  setTimeout(() => {
    log('WARN', 'watchdog', '强制退出');
    process.exit(0);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log('INFO', 'watchdog', '所有服务已启动，守护中... (Ctrl+C 退出)');
