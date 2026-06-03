#!/usr/bin/env node
/**
 * 小马 Agent 启动脚本
 *
 * 小马定位：项目管理 — 需求拆解、进度管理、文档统筹、验收
 * 模型：智谱 GLM-4.7-Flash（免费，轻量快速，不需要代码能力）
 * 路由：直连智谱 API
 *
 * 用法：
 *   node start-xiaoma.mjs
 *   node start-xiaoma.mjs D:/BKS/projects/other
 */
import 'dotenv/config';

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

// 直连智谱 GLM-4.7-Flash（免费，项目管理够用）
const xiaomaApiKey = process.env.ZHIPU_API_KEY_XIAOMA;
if (!xiaomaApiKey) {
  console.error('[小马] 错误: ZHIPU_API_KEY_XIAOMA 未设置，请检查 .env 文件');
  process.exit(1);
}
process.env.AI_BACKEND = 'openai';
process.env.OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
process.env.OPENAI_API_KEY = xiaomaApiKey;
process.env.OPENAI_MODEL = 'glm-4.7-flash';

console.log('[小马] 直连智谱 GLM-4.7-Flash（免费）');
console.log('[小马] OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('[小马] 模型: GLM-4.7-Flash（免费，项目管理够用）');

await import('./src/sdk/examples/xiaoma-listener.mjs');
