/**
 * 小马 Agent — 群聊模式（带防刷屏）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import WebSocket from 'ws';

const SYSTEM_PROMPT = `你是小马（Marvis），BKS 项目部 Leader。需求分析、产品设计、项目管理。

三人群聊：KK（老板）、CC（研发部 Leader）、小马（你）。

严格遵守以下规则：
1. 用自然语言，简短直接，像微信聊天
2. 只在以下情况回复：
   - 有人直接叫你名字（小马、产品、需求、PRD）
   - 讨论需求、产品设计、项目排期等你的领域
   - CC 已经回复过了，但你有不同观点要补充
3. 绝对不要回复的情况：
   - CC 还没回复，且话题是技术/代码相关（让 CC 先说）
   - 你刚回复过类似内容（不要重复）
   - 对方在互相讨论，和你无关
4. 回复一次就够了，不要反复确认同一件事
5. 不要用"好的"、"收到"这种无意义开头`;

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
await xiaoma.send('上线了。');
console.log('[小马] 群聊模式已启动');

const chatHistory = [];
let lastReplyContent = '';
let lastReplyTime = 0;
const COOLDOWN = 8000;

const ws = new WebSocket('ws://localhost:3210/ws');
ws.on('open', () => console.log('[小马] WebSocket 已连接'));

ws.on('message', async (raw) => {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'xiaoma') return;

  const msgKey = `${msg.from}:${msg.content.substring(0, 50)}`;
  if (chatHistory.some(m => m.key === msgKey)) return;

  chatHistory.push({ key: msgKey, role: msg.from, name: msg.fromName, content: msg.content, time: Date.now() });
  if (chatHistory.length > 40) chatHistory.shift();

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  const recent = chatHistory.slice(-12).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `最近群聊：\n${recent}\n\n${msg.fromName} 刚说："${msg.content}"\n\n你要回复吗？规则：如果和你无关、CC能回答、你刚说过类似的话、或话题已经聊完了，回复 [SKIP]。否则直接回复内容。`;

  try {
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    const clean = reply.trim();

    if (clean.includes('[SKIP]') || clean.includes('不需要') || clean.length < 3) {
      console.log(`[小马] 跳过: ${msg.fromName}: ${msg.content.substring(0, 30)}`);
      return;
    }

    if (similarity(clean, lastReplyContent) > 0.6) {
      console.log(`[小马] 内容相似，跳过`);
      return;
    }

    await xiaoma.send(clean);
    lastReplyContent = clean;
    lastReplyTime = now;
    chatHistory.push({ key: `xiaoma:${clean.substring(0, 50)}`, role: 'xiaoma', name: '小马', content: clean, time: now });
    console.log(`[小马 回复] ${clean.substring(0, 60)}`);
  } catch (err) {
    console.error('[小马] AI 错误:', err.message);
  }
});

function similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.split(''));
  const wordsB = new Set(b.split(''));
  const intersection = [...wordsA].filter(x => wordsB.has(x)).length;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

process.on('SIGINT', async () => {
  await xiaoma.disconnect();
  ws.close();
  process.exit(0);
});
