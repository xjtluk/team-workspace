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

// CX 直连 provider（路由器 OpenAI 端点不支持动态路由）
// 降级链由 ai-reply.js 的重试机制 + cx-listener 的 [困难] 标记处理
const CX_MODELS = [
  {
    name: 'SiliconFlow DeepSeek V4 Pro',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: process.env.SILICONFLOW_API_KEY || 'sk-kwmefeifzfkssrwsyrvrselxbxmorhzwqhekbnhrvncxpccx',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
  },
  {
    name: '火山方舟 DeepSeek V4 Pro',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-afa1d5c7-2e79-4bb7-b249-ab6fcf199aef-a8d71',
    model: 'ep-20260602221649-hcpvd',
  },
  {
    name: '智谱 GLM-4.7',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY || '441fab8e01b14ecea3e499521e25a4b5.4BqBiIi5jHrGkFvA',
    model: 'glm-4.7',
  },
  {
    name: 'MiMo 2.5 Pro',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiKey: process.env.XIAOMI_API_KEY || 'sk-c7e7o6zyxh1l3ue90uwg8mfye754eiooexl8wpe3d3wj13jg',
    model: 'mimo-v2.5-pro',
  },
];

const selected = CX_MODELS[0]; // 默认硅基 V4-Pro

process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = selected.baseUrl;
process.env.OPENAI_API_KEY = selected.apiKey;
process.env.OPENAI_MODEL = selected.model;

console.log('[CX] 直连 provider（不走路由器）');
console.log('[CX] 默认模型:', selected.name);
console.log('[CX] OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);
console.log('[CX] [困难] 标记可切换到 GLM-4.7');

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

await import('./src/workers/cx-listener.mjs');
