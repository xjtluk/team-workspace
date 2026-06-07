/**
 * Safety Checker — 路径验证 + 命令安全检查
 * 从 ai-reply.js 提取，独立模块化
 */
import { resolve, relative, isAbsolute } from 'path';
import config from '../../config/index.js';

// —— 安全验证函数 ——
const BLOCKED_BASH_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/,           // rm -rf / or ~
  /\bmkfs\b/,                      // 格式化磁盘
  /\bshutdown\b/,                  // 关机
  /\breboot\b/,                    // 重启
  /\bchmod\s+777/,                 // 开放权限
  /\bcurl\b.*\|\s*(ba)?sh/,       // curl | sh/bash
  /\bwget\b.*\|\s*(ba)?sh/,       // wget | sh/bash
  /\b(eval|exec)\s*\(/,           // eval/exec 调用
];

// 允许写入的额外目录（团队协作需要跨项目写文件）
const ALLOWED_DIRS = [
  config.paths.projectDir,
  config.paths.teamDir,
  config.paths.portfolioDir,
];

// 敏感文件扩展名黑名单
const SENSITIVE_EXTS = ['.env', '.pem', '.key', '.crt', '.pfx', '.secret'];

// 敏感文件名黑名单
const SENSITIVE_NAMES = ['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'];

function validatePath(filePath, projectDir) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: '路径为空或无效' };
  }
  if (filePath.includes('..')) {
    return { ok: false, error: '路径包含 .. 遍历，已拒绝' };
  }
  const baseDir = resolve(projectDir);
  const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(baseDir, filePath);

  const ext = targetPath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';
  const fileName = targetPath.split(/[/\\]/).pop() || '';

  // 跨盘符检查（Windows 安全）
  const baseRoot = baseDir.match(/^[a-zA-Z]:\//)?.[0] || '';
  const targetRoot = targetPath.match(/^[a-zA-Z]:\//)?.[0] || '';
  if (targetRoot && baseRoot && targetRoot.toLowerCase() !== baseRoot.toLowerCase()) {
    return { ok: false, error: `禁止跨盘符写入：${targetRoot} ≠ ${baseRoot}` };
  }

  // 敏感文件检查
  if (SENSITIVE_EXTS.includes(ext)) {
    return { ok: false, error: `禁止写入敏感文件 (${ext})` };
  }
  if (SENSITIVE_NAMES.includes(fileName)) {
    return { ok: false, error: `禁止写入敏感文件 (${fileName})` };
  }

  // 检查是否在项目目录内
  const rel = relative(baseDir, targetPath);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return { ok: true, resolved: targetPath };
  }

  // 检查是否在白名单目录内
  for (const allowedDir of ALLOWED_DIRS) {
    const allowedResolved = resolve(allowedDir);
    const relToAllowed = relative(allowedResolved, targetPath);
    if (!relToAllowed.startsWith('..') && !isAbsolute(relToAllowed)) {
      return { ok: true, resolved: targetPath };
    }
  }

  return { ok: false, error: `路径越界：${filePath} 不在允许的目录内` };
}

function validateBashCommand(command) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: '命令为空' };
  }
  for (const pattern of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return { ok: false, error: `命令匹配危险模式 (${pattern.source})，已拒绝` };
    }
  }
  return { ok: true };
}

export { validatePath, validateBashCommand, ALLOWED_DIRS, SENSITIVE_EXTS, SENSITIVE_NAMES, BLOCKED_BASH_PATTERNS };
