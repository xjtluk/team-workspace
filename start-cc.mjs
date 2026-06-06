#!/usr/bin/env node
/**
 * CC Agent 启动脚本 — 自动加载 API 配置
 *
 * 用法：
 *   node start-cc.mjs                          # 默认项目 team-workspace
 *   node start-cc.mjs D:/BKS/projects/other    # 指定项目目录
 *   PROJECT_DIR=D:/BKS/projects/other node start-cc.mjs  # 环境变量方式
 */

// ✅ 修复 3.3：添加 dotenv 支持，确保 .env 作为 fallback
// 手动加载 .env（dotenv ESM import 在 watchdog spawn 环境下可能不加载变量）
try {
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envContent = readFileSync(join(__dirname, '.env'), 'utf8');
  let loaded = 0;
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
    if (!process.env[key]) { process.env[key] = val; loaded++; }
  }
  console.log(`[CC] ✅ 已手动加载 .env 配置 (${loaded} 个变量)`);
} catch {
  console.log('[CC] ⚠️ 无法加载 .env 文件');
}

// 从 Claude 配置加载 API 密钥（优先级高于 .env）
try {
  const { readFileSync } = await import('fs');
  const settings = JSON.parse(readFileSync('C:/Users/Administrator/.claude/settings.json', 'utf8'));
  
  // 只在环境变量未设置时才从 Claude 配置加载
  if (!process.env.ANTHROPIC_BASE_URL && settings.env?.ANTHROPIC_BASE_URL) {
    process.env.ANTHROPIC_BASE_URL = settings.env.ANTHROPIC_BASE_URL;
  }
  if (!process.env.ANTHROPIC_AUTH_TOKEN && settings.env?.ANTHROPIC_AUTH_TOKEN) {
    process.env.ANTHROPIC_AUTH_TOKEN = settings.env.ANTHROPIC_AUTH_TOKEN;
  }
  if (!process.env.ANTHROPIC_MODEL && settings.env?.ANTHROPIC_MODEL) {
    process.env.ANTHROPIC_MODEL = settings.env.ANTHROPIC_MODEL;
  }
  
  console.log('[CC] ✅ 已加载 Claude 配置');
} catch (e) {
  console.warn('[CC] ⚠️ 无法加载 Claude 配置:', e.message);
  console.warn('[CC] ℹ️ 将仅使用 .env 配置');
}

// ✅ 修复：验证必需的 API 配置
if (!process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error('[CC] ❌ 错误: 未找到 Anthropic API Key');
  console.error('[CC] 请确保以下至少一个配置存在:');
  console.error('[CC]   - .env 文件中的 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY');
  console.error('[CC]   - Claude 配置文件 C:/Users/Administrator/.claude/settings.json');
  process.exit(1);
}

if (!process.env.ANTHROPIC_BASE_URL) {
  console.warn('[CC] ⚠️ 警告: 未设置 ANTHROPIC_BASE_URL，使用默认值');
  process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
}

// 项目路径：命令行参数 > 环境变量 > 默认值
if (process.argv[2]) {
  process.env.PROJECT_DIR = process.argv[2];
}

console.log(`[CC] ✅ CC Agent 启动准备完成`);
console.log(`[CC]    项目目录: ${process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace'}`);
console.log(`[CC]    Base URL: ${process.env.ANTHROPIC_BASE_URL}`);
console.log(`[CC]    模型: ${process.env.ANTHROPIC_MODEL || 'default'}`);

await import('./src/sdk/examples/cc-listener.mjs');
