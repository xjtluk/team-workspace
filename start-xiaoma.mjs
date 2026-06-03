#!/usr/bin/env node
/**
 * 小马 Agent 启动脚本
 *
 * 小马定位：项目管理 — 需求拆解、进度管理、文档统筹、验收
 * 模型：DeepSeek V4 Flash（轻量快速，不需要代码能力）
 * 路由：走 claude-code-router，降级链自动切换
 *
 * 用法：
 *   node start-xiaoma.mjs
 *   node start-xiaoma.mjs D:/BKS/projects/other
 */

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

// 直连 SiliconFlow（路由器 OpenAI 端点不支持动态路由）
process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = 'https://api.siliconflow.cn/v1';
process.env.OPENAI_API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-kwmefeifzfkssrwsyrvrselxbxmorhzwqhekbnhrvncxpccx';
process.env.OPENAI_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

console.log('[小马] 直连 SiliconFlow');
console.log('[小马] OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('[小马] 模型: DeepSeek V4 Flash（轻量快速，项目管理够用）');

await import('./src/sdk/examples/xiaoma-listener.mjs');
