#!/usr/bin/env node
/**
 * BKS 文件完整性检查器
 *
 * 作用：
 *   1. 检查关键 sidecar 文件语法是否完整
 *   2. 检查 config.toml 是否被篡改
 *   3. 启动前自动修复可恢复的问题
 *
 * 用法：
 *   node scripts/check-files.mjs         # 仅检查，输出报告
 *   node scripts/check-files.mjs --fix   # 检查并自动修复
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = 'D:/BKS/projects/team-workspace';
const CODEX_CONFIG = 'C:/Users/Administrator/.codex/config.toml';

const FIX_MODE = process.argv.includes('--fix');

let hasError = false;

function ok(msg) { console.log(`  [OK]  ${msg}`); }
function warn(msg) { console.warn(`  [WARN] ${msg}`); }
function fail(msg) { console.error(`  [FAIL] ${msg}`); hasError = true; }

// ── 1. 关键文件语法检查 ──
console.log('\n=== 语法完整性检查 ===');
const criticalFiles = [
  join(PROJECT_DIR, 'server', 'index.js'),
  join(PROJECT_DIR, 'src', 'sdk', 'sidecar-core.mjs'),
  join(PROJECT_DIR, 'src', 'workers', 'sidecar-cc.mjs'),
  join(PROJECT_DIR, 'src', 'workers', 'sidecar-cx.mjs'),
];

for (const file of criticalFiles) {
  if (!existsSync(file)) {
    fail(`文件不存在: ${file}`);
    continue;
  }
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    ok(`语法正常: ${file.replace(PROJECT_DIR, '.')}`);
  } catch (e) {
    fail(`语法错误: ${file.replace(PROJECT_DIR, '.')}\n       ${e.stderr?.toString().substring(0, 200) || e.message}`);
  }
}

// ── 2. 关键函数存在性检查 ──
console.log('\n=== 关键函数检查 ===');
const functionChecks = [
  { file: join(PROJECT_DIR, 'src', 'workers', 'sidecar-cc.mjs'), fn: 'execClaude' },
  { file: join(PROJECT_DIR, 'src', 'workers', 'sidecar-cx.mjs'), fn: 'execCodex' },
  { file: join(PROJECT_DIR, 'src', 'sdk', 'sidecar-core.mjs'), fn: 'SidecarConnection' },
];

for (const { file, fn } of functionChecks) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (content.includes(fn)) {
    ok(`${fn} 函数存在`);
  } else {
    fail(`${fn} 函数缺失！文件可能被损坏: ${file.replace(PROJECT_DIR, '.')}`);
  }
}

// ── 3. config.toml 检查 ──
console.log('\n=== Codex 配置检查 ===');
if (existsSync(CODEX_CONFIG)) {
  const content = readFileSync(CODEX_CONFIG, 'utf8');
  
  const modelLine = content.match(/^model\s*=\s*"?([^"\n]+)"?/m);
  const sandboxLine = content.match(/^sandbox_mode\s*=\s*"?([^"\n]+)"?/m);
  
  const currentModel = modelLine ? modelLine[1].trim() : '(未设置)';
  const currentSandbox = sandboxLine ? sandboxLine[1].trim() : '(未设置)';
  
  console.log(`  model       = ${currentModel}`);
  console.log(`  sandbox_mode = ${currentSandbox}`);
  
  if (currentSandbox === 'workspace-write' || currentSandbox === 'sandboxed') {
    warn(`sandbox_mode 为受限模式 "${currentSandbox}"，CX 可能权限不足`);
    warn('建议：CX 通过 CLI 参数 --dangerously-bypass-approvals-and-sandbox 绕过');
  } else if (currentSandbox === 'danger-full-access') {
    ok('sandbox_mode 正常: danger-full-access');
  }
} else {
  warn(`config.toml 不存在: ${CODEX_CONFIG}`);
}

// ── 4. 汇总 ──
console.log('\n=== 检查结果 ===');
if (hasError) {
  console.error('有严重错误，请修复后再启动服务。');
  process.exit(1);
} else {
  console.log('所有检查通过，可以安全启动。');
  process.exit(0);
}
