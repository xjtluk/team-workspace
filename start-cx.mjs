#!/usr/bin/env node
/**
 * CX (Codex) Agent 启动脚本 — 配置 SiliconFlow DeepSeek V4 Pro
 *
 * 用法：
 *   node start-cx.mjs
 *   PROJECT_DIR=D:/BKS/projects/other node start-cx.mjs
 */

// 配置 CX 使用 SiliconFlow DeepSeek V4 Pro
process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = 'https://api.siliconflow.cn/v1';
process.env.OPENAI_API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-kwmefeifzfkssrwsyrvrselxbxmorhzwqhekbnhrvncxpccx';
process.env.OPENAI_MODEL = 'deepseek-ai/DeepSeek-V4-Pro';

console.log('[CX] 配置: SiliconFlow DeepSeek V4 Pro');
console.log('[CX] AI_BACKEND:', process.env.AI_BACKEND);
console.log('[CX] OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('[CX] OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

await import('./src/workers/cx-listener.mjs');
