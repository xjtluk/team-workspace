#!/usr/bin/env node
/**
 * Heartbeat 守护进程
 *
 * 每2分钟轮询一次 heartbeat API，将 @小马 的新消息写入信箱
 */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

const HEARTBEAT_URL = 'http://127.0.0.1:3210/api/heartbeat';
const AGENT_ID = 'xiaoma';
const MAILBOX_PATH = 'D:\\BKS\\team\\通信\\to_小马.md';
const TIMESTAMP_FILE = join(process.cwd(), '.heartbeat-timestamp');
const POLL_INTERVAL = 2 * 60 * 1000; // 2 分钟

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

function saveTimestamp(ts) {
  try {
    writeFileSync(TIMESTAMP_FILE, String(ts), 'utf8');
  } catch (err) {
    console.error('[Heartbeat] 保存时间戳失败:', err.message);
  }
}

function formatTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

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

async function poll() {
  const lastTimestamp = getLastTimestamp();

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
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`API error: ${JSON.stringify(data)}`);
    }

    const atXiaomaMessages = data.newMessages.filter(msg =>
      msg.from !== 'xiaoma' && msg.content.includes('@小马')
    );

    if (atXiaomaMessages.length > 0) {
      writeToMailbox(atXiaomaMessages);
      console.log(`[Heartbeat] ${formatTime(Date.now())} - ${atXiaomaMessages.length} 条新消息`);
    }

    saveTimestamp(data.serverTimestamp);

  } catch (err) {
    console.error(`[Heartbeat] ${formatTime(Date.now())} 轮询失败:`, err.message);
  }
}

// 启动
console.log(`[Heartbeat] 守护进程启动，每 ${POLL_INTERVAL / 1000} 秒轮询一次`);
poll();
setInterval(poll, POLL_INTERVAL);

// 优雅退出
process.on('SIGINT', () => {
  console.log('[Heartbeat] 守护进程退出');
  process.exit(0);
});
