// ── cleanToolCallTags 测试 ──
// 复制的函数（与 cx-listener.mjs:192-215 一致）
function cleanToolCallTags(text) {
  if (!text) return '';
  let result = text;

  // 清洗 <tool_call>...</tool_call> 格式
  result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

  // 清洗 DeepSeek DSML 格式：<DSML|tool_calls>...</DSML|tool_calls>
  result = result.replace(/<DSML\|tool_calls>[\s\S]*?<\/DSML\|tool_calls>/g, '');

  // 清洗单独的 DSML 标签（invoke/parameter 等）
  result = result.replace(/<DSML\|[^>]*>/g, '');
  result = result.replace(/<\/DSML\|[^>]*>/g, '');

  // 清洗残留的 parameter> 等片段
  result = result.replace(/parameter>/g, '');
  result = result.replace(/invoke>/g, '');

  // 清洗空行
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

// ── 测试 ──
const tests = [];

// 辅助
function test(name, input, expected) {
  const actual = cleanToolCallTags(input);
  const pass = actual === expected;
  tests.push({ name, pass, input: input.substring(0, 80), expected: expected.substring(0, 80), actual: actual.substring(0, 80) });
  if (!pass) {
    console.log(`FAIL: ${name}`);
    console.log(`  expected: "${expected.substring(0, 100)}"`);
    console.log(`  actual:   "${actual.substring(0, 100)}"`);
  }
}

// ── 标准 tool_call XML ──
test('TC01: 标准tool_call标签',
  '你好<tool_call>{"name":"read","params":{}}</tool_call>世界',
  '你好世界');

test('TC02: 多个tool_call标签',
  'A<tool_call>X</tool_call>B<tool_call>Y</tool_call>C',
  'ABC');

test('TC03: tool_call跨行',
  '你好<tool_call>\n{"name":"read"}\n</tool_call>世界',
  '你好世界');

test('TC04: 无标签文本原样返回',
  '你好世界，这是一段普通文本。',
  '你好世界，这是一段普通文本。');

// ── DSML 格式 ──
test('TC05: DSML tool_calls完整块',
  '你好<DSML|tool_calls>\n<DSML|invoke name="bash">\n<DSML|parameter name="cmd">ls</DSML|parameter>\n</DSML|invoke>\n</DSML|tool_calls>世界',
  '你好世界');

test('TC06: DSML单独invoke标签',
  '你好<DSML|invoke name="bash">运行</DSML|invoke>世界',
  '你好运行世界');

test('TC07: DSML单独parameter标签',
  '结果<DSML|parameter name="cmd">ls</DSML|parameter>输出',
  '结果ls输出');

// ── 残留片段 ──
test('TC08: parameter>残留',
  '文本parameter>后续',
  '文本后续');

test('TC09: invoke>残留',
  '文本invoke>后续',
  '文本后续');

// ── 边界 ──
test('TC10: null输入',
  null,
  '');

test('TC11: undefined输入',
  undefined,
  '');

test('TC12: 空字符串',
  '',
  '');

test('TC13: 只有标签无文本',
  '<tool_call>X</tool_call>',
  '');

test('TC14: 嵌套标签',
  'A<tool_call>B<tool_call>C</tool_call>D</tool_call>E',
  'AE');

// ── DSML 部分标签（真实场景常见） ──
test('TC15: 不完整DSML开标签',
  '回答<DSML|tool_calls>内容未闭合',
  '回答内容未闭合');

test('TC16: 不完整DSML闭标签',
  '内容</DSML|tool_calls>结尾',
  '内容结尾');

test('TC17: 混合tool_call和DSML',
  'A<tool_call>T</tool_call>B<DSML|tool_calls>D</DSML|tool_calls>C',
  'ABC');

// ── 空行清理 ──
test('TC18: 多个连续空行合并',
  '第一段\n\n\n\n第二段',
  '第一段\n\n第二段');

test('TC19: 标签移除后产生空行',
  '第一段\n<tool_call>X</tool_call>\n\n\n第二段',
  '第一段\n\n第二段');

// ── 汇总 ──
const passed = tests.filter(t => t.pass).length;
const total = tests.length;
console.log(`\n${'='.repeat(50)}`);
console.log(`cleanToolCallTags 测试结果: ${passed}/${total} 通过`);
if (passed < total) {
  console.log(`失败 ${total - passed} 个:`);
  tests.filter(t => !t.pass).forEach(t => console.log(`  - ${t.name}`));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
}