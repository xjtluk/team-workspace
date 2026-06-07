/**
 * AI Engine — 核心 AI 调用模块
 * 负责 API 调用、重试、工具调用解析、Agent 循环
 * 工具执行由 tool-executor.js 负责，JSON 修复由 json-repair.js 负责
 */
import config from '../../config/index.js';
import { executeTool, TOOLS } from './tool-executor.js';
import { fixTruncatedUtf8, fixTruncatedJson, cleanToolCallTags } from './json-repair.js';

// —— 超时与重试工具 ——
const FETCH_TIMEOUT = parseInt(process.env.CX_FETCH_TIMEOUT) || 60000; // 优先读 CX_FETCH_TIMEOUT，默认60s
const MAX_RETRIES = 3;
const RETRY_ENABLED = process.env.AI_RETRY !== 'false'; // 重试开关，默认开启

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 懒加载配置 — 在函数调用时读取环境变量，而不是模块加载时
function getConfig() {
  const backend = process.env.AI_BACKEND || 'anthropic';

  // Anthropic 配置
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.xiaomimimo.com/anthropic';
  const anthropicApiKey = process.env.ANTHROPIC_AUTH_TOKEN || '';
  const anthropicModel = process.env.ANTHROPIC_MODEL || 'mimo-v2.5-pro';

  // OpenAI 兼容配置（本地模型）
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || 'http://localhost:8080/v1';
  const openaiApiKey = process.env.OPENAI_API_KEY || 'local';
  const openaiModel = process.env.OPENAI_MODEL || 'local-model';

  console.log('[AI] getConfig:', { backend, openaiModel, openaiBaseUrl });
  return { backend, anthropicBaseUrl, anthropicApiKey, anthropicModel, openaiBaseUrl, openaiApiKey, openaiModel };
}

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Fetch timeout after ${timeout}ms`);
    }
    throw err;
  }
}

/**
 * 带重试的 API 调用（指数退避）
 * 401/403 不重试（认证失败重试无意义）
 * 5xx/网络错误重试
 * 环境变量 AI_RETRY=false 可关闭重试
 */
async function callWithRetry(fn, maxRetries = MAX_RETRIES) {
  if (!RETRY_ENABLED) {
    return fn();
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = i === maxRetries - 1;
      const isAuthError = err.message.includes('401') || err.message.includes('403');

      // 认证错误或最后一次尝试，直接抛出
      if (isAuthError || isLastAttempt) {
        throw err;
      }

      // 指数退避：1s, 2s, 4s...
      const delay = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`[AI] 请求失败，${delay}ms 后重试 (${i + 1}/${maxRetries}): ${err.message}`);
      await sleep(delay);
    }
  }
}

// OpenAI 兼容 API 调用（本地模型）
async function callOpenAI(systemPrompt, messages, useTools, cfg) {
  cfg = cfg || getConfig();
  console.log('[AI] callOpenAI: using model', cfg.openaiModel);
  const body = {
    model: cfg.openaiModel,
    max_tokens: useTools ? 4096 : 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  };

  // 如果使用工具，添加工具定义（OpenAI 格式）
  if (useTools) {
    body.tools = TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  const requestUrl = `${cfg.openaiBaseUrl}/chat/completions`;
  console.log('[AI] → POST', requestUrl, '| model:', cfg.openaiModel);

  const response = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.openaiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${err}`);
  }

  // Use text() + fixTruncatedJson to handle truncated API responses
  const responseTextOA = await response.text();
  const data = fixTruncatedJson(responseTextOA, 'OpenAI');
  // 记录 API 实际返回的模型名（验证提供商是否使用了请求的模型）
  if (data.model) {
    console.log('[AI] → response.model:', data.model);
  }
  const choice = data.choices?.[0];
  if (!choice) return '';

  // 检查是否有工具调用
  if (choice.message?.tool_calls?.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: choice.message.tool_calls.map(tc => {
        let args = tc.function.arguments || '{}';
        let input;
        try {
          input = JSON.parse(args);
        } catch (e) {
          // 截断修复：尝试补齐缺失的尾部括号
          const fixed = args.replace(/,\s*$/, '').replace(/[^}\]]*$/, '') + '}';
          try {
            input = JSON.parse(fixed);
            console.warn('[AI] tool_call arguments 截断，已自动修复:', tc.function.name);
          } catch {
            console.error('[AI] tool_call arguments 畸形，跳过', tc.function.name, args.slice(0, 200));
            input = {};
          }
        }
        return { id: tc.id, name: tc.function.name, input };
      }),
      text: choice.message.content || '',
    };
  }

  const textContent = choice.message?.content || '';

  // DeepSeek 兼容：文本中包含 XML 工具调用标签时，解析执行
  if (textContent && textContent.includes('<tool_call>')) {
    const xmlCalls = parseXmlToolCalls(textContent);
    if (xmlCalls.length > 0) {
      console.log(`[AI] 从 OpenAI 响应文本中解析到 ${xmlCalls.length} 个 XML 工具调用`);
      return {
        type: 'tool_calls',
        toolCalls: xmlCalls,
        text: textContent,
      };
    }
  }

  // DSML 格式兼容（智谱）某些模型输出 DSML tool_calls 格式
  if (textContent && textContent.includes("DSML")) {
    const dsmlCalls = parseDsmlToolCalls(textContent);
    if (dsmlCalls.length > 0) {
      console.log(`[AI] 从响应文本中解析到 ${dsmlCalls.length} 个 DSML 工具调用`);
      return {
        type: 'tool_calls',
        toolCalls: dsmlCalls,
        text: textContent,
      };
    }
  }

  return { type: 'text', text: textContent };
}

// 解析 XML 格式工具调用（支持多种格式）
function parseXmlToolCalls(text) {
  const calls = [];
  let callId = 0;
  const oc = String.fromCharCode(60);
  const cc = String.fromCharCode(62);
  const openTag = oc + 'tool_call' + cc;
  const closeTag = oc + '/tool_call' + cc;

  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf(openTag, pos);
    if (start === -1) break;
    const end = text.indexOf(closeTag, start);
    if (end === -1) break;
    const block = text.substring(start + openTag.length, end).trim();
    pos = end + closeTag.length;

    // Format A: JSON
    try {
      const data = JSON.parse(block);
      if (data.name && data.arguments) {
        calls.push({ id: 'xml_' + callId++, name: data.name, input: data.arguments });
        continue;
      }
    } catch {}

    // Format B: function=xxx with parameter=yyy
    const fOpen = oc + 'function=';
    const fClose = oc + '/function' + cc;
    const fIdx = block.indexOf(fOpen);
    if (fIdx !== -1) {
      const fEnd = block.indexOf(cc, fIdx);
      const funcName = block.substring(fIdx + fOpen.length, fEnd).trim();
      const fCloseIdx = block.indexOf(fClose, fEnd);
      if (fCloseIdx !== -1) {
        const inner = block.substring(fEnd + 1, fCloseIdx);
        const params = {};
        const pOpen = oc + 'parameter=';
        const pClose = oc + '/parameter' + cc;
        let pPos = 0;
        while (pPos < inner.length) {
          const pStart = inner.indexOf(pOpen, pPos);
          if (pStart === -1) break;
          const pTagEnd = inner.indexOf(cc, pStart);
          const key = inner.substring(pStart + pOpen.length, pTagEnd).trim();
          const pEnd = inner.indexOf(pClose, pTagEnd);
          if (pEnd === -1) break;
          const val = inner.substring(pTagEnd + 1, pEnd).trim();
          params[key] = val;
          pPos = pEnd + pClose.length;
        }
        calls.push({ id: 'xml_' + callId++, name: funcName, input: params });
      }
    }
  }
  return calls;
}

// 解析 DSML 格式工具调用（智谱）某些模型输出格式
function parseDsmlToolCalls(text) {
  const calls = [];
  let callId = 0;
  // 用正则匹配一个或多个全角竖线，兼容单/双竖线
  const bar = '｜';

  const invokePattern = new RegExp(`<${bar}DSML${bar}invoke\\\\s+name="([^"]+)"[^>]*>([\\\\s\\\\S]*?)<\\\\/${bar}DSML${bar}invoke>`, 'g');
  let match;

  while ((match = invokePattern.exec(text)) !== null) {
    const funcName = match[1];
    const innerBlock = match[2];
    const params = {};

    const paramPattern = new RegExp(`<${bar}DSML${bar}parameter\\\\s+name="([^"]+)"[^>]*>([\\\\s\\\\S]*?)<\\\\/${bar}DSML${bar}parameter>`, 'g');
    let paramMatch;

    while ((paramMatch = paramPattern.exec(innerBlock)) !== null) {
      const key = paramMatch[1];
      const value = paramMatch[2].trim();
      const isString = paramMatch[0].includes('string="true"');
      params[key] = isString ? value : tryParseJson(value);
    }

    calls.push({ id: 'dsml_' + callId++, name: funcName, input: params });
  }

  return calls;
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return str; }
}

// Anthropic API 调用
async function callAnthropic(systemPrompt, messages, useTools, cfg) {
  cfg = cfg || getConfig();
  const body = {
    model: cfg.anthropicModel,
    max_tokens: useTools ? 4096 : 2048,
    system: systemPrompt,
    messages,
  };

  if (useTools) {
    body.tools = TOOLS;
  }

  const requestUrl = `${cfg.anthropicBaseUrl}/v1/messages`;
  console.log('[AI] → POST', requestUrl, '| model:', cfg.anthropicModel);

  const response = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${err}`);
  }

  // 获取原始响应文本，检查编码
  const responseText = await response.text();

  // 检测截断的 UTF-8 字符
  if (responseText.includes('�')) {
    console.warn('[AI] 检测到 UTF-8 编码问题，尝试修复');
  }

  const data = fixTruncatedJson(responseText, 'Anthropic');

  // 记录 API 实际返回的模型名
  if (data.model) {
    console.log('[AI] → response.model:', data.model);
  }

  const content = data.content || [];

  const toolUses = content.filter(b => b.type === 'tool_use');
  const textBlocks = content.filter(b => b.type === 'text');

  // 检查标准格式的工具调用
  if (toolUses.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: toolUses.map(t => ({
        id: t.id,
        name: t.name,
        input: t.input,
      })),
      text: textBlocks.map(b => fixTruncatedUtf8(b.text)).join('\n'),
    };
  }

  // 检查 XML 格式的工具调用（兼容某些 API 代理）
  const fullText = textBlocks.map(b => fixTruncatedUtf8(b.text)).join('\n');
  const xmlToolCalls = parseXmlToolCalls(fullText);
  if (xmlToolCalls.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: xmlToolCalls,
      text: '',
    };
  }

  return { type: 'text', text: fullText || '' };
}

/**
 * 生成 AI 回复（支持工具调用循环）
 * @param {string} systemPrompt - 系统提示词
 * @param {Array} history - 历史消息
 * @param {string} userMessage - 用户消息
 * @param {boolean} useTools - 是否启用工具（默认 true）
 * @param {object} modelOverride - 可选的模型覆盖配置
 * @param {number} maxToolRounds - 可选的工具调用轮次限制（默认 12）
 * @param {function} onToolCall - 工具执行回调
 */
async function generateReply(systemPrompt, history, userMessage, useTools = true, modelOverride, maxToolRounds, onToolCall) {
  // 整体超时保护（默认300秒，可通过 .env AI_TASK_TIMEOUT 配置）
  const TASK_TIMEOUT = parseInt(process.env.AI_TASK_TIMEOUT) || 300000;
  const taskPromise = _generateReply(systemPrompt, history, userMessage, useTools, modelOverride, maxToolRounds, onToolCall);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`任务超时 (${TASK_TIMEOUT/1000}s)`)), TASK_TIMEOUT)
  );
  return Promise.race([taskPromise, timeoutPromise]);
}

async function _generateReply(systemPrompt, history, userMessage, useTools, modelOverride, maxToolRounds, onToolCall) {
  const baseConfig = getConfig();
  // 如果传入 modelOverride，合并覆盖模型相关配置
  const cfg = modelOverride
    ? { ...baseConfig, ...modelOverride }
    : baseConfig;
  const messages = [];

  // 加入历史
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role === 'cc' || msg.role === 'xiaoma' || msg.role === 'assistant' ? 'assistant' : 'user',
      content: `${msg.name || msg.role}: ${msg.content}`,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  // 选择后端（传递合并后的 cfg，避免 callOpenAI/callAnthropic 内部 getConfig() 读到错误值）
  const callAPI = cfg.backend === 'openai'
    ? (sys, msgs, tools) => callOpenAI(sys, msgs, tools, cfg)
    : (sys, msgs, tools) => callAnthropic(sys, msgs, tools, cfg);

  // 如果不使用工具，直接返回文本回复
  if (!useTools) {
    const result = await callWithRetry(() => callAPI(systemPrompt, messages, false));
    return cleanToolCallTags(result.text);
  }

  // 工具调用循环（默认 12 轮，可通过 maxToolRounds 参数覆盖）
  const maxIterations = maxToolRounds || parseInt(process.env.MAX_TOOL_ROUNDS) || 12;
  for (let i = 0; i < maxIterations; i++) {
    const result = await callWithRetry(() => callAPI(systemPrompt, messages, true));

    if (result.type === 'text') {
      return cleanToolCallTags(result.text);
    }

    // 有工具调用 → 执行 → 返回结果继续对话
    if (result.type === 'tool_calls') {
      // 添加 assistant 消息（包含工具调用）
      if (cfg.backend === 'openai') {
        // 清理文本中的工具调用标签，防止模型在后续轮次模仿输出
        const cleanText = cleanToolCallTags(result.text) || null;
        messages.push({
          role: 'assistant',
          content: cleanText,
          tool_calls: result.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
        });
      } else {
        // Anthropic 格式
        const assistantContent = [];
        if (result.text) assistantContent.push({ type: 'text', text: cleanToolCallTags(result.text) });
        result.toolCalls.forEach(tc => {
          assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        });
        messages.push({ role: 'assistant', content: assistantContent });
      }

      // 执行工具并收集结果
      const toolResults = [];
      for (const tc of result.toolCalls) {
        console.log(`[工具] ${tc.name}(${JSON.stringify(tc.input).substring(0, 80)})`);
        // 实时回调：通知调用方当前正在执行的工具
        if (onToolCall) {
          try { onToolCall(tc.name, tc.input, i); } catch {}
        }
        const toolResult = executeTool(tc.name, tc.input);
        console.log(`[结果] ${toolResult.substring(0, 100)}`);

        if (cfg.backend === 'openai') {
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: toolResult,
          });
        }
      }

      // 添加工具结果到消息
      if (cfg.backend === 'openai') {
        messages.push(...toolResults);
      } else {
        messages.push({ role: 'user', content: toolResults });
      }
    }
  }

  // 工具调用轮次已达上限，让 AI 基于已收集的信息生成回复
  console.log(`[AI] 工具调用轮次已达上限 (${maxIterations}次)，基于已收集信息生成回复`);
  const finalResult = await callWithRetry(() => callAPI(systemPrompt, messages, false));
  return cleanToolCallTags(finalResult.text);
}

export { generateReply };
