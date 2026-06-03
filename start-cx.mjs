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

// CX 降级链配置
const CX_MODELS = [
  {
    name: 'SiliconFlow DeepSeek V4 Flash',
    backend: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: process.env.SILICONFLOW_API_KEY || 'sk-kwmefeifzfkssrwsyrvrselxbxmorhzwqhekbnhrvncxpccx',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
  },
  {
    name: '火山方舟 DeepSeek V4 Flash',
    backend: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-afa1d5c7-2e79-4bb7-b249-ab6fcf199aef-a8d71',
    model: 'ep-20260602221852-f6q4v',  // Endpoint ID
  },
  {
    name: '火山方舟 Doubao-2.0-code',
    backend: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-afa1d5c7-2e79-4bb7-b249-ab6fcf199aef-a8d71',
    model: 'ep-20260602205242-ztn6h',  // Endpoint ID
  },
  {
    name: '火山方舟 Doubao-2.0-lite',
    backend: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-afa1d5c7-2e79-4bb7-b249-ab6fcf199aef-a8d71',
    model: 'ep-20260602222337-4z7xh',  // Endpoint ID
  },
  {
    name: '智谱 GLM-4.5-air',
    backend: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY || '',
    model: 'glm-4.5-air',
  },
];

// 选择第一个有 API Key 的模型
const selectedModel = CX_MODELS.find(m => m.apiKey) || CX_MODELS[0];

process.env.AI_BACKEND = selectedModel.backend;
process.env.OPENAI_BASE_URL = selectedModel.baseUrl;
process.env.OPENAI_API_KEY = selectedModel.apiKey;
process.env.OPENAI_MODEL = selectedModel.model;

console.log(`[CX] 配置: ${selectedModel.name}`);
console.log('[CX] AI_BACKEND:', process.env.AI_BACKEND);
console.log('[CX] OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('[CX] OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

await import('./src/workers/cx-listener.mjs');
