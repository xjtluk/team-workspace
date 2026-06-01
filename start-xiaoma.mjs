#!/usr/bin/env node
/**
 * 小马 Agent 启动脚本 — 支持 Anthropic API 和本地模型
 *
 * 用法：
 *   node start-xiaoma.mjs                          # 默认项目 team-workspace
 *   node start-xiaoma.mjs D:/BKS/projects/other    # 指定项目目录
 *   PROJECT_DIR=D:/BKS/projects/other node start-xiaoma.mjs  # 环境变量方式
 *
 * 环境变量：
 *   AI_BACKEND=anthropic|openai (默认 anthropic)
 *   OPENAI_BASE_URL (本地模型地址，默认 http://localhost:8080/v1)
 */
import { readFileSync } from 'fs';

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

// 检查是否使用本地模型
const useLocalModel = process.env.AI_BACKEND === 'openai';

if (useLocalModel) {
  // 本地模型配置（支持 Ollama 和 llama.cpp）
  // Ollama 默认端口 11434，llama.cpp 默认端口 8080
  const ollamaUrl = 'http://localhost:11434/v1';
  const llamaCppUrl = 'http://localhost:8080/v1';

  // 自动检测哪个服务在运行
  let detectedUrl = ollamaUrl; // 默认使用 Ollama
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags');
    if (ollamaRes.ok) {
      detectedUrl = ollamaUrl;
      console.log('[小马] 检测到 Ollama 服务');
    }
  } catch {
    try {
      const llamaRes = await fetch('http://localhost:8080/v1/models');
      if (llamaRes.ok) {
        detectedUrl = llamaCppUrl;
        console.log('[小马] 检测到 llama.cpp 服务');
      }
    } catch {
      console.log('[小马] 未检测到本地模型服务，使用默认配置');
    }
  }

  process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || detectedUrl;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'local';
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'qwen2.5:3b';
  console.log('[小马] 使用本地模型:', process.env.OPENAI_BASE_URL);
}

// 也加载 Anthropic 配置（用于共享记忆等）
try {
  const settings = JSON.parse(readFileSync('C:/Users/Administrator/.claude/settings.json', 'utf8'));
  process.env.ANTHROPIC_BASE_URL = settings.env?.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_AUTH_TOKEN = settings.env?.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_MODEL = settings.env?.ANTHROPIC_MODEL;
} catch (e) {
  console.warn('[小马] 无法加载 Claude 配置:', e.message);
}

await import('./src/sdk/examples/xiaoma-listener.mjs');
