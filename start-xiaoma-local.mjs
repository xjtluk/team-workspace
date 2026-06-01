#!/usr/bin/env node
/**
 * 小马 Agent 启动脚本 — 使用本地模型（OpenAI 兼容）
 *
 * 本地模型处理轻量对话，复杂任务标记为"需要小马处理"
 */
import { readFileSync } from 'fs';

// 本地模型配置
process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'http://localhost:8080/v1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'local';
process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'local-model';

// 也加载 Anthropic 配置（用于共享记忆等）
try {
  const settings = JSON.parse(readFileSync('C:/Users/Administrator/.claude/settings.json', 'utf8'));
  process.env.ANTHROPIC_BASE_URL = settings.env?.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_AUTH_TOKEN = settings.env?.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_MODEL = settings.env?.ANTHROPIC_MODEL;
} catch (e) {
  console.warn('[小马] 无法加载 Claude 配置:', e.message);
}

console.log('[小马] 使用本地模型:', process.env.OPENAI_BASE_URL);
await import('./src/sdk/examples/xiaoma-listener.mjs');
