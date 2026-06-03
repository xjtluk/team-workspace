#!/usr/bin/env node
/**
 * Workspace Server Watchdog
 *
 * 每30秒检查一次workspace server是否在运行，如果不在则启动。
 * 配合Windows任务计划程序使用，在系统启动时自动运行。
 *
 * 用法：node watchdog.mjs
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK_INTERVAL = 30000; // 30秒
const PORT = 3210;

async function isServerRunning() {
  try {
    const { stdout } = await execAsync(`netstat -ano | findstr ":${PORT}" | findstr "LISTENING"`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function startServer() {
  try {
    const batPath = path.join(__dirname, 'start-server.bat');
    execAsync(`start /B "" "${batPath}"`, { cwd: __dirname });
    console.log(`[Watchdog] Server started at ${new Date().toISOString()}`);
  } catch (err) {
    console.error(`[Watchdog] Failed to start server:`, err.message);
  }
}

async function check() {
  const running = await isServerRunning();
  if (!running) {
    console.log(`[Watchdog] Server not running, starting...`);
    await startServer();
  }
}

console.log(`[Watchdog] Monitoring workspace server on port ${PORT}`);
console.log(`[Watchdog] Check interval: ${CHECK_INTERVAL / 1000}s`);

// 首次检查
await check();

// 定期检查
setInterval(check, CHECK_INTERVAL);
