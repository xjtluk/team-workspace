#!/usr/bin/env node
/**
 * Heartbeat 轮询脚本
 *
 * 功能：
 *   1. 定时调用 heartbeat API，获取自上次检查以来的新消息
 *   2. 将 @小马 的消息写入 D:\BKS\team\通信\to_小马.md
 *   3. 更新 lastSeenTimestamp 到本地文件
 *
 * 使用方式：
 *   node scripts/heartbeat-poller.mjs
 *
 * 配合 pm2 定时任务：
 *   pm2 start scripts/heartbeat-poller.mjs --name heartbeat-poller
 */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

const HEARTBEAT_URL = 'http://127.0.0.1:3210/api/heartbeat';
const AGENT_ID = 'xiaoma';
const MAILBOX_PATH = 'D:\\BKS\\team\\通信\\to_小马.md';
const TIMESTAMP_FILE = join(process.cwd(), '.heartbeat-timestamp');

// 读取上次检查时间戳
function getLastTimestamp() {
  try {
    if (existsSync(TIMESTAMP_FILE)) {
      const data = readFileSync(TIMESTAMP_FILE, 'utf8').trim();
      return parseInt(data, 10) || 0;
    }
  } catch (err) {
    console.error('[Heartbeat] 读取时间戳失败:', err.message);
  }
  return 0;
}

// 保存本次检查时间戳
function saveTimestamp(ts) {
  try {
    writeFileSync(TIMESTAMP_FILE, String(ts), 'utf8');
  } catch (err) {
    console.error('[Heartbeat] 保存时间戳失败:', err.message);
  }
}

// 格式化时间戳
function formatTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 写入信箱
function writeToMailbox(messages) {
  if (!messages || messages.length === 0) return;

  const now = formatTime(Date.now());
  let content = `\n\n---\n**自动轮询消息 (${now})**\n\n`;

  messages.forEach(msg => {
    const time = formatTime(msg.timestamp);
    content += `**${msg.fromName}** (${time}):\n${msg.content}\n\n`;
  });

  try {
    appendFileSync(MAILBOX_PATH, content, 'utf8');
    console.log(`[Heartbeat] 写入 ${messages.length} 条消息到信箱`);
  } catch (err) {
    console.error('[Heartbeat] 写入信箱失败:', err.message);
  }
}

// 主函数
async function main() {
  const lastTimestamp = getLastTimestamp();
  console.log(`[Heartbeat] 开始轮询，上次检查: ${lastTimestamp ? formatTime(lastTimestamp) : '首次'}`);

  try {
    const response = await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: AGENT_ID,
        lastSeenTimestamp: lastTimestamp,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`API 返回错误: ${JSON.stringify(data)}`);
    }

    console.log(`[Heartbeat] 新消息: ${data.newMessages.length} 条`);

    // 筛选 @小马 的消息
    const atXiaomaMessages = data.newMessages.filter(msg =>
      msg.from !== 'xiaoma' && msg.content.includes('@小马')
    );

    if (atXiaomaMessages.length > 0) {
      writeToMailbox(atXiaomaMessages);
    }

    // 更新时间戳
    saveTimestamp(data.serverTimestamp);
    console.log(`[Heartbeat] 完成，时间戳已更新: ${formatTime(data.serverTimestamp)}`);

  } catch (err) {
    console.error('[Heartbeat] 轮询失败:', err.message);
    process.exit(1);
  }
}

main();
