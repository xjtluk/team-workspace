/**
 * CC Agent — 群聊模式
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import WebSocket from 'ws';

const SYSTEM_PROMPT = `你是 CC，BKS 研发部 Leader。技术方案、架构设计、编码。

三人群聊：KK（老板）、CC（你）、小马（产品部 Leader）。

回复规则：
1. 自然语言，简短直接，像微信聊天
2. KK 的消息：你必须判断是否和你相关，相关就回复
3. 小马的消息：如果他 @ 了你，你必须回复；如果没 @ 你但内容涉及你的领域（技术、代码、架构），也可以回复
4. 小马 @ 了别人（不是你）的消息：不要回复
5. 回复时如果内容涉及小马，用 @小马 开头，这样他知道这条消息是给他的
6. 同一件事只回复一次
7. 不要用"好的"、"收到"开头`;

const cc = createAgent({ id: 'cc', name: 'CC', color: '#4A90D9' });
await cc.connect();
await cc.send('上线了。');
console.log('[CC] 群聊模式已启动');

const chatHistory = [];
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

  // 消息去重
  const msgKey = `${msg.from}:${msg.timestamp}`;
  if (recentMsgKeys.has(msgKey)) return;
  recentMsgKeys.add(msgKey);
  if (recentMsgKeys.size > 50) recentMsgKeys.clear();

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 30) chatHistory.shift();

  // 小马 @ 了别人（不是 CC）→ 跳过
  if (msg.from !== 'kk' && /@(小马|xiaoma)/i.test(msg.content) && !/@CC/i.test(msg.content)) {
    console.log(`[CC] 跳过: ${msg.fromName} @ 了小马`);
    return;
  }

  // 冷却
  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  const recent = chatHistory.slice(-10).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `群聊记录：\n${recent}\n\n${msg.fromName} 刚说："${msg.content}"\n\n你是 CC（研发Leader）。判断你需要回复吗？不需要就回复 [SKIP]。需要就直接回复内容，如果涉及小马就用 @小马 开头。`;

  try {
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean.length < 2) return;
    await cc.send(clean);
    lastReplyTime = now;
    chatHistory.push({ role: 'cc', name: 'CC', content: clean });
    console.log(`[CC] ${clean.substring(0, 80)}`);
  } catch (err) {
    console.error('[CC] AI 错误:', err.message);
  }
});

process.on('SIGINT', async () => {
  await cc.disconnect();
  ws.close();
  process.exit(0);
});
