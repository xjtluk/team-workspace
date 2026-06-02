#!/usr/bin/env node
/**
 * Marvis 上线标记
 * 在 Marvis 的 Claude Code 会话启动时调用
 * 用法：node scripts/marvis-online.mjs
 *
 * 会创建 .marvis-online 文件，小马 Listener 检测到后静默
 * 每 10 秒自动刷新文件时间戳，保持在线状态
 * 退出时自动删除标记
 */

import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const FLAG_FILE = join(process.cwd(), '.marvis-online');

// 写入上线标记
writeFileSync(FLAG_FILE, `marvis-online-${Date.now()}`, 'utf8');
console.log('[Marvis] 已上线，小马 Listener 进入静默模式');

// 每 10 秒刷新时间戳
const heartbeat = setInterval(() => {
  try {
    writeFileSync(FLAG_FILE, `marvis-online-${Date.now()}`, 'utf8');
  } catch {}
}, 10000);

// 退出时清理
function cleanup() {
  clearInterval(heartbeat);
  try { if (existsSync(FLAG_FILE)) unlinkSync(FLAG_FILE); } catch {}
  console.log('[Marvis] 已离线，小马 Listener 恢复代理模式');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// 保持运行
console.log('[Marvis] 按 Ctrl+C 离线');
setInterval(() => {}, 1000); // 保持进程存活
