#!/usr/bin/env node
/**
 * CX (Codex) Agent — Hub-Spoke 模式
 *
 * 职责：
 *   1. 注册 CX 上线 + 心跳保活
 *   2. 监听群聊消息 → 只回应 @CX 的消息
 *   3. 解析消息协议：[任务] [委托] [完成] [问题]
 *   4. 执行任务 → 完成后汇报
 *   5. 结果发回群聊
 */
import { createAgent } from '../sdk/agent-client.js';
import { generateReply } from '../sdk/ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../sdk/memory.js';
import { setCache, getCache } from '../sdk/cache.js';
import { getFullMemory } from '../sdk/shared-memory.js';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';

// ✅ 修复：添加 dotenv 支持，确保直接运行时也能加载 .env
try {
  const dotenv = await import('dotenv');
  dotenv.config();
  console.log('[CX] ✅ 已加载 .env 配置');
} catch {
  console.log('[CX] ℹ️ dotenv 未安装，跳过 .env 加载');
}

// ── 单实例保护 ──
const PID_FILE = join(process.cwd(), '.cx-listener.pid');

function checkSingleInstance() {
  if (existsSync(PID_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      const oldPid = data.pid;
      try {
        process.kill(oldPid, 0);
        console.error(`[CX] 错误: cx-listener 已在运行 (PID: ${oldPid})`);
        console.error(`[CX] 如需重启，请先运行: taskkill /F /PID ${oldPid}`);
        process.exit(1);
      } catch {
        // 进程不存在，可以继续
      }
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

// ── 项目路径 ──
const PROJECT_DIR = process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
console.log(`[CX] 项目目录: ${PROJECT_DIR}`);

// 环境变量兜底：如果 AI_BACKEND 未设置，默认使用智谱 GLM-4.7-Flash
if (!process.env.AI_BACKEND) {
  process.env.AI_BACKEND = 'openai';
  process.env.OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
  process.env.OPENAI_API_KEY = process.env.ZHIPU_API_KEY_XIAOMA || process.env.ZHIPU_API_KEY_CX || '';
  process.env.OPENAI_MODEL = 'glm-4.7-flash';

  if (!process.env.OPENAI_API_KEY) {
    console.error('[CX] ❌ 错误: 智谱 API Key 未设置');
    console.error('[CX] 请确保 .env 中有 ZHIPU_API_KEY_XIAOMA 或 ZHIPU_API_KEY_CX');
    process.exit(1);
  }

  console.log(`[CX] ✅ 默认模型: GLM-4.7-Flash（智谱永久免费）`);
}

// ── 加载记忆 ──
let teamMemory = getCache('team_memory');
if (!teamMemory) {
  teamMemory = loadTeamMemory(PROJECT_DIR);
  setCache('team_memory', teamMemory, 60 * 60 * 1000);
}

const sharedMemory = await getFullMemory(30);
console.log(`[CX] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

// ── Agent 实例 ──
const cx = createAgent({
  id: 'cx',
  name: 'CX',
  color: '#10A37F',
  gridFile: 'grids/cx.js',
});

// ── 进度动画 ──
const PROGRESS_STEPS = [
  { activity: '正在分析任务...', progress: 30 },
  { activity: '正在编写代码...', progress: 50 },
  { activity: '正在测试...', progress: 70 },
  { activity: '即将完成...', progress: 85 },
];

async function withProgress(agent, startActivity, startProgress, asyncFn) {
  await agent.work(startActivity, startProgress);
  let step = 0;
  const timer = setInterval(async () => {
    if (step < PROGRESS_STEPS.length) {
      const s = PROGRESS_STEPS[step++];
      try { await agent.work(s.activity, s.progress); } catch {}
    }
  }, 12000);
  try {
    return await asyncFn();
  } finally {
    clearInterval(timer);
  }
}

// ── 消息协议解析 ──
const MSG_PROTOCOL = {
  DAILY_TASK: /@CX\s*\[日常\]\s*(.+)/i,
  CODE_TASK: /@CX\s*\[代码\]\s*(.+)/i,
  DELEGATE: /@CX\s*\[委托\]\s*(.+)/i,
  AT_CX: /@CX/i,
};

// ── 模型分层配置 ──
const MODEL_TIERS = {
  // 日常: GLM-4.7-Flash（快速、稳定、永久免费）
  normal: {
    backend: 'openai',
    openaiModel: 'glm-4.7-flash',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    openaiApiKey: process.env.ZHIPU_API_KEY_XIAOMA || process.env.ZHIPU_API_KEY_CX,
  },
  // 代码: DeepSeek V4 Pro（强推理，@CX [代码] 触发）
  code: {
    backend: 'openai',
    openaiModel: 'deepseek-ai/DeepSeek-V4-Pro',
    openaiBaseUrl: 'https://api.siliconflow.cn/v1',
    openaiApiKey: process.env.SILICONFLOW_API_KEY,
  },
  // 兜底: GLM-4.7（DeepSeek 不可用时降级，省着用）
  fallback: {
    backend: 'openai',
    openaiModel: 'glm-4.7',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    openaiApiKey: process.env.ZHIPU_API_KEY_XIAOMA || process.env.ZHIPU_API_KEY_CX,
  },
};

// ── 系统提示词 ──
const SYSTEM_PROMPT = `你是 CX（Codex），BKS 研发部的代码工程师。

## 身份
- 角色：代码工程师，负责代码实现、重构、PR 管理
- 上级：CC（研发部 Leader）
- 同级：小马（项目部 Leader）

## 职责
1. 代码实现：按 CC 的技术方案完成编码任务
2. 代码重构：批量代码规范化、模式迁移
3. PR 管理：GitHub PR 审查、合并
4. 测试用例生成：按规范生成测试用例
5. 配置更新：修改 yaml/json/env 等配置文件
6. 批量测试：API 调用、端点验证、脚本执行

## 行为守则
1. 不越界：架构设计、技术决策由 CC 负责，CX 只做实现层
2. 任务来源：技术任务由 CC 直接派发（@CX [任务]），不接收其他人的任务
3. 产出物留痕：代码、报告均需落地为文件
4. 群聊规则：只回应 @CX 的消息；阶段完成时汇报一次
5. 执行效率：接到任务立即执行，不做多余确认

注意：团队守则（含CC-CX分工铁律、Karpathy四原则等）已通过团队记忆加载，严格遵守。

## 消息格式
- 阶段完成：@CC [完成] 描述 | 文件路径 | T:match O:compliant K:valid
- 问题上报：@CC [问题] 描述

## 当前项目上下文
${teamMemory}

## 最近共享记忆
${sharedMemory}
`;

// ── 清洗工具调用标签 ──
function cleanToolCallTags(text) {
  if (!text) return '';
  let result = text;

  // 清洗 <tool_call>...</tool_call> 格式
  result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

  // 清洗 DeepSeek DSML 格式：<｜DSML｜tool_calls>...</｜DSML｜tool_calls>
  // 使用 [\s\S]*? 匹配所有内容（含换行），非贪婪
  result = result.replace(/<｜DSML｜tool_calls>[\s\S]*?<\/｜DSML｜tool_calls>/g, '');

  // 清洗所有 DSML 闭合标签（包括没有 > 的情况）
  result = result.replace(/<\/｜DSML｜[^>]*>?/g, '');

  // 清洗 DSML 开标签
  result = result.replace(/<｜DSML｜[^>]*>/g, '');

  // 清洗残留的 parameter> 等片段
  result = result.replace(/parameter>/g, '');
  result = result.replace(/invoke>/g, '');

  // 清洗空行
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

// ── 消息处理 ──
let isProcessing = false;
let processingStartTime = 0;
const pendingMessages = [];

// 看门狗：必须大于 ai-reply.js 的 TASK_TIMEOUT（默认300s），否则会误杀正常任务
const WATCHDOG_TIMEOUT = parseInt(process.env.AI_TASK_TIMEOUT) || 300000;
const WATCHDOG_GRACE = 30000;
setInterval(() => {
  if (isProcessing && Date.now() - processingStartTime > WATCHDOG_TIMEOUT + WATCHDOG_GRACE) {
    console.error(`[CX] 消息处理卡死超过 ${Math.round((WATCHDOG_TIMEOUT + WATCHDOG_GRACE)/1000)}秒，强制重置 isProcessing`);
    isProcessing = false;
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}, 30000);

async function handleMessage(raw) {
  let msg;
  try {
    // 处理 Buffer 或 String
    const str = Buffer.isBuffer(raw) ? raw.toString() : raw;
    msg = typeof str === 'string' ? JSON.parse(str) : str;
  } catch (e) {
    console.error('[CX] 消息解析失败:', e.message);
    return;
  }

  if (msg.type !== 'new_message') return;
  const p = msg.payload;
  if (!p || !p.content) return;

  // 消息过期检查 — 超过 5 分钟的消息直接丢弃
  if (p.timestamp && Date.now() - p.timestamp > 5 * 60 * 1000) {
    console.log(`[CX] 跳过过期消息: ${p.id || 'unknown'} (${Math.floor((Date.now() - p.timestamp) / 1000)}秒前)`);
    return;
  }

  // 忽略自己发的消息
  if (p.from === 'cx') return;

  const content = p.content;

  // 只处理 @CX 的消息
  if (!MSG_PROTOCOL.AT_CX.test(content)) return;

  // 排队机制
  if (isProcessing) {
    pendingMessages.push(p);
    console.log(`[CX] 消息排队中，当前队列: ${pendingMessages.length}`);
    return;
  }

  isProcessing = true;
  processingStartTime = Date.now();
  console.log(`[CX] 收到消息: ${content.substring(0, 80)}`);

  try {
    // 模型选择：[代码] → DeepSeek V4 Pro，默认 → GLM-4.7-Flash
    const isCodeTask = MSG_PROTOCOL.CODE_TASK.test(content);
    let modelOverride = isCodeTask ? { ...MODEL_TIERS.code } : { ...MODEL_TIERS.normal };
    if (isCodeTask) {
      console.log(`[CX] 代码任务，使用: ${modelOverride.openaiModel}`);
    } else {
      console.log(`[CX] 日常任务，使用: ${modelOverride.openaiModel}`);
    }

    // 加载聊天历史
    const chatHistory = (await loadChatHistory(20)) || [];
    if (!Array.isArray(chatHistory)) {
      console.error('[CX] chatHistory 不是数组，已重置为空数组');
      chatHistory = [];
    }

    // 构建 prompt
    let prompt = '';

    if (MSG_PROTOCOL.CODE_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.CODE_TASK);
      prompt = `CC 派发了代码任务（需要高质量实现）：${match[1]}\n\n请执行任务，完成后回复 @CC [完成] 并附上文件路径。`;
    } else if (MSG_PROTOCOL.DAILY_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.DAILY_TASK);
      prompt = `CC 派发了日常任务：${match[1]}\n\n请执行任务，完成后回复 @CC [完成] 并附上文件路径。`;
    } else if (MSG_PROTOCOL.DELEGATE.test(content)) {
      const match = content.match(MSG_PROTOCOL.DELEGATE);
      prompt = `CC 内部委托：${match[1]}\n\n请执行委托，完成后回复 @CC [完成]。`;
    } else {
      prompt = `@CX 的消息：${content}\n\n请根据上下文回复。`;
    }

    // 生成回复（启用工具调用，CX 需要 bash/read_file/write_file 等工具执行任务）
    // modelOverride 直接传入，无需修改/恢复 process.env
    let aiReply;
    try {
      aiReply = await withProgress(cx, '正在分析任务...', 30,
        () => generateReply(SYSTEM_PROMPT, chatHistory, prompt, true, modelOverride));
    } catch (err) {
      // 代码任务超时时，降级到 GLM-4.7 重试
      if (isCodeTask && /timeout|超时/i.test(err.message)) {
        console.log(`[CX] DeepSeek 超时，降级到 GLM-4.7 重试`);
        modelOverride = { ...MODEL_TIERS.fallback };
        processingStartTime = Date.now(); // 刷新看门狗计时，防止降级重试被误杀
        aiReply = await withProgress(cx, '降级重试中...', 50,
          () => generateReply(SYSTEM_PROMPT, chatHistory, prompt, true, modelOverride));
      } else {
        throw err;
      }
    }

    if (isCodeTask) {
      console.log(`[CX] 代码任务完成`);
    }

    // 清洗并发送
    const cleanedReply = cleanToolCallTags(aiReply);

    if (cleanedReply && cleanedReply.trim()) {
      const maxLen = parseInt(process.env.CX_MAX_REPLY_LENGTH) || 2000;
      if (cleanedReply.length > maxLen) {
        // 超长：写入文件 + 发送摘要
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const replyFile = `D:/BKS/team/通信/CX回复_${timestamp}.md`;
        const fs = await import('fs');
        fs.default.writeFileSync(replyFile, `# CX 回复 (${new Date().toLocaleString('zh-CN')})\n\n${cleanedReply}`, 'utf-8');
        const summary = cleanedReply.substring(0, 300).replace(/\n/g, ' ').trim();
        await cx.send(`@CC [完成] 任务完成，回复较长(${cleanedReply.length}字符)，已写入文件\n\n摘要: ${summary}...\n\n完整内容: ${replyFile}`);
        console.log(`[CX] 回复已写入文件 (${cleanedReply.length} 字符) -> ${replyFile}`);
      } else {
        await cx.send(cleanedReply);
        console.log(`[CX] 回复已发送 (${cleanedReply.length} 字符)`);
      }
    } else {
      await cx.send('@CC [问题] 任务执行失败：AI 返回空回复');
    }

  } catch (err) {
    console.error('[CX] 处理错误:', err.message);
    try {
      await cx.send(`@CC [问题] 任务执行失败：${err.message}`);
    } catch {}
  } finally {
    isProcessing = false;
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      console.log(`[CX] 处理排队消息，剩余: ${pendingMessages.length}`);
      setTimeout(() => handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg })), 1000);
    }
  }
}

// ── WebSocket 监听（自动重连） ──
let ws = null;
let reconnectDelay = 1000;
let lastMessageTime = 0;

// 心跳假死检测
setInterval(() => {
  if (ws && ws.readyState === ws.OPEN && Date.now() - lastMessageTime > 90000) {
    console.warn('[CX] WebSocket 假死（90秒无消息），强制重连');
    try { ws.terminate(); } catch {}
  }
}, 30000);

async function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch {}
  }

  let wsToken = process.env.WS_TOKEN || '';
  if (!wsToken) {
    try {
      const res = await fetch('http://127.0.0.1:3210/api/auth/token');
      const data = await res.json();
      wsToken = data.token || '';
    } catch (e) {
      console.warn('[CX] 获取 WS Token 失败，使用空 token:', e.message);
    }
  }
  // WebSocket 认证：ws 库 headers 选项不兼容，改用 URL 参数传递 token
  ws = new WebSocket(`ws://localhost:3210/ws?token=${wsToken}`);

  ws.on('open', async () => {
    console.log('[CX] WebSocket 已连接');
    reconnectDelay = 1000;
    lastMessageTime = Date.now();
  });

  ws.on('close', (code) => {
    console.log(`[CX] WebSocket 断开 (code: ${code})，${reconnectDelay / 1000}秒后重连`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[CX] WebSocket 错误:', err.message);
  });

  ws.on('pong', () => {
    lastMessageTime = Date.now();
  });

  ws.on('message', (data) => {
    lastMessageTime = Date.now();
    handleMessage(data);
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectWebSocket();
  }, reconnectDelay);
}

// ── 心跳 ping ──
setInterval(() => {
  if (ws && ws.readyState === ws.OPEN) {
    ws.ping();
  }
}, 30000);

// ── 主流程 ──
async function main() {
  // 注册 Agent
  await cx.connect();
  console.log('[CX] 已注册到 Workspace Server');

  // 连接 WebSocket
  await connectWebSocket();

  // 优雅退出
  const cleanup = async () => {
    console.log('[CX] 正在断开连接...');
    try { unlinkSync(PID_FILE); } catch {}
    await cx.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log('[CX] 监听启动，等待任务...');
}

main().catch(err => {
  console.error('[CX] 启动失败:', err);
  process.exit(1);
});
