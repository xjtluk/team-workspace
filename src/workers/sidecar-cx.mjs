#!/usr/bin/env node
/**
 * CX Sidecar — CX (Codex CLI) 真实入住 sidecar
 *
 * 职责：
 *   1. 注册 CX 到聊天室
 *   2. 监听群聊 @CX 消息
 *   3. 调用 codex exec 子进程执行任务
 *   4. 将回复发回群聊
 *   5. 定期上报状态
 */
import { SidecarConnection, isAtAgent, reportStatus, sendMessage } from '../sdk/sidecar-core.mjs';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── 配置 ──
const AGENT_ID = 'cx';
const AGENT_NAME = 'CX';
const PROJECT_DIR = process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
const CODEX_SANDBOX = process.env.CODEX_SANDBOX || 'read-only';
const CODEX_MODEL = process.env.CODEX_MODEL || 'deepseek-v4-pro';
const CODEX_PATH = process.env.CODEX_PATH || 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
const REPLY_FILE = join(PROJECT_DIR, 'data', 'cx-reply.txt');

// 确保 data 目录存在
const dataDir = join(PROJECT_DIR, 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// ── 实例 ──
const conn = new SidecarConnection({
  agentId: AGENT_ID,
  agentName: AGENT_NAME,
  color: '#10A37F',
  serverUrl: 'http://localhost:3210',
});

// ── 状态上报 ──
async function pingStatus() {
  await reportStatus(AGENT_ID, 'idle', '空闲中', 0);
}

// ── codex exec 调用 ──
function execCodex(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      CODEX_PATH,
      'exec',
      '-m', CODEX_MODEL,
      '-C', PROJECT_DIR,
      '-s', CODEX_SANDBOX,
      '-o', REPLY_FILE,
    ];

    const child = spawn('node', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // 通过 stdin 传入 prompt（避免中文编码问题）
    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`codex exec 退出码 ${code}: ${stderr.substring(0, 200)}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', reject);
  });
}

// ── 读取回复文件 ──
function readReplyFile() {
  if (!existsSync(REPLY_FILE)) return '';
  try {
    const content = readFileSync(REPLY_FILE, 'utf-8').trim();
    try { unlinkSync(REPLY_FILE); } catch {}
    return content;
  } catch {
    return '';
  }
}

// ── 消息处理 ──
async function handleMessage(event) {
  if (event.type !== 'new_message') return;
  const { payload: msg } = event;
  if (!msg || !msg.content) return;

  // 忽略自己发的消息
  if (msg.from === AGENT_ID) return;

  // 忽略协议消息（防止自循环）
  if (msg.content.includes('[收到]') || msg.content.includes('[问题]') || msg.content.includes('[完成]') || msg.content.includes('[子任务完成]')) return;

  // 只处理 @CX 的消息
  if (!isAtAgent(msg.content, AGENT_ID)) return;

  console.log(`[CX-Sidecar] 收到 @CX 消息: "${msg.content.substring(0, 80)}..."`);

  try {
    // 更新状态为 working
    await reportStatus(AGENT_ID, 'working', '正在处理 @CX 消息', 30);

    // 发送已收到通知
    await sendMessage(AGENT_ID, `@${msg.from} [收到] 消息已收到，正在执行: ${msg.content.substring(0, 50)}...`);

    // 执行 codex exec
    console.log(`[CX-Sidecar] 调用 codex exec (model: ${CODEX_MODEL})`);
    await execCodex(msg.content);

    // 更新进度
    await reportStatus(AGENT_ID, 'working', '正在组织回复', 70);

    // 读取回复
    const reply = readReplyFile();

    if (reply) {
      await sendMessage(AGENT_ID, reply);
      console.log(`[CX-Sidecar] 回复已发送 (${reply.length} 字符)`);
    } else {
      await sendMessage(AGENT_ID, `@${msg.from} [完成] 任务已完成，无文本输出`);
      console.log(`[CX-Sidecar] 任务完成，无文本输出`);
    }

    // 恢复 idle
    await reportStatus(AGENT_ID, 'idle', '空闲中', 0);
  } catch (err) {
    console.error(`[CX-Sidecar] 处理失败: ${err.message}`);
    await sendMessage(AGENT_ID, `@${msg.from} [问题] 任务执行失败: ${err.message.substring(0, 100)}`);
    await reportStatus(AGENT_ID, 'error', '任务执行失败', 0);
    setTimeout(() => reportStatus(AGENT_ID, 'idle', '空闲中', 0), 3000);
  }
}

// ── 主流程 ──
async function main() {
  console.log(`[CX-Sidecar] 启动...`);
  console.log(`[CX-Sidecar] 项目目录: ${PROJECT_DIR}`);
  console.log(`[CX-Sidecar] 模型: ${CODEX_MODEL}`);
  console.log(`[CX-Sidecar] 沙箱: ${CODEX_SANDBOX}`);
  console.log(`[CX-Sidecar] 回复文件: ${REPLY_FILE}`);

  conn.on('message', handleMessage);
  await conn.connect();
  await pingStatus();
  setInterval(pingStatus, 30000);

  console.log(`[CX-Sidecar] 启动完成，等待 @CX 消息...`);

  const cleanup = async () => {
    console.log(`[CX-Sidecar] 正在断开...`);
    await reportStatus(AGENT_ID, 'offline', '已离线', 0);
    await conn.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error(`[CX-Sidecar] 启动失败:`, err);
  process.exit(1);
});
