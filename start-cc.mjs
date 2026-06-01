#!/usr/bin/env node
/**
 * CC Agent 启动脚本 — 自动加载 API 配置
 *
 * 用法：
 *   node start-cc.mjs                          # 默认项目 team-workspace
 *   node start-cc.mjs D:/BKS/projects/other    # 指定项目目录
 *   PROJECT_DIR=D:/BKS/projects/other node start-cc.mjs  # 环境变量方式
 */
import { readFileSync } from 'fs';

// 从 Claude 配置加载 API 密钥
try {
  const settings = JSON.parse(readFileSync('C:/Users/Administrator/.claude/settings.json', 'utf8'));
  process.env.ANTHROPIC_BASE_URL = settings.env?.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_AUTH_TOKEN = settings.env?.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_MODEL = settings.env?.ANTHROPIC_MODEL;
} catch (e) {
  console.warn('[CC] 无法加载 Claude 配置:', e.message);
}

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

await import('./src/sdk/examples/cc-listener.mjs');
