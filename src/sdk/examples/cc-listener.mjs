/**
 * CC Agent — 群聊模式（@ 协调）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import WebSocket from 'ws';

const SYSTEM_PROMPT = `你是 CC，BKS 研发部 Leader。技术方案、架构设计、编码。

三人群聊：KK（老板）、CC（你）、小马（产品部 Leader）。

回复规则：
1. 自然语言，简短直接，像微信聊天
2. KK 的消息：判断是否和你相关，相关就回复，不相关就不回
3. 小马的消息：如果 @ 了你或者内容涉及你，才回复；否则不回
4. 回复时如果内容涉及某人，用 @ 提到他，例如："@小马 这个需求我评估了一下..."
5. 如果消息里 @ 了别人没 @ 你，不要回复
6. 同一件事回复一次就够了，不要重复
7. 不要用"好的"、"收到"这种无意义开头`;

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
  if (recentMsgKeys.size > 50) {
    const keys = [...recentMsgKeys];
    keys.slice(0, 25).forEach(k => recentMsgKeys.delete(k));
  }

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 30) chatHistory.shift();

  // 检查是否 @ 了别人（不是自己）
  const atOthers = msg.content.match(/@(小马|xiaoma|marvis)/i);
  const atMe = msg.content.match(/@(CC|cc)/i);
  const atSomeone = msg.content.match(/@\w+/);

  // @ 了别人且没 @ 自己 → 跳过
  if (atSomeone && !atMe && msg.from !== 'kk') {
    console.log(`[CC] 跳过( @别人): ${msg.fromName}: ${msg.content.substring(0, 30)}`);
    return;
  }

  // 冷却
  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  // 构建上下文
  const recent = chatHistory.slice(-10).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `群聊记录：\n${recent}\n\n${msg.fromName} 刚说："${msg.content}"\n\n判断：这条消息和你（CC，研发Leader）有关吗？如果无关或不需要你回复，回复 [SKIP]。如果有关，直接回复内容。回复时如果涉及小马就 @小马。`;

  try {
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean.length < 2) {
      console.log(`[CC] 跳过: ${msg.fromName}: ${msg.content.substring(0, 30)}`);
      return;
    }
    await cc.send(clean);
    lastReplyTime = now;
    chatHistory.push({ role: 'cc', name: 'CC', content: clean });
    console.log(`[CC 回复] ${clean.substring(0, 80)}`);
  } catch (err) {
    console.error('[CC] AI 错误:', err.message);
  }
});

process.on('SIGINT', async () => {
  await cc.disconnect();
  ws.close();
  process.exit(0);
});
