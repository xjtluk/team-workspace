/**
 * 小马 Agent — 群聊模式（带记忆）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../memory.js';
import WebSocket from 'ws';

const teamMemory = loadTeamMemory();
console.log(`[小马] 记忆已加载 (${teamMemory.length} 字符)`);

const SYSTEM_PROMPT = `你是小马（Marvis），BKS 项目部 Leader。需求分析、产品设计、项目管理。

三人群聊：KK（老板）、CC（研发部 Leader）、小马（你）。

你的团队记忆：
${teamMemory}

你的工具能力：bash（执行命令）、read_file（读文件）、write_file（写文件）、list_files（列目录）、search_code（搜索代码）。

核心规则：
1. 当有人让你做具体事情（查看文件、写文档、分析需求）时，必须使用工具执行，不要凭记忆回答
2. 回复用自然语言，简短直接，像微信聊天
3. KK 的消息：判断是否和你相关，相关就回复
4. CC @ 了你：必须回复；CC @ 了别人：不回复
5. 涉及 CC 用 @CC 开头
6. 同一件事只回复一次
7. 不要用"好的"、"收到"开头`;

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
console.log('[小马] 群聊模式已启动');

const chatHistory = [];
const historyMsgs = await loadChatHistory(50);
historyMsgs.forEach(m => {
  chatHistory.push({ role: m.from, name: m.fromName, content: m.content });
});
console.log(`[小马] 加载了 ${historyMsgs.length} 条历史消息`);

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
  if (recentMsgKeys.size > 50) recentMsgKeys.clear();

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 50) chatHistory.shift();

  // CC @ 了别人（不是小马）→ 跳过
  if (msg.from !== 'kk' && /@CC/i.test(msg.content) && !/@(小马|xiaoma)/i.test(msg.content)) {
    return;
  }

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  const recent = chatHistory.slice(-12).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `群聊记录：\n${recent}\n\n${msg.fromName} 刚说："${msg.content}"\n\n你是小马（产品Leader）。你需要回复吗？不需要就回复 [SKIP]。需要就直接回复，涉及CC就用 @CC 开头。`;

  try {
    await xiaoma.work('正在思考...', 30);
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(0, -1), prompt);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean.length < 2) {
      await xiaoma.idle();
      return;
    }
    await xiaoma.send(clean);
    await xiaoma.idle();
    lastReplyTime = now;
    chatHistory.push({ role: 'xiaoma', name: '小马', content: clean });
    console.log(`[小马] ${clean.substring(0, 80)}`);
  } catch (err) {
    console.error('[小马] AI 错误:', err.message);
    await xiaoma.idle();
  }
});

process.on('SIGINT', async () => {
  await xiaoma.disconnect();
  ws.close();
  process.exit(0);
});
