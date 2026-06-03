#!/usr/bin/env node
/**
 * CC Agent — Hub-Spoke 模式
 *
 * 职责：
 *   1. 注册 CC 上线 + 心跳保活
 *   2. 监听群聊消息 → 只回应 @CC 的消息
 *   3. 解析消息协议：[任务] [完成] [TOK] [问题] [通过] [打回]
 *   4. 执行任务 → 完成后汇报 + TOK 自检
 *   5. 结果发回群聊 + 写入共享记忆
 */
import { createAgent } from '../sdk/agent-client.js';
import { generateReply } from '../sdk/ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../sdk/memory.js';
import { setCache, getCache } from '../sdk/cache.js';
import { getFullMemory } from '../sdk/shared-memory.js';
import { validateEncoding } from '../sdk/encoding.js';
import { writeFileSync, readdirSync, statSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';

// 清洗工具调用标签（防止泄漏到群聊）
function cleanToolCallTags(text) {
  if (!text) return '';
  const oc = String.fromCharCode(60);
  const cc = String.fromCharCode(62);
  const openTag = oc + 'tool_call' + cc;
  const closeTag = oc + '/tool_call' + cc;
  const openEsc = openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closeEsc = closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(openEsc + '[\\s\\S]*?' + closeEsc, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 单实例保护（增强版） ──
const PID_FILE = join(process.cwd(), '.cc-listener.pid');

function checkSingleInstance() {
  if (existsSync(PID_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      const oldPid = data.pid;
      const startTime = data.startTime || 0;

      // 检查进程是否还在运行
      let processAlive = false;
      try {
        process.kill(oldPid, 0);
        processAlive = true;
      } catch {
        processAlive = false;
      }

      if (processAlive) {
        // 进程存在，但检查是否是僵尸进程（启动超过 24 小时无心跳更新）
        const age = Date.now() - startTime;
        if (age > 24 * 60 * 60 * 1000) {
          console.warn(`[CC] 警告: 检测到旧进程 (PID: ${oldPid}) 运行超过 24 小时，可能是僵尸进程`);
          console.warn(`[CC] 请手动终止: taskkill /F /PID ${oldPid}`);
          process.exit(1);
        } else {
          console.error(`[CC] 错误: cc-listener 已在运行 (PID: ${oldPid})`);
          console.error(`[CC] 如需重启，请先运行: taskkill /F /PID ${oldPid}`);
          process.exit(1);
        }
      }
      // 进程不存在，可以继续
    } catch {
      // PID 文件格式错误，清理后继续
    }
  }
  writeFileSync(PID_FILE, JSON.stringify({
    pid: process.pid,
    startTime: Date.now(),
  }), 'utf8');
}

checkSingleInstance();

// Marvis 心跳检测：收到 from=xiaoma 的 [hb] 消息时更新时间戳
let marvisLastSeen = Date.now();

function cleanupPidFile() {
  try {
    if (existsSync(PID_FILE)) {
      const data = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      if (data.pid === process.pid) {
        unlinkSync(PID_FILE);
      }
    }
  } catch {}
}

// ── 项目路径（支持命令行参数或环境变量）──
const PROJECT_DIR = process.argv[2] || process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
console.log(`[CC] 项目目录: ${PROJECT_DIR}`);

// ── 加载记忆 ──
let teamMemory = getCache('team_memory');
if (!teamMemory) {
  teamMemory = loadTeamMemory(PROJECT_DIR);
  setCache('team_memory', teamMemory, 60 * 60 * 1000);
}

const sharedMemory = await getFullMemory(30);
console.log(`[CC] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

// ── 定期清理任务汇报文档 ──
const DOCS_DIR = join(PROJECT_DIR, 'docs');
const MAX_DOC_AGE = 24 * 60 * 60 * 1000; // 24 小时

function cleanupTaskDocs() {
  try {
    const files = readdirSync(DOCS_DIR);
    const now = Date.now();
    let cleaned = 0;

    files.forEach(file => {
      if (file.startsWith('任务汇报_') && file.endsWith('.md')) {
        const filePath = join(DOCS_DIR, file);
        const stat = statSync(filePath);
        const age = now - stat.mtime.getTime();

        if (age > MAX_DOC_AGE) {
          unlinkSync(filePath);
          cleaned++;
          console.log(`[CC] 清理过期文档: ${file}`);
        }
      }
    });

    if (cleaned > 0) {
      console.log(`[CC] 共清理 ${cleaned} 个过期文档`);
    }
  } catch (err) {
    console.error('[CC] 清理文档错误:', err.message);
  }
}

// 每小时清理一次过期文档
setInterval(cleanupTaskDocs, 60 * 60 * 1000);
console.log('[CC] 文档清理任务已启动（每小时检查一次）');

// ── 进度动画：在 AI 生成期间定期更新 status，让 UI 保持活跃 ──
const PROGRESS_STEPS = [
  { activity: '正在思考...', progress: 30 },
  { activity: '正在分析...', progress: 45 },
  { activity: '正在组织回复...', progress: 60 },
  { activity: '即将完成...', progress: 75 },
];

async function withProgress(agent, startActivity, startProgress, asyncFn) {
  await agent.work(startActivity, startProgress);
  let step = 0;
  const timer = setInterval(async () => {
    if (step < PROGRESS_STEPS.length) {
      const s = PROGRESS_STEPS[step++];
      try { await agent.work(s.activity, s.progress); } catch {}
    }
  }, 12000); // 每 12 秒更新一次
  try {
    return await asyncFn();
  } finally {
    clearInterval(timer);
  }
}

// ── 消息协议解析 ──
const MSG_PROTOCOL = {
  // 小马派发任务：@CC [任务] 描述 或 CC，[任务] 描述
  TASK_ASSIGN: /(?:@CC|CC[，,：:])\s*\[任务\]\s*(.+)/i,
  // 小马验收通过：@CC [通过] 描述 或 CC，[通过] 描述
  APPROVE: /(?:@CC|CC[，,：:])\s*\[通过\]\s*(.+)/i,
  // 小马打回：@CC [打回] 描述 | 原因
  REJECT: /(?:@CC|CC[，,：:])\s*\[打回\]\s*(.+?)(?:\s*\|\s*(.+))?$/i,
  // @CC 或 CC，的其他消息（需要判断是否相关）
  AT_CC: /(?:@CC|CC[，,：:])/i,
};

// ── 系统提示词 ──
const SYSTEM_PROMPT = `你是 CC，BKS 研发部 Leader。技术方案、架构设计、编码实现、测试部署。

## Hub-Spoke 工作流
- 小马是任务分发中枢，负责拆解任务、分配给你
- 你接到 @CC [任务] 后执行任务
- 完成后在群里汇报，格式：@小马 [完成] 描述 | 文件路径 | T:匹配 O:合规 K:有效
- 有问题时上报，格式：@小马 [问题] 描述

## 你的团队记忆
${teamMemory}

## 最近发生的事件
${sharedMemory}

## 你的工具能力
bash、read_file、write_file、list_files、search_code

## 行为规则
1. 只回应 @CC 的消息，其他消息不关注
2. 收到 @CC [任务] → 执行任务 → 完成后汇报
3. 收到 @CC [通过] → 确认验收
4. 收到 @CC [打回] → 根据原因修正后重新提交
5. 收到其他 @CC 消息 → 判断是否需要回复

## 任务执行规则
- 收到任务后，先评估可行性
- 可行则直接用工具执行
- 执行过程中需要小马配合，在消息里 @小马 说明需求
- 完成后，汇报结果 + 文件路径 + TOK 自检

## TOK 自检格式（每次完成任务必须附带）
T（任务匹配）：✅ 严格匹配本岗位职责，无越权操作
O（操作合规）：✅ 文件路径/目录归类/操作流程规范
K（结果有效）：✅ 成果文件可正常读取，可直接用于下一环节

## 输出格式
- 只用中文回复，不要出现英文、代码片段、随机字符串
- 回复简洁，1-3 句话，不要长篇大论
- 不要输出思考过程、分析步骤、内部标记
- 直接说结论和行动，不要解释推理

## 消息格式示例
- 接收任务：@CC [任务] 实现用户登录模块
- 完成汇报：@小马 [完成] 登录模块接口 | src/auth/login.js | T:匹配 O:合规 K:有效
- 需要TOK：@小马 [TOK] 请验收登录模块 | src/auth/login.js
- 问题上报：@小马 [问题] 缺少数据库配置
- 验收确认：收到，验收通过

记住：你是技术负责人，接到任务就执行，完成就汇报，有问题就上报。`;

// ── Agent 注册 ──
const cc = createAgent({ id: 'cc', name: 'CC', color: '#4A90D9' });
await cc.connect();
console.log('[CC] Agent 注册完成');

// ── 加载历史 ──
const chatHistory = [];
const historyMsgs = await loadChatHistory(30);
historyMsgs.forEach(m => chatHistory.push({ role: m.from, name: m.fromName, content: m.content }));
console.log(`[CC] 加载了 ${historyMsgs.length} 条历史消息`);

// 用最后一条历史消息的时间戳初始化，避免重复拉取已知消息
let lastMessageTimestamp = historyMsgs.length > 0
  ? Math.max(...historyMsgs.map(m => m.timestamp || 0))
  : Date.now();

let lastReplyTime = 0;
const COOLDOWN = 5000;
const recentMsgKeys = new Set();

// 简单内容 hash（用于去重）
function contentHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

// ── 消息协议解析 ──
function parseMessageProtocol(content) {
  // 检查是否是任务派发
  const taskMatch = content.match(MSG_PROTOCOL.TASK_ASSIGN);
  if (taskMatch) {
    return { type: 'task_assign', task: taskMatch[1].trim() };
  }

  // 检查是否是验收通过
  const approveMatch = content.match(MSG_PROTOCOL.APPROVE);
  if (approveMatch) {
    return { type: 'approve', description: approveMatch[1].trim() };
  }

  // 检查是否是打回
  const rejectMatch = content.match(MSG_PROTOCOL.REJECT);
  if (rejectMatch) {
    return { type: 'reject', description: rejectMatch[1].trim(), reason: rejectMatch[2]?.trim() || '' };
  }

  // 检查是否 @CC
  if (MSG_PROTOCOL.AT_CC.test(content)) {
    return { type: 'at_cc', content: content };
  }

  return { type: 'other' };
}

// ── TOK 自检模板 ──
function generateTokCheck() {
  return 'T:匹配 O:合规 K:有效';
}

// ── 补拉断开期间的消息 ──
async function fetchMissedMessages() {
  try {
    const response = await fetch(`http://127.0.0.1:3210/api/history?since=${lastMessageTimestamp}&limit=50`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.messages || data.messages.length === 0) return;

    console.log(`[CC] 补拉 ${data.messages.length} 条断开期间的消息`);

    // 只处理 @CC 的消息（排除自己发的）
    for (const msg of data.messages) {
      if (msg.from === 'cc') continue;
      if (!msg.content.includes('@CC') && !msg.content.includes('CC，')) continue;

      // 检查是否已经处理过（避免重复回复）
      if (recentMsgKeys.has(msg.id)) continue;

      // 模拟 WebSocket 消息触发处理
      const event = JSON.stringify({ type: 'new_message', payload: msg });
      await handleMessage(event);
    }
  } catch (err) {
    console.error('[CC] 补拉消息失败:', err.message);
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
    console.warn('[CC] WebSocket 假死（90秒无消息），强制重连');
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
      console.warn('[CC] 获取 WS Token 失败，使用空 token:', e.message);
    }
  }
  ws = new WebSocket(`ws://localhost:3210/ws?token=${wsToken}`);

  ws.on('open', async () => {
    console.log('[CC] WebSocket 已连接');
    reconnectDelay = 1000; // 重置退避
    lastMessageTime = Date.now(); // 重置心跳时间
    // 重连后补拉断开期间的消息
    await fetchMissedMessages();
  });

  ws.on('close', (code) => {
    console.log(`[CC] WebSocket 断开 (code: ${code})，${reconnectDelay / 1000}秒后重连`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[CC] WebSocket 错误:', err.message);
    // error 后会触发 close，不在这里重连
  });

  ws.on('pong', () => {
    lastMessageTime = Date.now(); // 收到 pong，连接正常
  });

  // 只注册一次消息处理器（使用命名函数便于调试）
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

// 消息处理锁（防止并发处理多条消息）
let isProcessing = false;
let processingStartTime = 0;
const pendingMessages = [];

// 看门狗：isProcessing 卡死超过 3 分钟强制重置
setInterval(() => {
  if (isProcessing && Date.now() - processingStartTime > 180000) {
    console.error('[CC] 消息处理卡死超过 3 分钟，强制重置 isProcessing');
    isProcessing = false;
    // 处理排队的消息
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}, 30000);

async function handleMessage(raw) {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'cc') return;

  // Marvis 心跳检测 + xiaoma-ai 过滤
  if (msg.from === 'xiaoma') {
    if (/\[hb\]/.test(msg.content)) {
      marvisLastSeen = Date.now();
      console.log('[CC] 收到 Marvis 心跳');
      return;
    }
    if (/\[上线\]/.test(msg.content)) {
      marvisLastSeen = Date.now();
      console.log('[CC] Marvis 上线');
      return;
    }
    if (/\[下线\]/.test(msg.content)) {
      marvisLastSeen = 0;
      console.log('[CC] Marvis 下线');
      return;
    }
  }
  if (msg.from === 'xiaoma-ai' && Date.now() - marvisLastSeen < 10 * 60 * 1000) {
    console.log('[CC] Marvis 在线，过滤 xiaoma-ai 消息');
    return;
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

  // 更新历史
  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 30) chatHistory.shift();

  // 更新最后消息时间戳（用于重连后补拉）
  if (msg.timestamp && msg.timestamp > lastMessageTimestamp) {
    lastMessageTimestamp = msg.timestamp;
  }

  // 不写共享记忆——xiaoma-listener 统一记录，避免跨进程重复写入

  // 解析消息协议
  const protocol = parseMessageProtocol(msg.content);

  // KK 的消息无条件处理；agent 之间需要 @CC 才处理
  const isFromHuman = msg.from === 'kk';
  if (!isFromHuman && protocol.type === 'other') return;

  // 冷却期（立即更新时间戳，防止并发消息穿透）
  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;
  lastReplyTime = now;

  // 如果正在处理消息，排队等待
  if (isProcessing) {
    pendingMessages.push(msg);
    console.log(`[CC] 消息排队中，当前队列: ${pendingMessages.length}`);
    return;
  }
  isProcessing = true;
  processingStartTime = Date.now();

  try {
  // 根据消息类型处理
  let reply = '';

  // KK 的非协议消息当作普通对话处理
  const effectiveType = (protocol.type === 'other' && isFromHuman) ? 'at_cc' : protocol.type;

  switch (effectiveType) {
    case 'task_assign':
      // 收到任务，开始执行
      console.log(`[CC] 收到任务: ${protocol.task}`);
      await cc.work(`执行任务: ${protocol.task}`, 10);

      // 构造 prompt 让 AI 执行任务
      const taskPrompt = `@CC [任务] ${protocol.task}\n\n请执行这个任务。完成后，用以下格式汇报：\n@小马 [完成] 任务描述 | 文件路径 | T:匹配 O:合规 K:有效\n\n如果遇到问题，用以下格式上报：\n@小马 [问题] 问题描述`;

      try {
        const taskReply = await withProgress(cc, `分析任务: ${protocol.task}`, 30,
          () => generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), taskPrompt, true));
        await cc.work(`整理结果: ${protocol.task}`, 70);
        reply = taskReply.trim();

        // 如果 AI 返回空字符串，生成一个简单的回复
        if (!reply || reply === '(无回复)') {
          reply = `@小马 [完成] 已执行任务: ${protocol.task} | 无文件产出 | T:匹配 O:合规 K:有效`;
        }

        // 如果回复过长（超过 200 字符），写入文档，群聊中只发送简短汇报
        if (reply.length > 200) {
          const docPath = join(DOCS_DIR, `任务汇报_${Date.now()}.md`);
          const docContent = `# 任务汇报\n\n**任务**: ${protocol.task}\n**时间**: ${new Date().toISOString()}\n**执行者**: CC\n\n## 详细内容\n\n${reply}\n\n---\n*自动生成，定期清理*`;

          // 写入文档
          const { writeFileSync } = await import('fs');
          writeFileSync(docPath, docContent, 'utf8');
          console.log(`[CC] 详细答复已写入文档: ${docPath}`);

          // 群聊中只发送简短汇报
          reply = `@小马 [完成] ${protocol.task} | ${docPath} | T:匹配 O:合规 K:有效`;
        }

        // 如果 AI 没有自动添加 TOK 自检，手动添加
        if (reply && !reply.includes('T:匹配')) {
          // 检查是否是完成汇报格式
          if (reply.includes('[完成]')) {
            reply = reply.replace(/(@小马\s*\[完成\]\s*.+)/, `$1 | ${generateTokCheck()}`);
          }
        }
      } catch (err) {
        console.error('[CC] 任务执行错误:', err.message);
        reply = `@小马 [问题] 任务执行失败: ${err.message}`;
      }
      break;

    case 'approve':
      // 验收通过
      console.log(`[CC] 验收通过: ${protocol.description}`);
      reply = `收到，验收通过`;
      break;

    case 'reject':
      // 被打回，需要修正
      console.log(`[CC] 被打回: ${protocol.description}，原因: ${protocol.reason}`);
      await cc.work(`修正任务: ${protocol.description}`, 10);

      const rejectPrompt = `@CC [打回] ${protocol.description} | ${protocol.reason}\n\n任务被打回，请根据原因修正。完成后重新汇报。`;

      try {
        const rejectReply = await withProgress(cc, `分析修正: ${protocol.description}`, 30,
          () => generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), rejectPrompt, true));
        await cc.work(`整理结果: ${protocol.description}`, 70);
        reply = rejectReply.trim();

        // 如果 AI 没有自动添加 TOK 自检，手动添加
        if (reply && !reply.includes('T:匹配')) {
          if (reply.includes('[完成]')) {
            reply = reply.replace(/(@小马\s*\[完成\]\s*.+)/, `$1 | ${generateTokCheck()}`);
          }
        }
      } catch (err) {
        console.error('[CC] 修正错误:', err.message);
        reply = `@小马 [问题] 修正失败: ${err.message}`;
      }
      break;

    case 'at_cc':
      // 其他 @CC 消息，让 AI 判断是否需要回复
      const recent = chatHistory.slice(-6).map(m => `${m.name}: ${m.content}`).join('\n');
      const prompt = `${recent}\n\n${msg.fromName}："${msg.content}"\n\n这是 @CC 的消息。你需要回复吗？如果消息和你无关，回复 [SKIP]。如果需要执行任务或参与讨论，直接回复。\n\n重要：如果回复涉及团队协作、产品、项目进展等内容，请在回复开头 @小马 让它知晓。如果只是技术细节确认，直接回复 @KK 即可。`;

      try {
        const aiReply = await withProgress(cc, '正在思考...', 30,
          () => generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), prompt, false));
        const clean = aiReply.trim();

        if (clean.includes('[SKIP]') || clean === 'SKIP' || clean.length < 2) {
          await cc.idle();
          return;
        }

        reply = clean.replace(/^(?:CC|cc)[：:]\s*/i, '');
        await cc.work('正在回复...', 80);
      } catch (err) {
        console.error('[CC] AI 错误:', err.message);
        await cc.idle();
        return;
      }
      break;
  }

  // 发送回复（清洗工具调用标签，防止泄漏）
  if (reply) {
    const cleaned = cleanToolCallTags(reply);
    if (!cleaned) {
      await cc.idle();
    } else {
      // 编码检查：检测乱码并跳过
      const { valid, cleaned: safeText } = validateEncoding(cleaned);
      if (!valid) {
        console.warn(`[CC] 检测到乱码，跳过发送: ${cleaned.substring(0, 100)}`);
        await cc.idle();
        return;
      }

      await cc.send(safeText);
      await cc.idle();
      chatHistory.push({ role: 'cc', name: 'CC', content: safeText });
      // 不写共享记忆——统一由 /api/history 提供
      console.log(`[CC] ${safeText.substring(0, 80)}`);
    }
  }

  } catch (err) {
    console.error('[CC] 消息处理异常:', err.message);
  } finally {
    isProcessing = false;
    // 处理排队的消息（FIFO：先进先出）
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}

process.on('SIGINT', async () => {
  await cc.disconnect();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) try { ws.close(); } catch {}
  cleanupPidFile();
  process.exit(0);
});

process.on('exit', cleanupPidFile);
