#!/usr/bin/env node
/**
 * CX Sidecar — CX (Codex CLI) 真实入住 sidecar
 *
 * 职责：
 *   1. 注册 CX 到聊天室
 *   2. 监听群聊 @CX 消息
 *   3. 调用 codex exec 子进程执行任务（FIFO 队列，串行执行）
 *   4. 将回复发回群聊
 *   5. 定期上报状态
 */
import { SidecarConnection, isAtAgent, reportStatus, sendMessage } from '../sdk/sidecar-core.mjs';
import { validateMessage, createMessage } from '../sdk/message-schema.mjs';
import { spawn, execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import config from '../../config/index.js';

// ── Trace 持久化 ──
const TRACE_DIR = 'D:/BKS/projects/team-workspace/traces/cx';
const today = new Date().toISOString().split('T')[0];
const todayTraceDir = join(TRACE_DIR, today);

if (!existsSync(todayTraceDir)) {
  mkdirSync(todayTraceDir, { recursive: true });
}

function writeTraceEvent(traceId, event) {
  try {
    const tracePath = join(todayTraceDir, `${traceId}.jsonl`);
    const line = JSON.stringify({ timestamp: Date.now(), ...event }) + '\n';
    appendFileSync(tracePath, line, 'utf-8');
  } catch (err) {
    console.error(`[CX-Sidecar] Trace 写入失败: ${err.message}`);
  }
}

// ── 配置 ──
const AGENT_ID = 'cx';
const AGENT_NAME = 'CX';
const PROJECT_DIR = process.env.PROJECT_DIR || 'D:/BKS/team';
const CODEX_SANDBOX = process.env.CODEX_SANDBOX || 'workspace-write';
const CODEX_PATH = process.env.CODEX_PATH || 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
const REPLY_FILE = join(PROJECT_DIR, 'data', 'cx-reply.txt');
const EXEC_TIMEOUT = 240000; // 240秒，复杂任务需要更多时间
const MSG_EXPIRE_MS = 300000; // 消息过期时间：5分钟

// ── 模型选择策略 ──
const MODELS = config.models;

function selectModel(prompt) {
  const p = prompt.toLowerCase();
  // 轻量任务关键词
  if (/^(ls|cat|读取|列出|检查|确认|验证|查看|统计)/.test(p) && prompt.length < 200) {
    return MODELS.light;
  }
  // 重量任务关键词
  if (/批量|重构|多文件|架构|整个|全部|所有文件/.test(p) || prompt.length > 1000) {
    return MODELS.heavy;
  }
  // 默认中等
  return MODELS.medium;
}

// 确保 data 目录存在
const dataDir = join(PROJECT_DIR, 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// ── 实例 ──
let currentModel = MODELS.medium.model;

const conn = new SidecarConnection({
  agentId: AGENT_ID,
  agentName: AGENT_NAME,
  color: '#10A37F',
  model: currentModel,
  serverUrl: 'http://localhost:3210',
});

// ── 消息队列（FIFO 串行执行） ──
const messageQueue = [];
let isProcessing = false;
let idleTimeout = null;
let isErrorCoolingDown = false;

function enqueue(msg) {
  messageQueue.push({ msg, enqueuedAt: Date.now() });

  // 队列积压告警：超过 5 条通知 CC
  if (messageQueue.length > 5) {
    console.warn(`[CX-Sidecar] 队列积压 ${messageQueue.length} 条，可能存在问题`);
    sendMessage(AGENT_ID, `@CC [问题] 队列积压 ${messageQueue.length} 条消息，请检查是否有任务卡住`).catch(() => {});
  }

  processQueue();
}

async function processQueue() {
  if (isProcessing) return;

  // ???????????????
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
    isErrorCoolingDown = false;
  }

  if (messageQueue.length === 0) return;

  isProcessing = true;
  let lastTaskFailed = false;

  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    if (Date.now() - item.enqueuedAt > MSG_EXPIRE_MS) {
      console.log(`[CX-Sidecar] ??????: "${item.msg.content.substring(0, 50)}..."`);
      continue;
    }
    const result = await executeTask(item.msg);
    lastTaskFailed = !result.success;
  }

  isProcessing = false;

  if (lastTaskFailed) {
    console.log('[CX-Sidecar] ???????????error??30????idle');
    isErrorCoolingDown = true;
    idleTimeout = setTimeout(async () => {
      idleTimeout = null;
      isErrorCoolingDown = false;
      await reportStatus(AGENT_ID, 'idle', '???', 0, { model: currentModel });
    }, 30000);
  } else {
    await reportStatus(AGENT_ID, 'idle', '???', 0, { model: currentModel });
  }
}

// ── 协议消息过滤（在入队前检查） ──
function isProtocolMessage(content) {
  if (!content) return true;
  // 协议标记
  if (content.includes('[收到]')) return true;
  if (content.includes('[问题]')) return true;
  if (content.includes('[完成]')) return true;
  if (content.includes('[子任务完成]')) return true;
  // 心跳
  if (content.trim() === 'hb') return true;
  // 纯状态消息（无实质内容）
  if (content.startsWith('当前任务执行中')) return true;
  if (content.startsWith('收到，开始执行:') && content.length < 80) return true;
  return false;
}

// ── 状态上报 ──
async function pingStatus() {
  await reportStatus(AGENT_ID, isProcessing ? 'working' : 'idle', isProcessing ? '正在执行任务' : '空闲中', 0, { model: currentModel });
}

// ── codex exec 调用（带两阶段超时保护） ──
function execCodex(prompt, modelOverride) {
  return new Promise((resolve, reject) => {
    // 注入 CX 身份指令
    const fullPrompt = [
      '你是 CX，BKS 研发部代码工程师。严格遵守以下规则：',
      '1. 铁律：CC 不动手写代码，CX 只做实现——架构设计/技术决策由 CC 负责',
      '2. 完成后回复 @CC [完成] 描述 | 文件路径 | T:match O:compliant K:valid',
      '3. 遇到阻塞上报 @CC [问题] 描述',
      '4. 不越界：不碰架构设计、不自行扩大任务范围（手术式修改）',
      '5. 任务来源：只接收 CC 派发的任务，不直接接收 KK/小马的任务',
      '',
      prompt,
    ].join('\n');

    // 把 prompt 作为命令行参数传递，避免 stdin 管道问题
    const selectedModel = modelOverride || MODELS.medium.model;
    const selectedReasoning = Object.values(MODELS).find(m => m.model === selectedModel)?.reasoning || 'medium';
    const args = [
      CODEX_PATH,
      'exec',
      '-m', selectedModel,
      '-C', PROJECT_DIR,
      '-s', CODEX_SANDBOX,
      '-o', REPLY_FILE,
      '--dangerously-bypass-approvals-and-sandbox',
      fullPrompt,
    ];

    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let killed = false;
    let timeoutTimer = null;

    // 清理 timer
    const clearTimer = () => {
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    };

    // 两阶段 kill：SIGTERM → 3s → taskkill（Windows 兼容）
    const terminateChild = () => {
      if (killed) return;
      killed = true;
      console.warn(`[CX-Sidecar] codex exec 超时 (${EXEC_TIMEOUT / 1000}s)，终止进程树...`);
      try {
        // taskkill /T 杀整个进程树（含 codex.exe 子进程），/F 强制
        execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'ignore' });
      } catch {
        // taskkill 可能失败（进程已退出），兜底直接 kill
        try { child.kill(); } catch {}
      }
    };

    timeoutTimer = setTimeout(() => {
      terminateChild();
      reject(new Error(`codex exec 超时 (${EXEC_TIMEOUT / 1000}s)`));
    }, EXEC_TIMEOUT);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      clearTimer();
      if (killed) return; // 超时 kill 触发的 close，已在 reject 中处理
      if (code !== 0) {
        reject(new Error(`codex exec 退出码 ${code}: ${stderr.substring(0, 200)}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', (err) => {
      clearTimer();
      reject(err);
    });
  });
}

// ── 读取回复文件 ──
function readReplyFile() {
  if (!existsSync(REPLY_FILE)) return '';
  try {
    const content = readFileSync(REPLY_FILE, 'utf-8').trim();
    try { unlinkSync(REPLY_FILE); } catch {}
    return content;
  } catch {
    return '';
  }
}

// ── 执行单个任务 ──
async function executeTask(msg) {
  const traceId = `cx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const modelChoice = selectModel(msg.content);
  currentModel = modelChoice.model;
  
  writeTraceEvent(traceId, { event: 'start', model: currentModel, task: msg.content.substring(0, 100) });
  console.log(`[CX-Sidecar] 开始执行 (model: ${currentModel}, reasoning: ${modelChoice.reasoning}): "${msg.content.substring(0, 80)}..."`);

  try {
    await reportStatus(AGENT_ID, 'working', `正在处理: ${msg.content.substring(0, 30)}`, 30, { model: currentModel });
    writeTraceEvent(traceId, { event: 'status', status: 'working' });

    await execCodex(msg.content, modelChoice.model);
    writeTraceEvent(traceId, { event: 'exec_complete', model: currentModel });

    await reportStatus(AGENT_ID, 'working', '正在组织回复', 70, { model: currentModel });

    const reply = readReplyFile();

    if (reply) {
      writeTraceEvent(traceId, { event: 'reply_generated', length: reply.length });
      
      // Schema 校验：发送前校验回复消息
      const replyMsg = createMessage({
        from: AGENT_ID,
        fromName: AGENT_NAME,
        content: reply,
        channel: msg.channel || 'group',
      });
      
      if (replyMsg) {
        await sendMessage(AGENT_ID, replyMsg.content, replyMsg.channel);
        writeTraceEvent(traceId, { event: 'reply_sent', sent: true });
        console.log(`[CX-Sidecar] 回复已发送 (${reply.length} 字符)`);
      } else {
        console.error(`[CX-Sidecar] 回复消息 Schema 校验失败，丢弃`);
        writeTraceEvent(traceId, { event: 'reply_dropped', reason: 'schema_validation_failed' });
      }
    } else {
      writeTraceEvent(traceId, { event: 'done', output: 'empty' });
      
      const doneMsg = createMessage({
        from: AGENT_ID,
        fromName: AGENT_NAME,
        content: `@CC [完成] 任务已完成，无文本输出`,
        channel: msg.channel || 'group',
      });
      
      if (doneMsg) {
        await sendMessage(AGENT_ID, doneMsg.content, doneMsg.channel);
      } else {
        await sendMessage(AGENT_ID, `@CC [完成] 任务已完成，无文本输出`);
      }
      console.log(`[CX-Sidecar] 任务完成，无文本输出`);
    }
    writeTraceEvent(traceId, { event: 'completed', status: 'success' });
    return { success: true };
  } catch (err) {
    console.error(`[CX-Sidecar] 处理失败: ${err.message}`);
    writeTraceEvent(traceId, { event: 'error', message: err.message });
    
    const errorMsg = createMessage({
      from: AGENT_ID,
      fromName: AGENT_NAME,
      content: `@CC [问题] 任务执行失败: ${err.message.substring(0, 100)}`,
      channel: msg.channel || 'group',
    });
    
    if (errorMsg) {
      await sendMessage(AGENT_ID, errorMsg.content, errorMsg.channel);
    } else {
      await sendMessage(AGENT_ID, `@CC [问题] 任务执行失败: ${err.message.substring(0, 100)}`);
    }
    
    await reportStatus(AGENT_ID, 'error', '任务执行失败', 0, { model: currentModel });
    writeTraceEvent(traceId, { event: 'completed', status: 'error', message: err.message });
    return { success: false };
  }
}

// ── 消息处理（入队前过滤 + Schema 校验） ──
function handleMessage(event) {
  if (event.type !== 'new_message') return;
  const { payload: msg } = event;
  if (!msg || !msg.content) return;

  // Schema 校验（接收前校验）
  const { valid, errors } = validateMessage(msg);
  if (!valid) {
    console.warn(`[CX-Sidecar] 消息 Schema 校验失败:`, errors);
    // 协议消息不做校验（向后兼容）
    if (!isProtocolMessage(msg.content)) {
      console.log(`[CX-Sidecar] 丢弃不符合 Schema 的消息`);
      return; // 非协议消息，校验失败直接丢弃
    }
  }

  // 忽略自己发的消息
  if (msg.from === AGENT_ID) return;

  // 频道过滤：只处理群聊和自己的私聊
  const ch = msg.channel || 'group';
  if (ch !== 'group' && ch !== `dm_${AGENT_ID}`) return;

  // 过滤协议消息（在入队前就拦截）
  if (isProtocolMessage(msg.content)) return;

  // 只处理 @CX 的消息（私聊通道跳过此检查——私聊本身就是发给你的）
  const isPrivateChat = ch.startsWith('dm_');
  if (!isPrivateChat && !isAtAgent(msg.content, AGENT_ID)) return;

  // CC的消息：协议消息已被core层过滤，剩余的@CX消息都应处理（包括任务、追问、指令）
  // KK/小马的@CX消息也应处理（老板可以直接指派CX）
  // 其他agent的消息只处理带任务前缀的
  const isFromHumanOrCC = ['cc', 'kk', 'xiaoma', 'xiaoma-ai'].includes(msg.from);
  if (!isFromHumanOrCC) {
    const taskPrefixes = ['[任务]', '[方案审查]', '[委托]'];
    const hasTaskPrefix = taskPrefixes.some(p => msg.content.includes(p));
    if (!hasTaskPrefix) {
      console.log(`[CX-Sidecar] 跳过非任务消息: "${msg.content.substring(0, 60)}..."`);
      return;
    }
  }

  console.log(`[CX-Sidecar] 收到 @CX 消息，入队: "${msg.content.substring(0, 80)}..."`);
  enqueue(msg);
}

// ── 主流程 ──
async function main() {
  console.log(`[CX-Sidecar] 启动...`);
  console.log(`[CX-Sidecar] 项目目录: ${PROJECT_DIR}`);
  console.log(`[CX-Sidecar] 模型: ${currentModel}`);
  console.log(`[CX-Sidecar] 沙箱: ${CODEX_SANDBOX}`);

  conn.on('message', handleMessage);
  await conn.connect();
  await pingStatus();
  setInterval(pingStatus, 30000);

  console.log(`[CX-Sidecar] 启动完成，等待 @CX 消息...`);

  const cleanup = async () => {
    console.log(`[CX-Sidecar] 正在断开...`);
    await reportStatus(AGENT_ID, 'offline', '已离线', 0, { model: currentModel });
    await conn.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error(`[CX-Sidecar] 启动失败:`, err);
  process.exit(1);
});
