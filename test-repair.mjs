// 测试 repairTruncatedJson 函数
function repairTruncatedJson(text) {
  if (!text) return null;
  text = text.trim();
  try { return JSON.parse(text); } catch {}

  let partial = text;
  const openQuotes = (partial.match(/"/g) || []).length;
  if (openQuotes % 2 !== 0) partial += '"';

  const opens = (partial.match(/[\[{]/g) || []).length;
  const closes = (partial.match(/[\]}]/g) || []).length;
  for (let i = 0; i < opens - closes; i++) {
    if (partial.lastIndexOf('[') > partial.lastIndexOf(']')) partial += ']';
    else partial += '}';
  }

  try { return JSON.parse(partial); } catch (e) { console.log('Bracket repair failed:', e.message); }

  const contentMatch = text.match(/"content"\s*:\s*"((?:[^"\\]|\\[\s\S])*)/);
  if (contentMatch) {
    const partialContent = contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    if (partialContent.length > 10) {
      console.log(`Extracted partial content (${partialContent.length} chars)`);
      return {
        choices: [{
          message: { content: partialContent + '\n\n[TRUNCATED]', role: 'assistant' },
          finish_reason: 'length',
        }],
        model: 'truncated',
      };
    }
  }
  return null;
}

// Test 1: 完整 JSON（应该直接解析）
const ok = '{"choices":[{"message":{"content":"hello"}}]}';
console.log('Test 1 (complete):', repairTruncatedJson(ok) ? 'PASS' : 'FAIL');

// Test 2: 字符串中间截断
const t2 = '{"id":"chatcmpl-123","choices":[{"index":0,"message":{"role":"assistant","content":"我来帮你查看代码。首先让我读取相关文件';
console.log('Test 2 (mid-string):', repairTruncatedJson(t2) ? 'PASS' : 'FAIL');

// Test 3: 只有 content 开头
const t3 = '{"choices":[{"message":{"content":"这是一个很长的回复，被截断在了中间位置';
console.log('Test 3 (content partial):', repairTruncatedJson(t3) ? 'PASS' : 'FAIL');

// Test 4: 完全截断到只剩半个字符
const t4 = '{"choices":[{"message":{"content":"';
console.log('Test 4 (too short):', repairTruncatedJson(t4) === null ? 'PASS (null)' : 'FAIL');
