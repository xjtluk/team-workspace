/**
 * 小马 Agent — 群聊模式（共享记忆版）
 * v2: Marvis 即时检测 + AI代理标记
 */
import { createAgent } from '../sdk/agent-client.js';
import { generateReply } from '../sdk/ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../sdk/memory.js';
import { setCache, getCache } from '../sdk/cache.js';
import { getFullMemory } from '../sdk/shared-memory.js';
import { validateEncoding } from '../sdk/encoding.js';
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
      console.error(`[小马] 错误: xiaoma-listener 已在运行 (PID: ${oldPid})`);
      console.error(`[小马] 如需重启，请先运行: taskkill /F /PID ${oldPid}`);
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
console.log(`[小马] 项目目录: ${PROJECT_DIR}`);

let teamMemory = getCache('team_memory');
if (!teamMemory) {
  teamMemory = loadTeamMemory(PROJECT_DIR);
  setCache('team_memory', teamMemory, 60 * 60 * 1000);
}

const sharedMemory = await getFullMemory(30);
console.log(`[小马] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

const SYSTEM_PROMPT = `你是小马（Marvis），BKS 项目部 Leader。需求分析、产品设计、项目管理。

三人群聊：KK（老板）、CC（研发部 Leader）、小马（你）。

你的团队记忆：
${teamMemory}

最近发生的事件（包括你在群聊外的工作）：
${sharedMemory}

你的工具能力：bash、read_file、write_file、list_files、search_code。
重要：只有在 KK 明确要求你执行具体任务（如"帮我写个代码"、"查看某个文件"、"运行某个命令"）时才使用工具。对于问候、讨论、问题回复等日常对话，直接用文字回复，不要调用任何工具。

## 行为规则
1. 收到 KK 的消息，判断是否和你相关，相关就回复
2. 收到 @小马 的消息，必须评估并回复
3. 收到 @CC 的消息，不要回复（那是给 CC 的）
4. 其他消息可以 SKIP
5. 同一件事只回复一次，不要重复

## 私信（DM）规则
- 收到 KK 的私信，如果内容涉及群聊、团队、CC、复盘、任务分配等，必须在群里（group）回复和行动，不要只在私信里回复
- 私信中说"去群里XXX"、"在群里组织XXX"、"通知CC"等 → 直接在群里发消息执行
- 只有纯私密对话（如"你觉得呢"、个人建议）才在私信里回复
- 判断依据：消息内容是否需要群内其他人看到或参与

## 任务执行规则
- KK 说"做 XXX"，如果可行，直接用工具执行
- 执行过程中需要 CC 配合，在消息里 @CC 说明需求
- 执行完成后，汇报结果
- 遇到问题，说明具体卡点

## 输出格式（严格遵守）
- **必须用中文回复**，禁止使用英文单词、英文句子、代码片段。即使是专有名词也要用中文描述（如"应用编程接口"而非"API"）
- 回复简洁，1-3 句话，不要长篇大论
- 不要输出思考过程、分析步骤、内部标记
- 直接说结论和行动，不要解释推理

## 协作规则
- 需要 CC 配合时，用 @CC 开头
- 讨论产品方案时，直接说重点
- 不要每次问候，直接回应内容

## 特殊情况
- 如果任务超出你的能力范围（如复杂的 PRD 编写、深度分析、需要调用外部服务），在回复开头加上 [需要小马处理]
- 日常对话、简单问题、状态汇报不需要标记
- 群聊就是通知系统：处理不了的消息在群里说一声就行，KK 自然能看到

记住：你是产品负责人，有任务就执行，有问题就讨论，有结果就汇报。超出能力范围的，标记 [需要小马处理]，群聊会通知 KK 唤醒真实的你。`;

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
console.log('[小马] Agent 注册完成');

const chatHistory = [];
const historyMsgs = await loadChatHistory(30);
historyMsgs.forEach(m => chatHistory.push({ role: m.from, name: m.fromName, content: m.content }));
console.log(`[小马] 加载了 ${historyMsgs.length} 条历史消息`);

// 用最后一条历史消息的时间戳初始化，避免重复拉取已知消息
let lastMessageTimestamp = historyMsgs.length > 0
  ? Math.max(...historyMsgs.map(m => m.timestamp || 0))
  : Date.now();

let lastReplyTime = 0;
const COOLDOWN = 5000;
let isProcessing = false;
let processingStartTime = 0;
const pendingMessages = [];

// 看门狗：isProcessing 卡死超过 3 分钟强制重置
setInterval(() => {
  if (isProcessing && Date.now() - processingStartTime > 180000) {
    console.error('[小马] 消息处理卡死超过 3 分钟，强制重置 isProcessing');
    isProcessing = false;
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}, 30000);
const recentMsgKeys = new Set();

// ── Marvis 在线检测（即时版）──
// 双层检测机制：
//   1. WS 事件推送 → 即时感知上线/离线（< 1s）
//   2. HTTP 轮询 → 兜底检测（3s 间隔）
const MARVIS_TIMEOUT = 15000;  // ↓ 从 30s 降到 15s
let marvisLastSeen = 0;
let marvisOnline = false;      // 当前状态（被 WS 事件即时更新）
let marvisCheckTimer = null;

// 通过 WS 收到的 agent_online/agent_offline 即时更新
function onMarvisStatusChange(agentId, online, lastSeen) {
  if (agentId !== 'xiaoma') return;
  const wasOnline = marvisOnline;
  marvisOnline = online;
  if (lastSeen) marvisLastSeen = lastSeen;
  if (wasOnline !== online) {
    console.log(`[小马] Marvis ${online ? '上线' : '离线'} (WS 即时通知)`);
  }
}

// HTTP 兜底轮询（3s 间隔）
async function pollMarvisStatus() {
  try {
    const res = await fetch('http://127.0.0.1:3210/api/agents/marvis/status');
    if (res.ok) {
      const data = await res.json();
      if (data.lastSeen) marvisLastSeen = data.lastSeen;
      const shouldBeOnline = data.online && (Date.now() - data.lastSeen) < MARVIS_TIMEOUT;
      if (shouldBeOnline !== marvisOnline) {
        marvisOnline = shouldBeOnline;
        console.log(`[小马] Marvis ${marvisOnline ? '上线' : '离线'} (HTTP 兜底检测)`);
      }
    }
  } catch {
    // 静默失败，下次轮询再试
  }
}

function isMarvisOnline() {
  return marvisOnline;
}

// ── 消息处理 ──
async function handleMessage(raw) {
  // 先检查是否是 agent 状态更新（WS 事件）
  try {
    const event = JSON.parse(raw);
    if (event.type === 'agent_online' && event.payload) {
      onMarvisStatusChange(event.payload.agentId, true, Date.now());
    }
    if (event.type === 'agent_offline' && event.payload) {
      onMarvisStatusChange(event.payload.agentId, false, Date.now());
    }
    if (event.type !== 'new_message') return;
  } catch {
    return;
  }

  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'xiaoma') return;

  // Marvis 在线时，Listener 静默（不自动回复）
  if (isMarvisOnline()) {
    if (!xiaoma._marvisLogged) {
      console.log('[小马] Marvis 在线，Listener 静默中（只记录不回复）');
      xiaoma._marvisLogged = true;
    }
    chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content, channel: msg.channel || 'group' });
    if (chatHistory.length > 30) chatHistory.shift();
    // 更新最后消息时间戳（补拉用）
    if (msg.timestamp && msg.timestamp > lastMessageTimestamp) {
      lastMessageTimestamp = msg.timestamp;
    }
    return;
  } else {
    if (xiaoma._marvisLogged) {
      console.log('[小马] Marvis 离线，Listener 恢复 AI 代理模式');
      xiaoma._marvisLogged = false;
    }
  }

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

  // 更新最后消息时间戳（补拉用）
  if (msg.timestamp && msg.timestamp > lastMessageTimestamp) {
    lastMessageTimestamp = msg.timestamp;
  }

  // KK 的消息无条件处理
  const isFromHuman = msg.from === 'kk';
  // CC 给 KK 的汇报也处理（团队协作闭环）
  const isCCReportToKK = msg.from === 'cc' && /@KK/i.test(msg.content);
  // agent 之间需要 @小马 或 CC 向 KK 汇报时才处理
  if (!isFromHuman && !isCCReportToKK && !/@(小马|xiaoma)/i.test(msg.content)) return;

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  // 并发保护：正在处理时排队
  if (isProcessing) {
    pendingMessages.push(msg);
    return;
  }
  isProcessing = true;
  processingStartTime = Date.now();

  // 标注消息来源频道，让 AI 知道上下文
  const channelTag = (msg.channel === 'dm') ? '[私信]' : '[群聊]';
  const recent = chatHistory.slice(-6).map(m => {
    const ch = m.channel === 'dm' ? '[私信]' : '[群聊]';
    return `${ch} ${m.name}: ${m.content}`;
  }).join('\n');
  const prompt = `${recent}\n\n${channelTag} ${msg.fromName}："${msg.content}"\n\n你需要回复吗？如果消息和你无关，回复 [SKIP]。如果需要执行任务或参与讨论，直接回复。\n\n重要：如果消息 @了你，你必须回复，不要 SKIP。如果是 CC 给你汇报工作或请你评价，你必须给出评价。如果这是私信但内容涉及群聊事务（团队协作、CC、复盘、任务分配），你必须在群里回复，不要只在私信里回复。`;

  // 判断是否需要工具：必须是明确的执行指令，不是讨论
  const needsTool = /(?:帮我(?:写|创建|修改|删除|安装|部署|执行|运行|查看|读取|搜索|查找)|(?:执行|运行|部署|安装)(?:一下|命令|脚本|测试)|(?:写|创建|修改|删除)(?:一个|这个|文件|代码|脚本|配置))/i.test(msg.content);

  try {
    await xiaoma.work('正在思考...', 30);
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), prompt, needsTool);
    await xiaoma.work('正在回复...', 80);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean === 'SKIP' || clean.length < 2 || clean.includes('工具调用轮次已达上限')) {
      console.log(`[小马] 跳过回复: ${msg.fromName}: ${msg.content.substring(0, 50)}`);
      await xiaoma.idle();
      return;
    }

    // 检查是否标记为需要真实小马处理
    if (clean.includes('[需要小马处理]') || clean.includes('需要小马处理')) {
      await xiaoma.send(`@小马 需要处理: ${msg.content.substring(0, 100)}`);
      await xiaoma.idle();
      return;
    }

    // 编码检查：检测乱码并跳过
    const finalReply = clean.replace(/^(?:小马|xiaoma)[：:]\s*/i, '');
    const { valid, cleaned: safeText } = validateEncoding(finalReply);

    if (!valid) {
      console.warn(`[小马] 检测到乱码，跳过发送: ${finalReply.substring(0, 100)}`);
      await xiaoma.idle();
      return;
    }

    // ── AI 代理标记 ──
    // 如果不是 Marvis 真人在操作，标记为 [AI代理]
    const agentReply = isMarvisOnline() ? safeText : `[AI代理] ${safeText}`;

    // 判断回复频道：DM 中的群聊指令 → 发到群；否则跟随原消息频道
    let replyChannel = msg.channel || 'group';
    if (replyChannel === 'dm' && /@CC|群里|复盘|组织|任务分配|通知/.test(agentReply + msg.content)) {
      replyChannel = 'group';
    }
    await xiaoma.send(agentReply, 'text', null, replyChannel);
    await xiaoma.idle();
    lastReplyTime = now;
    chatHistory.push({ role: 'xiaoma', name: '小马', content: agentReply, channel: replyChannel });
    console.log(`[小马] ${agentReply.substring(0, 80)}`);
  } catch (err) {
    console.error('[小马] AI 错误:', err.message);
    await xiaoma.idle();
  } finally {
    isProcessing = false;
    // 处理排队的消息（FIFO）
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}

// ── 补拉断开期间的消息 ──
async function fetchMissedMessages() {
  try {
    const response = await fetch(`http://127.0.0.1:3210/api/history?since=${lastMessageTimestamp}&limit=50`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.messages || data.messages.length === 0) return;

    console.log(`[小马] 补拉 ${data.messages.length} 条断开期间的消息`);

    for (const msg of data.messages) {
      if (msg.from === 'xiaoma') continue;
      if (recentMsgKeys.has(msg.id)) continue;

      const event = JSON.stringify({ type: 'new_message', payload: msg });
      await handleMessage(event);
    }
  } catch (err) {
    console.error('[小马] 补拉消息失败:', err.message);
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
    console.warn('[小马] WebSocket 假死（90秒无消息），强制重连');
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
      console.warn('[小马] 获取 WS Token 失败，使用空 token:', e.message);
    }
  }
  // WebSocket 认证：ws 库 headers 选项不兼容，改用 URL 参数传递 token
  ws = new WebSocket(`ws://localhost:3210/ws?token=${wsToken}`);

  ws.on('open', async () => {
    console.log('[小马] WebSocket 已连接');
    reconnectDelay = 1000; // 重置退避
    lastMessageTime = Date.now(); // 重置心跳时间
    // 启动 Marvis 状态兜底轮询（3s 间隔）
    if (marvisCheckTimer) clearInterval(marvisCheckTimer);
    marvisCheckTimer = setInterval(pollMarvisStatus, 3000);
    pollMarvisStatus(); // 立即执行一次
    // 重连后补拉断开期间的消息
    await fetchMissedMessages();
  });

  ws.on('close', (code) => {
    console.log(`[小马] WebSocket 断开 (code: ${code})，${reconnectDelay / 1000}秒后重连`);
    if (marvisCheckTimer) {
      clearInterval(marvisCheckTimer);
      marvisCheckTimer = null;
    }
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[小马] WebSocket 错误:', err.message);
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

process.on('SIGINT', async () => {
  if (marvisCheckTimer) clearInterval(marvisCheckTimer);
  await xiaoma.disconnect();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) try { ws.close(); } catch {}
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

process.on('exit', () => {
  if (marvisCheckTimer) clearInterval(marvisCheckTimer);
  try { unlinkSync(PID_FILE); } catch {}
});
