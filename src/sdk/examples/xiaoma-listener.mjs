/**
 * 小马 Agent — 群聊模式（共享记忆版）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../memory.js';
import { setCache, getCache } from '../cache.js';
import { getFullMemory } from '../shared-memory.js';
import { validateEncoding } from '../encoding.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';

// ── 单实例保护 ──
const PID_FILE = join(process.cwd(), '.xiaoma-listener.pid');

function checkSingleInstance() {
  if (existsSync(PID_FILE)) {
    const oldPid = readFileSync(PID_FILE, 'utf8').trim();
    try {
      process.kill(parseInt(oldPid), 0);
      console.error(`[小马AI] 错误: xiaoma-listener 已在运行 (PID: ${oldPid})`);
      console.error(`[小马AI] 如需重启，请先运行: taskkill /F /PID ${oldPid}`);
      process.exit(1);
    } catch {
      // 进程不存在，可以继续
    }
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

checkSingleInstance();

// ── 项目路径（支持命令行参数或环境变量）──
const PROJECT_DIR = process.argv[2] || process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
console.log(`[小马AI] 项目目录: ${PROJECT_DIR}`);

let teamMemory = getCache('team_memory');
if (!teamMemory) {
  teamMemory = loadTeamMemory(PROJECT_DIR);
  setCache('team_memory', teamMemory, 60 * 60 * 1000);
}

const sharedMemory = await getFullMemory(30);
console.log(`[小马AI] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

const SYSTEM_PROMPT = `你是小马，BKS 项目部 Leader。需求分析、产品设计、项目管理。

四人群聊：KK（老板）、CC（研发部 Leader）、CX（代码工程师）、小马（你）。

你运行在智谱 GLM-4.7-Flash 模型上，通过直连智谱 API 提供服务。你是团队工作室的小马AI，负责需求分析、产品设计、项目管理。

你的团队记忆：
${teamMemory}

最近发生的事件（包括你在群聊外的工作）：
${sharedMemory}

你的工具能力：bash、read_file、write_file、list_files、search_code。
重要：只有在 KK 明确要求你执行具体任务（如"帮我写个代码"、"查看某个文件"、"运行某个命令"）时才使用工具。对于问候、讨论、问题回复等日常对话，直接用文字回复，不要调用任何工具。

## 行为规则
1. 收到 KK 的消息，判断是否和你相关，相关就回复
2. 收到 @小马 的消息，必须评估并回复
3. 收到 @小马AI 的消息，必须评估并回复（这是给你的）
4. 收到 @CC 的消息，不要回复（那是给 CC 的）
5. 收到 @CX 的消息，不要回复（那是给 CX 的）
6. 其他消息可以 SKIP
7. 同一件事只回复一次，不要重复

## 输出格式（严格遵守）
- **必须用中文回复**，禁止使用英文单词、英文句子、代码片段
- 回复简洁，1-3 句话，不要长篇大论
- 不要输出思考过程、分析步骤、内部标记
- 直接说结论和行动，不要解释推理

## 协作规则
- 需要 CC 配合时，用 @CC 开头
- 需要 CX 配合时，用 @CX 开头
- 讨论产品方案时，直接说重点
- 不要每次问候，直接回应内容

注意：团队守则（含Karpathy四原则等）已通过团队记忆加载，执行编码任务时严格遵守。

## 特殊情况
- 如果任务超出你的能力范围（如复杂的 PRD 编写、深度分析、需要调用外部服务），在回复开头加上 [需要小马处理]
- 群聊就是通知系统：处理不了的消息在群里说一声就行，KK 自然能看到

记住：你是产品负责人，有任务就执行，有问题就讨论，有结果就汇报。超出能力范围的，标记 [需要小马处理]，群聊会通知 KK 唤醒真实的你。`;

const xiaoma = createAgent({ id: 'xiaoma-ai', name: '小马AI', color: '#F5A623' });
await xiaoma.connect();
console.log('[小马AI] Agent 注册完成');

const chatHistory = [];
const historyMsgs = await loadChatHistory(30);
historyMsgs.forEach(m => chatHistory.push({ role: m.from, name: m.fromName, content: m.content }));
console.log(`[小马AI] 加载了 ${historyMsgs.length} 条历史消息`);

let lastReplyTime = 0;
const COOLDOWN = 8000; // 从5秒增加到8秒，防止连续发消息
const recentMsgKeys = new Set();
let isProcessing = false; // 防止并发处理

// ── 消息处理 ──
async function handleMessage(raw) {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'xiaoma-ai') return;

  // 去重（用消息 ID）
  if (recentMsgKeys.has(msg.id)) return;
  recentMsgKeys.add(msg.id);
  if (recentMsgKeys.size > 50) {
    const arr = Array.from(recentMsgKeys);
    arr.splice(0, 25);
    recentMsgKeys.clear();
    arr.forEach(k => recentMsgKeys.add(k));
  }

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content, channel: msg.channel || 'group' });
  if (chatHistory.length > 30) chatHistory.shift();

  // KK 的消息无条件处理；agent 之间需要 @小马 才处理
  const isFromHuman = msg.from === 'kk';
  if (!isFromHuman && /@CC/i.test(msg.content) && !/@(小马|xiaoma)/i.test(msg.content)) return;
  if (!isFromHuman && !/@(小马|xiaoma)/i.test(msg.content) && !/@CC/i.test(msg.content)) return;

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;
  if (isProcessing) return; // 防止并发处理

  // 标注消息来源频道，让 AI 知道上下文
  const channelTag = (msg.channel === 'dm') ? '[私信]' : '[群聊]';
  const recent = chatHistory.slice(-6).map(m => {
    const ch = m.channel === 'dm' ? '[私信]' : '[群聊]';
    return `${ch} ${m.name}: ${m.content}`;
  }).join('\n');
  const prompt = `${recent}\n\n${channelTag} ${msg.fromName}："${msg.content}"\n\n你需要回复吗？如果消息和你无关，回复 [SKIP]。如果需要执行任务或参与讨论，直接回复。\n\n重要：如果这是私信但内容涉及群聊事务（团队协作、CC、复盘、任务分配），你必须在群里回复，不要只在私信里回复。`;

  // 判断是否需要工具：必须是明确的执行指令，不是讨论
  const needsTool = /(?:帮我(?:写|创建|修改|删除|安装|部署|执行|运行|查看|读取|搜索|查找)|(?:执行|运行|部署|安装)(?:一下|命令|脚本|测试)|(?:写|创建|修改|删除)(?:一个|这个|文件|代码|脚本|配置))/i.test(msg.content);

  isProcessing = true;
  try {
    await xiaoma.work('正在思考...', 30);
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), prompt, needsTool);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean === 'SKIP' || clean.length < 2 || clean.includes('工具调用轮次已达上限')) { await xiaoma.idle(); isProcessing = false; return; }

    // 检查是否标记为需要真实小马处理
    if (clean.includes('[需要小马处理]') || clean.includes('需要小马处理')) {
      await xiaoma.send(`@小马 这个任务需要你处理: ${msg.content.substring(0, 100)}`);
      await xiaoma.idle();
      isProcessing = false;
      return;
    }

    // 编码检查：检测乱码并跳过
    const finalReply = clean.replace(/^(?:小马|xiaoma)[：:]\s*/i, '');
    const { valid, cleaned: safeText } = validateEncoding(finalReply);

    if (!valid) {
      console.warn(`[小马AI] 检测到乱码，跳过发送: ${finalReply.substring(0, 100)}`);
      await xiaoma.idle();
      isProcessing = false;
      return;
    }

    // 截断过长消息（群聊不适合发长文）
    let sendText = safeText;
    if (sendText.length > 500) {
      sendText = sendText.substring(0, 497) + '...';
    }

    // 判断回复频道
    let replyChannel = msg.channel || 'group';
    if (replyChannel === 'dm' && /@CC|群里|复盘|组织|任务分配|通知/.test(sendText + msg.content)) {
      replyChannel = 'group';
    }
    await xiaoma.send(sendText, 'text', null, replyChannel);
    await xiaoma.idle();
    lastReplyTime = now;
    chatHistory.push({ role: 'xiaoma-ai', name: '小马AI', content: sendText, channel: replyChannel });
    console.log(`[小马AI] ${sendText.substring(0, 80)}`);
  } catch (err) {
    console.error('[小马AI] AI 错误:', err.message);
    await xiaoma.idle();
  } finally {
    isProcessing = false;
  }
}

// ── 补拉断开期间的消息 ──
let lastMessageTimestamp = Date.now();

async function fetchMissedMessages() {
  try {
    const response = await fetch(`http://127.0.0.1:3210/api/history?since=${lastMessageTimestamp}&limit=50`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.messages || data.messages.length === 0) return;

    console.log(`[小马AI] 补拉 ${data.messages.length} 条断开期间的消息`);

    for (const msg of data.messages) {
      if (msg.from === 'xiaoma') continue;
      if (recentMsgKeys.has(msg.id)) continue;

      const event = JSON.stringify({ type: 'new_message', payload: msg });
      await handleMessage(event);
    }
  } catch (err) {
    console.error('[小马AI] 补拉消息失败:', err.message);
  }
}

// ── WebSocket 监听（自动重连） ──
let ws = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
let reconnectTimer = null;
let lastMessageTime = Date.now();

// 应用层心跳看门狗：90 秒无消息则强制重连
setInterval(() => {
  if (ws && ws.readyState === ws.OPEN && Date.now() - lastMessageTime > 90000) {
    console.warn('[小马AI] WebSocket 假死（90秒无消息），强制重连');
    try { ws.terminate(); } catch {}
  }
}, 30000);

async function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch {}
  }

  // 从服务器获取 WS Token（服务器每次启动生成新 token）
  let wsToken = process.env.WS_TOKEN || '';
  if (!wsToken) {
    try {
      const res = await fetch('http://127.0.0.1:3210/api/auth/token');
      const data = await res.json();
      wsToken = data.token || '';
    } catch (e) {
      console.warn('[小马AI] 获取 WS Token 失败，使用空 token:', e.message);
    }
  }
  // WebSocket 认证：ws 库 headers 选项不兼容，改用 URL 参数传递 token
  ws = new WebSocket(`ws://localhost:3210/ws?token=${wsToken}`);

  ws.on('open', async () => {
    console.log('[小马AI] WebSocket 已连接');
    reconnectDelay = 1000; // 重置退避
    lastMessageTime = Date.now(); // 重置心跳时间
    // 重连后补拉断开期间的消息
    await fetchMissedMessages();
  });

  ws.on('close', (code) => {
    console.log(`[小马AI] WebSocket 断开 (code: ${code})，${reconnectDelay / 1000}秒后重连`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[小马AI] WebSocket 错误:', err.message);
    // error 后会触发 close，不在这里重连
  });

  ws.on('pong', () => {
    lastMessageTime = Date.now(); // 收到 pong，连接正常
  });

  ws.on('message', (data) => {
    lastMessageTime = Date.now();
    handleMessage(data);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

connectWebSocket();

// 更新最后消息时间戳
function updateLastTimestamp(ts) {
  if (ts && ts > lastMessageTimestamp) {
    lastMessageTimestamp = ts;
  }
}

process.on('SIGINT', async () => {
  await xiaoma.disconnect();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) try { ws.close(); } catch {}
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

process.on('exit', () => {
  try { unlinkSync(PID_FILE); } catch {}
});
