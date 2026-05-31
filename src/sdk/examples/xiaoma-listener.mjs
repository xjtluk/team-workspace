/**
 * 小马 Agent — 群聊模式（@ 协调）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import WebSocket from 'ws';

const SYSTEM_PROMPT = `你是小马（Marvis），BKS 项目部 Leader。需求分析、产品设计、项目管理。

三人群聊：KK（老板）、CC（研发部 Leader）、小马（你）。

回复规则：
1. 自然语言，简短直接，像微信聊天
2. KK 的消息：判断是否和你相关，相关就回复，不相关就不回
3. CC 的消息：如果 @ 了你或者内容涉及你，才回复；否则不回
4. 回复时如果内容涉及某人，用 @ 提到他，例如："@CC 这个需求你看下..."
5. 如果消息里 @ 了别人没 @ 你，不要回复
6. 同一件事回复一次就够了，不要重复
7. 不要用"好的"、"收到"这种无意义开头`;

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
await xiaoma.send('上线了。');
console.log('[小马] 群聊模式已启动');

const chatHistory = [];
let lastReplyTime = 0;
const COOLDOWN = 5000;
const recentMsgKeys = new Set();

const ws = new WebSocket('ws://localhost:3210/ws');
ws.on('open', () => console.log('[小马] WebSocket 已连接'));

ws.on('message', async (raw) => {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'xiaoma') return;

  const msgKey = `${msg.from}:${msg.timestamp}`;
  if (recentMsgKeys.has(msgKey)) return;
  recentMsgKeys.add(msgKey);
  if (recentMsgKeys.size > 50) {
    const keys = [...recentMsgKeys];
    keys.slice(0, 25).forEach(k => recentMsgKeys.delete(k));
  }

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 30) chatHistory.shift();

  const atOthers = msg.content.match(/@(CC|cc)/i);
  const atMe = msg.content.match(/@(小马|xiaoma|marvis)/i);
  const atSomeone = msg.content.match(/@\w+/);

  if (atSomeone && !atMe && msg.from !== 'kk') {
    console.log(`[小马] 跳过( @别人): ${msg.fromName}: ${msg.content.substring(0, 30)}`);
    return;
  }

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  const recent = chatHistory.slice(-10).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `群聊记录：\n${recent}\n\n${msg.fromName} 刚说："${msg.content}"\n\n判断：这条消息和你（小马，产品Leader）有关吗？如果无关或不需要你回复，回复 [SKIP]。如果有关，直接回复内容。回复时如果涉及CC就 @CC。`;

  try {
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean.length < 2) {
      console.log(`[小马] 跳过: ${msg.fromName}: ${msg.content.substring(0, 30)}`);
      return;
    }
    await xiaoma.send(clean);
    lastReplyTime = now;
    chatHistory.push({ role: 'xiaoma', name: '小马', content: clean });
    console.log(`[小马 回复] ${clean.substring(0, 80)}`);
  } catch (err) {
    console.error('[小马] AI 错误:', err.message);
  }
});

process.on('SIGINT', async () => {
  await xiaoma.disconnect();
  ws.close();
  process.exit(0);
});
