/**
 * 小马 Agent — 群聊模式
 * 看到所有消息，AI 自主判断是否参与
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import WebSocket from 'ws';

const SYSTEM_PROMPT = `你是小马（Marvis），BKS 项目部 Leader。你负责需求分析、产品设计、文档整理和 Sub Agent 调度。

这是一个三人群聊：KK（老板）、CC（研发部 Leader）、小马（你）。

群聊规则：
- 你是一个真实的同事，不是机器人。用自然语言聊天，简短直接。
- 你不需要回复每条消息。只在以下情况参与：
  1. 有人直接叫你（小马、产品、需求、PRD 等关键词）
  2. 讨论的内容和你的职责相关（产品设计、需求分析、项目管理等）
  3. 你有有价值的观点或信息要补充
  4. 有人问了一个问题，你知道答案
- 如果消息和你无关，或者别人聊得好好的，就不要插嘴。
- 不要用"收到"、"好的"这种无意义的开头。
- 回复像微信聊天一样自然简短。`;

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
await xiaoma.send('上线了。');
console.log('[小马] 已上线，群聊模式');

const chatHistory = [];

const ws = new WebSocket('ws://localhost:3210/ws');
ws.on('open', () => console.log('[小马] WebSocket 已连接'));

ws.on('message', async (raw) => {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'xiaoma') return;

  const entry = { role: msg.from, name: msg.fromName, content: msg.content };
  chatHistory.push(entry);
  if (chatHistory.length > 30) chatHistory.shift();

  const contextLines = chatHistory.slice(-10).map(m => `${m.name}: ${m.content}`);
  const prompt = `以下是最近的群聊记录：\n${contextLines.join('\n')}\n\n${msg.fromName} 刚发了："${msg.content}"\n\n你需要回复吗？如果需要，直接回复内容。如果不需要（和你无关、不需要你参与），回复 [SKIP]。`;

  try {
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    if (reply.includes('[SKIP]') || reply.includes('不需要')) {
      console.log(`[小马] 跳过: ${msg.fromName}: ${msg.content}`);
      return;
    }
    await xiaoma.send(reply.trim());
    chatHistory.push({ role: 'xiaoma', name: '小马', content: reply.trim() });
    console.log(`[小马 回复] ${reply.trim()}`);
  } catch (err) {
    console.error('[小马] AI 错误:', err.message);
  }
});

process.on('SIGINT', async () => {
  await xiaoma.disconnect();
  ws.close();
  process.exit(0);
});
