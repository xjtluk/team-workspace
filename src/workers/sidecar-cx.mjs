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
import { spawn, execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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
const MODELS = {
  heavy: { model: 'deepseek-v4-pro', reasoning: 'high' },    // 多文件、批量重构、复杂推理
  medium: { model: 'deepseek-v4-pro', reasoning: 'medium' },  // 单文件修改、PR审查
  light: { model: 'glm-4.7-flash', reasoning: 'low' },        // 读文件、列目录、快速检查
};

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
  const modelChoice = selectModel(msg.content);
  currentModel = modelChoice.model;
  console.log(`[CX-Sidecar] 开始执行 (model: ${currentModel}, reasoning: ${modelChoice.reasoning}): "${msg.content.substring(0, 80)}..."`);

  try {
    await reportStatus(AGENT_ID, 'working', `正在处理: ${msg.content.substring(0, 30)}`, 30, { model: currentModel });

    await execCodex(msg.content, modelChoice.model);

    await reportStatus(AGENT_ID, 'working', '正在组织回复', 70, { model: currentModel });

    const reply = readReplyFile();

    if (reply) {
      await sendMessage(AGENT_ID, reply);
      console.log(`[CX-Sidecar] 回复已发送 (${reply.length} 字符)`);
    } else {
      await sendMessage(AGENT_ID, `@CC [完成] 任务已完成，无文本输出`);
      console.log(`[CX-Sidecar] 任务完成，无文本输出`);
    }
    return { success: true };
  } catch (err) {
    console.error(`[CX-Sidecar] 处理失败: ${err.message}`);
    await sendMessage(AGENT_ID, `@CC [问题] 任务执行失败: ${err.message.substring(0, 100)}`);
    await reportStatus(AGENT_ID, 'error', '任务执行失败', 0, { model: currentModel });
    return { success: false };
  }
}

// ── 消息处理（入队前过滤） ──
function handleMessage(event) {
  if (event.type !== 'new_message') return;
  const { payload: msg } = event;
  if (!msg || !msg.content) return;

  // 忽略自己发的消息
  if (msg.from === AGENT_ID) return;

  // 过滤协议消息（在入队前就拦截）
  if (isProtocolMessage(msg.content)) return;

  // 只处理 @CX 的消息
  if (!isAtAgent(msg.content, AGENT_ID)) return;

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
