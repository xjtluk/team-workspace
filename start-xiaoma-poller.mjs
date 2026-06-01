#!/usr/bin/env node
/**
 * 小马 Agent 启动脚本 — 定时轮询模式
 *
 * 不需要本地模型，直接用 Marvis API
 * 定时检查群聊历史，有新消息就回复
 */
import { readFileSync } from 'fs';

// 加载 Anthropic 配置（用于共享记忆等）
try {
  const settings = JSON.parse(readFileSync('C:/Users/Administrator/.claude/settings.json', 'utf8'));
  process.env.ANTHROPIC_BASE_URL = settings.env?.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_AUTH_TOKEN = settings.env?.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_MODEL = settings.env?.ANTHROPIC_MODEL;
} catch (e) {
  console.warn('[小马] 无法加载 Claude 配置:', e.message);
}

console.log('[小马] 使用轮询模式（不需要本地模型）');
await import('./src/sdk/examples/xiaoma-poller.mjs');
