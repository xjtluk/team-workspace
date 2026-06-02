#!/usr/bin/env node
/**
 * 小马群聊心跳监听脚本
 * 
 * 定时调用 heartbeat API，有新消息写入 to_小马.md
 * 用法：node poll-heartbeat.mjs [间隔秒数，默认 120]
 */

const FS = require('fs');
const PATH = require('path');

const CHAT_URL = 'http://localhost:3210';
const MAILBOX_PATH = 'D:\\BKS\\team\\通信\\to_小马.md';
const STATE_PATH = 'D:\\BKS\\team\\通信\\.heartbeat_state.json';

const INTERVAL = parseInt(process.argv[2] || '120') * 1000;

function loadState() {
  try {
    return JSON.parse(FS.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastSeenTimestamp: new Date().toISOString() };
  }
}

function saveState(state) {
  FS.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function poll() {
  const state = loadState();
  
  try {
    const url = `${CHAT_URL}/api/heartbeat?agent=小马&lastSeenTimestamp=${encodeURIComponent(state.lastSeenTimestamp)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.newMessages && data.newMessages.length > 0) {
      const now = new Date().toISOString();
      const header = `\n---\n> ${now} | ${data.newMessages.length} 条新消息\n\n`;
      
      const body = data.newMessages
        .filter(m => m.sender !== 'xiaoma') // 过滤自己发的
        .map(m => `**[${m.sender}]** ${m.content}\n`)
        .join('\n');

      if (body) {
        FS.appendFileSync(MAILBOX_PATH, header + body, 'utf8');
        console.log(`[${now}] 写入 ${data.newMessages.length} 条新消息`);
      }
    }

    state.lastSeenTimestamp = data.timestamp || new Date().toISOString();
    saveState(state);

  } catch (err) {
    console.error(`[${new Date().toISOString()}] 心跳失败:`, err.message);
  }
}

console.log(`[启动] 心跳监听 ${INTERVAL / 1000}s/次, 目标 ${CHAT_URL}`);
poll(); // 立即执行一次
setInterval(poll, INTERVAL);
