#!/usr/bin/env node
/**
 * 小马 Agent 启动脚本 — 自动加载 API 配置
 */
import { readFileSync } from 'fs';

try {
  const settings = JSON.parse(readFileSync('C:/Users/Administrator/.claude/settings.json', 'utf8'));
  process.env.ANTHROPIC_BASE_URL = settings.env?.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_AUTH_TOKEN = settings.env?.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_MODEL = settings.env?.ANTHROPIC_MODEL;
} catch (e) {
  console.warn('[小马] 无法加载 Claude 配置:', e.message);
}

await import('./src/sdk/examples/xiaoma-listener.mjs');
