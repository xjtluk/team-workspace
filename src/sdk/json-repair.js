// JSON/Text Repair Utilities
// Extracted from ai-reply.js
// No external dependencies — pure functions only.

// 修复截断的 UTF-8 文本
/**
 * Fix truncated UTF-8 text by removing Unicode replacement characters.
 * @param {string} text - Raw text that may contain truncated UTF-8 sequences
 * @returns {string} Cleaned text
 */
function fixTruncatedUtf8(text) {
  if (!text) return text;

  // 检测 Unicode 替换字符（U+FFFD），这是 UTF-8 解码失败的标志
  if (text.includes('�')) {
    // 移除末尾的替换字符
    return text.replace(/�$/, '').trim();
  }

  // 检测不完整的 UTF-8 序列（高位字节后缺少低位字节）
  return text;
}

/**
 * Fix truncated JSON by closing unclosed strings and balancing brackets.
 * Used when API response is cut off due to model output truncation.
 * @param {string} jsonStr - Raw JSON string from API response
 * @param {string} source - Label for logging (e.g. 'OpenAI', 'Anthropic')
 * @returns {object} Parsed JSON object
 */
function fixTruncatedJson(jsonStr, source) {
  source = source || 'API';
  // First try direct parse
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[AI] JSON parse failed (' + source + '), attempting truncation fix:', e.message);
    
    let fixed = jsonStr;
    
    // Fix 1: Close unclosed string (Unterminated string in JSON)
    if (e.message.indexOf('Unterminated string') !== -1) {
      const posMatch = e.message.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        let inString = false;
        for (let i = 0; i < Math.min(pos, fixed.length); i++) {
          if (fixed[i] === '"' && (i === 0 || fixed[i-1] !== '\\')) {
            inString = !inString;
          }
        }
        if (inString) {
          fixed = fixed.substring(0, pos) + '"' + fixed.substring(pos);
        }
      }
    }
    
    // Fix 2: Balance braces and brackets (Unexpected end of JSON input)
    if (e.message.indexOf('Unexpected end of JSON input') !== -1 || e.message.indexOf('Unterminated string') !== -1) {
      let braceCount = 0;
      let bracketCount = 0;
      let inString = false;
      for (let i = 0; i < fixed.length; i++) {
        const ch = fixed[i];
        if (ch === '"' && (i === 0 || fixed[i-1] !== '\\')) {
          inString = !inString;
        }
        if (!inString) {
          if (ch === '{') braceCount++;
          if (ch === '}') braceCount--;
          if (ch === '[') bracketCount++;
          if (ch === ']') bracketCount--;
        }
      }
      if (inString) { fixed += '"'; }
      while (bracketCount > 0) { fixed += ']'; bracketCount--; }
      while (braceCount > 0) { fixed += '}'; braceCount--; }
    }
    
    try {
      const result = JSON.parse(fixed);
      console.warn('[AI] JSON truncated, auto-fixed successfully (' + source + ')');
      return result;
    } catch (e2) {
      console.error('[AI] JSON fix failed (' + source + '):', e2.message);
      throw new Error('API response parse failed after fix attempt: ' + e2.message);
    }
  }
}

// 清洗工具调用标签（防止泄露到群聊）
/**
 * Strip tool_call, think, and DSML-format tool_calls XML tags from text.
 * @param {string} text - Raw text that may contain tool call tags
 * @returns {string} Cleaned text
 */
function cleanToolCallTags(text) {
  if (!text) return '';
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    // DSML 格式：兼容单竖线和双竖线
    .replace(/<｜?DSML｜?tool_calls>[\s\S]*?<\/｜?DSML｜?tool_calls>/g, '')
    .replace(/<\/｜?DSML｜?[^>]*>?/g, '')
    .replace(/<｜?DSML｜?[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export { fixTruncatedUtf8, fixTruncatedJson, cleanToolCallTags };
