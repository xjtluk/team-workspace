#!/usr/bin/env node
/**
 * CX (Codex) Agent 启动脚本 — 多模型降级链配置
 *
 * CX 代码实现任务降级链（按 model-allocation.yaml）：
 *   1. SiliconFlow DeepSeek V4 Flash（主力，2000万永久免费）
 *   2. 火山方舟 DeepSeek V4 Flash（备用，50万+200万/天可续）
 *   3. 火山方舟 Doubao-2.0-code（代码特化）
 *   4. 火山方舟 Doubao-2.0-lite（低成本批量）
 *   5. 智谱 GLM-4.5-air（战略储备）
 *
 * 用法：
 *   node start-cx.mjs
 *   PROJECT_DIR=D:/BKS/projects/other node start-cx.mjs
 */

// CX 走 claude-code-router 统一路由
// 自动降级链：硅基V4-Flash → 火山V4-Flash → MiMo 2.5 Pro
// 降级逻辑由 custom-router.js 处理（检测 429 自动切换 provider）
const ROUTER_URL = 'http://127.0.0.1:3456/v1';

process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = ROUTER_URL;
process.env.OPENAI_API_KEY = 'any-string-is-ok';  // 路由器不需要真实 key
process.env.OPENAI_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';  // 路由器根据此 model 名分流

console.log('[CX] 走 claude-code-router 统一路由');
console.log('[CX] OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);
console.log('[CX] OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('[CX] 降级链: 硅基V4-Flash → 火山V4-Flash → MiMo 2.5 Pro');

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

await import('./src/workers/cx-listener.mjs');
