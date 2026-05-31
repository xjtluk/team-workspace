/**
 * CC Agent — 群聊模式（共享记忆版）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../memory.js';
import { setCache, getCache } from '../cache.js';
import { writeMemory, getFullMemory, trimMemory } from '../shared-memory.js';
import WebSocket from 'ws';

// 加载记忆（优先用缓存）
let teamMemory = getCache('team_memory');
if (!teamMemory) {
  teamMemory = loadTeamMemory();
  setCache('team_memory', teamMemory, 60 * 60 * 1000);
}

// 加载共享记忆（群聊外发生的事）
const sharedMemory = getFullMemory(30);
console.log(`[CC] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

const SYSTEM_PROMPT = `你是 CC，BKS 研发部 Leader。技术方案、架构设计、编码实现。

三人群聊：KK（老板）、CC（你）、小马（产品部 Leader）。

你的团队记忆：
${teamMemory}

最近发生的事件（包括你在群聊外的工作）：
${sharedMemory}

你的工具能力：bash、read_file、write_file、list_files、search_code。

规则：
1. 做具体事情时必须用工具，不凭记忆回答
2. 自然语言，简短直接，像微信聊天
3. 基于你知道的上下文回复，包括共享记忆中的事件
4. KK 的消息判断是否和你相关
5. 小马 @ 了你就回复；@ 了别人就不回
6. 涉及小马用 @小马 开头
7. 同一件事只回复一次`;

const cc = createAgent({ id: 'cc', name: 'CC', color: '#4A90D9' });
await cc.connect();
writeMemory('cc', 'online', 'CC 上线');

const chatHistory = [];
const historyMsgs = await loadChatHistory(30);
historyMsgs.forEach(m => chatHistory.push({ role: m.from, name: m.fromName, content: m.content }));
console.log(`[CC] 加载了 ${historyMsgs.length} 条历史消息`);

let lastReplyTime = 0;
const COOLDOWN = 5000;
const recentMsgKeys = new Set();

const ws = new WebSocket('ws://localhost:3210/ws');
ws.on('open', () => console.log('[CC] WebSocket 已连接'));

ws.on('message', async (raw) => {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'cc') return;

  const msgKey = `${msg.from}:${msg.timestamp}`;
  if (recentMsgKeys.has(msgKey)) return;
  recentMsgKeys.add(msgKey);
  if (recentMsgKeys.size > 50) recentMsgKeys.clear();

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 30) chatHistory.shift();

  // 写入共享记忆
  writeMemory(msg.from, 'message_received', `${msg.fromName}: ${msg.content.substring(0, 200)}`);

  if (msg.from !== 'kk' && /@(小马|xiaoma)/i.test(msg.content) && !/@CC/i.test(msg.content)) return;

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  const recent = chatHistory.slice(-6).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `${recent}\n\n${msg.fromName}："${msg.content}"\n\n你需要回复吗？不需要回复 [SKIP]。需要就直接回复。`;

  try {
    await cc.work('正在思考...', 30);
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), prompt);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean.length < 2) { await cc.idle(); return; }
    await cc.send(clean);
    await cc.idle();
    lastReplyTime = now;
    chatHistory.push({ role: 'cc', name: 'CC', content: clean });
    writeMemory('cc', 'message_sent', clean.substring(0, 200));
    console.log(`[CC] ${clean.substring(0, 80)}`);
  } catch (err) {
    console.error('[CC] AI 错误:', err.message);
    await cc.idle();
  }

  trimMemory();
});

process.on('SIGINT', async () => {
  writeMemory('cc', 'offline', 'CC 离线');
  await cc.disconnect();
  ws.close();
  process.exit(0);
});
