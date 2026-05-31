/**
 * AI 回复模块 — 让 Agent 能用自然语言对话
 * 调用 Anthropic API (通过配置的代理) 生成回复
 */

const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.xiaomimimo.com/anthropic';
const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'mimo-v2.5-pro';

/**
 * 生成 AI 回复
 * @param {string} systemPrompt — Agent 的人设和角色描述
 * @param {Array}  history      — 对话历史 [{from, content}]
 * @param {string} userMessage  — 当前用户消息
 * @returns {string} AI 生成的回复文本
 */
export async function generateReply(systemPrompt, history, userMessage) {
  // 构建对话历史
  const messages = [];

  // 加入最近的历史消息作为上下文（最多 10 条）
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.from === 'user' ? 'user' : 'assistant',
      content: `${msg.from}: ${msg.content}`,
    });
  }

  // 当前消息
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '(无回复)';
}
