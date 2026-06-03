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

// 走 claude-code-router 统一路由
const ROUTER_URL = 'http://127.0.0.1:3456/v1';

process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = ROUTER_URL;
process.env.OPENAI_API_KEY = 'any-string-is-ok';
process.env.OPENAI_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

console.log('[小马] 走 claude-code-router 统一路由');
console.log('[小马] OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);
console.log('[小马] OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('[小马] 降级链: 硅基V4-Flash → 火山V4-Flash → MiMo 2.5 Pro');

await import('./src/sdk/examples/xiaoma-listener.mjs');
