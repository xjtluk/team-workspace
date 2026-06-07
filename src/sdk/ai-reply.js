/**
 * AI 回复模块 — 入口文件（barrel re-export）
 *
 * 原 819 行已拆分为 4 个独立模块：
 *   - ai-engine.js       核心 AI 调用逻辑
 *   - tool-executor.js    工具定义与执行
 *   - safety-checker.js   安全校验
 *   - json-repair.js      JSON/文本修复
 *
 * 此文件保留为向后兼容入口，统一导出 generateReply。
 */
export { generateReply } from './ai-engine.js';
