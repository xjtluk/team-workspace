#!/usr/bin/env node
/**
 * CX (Codex) Agent 启动脚本 — 多模型降级链配置
 *
 * CX 模型分层：
 *   日常: 火山方舟 DS4 Flash（优先用完额度）→ TaoToken Flash → GLM-4.7-Flash
 *   代码: SiliconFlow DS4 Pro → 火山 DS4 Flash → TaoToken Flash → GLM-4.7
 *   兜底: GLM-4.7（智谱，DeepSeek不可用时降级）
 *
 * 用法：
 *   node start-cx.mjs
 *   PROJECT_DIR=D:/BKS/projects/other node start-cx.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 手动加载 .env（dotenv ESM import 在 watchdog spawn 环境下不加载变量）
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envContent = readFileSync(join(__dirname, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // 去掉引号包裹的值：KEY="value" → value, KEY='value' → value
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('[CX] 已手动加载 .env 配置');
} catch (e) {
  console.warn('[CX] 无法加载 .env:', e.message);
}

// CX 直连 provider（路由器 OpenAI 端点不支持动态路由）
// 降级链由 ai-reply.js 的重试机制 + cx-listener 的 [困难] 标记处理
// ── CX 模型分层配置 ──
// 日常: 火山方舟 DS4 Flash（优先用完额度）→ TaoToken Flash → GLM-4.7-Flash
// 代码: SiliconFlow DS4 Pro → 火山 DS4 Flash → TaoToken Flash → GLM-4.7
// 兜底: GLM-4.7（智谱，DeepSeek不可用时降级）
const CX_MODELS = {
  // 日常模型 — 快速、稳定、永久免费
  normal: {
    name: '智谱 GLM-4.7-Flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY_CX || process.env.ZHIPU_API_KEY_XIAOMA,
    model: 'glm-4.7-flash',
  },
  // 代码模型 — 强推理，用于复杂代码任务
  code: {
    name: 'SiliconFlow DeepSeek V4 Pro',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: process.env.SILICONFLOW_API_KEY,
    model: 'deepseek-ai/DeepSeek-V4-Pro',
  },
  // 兜底模型 — DeepSeek 不可用时降级
  fallback: {
    name: '智谱 GLM-4.7',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY_CX || process.env.ZHIPU_API_KEY_XIAOMA,
    model: 'glm-4.7',
  },
};

const selected = CX_MODELS.normal; // 默认 GLM-4.7-Flash

if (!selected.apiKey) {
  console.error(`[CX] 错误: ${selected.name} 的 API Key 未设置，请检查 .env 文件`);
  process.exit(1);
}

process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = selected.baseUrl;
process.env.OPENAI_API_KEY = selected.apiKey;
process.env.OPENAI_MODEL = selected.model;

console.log('[CX] 模型分层策略:');
console.log('[CX]   日常:', CX_MODELS.normal.name, '(@CX [日常])');
console.log('[CX]   代码:', CX_MODELS.code.name, '(@CX [代码])');
console.log('[CX]   兜底:', CX_MODELS.fallback.name, '(DeepSeek不可用时)');
console.log('[CX] 默认模型:', selected.name);

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

await import('./src/workers/sidecar-cx.mjs');
