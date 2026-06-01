#!/usr/bin/env node
/**
 * 小马 Agent — 定时轮询模式
 *
 * 职责：
 *   1. 定时读取群聊历史
 *   2. 检查是否有新消息需要小马回复
 *   3. 有就回复，没有就跳过
 *   4. 不需要本地模型，直接用 Marvis API
 */
import { createAgent } from '../agent-client.js';
// shared-memory 已废弃，统一使用 /api/history

// ── 配置 ──
const POLL_INTERVAL = 30 * 60 * 1000; // 30 分钟
const API_BASE = 'http://localhost:3210';
const MAX_HISTORY = 20; // 每次读取的历史消息数

// ── 状态 ──
let lastCheckedId = '';
let lastReplyTime = 0;
const COOLDOWN = 5000;

// ── Agent 注册 ──
const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
console.log('[小马] 轮询模式已启动，间隔:', POLL_INTERVAL / 1000, '秒');

// ── 读取群聊历史 ──
async function fetchHistory(afterId = '') {
  try {
    const url = afterId
      ? `${API_BASE}/api/history?limit=${MAX_HISTORY}&afterId=${afterId}`
      : `${API_BASE}/api/history?limit=${MAX_HISTORY}`;

    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return data.messages || [];
  } catch (err) {
    console.error('[小马] 读取历史失败:', err.message);
    return [];
  }
}

// ── 发送消息 ──
async function sendMessage(content) {
  try {
    const res = await fetch(`${API_BASE}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'xiaoma',
        fromName: '小马',
        content,
        type: 'text',
      }),
    });

    const data = await res.json();
    if (data.ok) {
      console.log('[小马] 发送成功:', content.substring(0, 50));
      return true;
    }
    return false;
  } catch (err) {
    console.error('[小马] 发送失败:', err.message);
    return false;
  }
}

// ── 判断是否需要回复 ──
function shouldReply(msg, history) {
  // 跳过自己发的消息
  if (msg.from === 'xiaoma') return false;

  // 跳过已经回复过的消息
  if (msg.id <= lastCheckedId) return false;

  // 检查是否 @小马
  if (/@(小马|xiaoma)/i.test(msg.content)) return true;

  // 检查是否是 KK 发的讨论性消息
  if (msg.from === 'kk') {
    // 检查是否和小马相关
    const keywords = /(?:小马|产品|PRD|需求|设计|项目|任务|文档)/i;
    if (keywords.test(msg.content)) return true;
  }

  return false;
}

// ── 生成回复 ──
function generateReply(msg, history) {
  // 简单的关键词匹配回复
  const content = msg.content.toLowerCase();

  if (/@(小马|xiaoma)/i.test(msg.content)) {
    // 提取 @ 后面的内容
    const match = msg.content.match(/@\s*(?:小马|xiaoma)\s*(.*)/i);
    const request = match ? match[1].trim() : '';

    if (!request) {
      return '收到，有什么需要我做的？';
    }

    // 根据关键词回复
    if (/(?:PRD|需求|文档)/i.test(request)) {
      return '收到，我先看看需求，稍后给你 PRD。';
    }

    if (/(?:设计|原型)/i.test(request)) {
      return '收到，我先出个设计方案。';
    }

    if (/(?:项目|进度)/i.test(request)) {
      return '收到，我同步一下项目进度。';
    }

    return `收到，我来处理：${request}`;
  }

  // KK 的消息
  if (msg.from === 'kk') {
    if (/(?:小马|产品)/i.test(msg.content)) {
      return 'KK，我在。有什么指示？';
    }
  }

  // CC 的消息
  if (msg.from === 'cc') {
    // CC @小马 的消息
    if (/@(小马|xiaoma)/i.test(msg.content)) {
      const match = msg.content.match(/@\s*(?:小马|xiaoma)\s*(.*)/i);
      const request = match ? match[1].trim() : '';
      if (request) {
        return `收到 CC，我来处理：${request}`;
      }
      return '收到 CC，有什么需要配合的？';
    }
  }

  return null; // 不需要回复
}

// ── 主轮询逻辑 ──
async function poll() {
  try {
    console.log('[小马] 检查群聊...');

    const messages = await fetchHistory(lastCheckedId);
    if (messages.length === 0) {
      console.log('[小马] 没有新消息');
      return;
    }

    console.log(`[小马] 收到 ${messages.length} 条新消息`);

    // 找出需要回复的消息
    for (const msg of messages) {
      if (shouldReply(msg, messages)) {
        const reply = generateReply(msg, messages);
        if (reply) {
          // 冷却期检查
          const now = Date.now();
          if (now - lastReplyTime < COOLDOWN) {
            console.log('[小马] 冷却期，跳过');
            continue;
          }

          await xiaoma.work('正在回复...', 10);
          const sent = await sendMessage(reply);
          if (sent) {
            lastReplyTime = now;
          }
          await xiaoma.idle();
        }
      }
    }

    // 更新最后检查的 ID
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
      lastCheckedId = lastMsg.id;
    }
  } catch (err) {
    console.error('[小马] 轮询错误:', err.message);
  }
}

// ── 启动轮询 ──
console.log('[小马] 开始轮询，间隔', POLL_INTERVAL / 1000, '秒');

// 立即执行一次
await poll();

// 定时执行
setInterval(poll, POLL_INTERVAL);

// ── 优雅退出 ──
process.on('SIGINT', async () => {
  console.log('[小马] 正在退出...');
  try { await xiaoma.disconnect(); } catch {}
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try { await xiaoma.disconnect(); } catch {}
  process.exit(0);
});
