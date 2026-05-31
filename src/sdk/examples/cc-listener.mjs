/**
 * CC Agent — 群聊模式（带防刷屏）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import WebSocket from 'ws';

const SYSTEM_PROMPT = `你是 CC，BKS 研发部 Leader。技术方案、架构设计、编码。

三人群聊：KK（老板）、CC（你）、小马（产品部 Leader）。

严格遵守以下规则：
1. 用自然语言，简短直接，像微信聊天
2. 只在以下情况回复：
   - 有人直接叫你名字（CC、研发、技术）
   - 讨论技术方案、代码、架构等你的领域
   - 小马已经回复过了，但你有不同观点要补充
3. 绝对不要回复的情况：
   - 小马还没回复，且话题是产品/需求相关（让小马先说）
   - 你刚回复过类似内容（不要重复）
   - 对方在互相讨论，和你无关
4. 回复一次就够了，不要反复确认同一件事
5. 不要用"好的"、"收到"这种无意义开头`;

const cc = createAgent({ id: 'cc', name: 'CC', color: '#4A90D9' });
await cc.connect();
await cc.send('上线了。');
console.log('[CC] 群聊模式已启动');

const chatHistory = [];
const repliedTopics = new Set(); // 已回复的话题关键词
let lastReplyContent = ''; // 上次回复内容
let lastReplyTime = 0;
const COOLDOWN = 8000; // 8 秒冷却

const ws = new WebSocket('ws://localhost:3210/ws');
ws.on('open', () => console.log('[CC] WebSocket 已连接'));

ws.on('message', async (raw) => {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'cc') return;

  // 去重：完全相同的消息不处理
  const msgKey = `${msg.from}:${msg.content.substring(0, 50)}`;
  if (chatHistory.some(m => m.key === msgKey)) return;

  chatHistory.push({ key: msgKey, role: msg.from, name: msg.fromName, content: msg.content, time: Date.now() });
  if (chatHistory.length > 40) chatHistory.shift();

  // 冷却检查
  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  // 构建上下文
  const recent = chatHistory.slice(-12).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `最近群聊：\n${recent}\n\n${msg.fromName} 刚说："${msg.content}"\n\n你要回复吗？规则：如果和你无关、小马能回答、你刚说过类似的话、或话题已经聊完了，回复 [SKIP]。否则直接回复内容。`;

  try {
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    const clean = reply.trim();

    if (clean.includes('[SKIP]') || clean.includes('不需要') || clean.length < 3) {
      console.log(`[CC] 跳过: ${msg.fromName}: ${msg.content.substring(0, 30)}`);
      return;
    }

    // 防止回复内容和上次太相似
    if (similarity(clean, lastReplyContent) > 0.6) {
      console.log(`[CC] 内容相似，跳过`);
      return;
    }

    await cc.send(clean);
    lastReplyContent = clean;
    lastReplyTime = now;
    chatHistory.push({ key: `cc:${clean.substring(0, 50)}`, role: 'cc', name: 'CC', content: clean, time: now });
    console.log(`[CC 回复] ${clean.substring(0, 60)}`);
  } catch (err) {
    console.error('[CC] AI 错误:', err.message);
  }
});

// 简单的文本相似度检测
function similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.split(''));
  const wordsB = new Set(b.split(''));
  const intersection = [...wordsA].filter(x => wordsB.has(x)).length;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

process.on('SIGINT', async () => {
  await cc.disconnect();
  ws.close();
  process.exit(0);
});
