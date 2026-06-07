#!/usr/bin/env node
/**
 * BKS Team Workspace 进程守护 — 唯一进程管理者
 *
 * 功能：
 *   1. 启动所有服务（server + CC + CX）
 *   2. 崩溃自动重启（指数退避）
 *   3. 健康检查 + 告警日志
 *   4. HTTP 控制 API（端口 3211）
 *   5. 优雅退出（SIGINT/SIGTERM）
 *
 * 用法：
 *   node scripts/watchdog.mjs
 *   node scripts/watchdog.mjs --no-cx    # 不启动 CX
 *
 * 控制 API（端口 3211）：
 *   GET  /status              — 所有服务状态
 *   POST /restart/:service    — 重启指定服务
 *   POST /stop/:service       — 停止指定服务
 *   POST /start/:service      — 启动指定服务
 *   GET  /health              — watchdog 自身健康
 */

import { spawn, execSync } from 'child_process';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createServer } from 'http';
import net from 'net';
import config from '../config/index.js';

const PROJECT_DIR = config.paths.projectDir;
const LOG_DIR = join(PROJECT_DIR, 'logs');
const PID_FILE = join(PROJECT_DIR, '.watchdog.pid');
const CONTROL_PORT = 3211;
const SERVER_PORT = 3210;

// ── 服务定义 ──
const SERVICES = [
  {
    name: 'workspace-server',
    script: 'server/index.js',
    args: [],
    env: { NODE_ENV: 'production', PORT: String(SERVER_PORT) },
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

// ── 工具函数 ──
async function isPortInUse(port) {
  // 用 TCP connect 检测端口是否被占用（比 createServer 更可靠）
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── 进程管理 ──
const processes = new Map(); // name → { proc, restarts, lastCrash, startTime, service }

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
    service,
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

    // 如果是手动重启触发的退出，跳过自动重启（由 restartService() 负责）
    if (state.restarting) {
      log('INFO', service.name, '手动重启中，跳过自动重启');
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

function stopService(name) {
  const state = processes.get(name);
  if (!state || state.proc.killed || state.proc.exitCode !== null) {
    return false;
  }
  log('INFO', name, '发送 SIGTERM');
  state.proc.kill('SIGTERM');
  return true;
}

function restartService(name) {
  const state = processes.get(name);
  if (!state) return false;
  // 标记手动重启中，阻止 exit 回调再次触发重启
  state.restarting = true;
  // 停止旧进程
  if (!state.proc.killed && state.proc.exitCode === null) {
    state.proc.kill('SIGTERM');
  }
  // 手动触发重启（不等 exit 事件）
  setTimeout(() => {
    const service = state.service;
    processes.delete(name);
    const newState = startService(service);
    newState.restarts = 0;
    log('INFO', name, '手动重启完成');
  }, 1000);
  return true;
}

// ── 健康检查 ──
function healthCheck() {
  for (const [name, state] of processes) {
    if (state.proc.killed || state.proc.exitCode !== null) {
      log('WARN', name, '进程已退出，等待自动重启');
    }
  }
}

// ── HTTP 健康探针（每 30 秒）──
const HEALTH_URL = `http://localhost:${SERVER_PORT}/api/health`;
let healthFailCount = 0;
const HEALTH_FAIL_THRESHOLD = 5;

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
      restartService('workspace-server');
      healthFailCount = 0;
    }
  }
}

// ── Agent 心跳健康检查（每 60 秒）──
const agentUnhealthyCount = new Map();
const AGENT_UNHEALTHY_THRESHOLD = 2;

const AGENT_SERVICE_MAP = {
  cc: 'cc-listener',
  cx: 'cx-listener',
};

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
      if (!AGENT_SERVICE_MAP[agentId]) continue;

      if (!info.healthy) {
        const count = (agentUnhealthyCount.get(agentId) || 0) + 1;
        agentUnhealthyCount.set(agentId, count);
        log('WARN', agentId, `Agent 无心跳 (${count}/${AGENT_UNHEALTHY_THRESHOLD})`);

        if (count >= AGENT_UNHEALTHY_THRESHOLD) {
          const serviceName = AGENT_SERVICE_MAP[agentId];
          log('ERROR', agentId, `连续 ${count} 次无心跳，重启 ${serviceName}`);
          restartService(serviceName);
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

// ── 每日数据库备份（每 24 小时）──
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

// ── HTTP 控制 API ──
function getServiceStatus() {
  const result = {};
  for (const [name, state] of processes) {
    const isAlive = !state.proc.killed && state.proc.exitCode === null;
    result[name] = {
      pid: isAlive ? state.proc.pid : null,
      status: isAlive ? 'running' : 'stopped',
      uptime: isAlive ? Math.round((Date.now() - state.startTime) / 1000) : 0,
      restarts: state.restarts,
      lastCrash: state.lastCrash || null,
      maxRestarts: state.service.maxRestarts,
    };
  }
  return result;
}

function startControlServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${CONTROL_PORT}`);
    const path = url.pathname;
    const method = req.method;

    // CORS headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // GET /status
    if (method === 'GET' && path === '/status') {
      res.end(JSON.stringify({ ok: true, services: getServiceStatus() }));
      return;
    }

    // GET /health
    if (method === 'GET' && path === '/health') {
      res.end(JSON.stringify({ status: 'ok', pid: process.pid, uptime: process.uptime() }));
      return;
    }

    // POST /restart/:service
    const restartMatch = path.match(/^\/restart\/(.+)$/);
    if (method === 'POST' && restartMatch) {
      const serviceName = restartMatch[1];
      if (!processes.has(serviceName)) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: `Service '${serviceName}' not found` }));
        return;
      }
      const ok = restartService(serviceName);
      res.end(JSON.stringify({ ok, service: serviceName, action: 'restart' }));
      return;
    }

    // POST /stop/:service
    const stopMatch = path.match(/^\/stop\/(.+)$/);
    if (method === 'POST' && stopMatch) {
      const serviceName = stopMatch[1];
      if (!processes.has(serviceName)) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: `Service '${serviceName}' not found` }));
        return;
      }
      const ok = stopService(serviceName);
      res.end(JSON.stringify({ ok, service: serviceName, action: 'stop' }));
      return;
    }

    // POST /start/:service
    const startMatch = path.match(/^\/start\/(.+)$/);
    if (method === 'POST' && startMatch) {
      const serviceName = startMatch[1];
      const serviceDef = SERVICES.find(s => s.name === serviceName);
      if (!serviceDef) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: `Service '${serviceName}' not found` }));
        return;
      }
      if (processes.has(serviceName)) {
        const state = processes.get(serviceName);
        if (!state.proc.killed && state.proc.exitCode === null) {
          res.end(JSON.stringify({ ok: true, service: serviceName, action: 'already_running' }));
          return;
        }
      }
      startService(serviceDef);
      res.end(JSON.stringify({ ok: true, service: serviceName, action: 'start' }));
      return;
    }

    // 404
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found. Use: GET /status, POST /restart/:service, POST /stop/:service, POST /start/:service, GET /health' }));
  });

  server.listen(CONTROL_PORT, '127.0.0.1', () => {
    log('INFO', 'watchdog', `控制 API 监听端口 ${CONTROL_PORT} (仅本地访问)`);
  });

  server.on('error', (err) => {
    log('ERROR', 'watchdog', `控制 API 启动失败: ${err.message}`);
  });
}

// ── 启动前冲突检测 ──
async function checkConflicts() {
  // 检查 watchdog 自身是否已在运行
  if (existsSync(PID_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      if (data.pid && isProcessAlive(data.pid)) {
        log('ERROR', 'watchdog', `watchdog 已在运行 (PID: ${data.pid})，退出`);
        process.exit(1);
      }
      log('INFO', 'watchdog', '发现过期 PID 文件，清理');
      unlinkSync(PID_FILE);
    } catch {
      try { unlinkSync(PID_FILE); } catch {}
    }
  }

  // 检查 server 端口是否已被占用
  const serverPortUsed = await isPortInUse(SERVER_PORT);
  if (serverPortUsed) {
    log('WARN', 'watchdog', `端口 ${SERVER_PORT} 已被占用，将跳过 server 启动，仅监控现有进程`);
  }

  // 检查控制 API 端口是否已被占用
  const controlPortUsed = await isPortInUse(CONTROL_PORT);
  if (controlPortUsed) {
    log('WARN', 'watchdog', `控制 API 端口 ${CONTROL_PORT} 已被占用，跳过控制 API 启动`);
  }

  return { serverPortUsed, controlPortUsed };
}

// ── 主流程 ──
async function main() {
  log('INFO', 'watchdog', '=== BKS Team Workspace Watchdog 启动 ===');
  log('INFO', 'watchdog', `项目目录: ${PROJECT_DIR}`);
  log('INFO', 'watchdog', `服务数量: ${SERVICES.filter(s => s.enabled).length}`);

  // ── 启动前文件完整性检查 ──
  log('INFO', 'watchdog', '执行启动前文件完整性检查...');
  try {
    execSync(`node "${join(PROJECT_DIR, 'scripts', 'check-files.mjs')}"`, {
      cwd: PROJECT_DIR,
      stdio: 'pipe',
      windowsHide: true,
    });
    log('INFO', 'watchdog', '文件完整性检查通过');
  } catch (e) {
    const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    log('ERROR', 'watchdog', `文件完整性检查失败:\n${output}`);
    log('WARN', 'watchdog', '存在文件损坏，仍然继续启动（部分服务可能异常）');
  }

  // 冲突检测
  const { serverPortUsed, controlPortUsed } = await checkConflicts();

  // 写 PID 文件
  writeFileSync(PID_FILE, JSON.stringify({
    pid: process.pid,
    startTime: Date.now(),
    services: SERVICES.filter(s => s.enabled).map(s => s.name),
  }), 'utf8');

  // 启动控制 API（端口未被占用时）
  if (!controlPortUsed) {
    startControlServer();
  }

  // 启动服务
  for (const service of SERVICES) {
    if (!service.enabled) {
      log('INFO', service.name, '已禁用，跳过');
      continue;
    }

    // 如果 server 端口已被占用，跳过 server 启动
    if (service.name === 'workspace-server' && serverPortUsed) {
      log('INFO', service.name, '端口已占用，跳过启动（仅监控）');
      continue;
    }

    startService(service);
  }

  // 定期健康检查
  setInterval(healthCheck, 60000);
  setInterval(httpHealthCheck, 30000);
  setInterval(agentHealthCheck, 60000);
  setInterval(dailyBackup, 60 * 60 * 1000);

  log('INFO', 'watchdog', '所有服务已启动，守护中...');
  log('INFO', 'watchdog', `控制 API: http://localhost:${CONTROL_PORT}/status`);
}

// ── 优雅退出 ──
function shutdown(signal) {
  log('INFO', 'watchdog', `收到 ${signal}，正在关闭所有服务...`);
  for (const [name, state] of processes) {
    if (!state.proc.killed && state.proc.exitCode === null) {
      log('INFO', name, '发送 SIGTERM');
      state.proc.kill('SIGTERM');
    }
  }
  // 清理 PID 文件
  try { unlinkSync(PID_FILE); } catch {}
  // 5 秒后强制退出
  setTimeout(() => {
    log('WARN', 'watchdog', '强制退出');
    process.exit(0);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(err => {
  log('ERROR', 'watchdog', `启动失败: ${err.message}`);
  process.exit(1);
});
