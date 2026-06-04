/**
 * AI 回复模块 — 支持工具调用的 Agent 引擎
 * 支持 Anthropic API 和 OpenAI 兼容 API（本地模型）
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';

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

// ── 安全验证函数 ──
const BLOCKED_BASH_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/,           // rm -rf / or ~
  /\bmkfs\b/,                      // 格式化磁盘
  /\bdd\s+.*of=\/dev/,            // dd 写设备
  /\b:(){ :\|:& };:/,             // fork bomb
  /\bshutdown\b/,                  // 关机
  /\breboot\b/,                    // 重启
  /\bchmod\s+777/,                 // 开放权限
  /\bchown\b/,                     // 改变所有者
  />\s*\/etc\//,                   // 写入 /etc
  /\bcurl\b.*\|\s*(ba)?sh/,       // curl | sh/bash
  /\bwget\b.*\|\s*(ba)?sh/,       // wget | sh/bash
  /\b(eval|exec)\s*\(/,           // eval/exec 调用
];

function validatePath(filePath, projectDir) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: '路径为空或无效' };
  }
  if (filePath.includes('..')) {
    return { ok: false, error: '路径包含 .. 遍历，已拒绝' };
  }
  const baseDir = resolve(projectDir);
  const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(baseDir, filePath);
  const rel = relative(baseDir, targetPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: `路径越界: ${filePath} 不在项目目录内` };
  }
  return { ok: true, resolved: targetPath };
}

function validateBashCommand(command) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: '命令为空' };
  }
  for (const pattern of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return { ok: false, error: `命令匹配危险模式 (${pattern.source})，已拒绝` };
    }
  }
  return { ok: true };
}

// ── 超时与重试工具 ──
const FETCH_TIMEOUT = 60000; // 60 秒超时（长上下文需要更多时间）
const MAX_RETRIES = 3;
const RETRY_ENABLED = process.env.AI_RETRY !== 'false'; // 重试开关，默认开启

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

// 工具定义
const TOOLS = [
  {
    name: 'bash',
    description: '执行 shell 命令。用于运行代码、安装依赖、Git 操作、查看文件等。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        cwd: { type: 'string', description: '工作目录，默认 D:/BKS/projects/team-workspace' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '读取文件内容。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '创建或覆盖写入文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: '列出目录下的文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' },
        pattern: { type: 'string', description: '文件名过滤（可选）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: '在文件中搜索关键词。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索关键词或正则' },
        path: { type: 'string', description: '搜索目录' },
      },
      required: ['pattern', 'path'],
    },
  },
];

// OpenAI 兼容 API 调用（本地模型）
async function callOpenAI(systemPrompt, messages, useTools, config) {
  config = config || getConfig();
  console.log('[AI] callOpenAI: using model', config.openaiModel);
  const body = {
    model: config.openaiModel,
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

  const response = await fetchWithTimeout(`${config.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) return '';

  // 检查是否有工具调用
  if (choice.message?.tool_calls?.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: choice.message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      })),
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

  return { type: 'text', text: textContent };
}

// 解析工具调用（支持多种格式）
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

// 修复截断的 UTF-8 文本
function fixTruncatedUtf8(text) {
  if (!text) return text;

  // 检测 Unicode 替换字符（U+FFFD），这是 UTF-8 解码失败的标志
  if (text.includes('�')) {
    // 移除末尾的替换字符
    return text.replace(/�+$/, '').trim();
  }

  // 检测不完整的 UTF-8 序列（高位字节后缺少低位字节）
  // 这种情况在 Node.js 中通常会表现为替换字符，但以防万一
  return text;
}

// Anthropic API 调用
async function callAnthropic(systemPrompt, messages, useTools, config) {
  config = config || getConfig();
  const body = {
    model: config.anthropicModel,
    max_tokens: useTools ? 4096 : 2048,
    system: systemPrompt,
    messages,
  };

  if (useTools) {
    body.tools = TOOLS;
  }

  const response = await fetchWithTimeout(`${config.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
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

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseErr) {
    // JSON 解析失败，可能是响应被截断
    console.error('[AI] JSON 解析失败，响应可能被截断:', parseErr.message);
    throw new Error(`API 响应解析失败: ${parseErr.message}`);
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

// 执行工具
function executeTool(name, input) {
  const projectDir = input.cwd || process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
  try {
    switch (name) {
      case 'bash': {
        const check = validateBashCommand(input.command);
        if (!check.ok) return `安全拒绝: ${check.error}`;
        const result = execSync(input.command, {
          cwd: projectDir,
          encoding: 'utf8',
          timeout: 30000,
          windowsHide: true,
        });
        return result.substring(0, 3000);
      }
      case 'read_file': {
        const check = validatePath(input.path, projectDir);
        if (!check.ok) return `安全拒绝: ${check.error}`;
        const content = readFileSync(check.resolved, 'utf8');
        if (content.length > 5000) {
          return content.substring(0, 5000) + `\n\n[TRUNCATED: showing first 5000 of ${content.length} chars]`;
        }
        return content;
      }
      case 'write_file': {
        const check = validatePath(input.path, projectDir);
        if (!check.ok) return `安全拒绝: ${check.error}`;
        writeFileSync(check.resolved, input.content, 'utf8');
        return `文件已写入: ${input.path}`;
      }
      case 'list_files': {
        const check = validatePath(input.path || '.', projectDir);
        if (!check.ok) return `安全拒绝: ${check.error}`;
        const entries = readdirSync(check.resolved, { withFileTypes: true });
        let result = entries.map(e => (e.isDirectory() ? '[DIR] ' : '') + e.name).join('\n');
        if (input.pattern) {
          result = result.split('\n').filter(l => l.includes(input.pattern)).join('\n');
        }
        return result.substring(0, 2000);
      }
      case 'search_code': {
        const check = validatePath(input.path || '.', projectDir);
        if (!check.ok) return `安全拒绝: ${check.error}`;
        // 转义 pattern 中的特殊字符防止命令注入
        const safePattern = (input.pattern || '').replace(/["`$\\]/g, '');
        const result = execSync(`grep -r "${safePattern}" "${check.resolved}" --include="*.js" --include="*.jsx" --include="*.md" --include="*.json" --include="*.css" -l 2>/dev/null || echo "无匹配"`, {
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
        });
        return result.substring(0, 1000);
      }
      default:
        return `未知工具: ${name}`;
    }
  } catch (err) {
    return `工具执行错误: ${err.message.substring(0, 500)}`;
  }
}

/**
 * 生成 AI 回复（支持工具调用循环）
 * @param {string} systemPrompt - 系统提示词
 * @param {Array} history - 历史消息
 * @param {string} userMessage - 用户消息
 * @param {boolean} useTools - 是否启用工具（默认 true）
 * @param {object} modelOverride - 可选的模型配置覆盖 { backend, openaiBaseUrl, openaiApiKey, openaiModel }
 */
export async function generateReply(systemPrompt, history, userMessage, useTools = true, modelOverride) {
  // 整体超时保护（默认300秒，可通过.env AI_TASK_TIMEOUT配置）
  const TASK_TIMEOUT = parseInt(process.env.AI_TASK_TIMEOUT) || 300000;
  const taskPromise = _generateReply(systemPrompt, history, userMessage, useTools, modelOverride);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`任务超时 (${TASK_TIMEOUT/1000}s)`)), TASK_TIMEOUT)
  );
  return Promise.race([taskPromise, timeoutPromise]);
}

// 清洗工具调用标签（防止泄漏到群聊）
function cleanToolCallTags(text) {
  if (!text) return '';
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<｜DSML｜tool_calls>[\s\S]*?<\/｜DSML｜tool_calls>/g, '')
    .replace(/<\/｜DSML｜[^>]*>?/g, '')
    .replace(/<｜DSML｜[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


async function _generateReply(systemPrompt, history, userMessage, useTools, modelOverride) {
  const baseConfig = getConfig();
  // 如果传入 modelOverride，合并覆盖模型相关配置
  const config = modelOverride
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

  // 选择后端（传递合并后的 config，避免 callOpenAI/callAnthropic 内部 getConfig() 读到错误值）
  const callAPI = config.backend === 'openai'
    ? (sys, msgs, tools) => callOpenAI(sys, msgs, tools, config)
    : (sys, msgs, tools) => callAnthropic(sys, msgs, tools, config);

  // 如果不使用工具，直接返回文本回复
  if (!useTools) {
    const result = await callWithRetry(() => callAPI(systemPrompt, messages, false));
    return cleanToolCallTags(result.text);
  }

  // 工具调用循环（最多 5 轮）
  const maxIterations = 12;
  for (let i = 0; i < maxIterations; i++) {
    const result = await callWithRetry(() => callAPI(systemPrompt, messages, true));

    if (result.type === 'text') {
      return cleanToolCallTags(result.text);
    }

    // 有工具调用 → 执行 → 返回结果继续对话
    if (result.type === 'tool_calls') {
      // 添加 assistant 消息（包含工具调用）
      if (config.backend === 'openai') {
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
        const toolResult = executeTool(tc.name, tc.input);
        console.log(`[结果] ${toolResult.substring(0, 100)}`);

        if (config.backend === 'openai') {
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
      if (config.backend === 'openai') {
        messages.push(...toolResults);
      } else {
        messages.push({ role: 'user', content: toolResults });
      }
    }
  }

  // 工具调用轮次已达上限，让 AI 基于已收集的信息生成回复
  console.log(`[AI] 工具调用轮次已达上限 (5次)，基于已收集信息生成回复`);
  const finalResult = await callWithRetry(() => callAPI(systemPrompt, messages, false));
  return cleanToolCallTags(finalResult.text);
}
