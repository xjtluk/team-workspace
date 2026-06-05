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
import { route, getRouteChain, classifyTask } from '../sdk/model-router.js';
import { report as reportHealth } from '../sdk/provider-health.js';
import { writeFileSync, existsSync, readFileSync, unlinkSync, appendFileSync } from 'fs';
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
// ── 执行日志 ──
const CX_LOG = join(process.cwd(), 'logs', 'cx-execution.log');

// ── 项目路径 ──
const PROJECT_DIR = process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
console.log(`[CX] 项目目录: ${PROJECT_DIR}`);

// 环境变量兜底：如果 AI_BACKEND 未设置，默认使用智谱 GLM-4.7-Flash
if (!process.env.AI_BACKEND) {
  process.env.AI_BACKEND = 'openai';
  process.env.OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
  process.env.OPENAI_API_KEY = process.env.ZHIPU_API_KEY_CX || process.env.ZHIPU_API_KEY_XIAOMA || '';
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

const sharedMemory = await getFullMemory(10);
console.log(`[CX] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

// ── Agent 实例 ──
const cx = createAgent({
  id: 'cx',
  name: 'CX',
  color: '#10A37F',
  gridFile: 'grids/cx.js',
  getModel: () => currentModel,
});

// ── 工具执行进度回调 ──
const TOOL_LABELS = {
  bash: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  list_files: '浏览目录',
  search_code: '搜索代码',
};

function createToolProgressCallback(agent) {
  let toolRound = 0;
  return async (toolName, toolInput, roundIndex) => {
    toolRound++;
    const label = TOOL_LABELS[toolName] || toolName;
    const detail = toolInput?.command || toolInput?.path || toolInput?.pattern || '';
    const shortDetail = typeof detail === 'string' ? detail.substring(0, 40) : '';
    const progress = Math.min(30 + toolRound * 5, 90);
    try {
      await agent.work(`${currentTaskName} — ${label}`, progress);
    } catch {}
  };
}

// ── 消息协议解析 ──
const MSG_PROTOCOL = {
  DAILY_TASK: /@CX\s*\[日常\]\s*(.+)/i,
  CODE_TASK: /@CX\s*\[代码\]\s*(.+)/i,
  DELEGATE: /@CX\s*\[委托\]\s*(.+)/i,
  AT_CX: /@CX/i,
};

// ── 模型分层配置（路由系统的 fallback 兜底）──
// 主路由在 config/model-allocation.js，这里只做最后保底
const MODEL_TIERS = {
  // 硅基 DS4 Pro（强推理）
  siliconflowPro: {
    backend: 'openai',
    openaiModel: 'deepseek-ai/DeepSeek-V4-Pro',
    openaiBaseUrl: 'https://api.siliconflow.cn/v1',
    openaiApiKey: process.env.SILICONFLOW_API_KEY,
  },
  // 硅基 DS4 Flash（快速）
  siliconflowFlash: {
    backend: 'openai',
    openaiModel: 'deepseek-ai/DeepSeek-V4-Flash',
    openaiBaseUrl: 'https://api.siliconflow.cn/v1',
    openaiApiKey: process.env.SILICONFLOW_API_KEY,
  },
  // TaoToken DS4 Pro
  taotokenPro: {
    backend: 'openai',
    openaiModel: 'deepseek-v4-pro',
    openaiBaseUrl: 'https://taotoken.net/api/v1',
    openaiApiKey: process.env.TAOTOKEN_API_KEY,
  },
  // TaoToken DS4 Flash
  taotokenFlash: {
    backend: 'openai',
    openaiModel: 'deepseek-v4-flash',
    openaiBaseUrl: 'https://taotoken.net/api/v1',
    openaiApiKey: process.env.TAOTOKEN_API_KEY,
  },
  // 火山 DS4 Flash
  volcFlash: {
    backend: 'openai',
    openaiModel: 'ep-20260602221852-f6q4v',
    openaiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    openaiApiKey: process.env.ARK_API_KEY,
  },
  // 智谱 GLM-4.7（额度多，优先用完）
  zhipuGLM: {
    backend: 'openai',
    openaiModel: 'glm-4.7',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    openaiApiKey: process.env.ZHIPU_API_KEY_CX || process.env.ZHIPU_API_KEY_XIAOMA,
  },
  // 智谱 GLM-4.7-Flash（永久免费兜底）
  zhipuFlash: {
    backend: 'openai',
    openaiModel: 'glm-4.7-flash',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    openaiApiKey: process.env.ZHIPU_API_KEY_CX || process.env.ZHIPU_API_KEY_XIAOMA,
  },
};

// ── 当前模型跟踪（用于心跳上报）──
let currentModel = "glm-4.7-flash";
let currentTaskName = '';  // 任务级状态显示

// ── Provider 冷却机制（429后5分钟跳过同一provider） ──
const providerCooldown = new Map();
const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000; // 5分钟冷却

function isProviderOnCooldown(name) {
  const until = providerCooldown.get(name);
  return until && Date.now() < until;
}

function markProviderCooldown(name) {
  providerCooldown.set(name, Date.now() + PROVIDER_COOLDOWN_MS);
  console.log(`[CX] ${name} 触发冷却，5分钟后恢复`);
}

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

  // 清洗 DeepSeek DSML 格式：兼容单竖线 ｜ 和双竖线 ｜｜
  result = result.replace(/<｜+DSML｜+tool_calls>[\s\S]*?<\/｜+DSML｜+tool_calls>/g, '');
  result = result.replace(/<\/｜+DSML｜+[^>]*>?/g, '');
  result = result.replace(/<｜+DSML｜+[^>]*>/g, '');

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

// 看门狗：动态超时，根据任务复杂度调整
// 简单任务120s / 代码任务300s / 批量任务600s
const WATCHDOG_GRACE = 30000;
let currentWatchdogTimeout = 120000; // 默认120s

// 根据消息内容判断任务复杂度并设置超时
function setWatchdogTimeout(content) {
  if (/批量|batch|大量|全部|所有文件|全量|所有项目/i.test(content)) {
    currentWatchdogTimeout = 600000; // 批量600s
  } else if (/@CX\s*\[代码\]/i.test(content)) {
    currentWatchdogTimeout = 300000; // 代码300s
  } else {
    currentWatchdogTimeout = 120000; // 简单120s
  }
  console.log(`[CX] 看门狗超时: ${Math.round(currentWatchdogTimeout/1000)}秒 (${currentWatchdogTimeout === 600000 ? '批量' : currentWatchdogTimeout === 300000 ? '代码' : '简单'}任务)`);
}

// ── 任务摘要提取（任务级状态显示）──
function extractTaskSummary(content) {
  const match = content.match(/@CX\s*\[(?:代码|日常|委托|任务)\]\s*(.+)/i);
  if (match) return match[1].substring(0, 30);
  return content.substring(0, 30);
}

// ── 群聊通知辅助函数 ──
async function sendGroupMessage(fromId, msg) {
  try {
    const res = await fetch('http://localhost:3210/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromId, content: msg, channel: 'group' }),
    });
    if (!res.ok) console.error('[CX] 群聊通知发送失败:', res.status);
  } catch (e) {
    console.error('[CX] 群聊通知发送异常:', e.message);
  }
}

// ── 执行日志 ──
function logExecution(event, detail) {
  const line = '[' + new Date().toISOString() + '] ' + event + ': ' + detail + '\n';
  try { appendFileSync(CX_LOG, line); } catch {}
}

setInterval(() => {
  if (isProcessing && Date.now() - processingStartTime > currentWatchdogTimeout + WATCHDOG_GRACE) {
    console.error(`[CX] 消息处理卡死超过 ${Math.round((currentWatchdogTimeout + WATCHDOG_GRACE)/1000)}秒，强制重置 isProcessing`);
    isProcessing = false;
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}, 30000);

// 写故障报告文件
function writeFaultReport(error, routeChain) {
  try {
    const now = new Date().toLocaleString('zh-CN');
    const providers = routeChain.map(f => f.name).join(' → ');
    const report = `# CX 故障报告\n\n时间: ${now}\n错误: ${error}\n尝试的 provider: ${providers}\n状态: 所有 provider 失败\n`;
    writeFileSync('D:/BKS/team/通信/CX故障报告.md', report, 'utf-8');
    console.log('[CX] 故障报告已写入');
  } catch (e) {
    console.error('[CX] 写故障报告失败:', e.message);
  }
}

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
    // 通知点2：排队通知
    sendGroupMessage('cx', `当前任务执行中，已排队。队列: ${pendingMessages.length} 条`);
    logExecution('QUEUE', 'pending: ' + pendingMessages.length);
    return;
  }

  isProcessing = true;
  processingStartTime = Date.now();
  console.log(`[CX] 收到消息: ${content.substring(0, 80)}`);

  // 任务级状态：提取任务摘要
  currentTaskName = extractTaskSummary(content);

  // 动态超时设置
  setWatchdogTimeout(content);

  // 通知点1：接活通知
  sendGroupMessage('cx', `收到，开始执行: ${currentTaskName}`);
  logExecution('RECEIVE', currentTaskName);

  try {
    const isCodeTask = MSG_PROTOCOL.CODE_TASK.test(content);

    // 按任务类型设置 fetch 超时
    process.env.CX_FETCH_TIMEOUT = isCodeTask ? '120000' : '60000';
    logExecution('START', isCodeTask ? '代码任务' : '日常任务');

    // 加载聊天历史（限制条数和单条长度，防止上下文过载导致模型返回空）
    let chatHistory = (await loadChatHistory(10)) || [];
    if (!Array.isArray(chatHistory)) {
      console.error('[CX] chatHistory 不是数组，已重置为空数组');
      chatHistory = [];
    }
    // 截断过长的历史消息，防止单条消息占用过多 token
    chatHistory = chatHistory.map(m => ({
      ...m,
      content: typeof m.content === 'string' && m.content.length > 500
        ? m.content.substring(0, 500) + '...(截断)'
        : m.content,
    }));

    // 构建 prompt（开头注入身份提醒，防止多轮工具调用后忘记身份）
    const identityReminder = `你是 CX，BKS 研发部代码工程师。铁律：1.接到任务先在群里通知"收到，开始执行" 2.完成后回复 @CC [完成] 3.遇到阻塞上报 @CC [问题]。`;
    let prompt = '';

    if (MSG_PROTOCOL.CODE_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.CODE_TASK);
      prompt = `${identityReminder}\n\nCC 派发了代码任务（需要高质量实现）：${match[1]}\n\n请执行任务，完成后回复 @CC [完成] 并附上文件路径。`;
    } else if (MSG_PROTOCOL.DAILY_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.DAILY_TASK);
      prompt = `${identityReminder}\n\nCC 派发了日常任务：${match[1]}\n\n请执行任务，完成后回复 @CC [完成] 并附上文件路径。`;
    } else if (MSG_PROTOCOL.DELEGATE.test(content)) {
      const match = content.match(MSG_PROTOCOL.DELEGATE);
      prompt = `${identityReminder}\n\nCC 内部委托：${match[1]}\n\n请执行委托，完成后回复 @CC [完成]。`;
    } else {
      prompt = `${identityReminder}\n\n@CX 的消息：${content}\n\n请根据上下文回复。`;
    }

    // 智能模型路由：根据任务内容 + 上下文大小自动选择最优 provider
    const contextSize = (SYSTEM_PROMPT?.length || 0) + JSON.stringify(chatHistory).length + prompt.length;
    const routeResult = route(content, contextSize);
    let modelOverride = routeResult.modelOverride || { ...MODEL_TIERS.volcFlash };
    currentModel = modelOverride.openaiModel;
    console.log(`[CX] 任务分类: ${routeResult.taskType}, 选中: ${routeResult.providerName}, 上下文: ${contextSize}字符`);

    // 生成回复（启用工具调用，CX 需要 bash/read_file/write_file 等工具执行任务）
    let aiReply;
    const toolRounds = isCodeTask ? 50 : 20;
    console.log(`[CX] 工具轮次: ${toolRounds}次 (${isCodeTask ? '代码' : '日常'}任务)`);

    // 实时进度回调：每次工具执行时更新 agent 状态
    const onToolCall = createToolProgressCallback(cx);

    // 智能降级链：按 provider 健康度排序，动态选择
    const routeChain = getRouteChain(content, contextSize);

    let lastErr;
    for (let i = 0; i < routeChain.length; i++) {
      const { name, tierName, tier } = routeChain[i];

      modelOverride = { ...tier };
      currentModel = modelOverride.openaiModel;
      try {
        console.log(`[CX] 尝试 ${name} (${modelOverride.openaiModel})`);
        await cx.work(`${currentTaskName} — 准备中`, 20);
        aiReply = await generateReply(SYSTEM_PROMPT, chatHistory, prompt, true, modelOverride, toolRounds, onToolCall);

        // 调试日志：记录回复类型和长度
        const replyType = typeof aiReply;
        const replyLen = replyType === 'string' ? aiReply.length : (aiReply?.text?.length || 0);
        console.log(`[CX] ${name} 回复: type=${replyType}, len=${replyLen}`);

        // 空回复检测：模型返回成功但内容为空时，尝试下一个 provider
        const replyText = typeof aiReply === 'string' ? aiReply : (aiReply?.text || '');
        if (!replyText || !replyText.trim()) {
          console.warn(`[CX] ${name} 返回空回复，尝试下一个 provider`);
          reportHealth(tierName, 'unknown', '空回复');
          aiReply = undefined;
          continue;
        }

        // 成功 → 报告健康度
        reportHealth(tierName, 'success');
        console.log(`[CX] ${name} 成功`);
        break;
      } catch (err) {
        lastErr = err;
        console.log(`[CX] ${name} 失败: ${err.message.substring(0, 100)}`);

        // 根据错误类型报告健康度
        if (/429|rate.?limit/i.test(err.message)) {
          reportHealth(tierName, 'rate_limit');
        } else if (/unterminated|truncat|json/i.test(err.message)) {
          reportHealth(tierName, 'truncation');
        } else if (/timeout|abort/i.test(err.message)) {
          reportHealth(tierName, 'timeout');
        } else if (/401|403/i.test(err.message)) {
          reportHealth(tierName, 'auth_error');
        } else {
          reportHealth(tierName, 'unknown', err.message.substring(0, 50));
        }

        if (i < routeChain.length - 1) {
          processingStartTime = Date.now(); // 刷新看门狗
          continue;
        }
        // 所有降级都失败，上报 CC + 写故障报告
        console.log(`[CX] 所有模型降级失败: ${lastErr.message}`);
        // 通知点3：错误通知
        sendGroupMessage('cx', `执行失败: ${lastErr.message.substring(0, 100)}`);
        logExecution('FAIL', lastErr.message);
        aiReply = `@CC [问题] 所有模型降级失败: ${lastErr.message}，请指示。`;
        writeFaultReport(lastErr.message, routeChain);
      }
    }

    // P0修复：所有 provider 都在冷却中时，aiReply 为 undefined
    if (!aiReply) {
      const cooldownList = routeChain.map(f => f.name).filter(n => isProviderOnCooldown(n));
      if (cooldownList.length === routeChain.length) {
        aiReply = `@CC [问题] 所有 API 提供商均在冷却中（${cooldownList.join('、')}），约5分钟后自动恢复。`;
        console.log(`[CX] 所有 provider 冷却中: ${cooldownList.join(', ')}`);
        writeFaultReport(`所有 provider 冷却中: ${cooldownList.join(', ')}`, routeChain);
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

    logExecution('DONE', currentTaskName);
  } catch (err) {
    console.error('[CX] 处理错误:', err.message);
    // 通知点3：错误通知
    sendGroupMessage('cx', `执行失败: ${err.message.substring(0, 100)}`);
    logExecution('FAIL', err.message);
    try {
      await cx.send(`@CC [问题] 任务执行失败：${err.message}`);
    } catch {}
  } finally {
    isProcessing = false;
    currentTaskName = '';
    // 状态同步规则：任务完成后必须恢复 idle
    await cx.idle().catch(() => {});
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
