/**
 * AI 鍥炲妯″潡 鈥?鏀寔宸ュ叿璋冪敤鐨?Agent 寮曟搸
 * 鏀寔 Anthropic API 鍜?OpenAI 鍏煎 API锛堟湰鍦版ā鍨嬶級
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';

// 鎳掑姞杞介厤缃?鈥?鍦ㄥ嚱鏁拌皟鐢ㄦ椂璇诲彇鐜鍙橀噺锛岃€屼笉鏄ā鍧楀姞杞芥椂
function getConfig() {
  const backend = process.env.AI_BACKEND || 'anthropic';

  // Anthropic 閰嶇疆
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.xiaomimimo.com/anthropic';
  const anthropicApiKey = process.env.ANTHROPIC_AUTH_TOKEN || '';
  const anthropicModel = process.env.ANTHROPIC_MODEL || 'mimo-v2.5-pro';

  // OpenAI 鍏煎閰嶇疆锛堟湰鍦版ā鍨嬶級
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || 'http://localhost:8080/v1';
  const openaiApiKey = process.env.OPENAI_API_KEY || 'local';
  const openaiModel = process.env.OPENAI_MODEL || 'local-model';

  console.log('[AI] getConfig:', { backend, openaiModel, openaiBaseUrl });
  return { backend, anthropicBaseUrl, anthropicApiKey, anthropicModel, openaiBaseUrl, openaiApiKey, openaiModel };
}

// 鈹€鈹€ 瀹夊叏楠岃瘉鍑芥暟 鈹€鈹€
const BLOCKED_BASH_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/,           // rm -rf / or ~
  /\bmkfs\b/,                      // 鏍煎紡鍖栫鐩?
  /\bdd\s+.*of=\/dev/,            // dd 鍐欒澶?
  /\b:(){ :\|:& };:/,             // fork bomb
  /\bshutdown\b/,                  // 鍏虫満
  /\breboot\b/,                    // 閲嶅惎
  /\bchmod\s+777/,                 // 寮€鏀炬潈闄?
  /\bchown\b/,                     // 鏀瑰彉鎵€鏈夎€?
  />\s*\/etc\//,                   // 鍐欏叆 /etc
  /\bcurl\b.*\|\s*(ba)?sh/,       // curl | sh/bash
  /\bwget\b.*\|\s*(ba)?sh/,       // wget | sh/bash
  /\b(eval|exec)\s*\(/,           // eval/exec 璋冪敤
];

function validatePath(filePath, projectDir) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: '璺緞涓虹┖鎴栨棤鏁? };
  }
  if (filePath.includes('..')) {
    return { ok: false, error: '璺緞鍖呭惈 .. 閬嶅巻锛屽凡鎷掔粷' };
  }
  const baseDir = resolve(projectDir);
  const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(baseDir, filePath);
  const rel = relative(baseDir, targetPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: `璺緞瓒婄晫: ${filePath} 涓嶅湪椤圭洰鐩綍鍐卄 };
  }
  return { ok: true, resolved: targetPath };
}

function validateBashCommand(command) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: '鍛戒护涓虹┖' };
  }
  for (const pattern of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return { ok: false, error: `鍛戒护鍖归厤鍗遍櫓妯″紡 (${pattern.source})锛屽凡鎷掔粷` };
    }
  }
  return { ok: true };
}

// 鈹€鈹€ 瓒呮椂涓庨噸璇曞伐鍏?鈹€鈹€
const FETCH_TIMEOUT = 60000; // 60 绉掕秴鏃讹紙闀夸笂涓嬫枃闇€瑕佹洿澶氭椂闂达級
const MAX_RETRIES = 3;
const RETRY_ENABLED = process.env.AI_RETRY !== 'false'; // 閲嶈瘯寮€鍏筹紝榛樿寮€鍚?

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 甯﹁秴鏃剁殑 fetch
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
 * 甯﹂噸璇曠殑 API 璋冪敤锛堟寚鏁伴€€閬匡級
 * 401/403 涓嶉噸璇曪紙璁よ瘉澶辫触閲嶈瘯鏃犳剰涔夛級
 * 5xx/缃戠粶閿欒閲嶈瘯
 * 鐜鍙橀噺 AI_RETRY=false 鍙叧闂噸璇?
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

      // 璁よ瘉閿欒鎴栨渶鍚庝竴娆″皾璇曪紝鐩存帴鎶涘嚭
      if (isAuthError || isLastAttempt) {
        throw err;
      }

      // 鎸囨暟閫€閬匡細1s, 2s, 4s...
      const delay = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`[AI] 璇锋眰澶辫触锛?{delay}ms 鍚庨噸璇?(${i + 1}/${maxRetries}): ${err.message}`);
      await sleep(delay);
    }
  }
}

// 宸ュ叿瀹氫箟
const TOOLS = [
  {
    name: 'bash',
    description: '鎵ц shell 鍛戒护銆傜敤浜庤繍琛屼唬鐮併€佸畨瑁呬緷璧栥€丟it 鎿嶄綔銆佹煡鐪嬫枃浠剁瓑銆?,
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '瑕佹墽琛岀殑 shell 鍛戒护' },
        cwd: { type: 'string', description: '宸ヤ綔鐩綍锛岄粯璁?D:/BKS/projects/team-workspace' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '璇诲彇鏂囦欢鍐呭銆?,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '鏂囦欢缁濆璺緞' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '鍒涘缓鎴栬鐩栧啓鍏ユ枃浠躲€?,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '鏂囦欢缁濆璺緞' },
        content: { type: 'string', description: '鏂囦欢鍐呭' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: '鍒楀嚭鐩綍涓嬬殑鏂囦欢銆?,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '鐩綍璺緞' },
        pattern: { type: 'string', description: '鏂囦欢鍚嶈繃婊わ紙鍙€夛級' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: '鍦ㄦ枃浠朵腑鎼滅储鍏抽敭璇嶃€?,
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '鎼滅储鍏抽敭璇嶆垨姝ｅ垯' },
        path: { type: 'string', description: '鎼滅储鐩綍' },
      },
      required: ['pattern', 'path'],
    },
  },
];

// OpenAI 鍏煎 API 璋冪敤锛堟湰鍦版ā鍨嬶級
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

  // 濡傛灉浣跨敤宸ュ叿锛屾坊鍔犲伐鍏峰畾涔夛紙OpenAI 鏍煎紡锛?
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

  // 妫€鏌ユ槸鍚︽湁宸ュ叿璋冪敤
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

  // DeepSeek 鍏煎锛氭枃鏈腑鍖呭惈 XML 宸ュ叿璋冪敤鏍囩鏃讹紝瑙ｆ瀽鎵ц
  if (textContent && textContent.includes('<tool_call>')) {
    const xmlCalls = parseXmlToolCalls(textContent);
    if (xmlCalls.length > 0) {
      console.log(`[AI] 浠?OpenAI 鍝嶅簲鏂囨湰涓В鏋愬埌 ${xmlCalls.length} 涓?XML 宸ュ叿璋冪敤`);
      return {
        type: 'tool_calls',
        toolCalls: xmlCalls,
        text: textContent,
      };
    }
  }

  return { type: 'text', text: textContent };
}

// 瑙ｆ瀽宸ュ叿璋冪敤锛堟敮鎸佸绉嶆牸寮忥級
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

// 淇鎴柇鐨?UTF-8 鏂囨湰
function fixTruncatedUtf8(text) {
  if (!text) return text;

  // 妫€娴?Unicode 鏇挎崲瀛楃锛圲+FFFD锛夛紝杩欐槸 UTF-8 瑙ｇ爜澶辫触鐨勬爣蹇?
  if (text.includes('锟?)) {
    // 绉婚櫎鏈熬鐨勬浛鎹㈠瓧绗?
    return text.replace(/锟?$/, '').trim();
  }

  // 妫€娴嬩笉瀹屾暣鐨?UTF-8 搴忓垪锛堥珮浣嶅瓧鑺傚悗缂哄皯浣庝綅瀛楄妭锛?
  // 杩欑鎯呭喌鍦?Node.js 涓€氬父浼氳〃鐜颁负鏇挎崲瀛楃锛屼絾浠ラ槻涓囦竴
  return text;
}

// Anthropic API 璋冪敤
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

  // 鑾峰彇鍘熷鍝嶅簲鏂囨湰锛屾鏌ョ紪鐮?
  const responseText = await response.text();

  // 妫€娴嬫埅鏂殑 UTF-8 瀛楃
  if (responseText.includes('锟?)) {
    console.warn('[AI] 妫€娴嬪埌 UTF-8 缂栫爜闂锛屽皾璇曚慨澶?);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseErr) {
    // JSON 瑙ｆ瀽澶辫触锛屽彲鑳芥槸鍝嶅簲琚埅鏂?
    console.error('[AI] JSON 瑙ｆ瀽澶辫触锛屽搷搴斿彲鑳借鎴柇:', parseErr.message);
    throw new Error(`API 鍝嶅簲瑙ｆ瀽澶辫触: ${parseErr.message}`);
  }

  const content = data.content || [];

  const toolUses = content.filter(b => b.type === 'tool_use');
  const textBlocks = content.filter(b => b.type === 'text');

  // 妫€鏌ユ爣鍑嗘牸寮忕殑宸ュ叿璋冪敤
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

  // 妫€鏌?XML 鏍煎紡鐨勫伐鍏疯皟鐢紙鍏煎鏌愪簺 API 浠ｇ悊锛?
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

// 鎵ц宸ュ叿
function executeTool(name, input) {
  const projectDir = input.cwd || process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
  try {
    switch (name) {
      case 'bash': {
        const check = validateBashCommand(input.command);
        if (!check.ok) return `瀹夊叏鎷掔粷: ${check.error}`;
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
        if (!check.ok) return `瀹夊叏鎷掔粷: ${check.error}`;
        const content = readFileSync(check.resolved, 'utf8');
        if (content.length > 5000) {
          return content.substring(0, 5000) + `\n\n[TRUNCATED: showing first 5000 of ${content.length} chars]`;
        }
        return content;
      }
      case 'write_file': {
        const check = validatePath(input.path, projectDir);
        if (!check.ok) return `瀹夊叏鎷掔粷: ${check.error}`;
        writeFileSync(check.resolved, input.content, 'utf8');
        return `鏂囦欢宸插啓鍏? ${input.path}`;
      }
      case 'list_files': {
        const check = validatePath(input.path || '.', projectDir);
        if (!check.ok) return `瀹夊叏鎷掔粷: ${check.error}`;
        const entries = readdirSync(check.resolved, { withFileTypes: true });
        let result = entries.map(e => (e.isDirectory() ? '[DIR] ' : '') + e.name).join('\n');
        if (input.pattern) {
          result = result.split('\n').filter(l => l.includes(input.pattern)).join('\n');
        }
        return result.substring(0, 2000);
      }
      case 'search_code': {
        const check = validatePath(input.path || '.', projectDir);
        if (!check.ok) return `瀹夊叏鎷掔粷: ${check.error}`;
        // 杞箟 pattern 涓殑鐗规畩瀛楃闃叉鍛戒护娉ㄥ叆
        const safePattern = (input.pattern || '').replace(/["`$\\]/g, '');
        const result = execSync(`grep -r "${safePattern}" "${check.resolved}" --include="*.js" --include="*.jsx" --include="*.md" --include="*.json" --include="*.css" -l 2>/dev/null || echo "鏃犲尮閰?`, {
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
        });
        return result.substring(0, 1000);
      }
      default:
        return `鏈煡宸ュ叿: ${name}`;
    }
  } catch (err) {
    return `宸ュ叿鎵ц閿欒: ${err.message.substring(0, 500)}`;
  }
}

/**
 * 鐢熸垚 AI 鍥炲锛堟敮鎸佸伐鍏疯皟鐢ㄥ惊鐜級
 * @param {string} systemPrompt - 绯荤粺鎻愮ず璇?
 * @param {Array} history - 鍘嗗彶娑堟伅
 * @param {string} userMessage - 鐢ㄦ埛娑堟伅
 * @param {boolean} useTools - 鏄惁鍚敤宸ュ叿锛堥粯璁?true锛?
 * @param {object} modelOverride - 鍙€夌殑妯″瀷閰嶇疆瑕嗙洊 { backend, openaiBaseUrl, openaiApiKey, openaiModel }
 */
export async function generateReply(systemPrompt, history, userMessage, useTools = true, modelOverride) {
  // 鏁翠綋瓒呮椂淇濇姢锛?80 绉掞紝宸ュ叿璋冪敤杞澶氭椂闇€瑕佹洿闀挎椂闂达級
  const TASK_TIMEOUT = parseInt(process.env.AI_TASK_TIMEOUT) || 300000; // 默认300秒，可通过.env配置
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
  // 濡傛灉浼犲叆 modelOverride锛屽悎骞惰鐩栨ā鍨嬬浉鍏抽厤缃?
  const config = modelOverride
    ? { ...baseConfig, ...modelOverride }
    : baseConfig;
  const messages = [];

  // 鍔犲叆鍘嗗彶
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role === 'cc' || msg.role === 'xiaoma' || msg.role === 'assistant' ? 'assistant' : 'user',
      content: `${msg.name || msg.role}: ${msg.content}`,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  // 閫夋嫨鍚庣锛堜紶閫掑悎骞跺悗鐨?config锛岄伩鍏?callOpenAI/callAnthropic 鍐呴儴 getConfig() 璇诲埌閿欒鍊硷級
  const callAPI = config.backend === 'openai'
    ? (sys, msgs, tools) => callOpenAI(sys, msgs, tools, config)
    : (sys, msgs, tools) => callAnthropic(sys, msgs, tools, config);

  // 濡傛灉涓嶄娇鐢ㄥ伐鍏凤紝鐩存帴杩斿洖鏂囨湰鍥炲
  if (!useTools) {
    const result = await callWithRetry(() => callAPI(systemPrompt, messages, false));
    return cleanToolCallTags(result.text);
  }

  // 工具调用循环（最多 12 轮）
  const maxIterations = 12;
  for (let i = 0; i < maxIterations; i++) {
    const result = await callWithRetry(() => callAPI(systemPrompt, messages, true));

    if (result.type === 'text') {
      return cleanToolCallTags(result.text);
    }

    // 鏈夊伐鍏疯皟鐢?鈫?鎵ц 鈫?杩斿洖缁撴灉缁х画瀵硅瘽
    if (result.type === 'tool_calls') {
      // 娣诲姞 assistant 娑堟伅锛堝寘鍚伐鍏疯皟鐢級
      if (config.backend === 'openai') {
        // 娓呯悊鏂囨湰涓殑宸ュ叿璋冪敤鏍囩锛岄槻姝㈡ā鍨嬪湪鍚庣画杞妯′豢杈撳嚭
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
        // Anthropic 鏍煎紡
        const assistantContent = [];
        if (result.text) assistantContent.push({ type: 'text', text: cleanToolCallTags(result.text) });
        result.toolCalls.forEach(tc => {
          assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        });
        messages.push({ role: 'assistant', content: assistantContent });
      }

      // 鎵ц宸ュ叿骞舵敹闆嗙粨鏋?
      const toolResults = [];
      for (const tc of result.toolCalls) {
        console.log(`[宸ュ叿] ${tc.name}(${JSON.stringify(tc.input).substring(0, 80)})`);
        const toolResult = executeTool(tc.name, tc.input);
        console.log(`[缁撴灉] ${toolResult.substring(0, 100)}`);

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

      // 娣诲姞宸ュ叿缁撴灉鍒版秷鎭?
      if (config.backend === 'openai') {
        messages.push(...toolResults);
      } else {
        messages.push({ role: 'user', content: toolResults });
      }
    }
  }

  // 工具调用轮次已达上限，让 AI 基于已收集的信息生成回复
  console.log(`[AI] 工具调用轮次已达上限 (12次)，基于已收集信息生成回复`);
  const finalResult = await callWithRetry(() => callAPI(systemPrompt, messages, false));
  return cleanToolCallTags(finalResult.text);
}

