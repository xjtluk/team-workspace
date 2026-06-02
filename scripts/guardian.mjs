#!/usr/bin/env node
/**
 * 进程守护器 — 替代 PM2，监听子进程崩溃并自动重启
 * v2: 增加功能健康检查（HTTP 探测）
 *
 * 用法：node scripts/guardian.mjs <script> [args...]
 * 示例：node scripts/guardian.mjs src/workers/cc-listener.mjs
 *
 * 环境变量：
 *   MAX_RESTARTS       — 最大重启次数（默认 10，重置窗口 60s）
 *   RESTART_DELAY      — 重启延迟 ms（默认 3000）
 *   WS_TOKEN           — 传递给子进程的认证 token
 *   HEALTH_CHECK_URL   — 健康检查 URL（默认 http://127.0.0.1:3210/api/health）
 *   HEALTH_CHECK_INTERVAL — 健康检查间隔 ms（默认 15000）
 *   HEALTH_CHECK_TIMEOUT  — 健康检查超时 ms（默认 5000）
 *   MAX_HEALTH_FAILS   — 连续健康检查失败次数触发重启（默认 3）
 */

import { spawn } from 'child_process';
import { resolve, basename } from 'path';

const script = process.argv[2];
if (!script) {
  console.error('用法: node guardian.mjs <script> [args...]');
  process.exit(1);
}

const args = process.argv.slice(3);
const MAX_RESTARTS = parseInt(process.env.MAX_RESTARTS || '10');
const RESTART_DELAY = parseInt(process.env.RESTART_DELAY || '3000');
const RESET_WINDOW = 60000; // 60s 内重启次数重置
const HEALTH_URL = process.env.HEALTH_CHECK_URL || 'http://127.0.0.1:3210/api/health';
const HEALTH_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL || '15000');
const HEALTH_TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000');
const MAX_HEALTH_FAILS = parseInt(process.env.MAX_HEALTH_FAILS || '3');

let restartCount = 0;
let lastRestartTime = 0;
let child = null;
let stopping = false;
let healthFailCount = 0;
let healthCheckTimer = null;
let childStartTime = 0;

const scriptName = basename(script, '.mjs');

function log(msg) {
  const time = new Date().toLocaleTimeString('zh-CN');
  console.log(`[Guardian:${scriptName}] ${time} ${msg}`);
}

// ═══════════════════════ 功能健康检查 ═══════════════════════
async function checkHealth() {
  // 进程刚启动，给 10 秒预热时间
  if (Date.now() - childStartTime < 10000) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);

    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      if (healthFailCount > 0) {
        log(`健康检查恢复 (之前失败 ${healthFailCount} 次)`);
      }
      healthFailCount = 0;
    } else {
      healthFailCount++;
      log(`健康检查返回异常状态 ${response.status} (${healthFailCount}/${MAX_HEALTH_FAILS})`);
    }
  } catch (err) {
    healthFailCount++;
    log(`健康检查失败: ${err.message} (${healthFailCount}/${MAX_HEALTH_FAILS})`);
  }

  // 连续失败达到阈值 → 重启
  if (healthFailCount >= MAX_HEALTH_FAILS) {
    log(`连续 ${MAX_HEALTH_FAILS} 次健康检查失败，强制重启子进程`);
    healthFailCount = 0;
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    if (child) {
      child.kill('SIGTERM');
      // 如果 5 秒后还没退出，强制 SIGKILL
      setTimeout(() => {
        if (child && !child.killed) {
          log('子进程无响应，强制终止 (SIGKILL)');
          child.kill('SIGKILL');
        }
      }, 5000);
    }
  }
}

function startHealthCheck() {
  childStartTime = Date.now();
  healthFailCount = 0;
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = setInterval(checkHealth, HEALTH_INTERVAL);
  log(`健康检查已启动 (间隔 ${HEALTH_INTERVAL / 1000}s, URL: ${HEALTH_URL})`);
}

function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// ═══════════════════════ 进程管理 ═══════════════════════
function start() {
  const scriptPath = resolve(script);
  log(`启动: node ${scriptPath}`);

  child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  startHealthCheck();

  child.on('exit', (code, signal) => {
    stopHealthCheck();

    if (stopping) {
      log(`正常退出 (code=${code})`);
      process.exit(0);
    }

    const now = Date.now();
    if (now - lastRestartTime > RESET_WINDOW) {
      restartCount = 0;
    }
    restartCount++;
    lastRestartTime = now;

    if (restartCount > MAX_RESTARTS) {
      log(`崩溃次数过多 (${restartCount}/${MAX_RESTARTS})，停止重启`);
      process.exit(1);
    }

    log(`进程退出 (code=${code}, signal=${signal})，${RESTART_DELAY / 1000}秒后重启 (${restartCount}/${MAX_RESTARTS})`);
    setTimeout(start, RESTART_DELAY);
  });

  child.on('error', (err) => {
    stopHealthCheck();
    log(`启动失败: ${err.message}`);
  });
}

// 优雅退出
process.on('SIGINT', () => {
  stopping = true;
  log('收到 SIGINT，正在停止...');
  stopHealthCheck();
  if (child) child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  stopping = true;
  log('收到 SIGTERM，正在停止...');
  stopHealthCheck();
  if (child) child.kill('SIGTERM');
});

start();
