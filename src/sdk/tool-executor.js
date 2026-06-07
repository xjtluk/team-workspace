/**
 * Tool Executor — 工具定义与执行
 * 从 ai-reply.js 提取，独立模块化
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import config from '../../config/index.js';
import { validatePath, validateBashCommand } from './safety-checker.js';

// —— 环境变量 ——

const DOMAINS_NO_PROXY = 'siliconflow.cn,bigmodel.cn,taotoken.net,volces.com,xiaomimimo.com,127.0.0.1,localhost';

const UTF8_ENV = {
  ...process.env,
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  PYTHONIOENCODING: 'utf-8',
  GIT_TERMINAL_PROMPT: '0',
  http_proxy: 'http://127.0.0.1:7897',
  https_proxy: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  no_proxy: DOMAINS_NO_PROXY,
  NO_PROXY: DOMAINS_NO_PROXY,
};

// —— 工具定义 ——

const TOOLS = [
  {
    name: 'bash',
    description: '执行 shell 命令。用于运行代码、安装依赖、Git 操作、查看文件等。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        cwd: { type: 'string', description: '工作目录，默认 D:/BKS/projects/team-workspace' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '读取文件内容。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '创建或覆盖写入文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: '列出目录下的文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' },
        pattern: { type: 'string', description: '文件名过滤（可选）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: '在文件中搜索关键词。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索关键词或正则' },
        path: { type: 'string', description: '搜索目录' },
      },
      required: ['pattern', 'path'],
    },
  },
];

// —— 工具执行 ——

function executeTool(name, input) {
  const projectDir = input.cwd || process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
  try {
    switch (name) {
      case 'bash': {
        const check = validateBashCommand(input.command);
        if (!check.ok) return `安全拒绝：${check.error}`;
        // Windows 强制 UTF-8 代码页，防止中文乱码
        const isWin = process.platform === 'win32';
        const cmd = isWin ? `chcp 65001 >nul 2>&1 && ${input.command}` : input.command;
        const result = execSync(cmd, {
          cwd: projectDir,
          encoding: 'utf8',
          timeout: 30000,
          windowsHide: true,
          env: UTF8_ENV,
          shell: true,
        });
        return result.substring(0, 3000);
      }
      case 'read_file': {
        const check = validatePath(input.path, projectDir);
        if (!check.ok) return `安全拒绝：${check.error}`;
        const content = readFileSync(check.resolved, 'utf8');
        if (content.length > 50000) {
          return content.substring(0, 50000) + `\n\n[TRUNCATED: showing first 50000 of ${content.length} chars]`;
        }
        return content;
      }
      case 'write_file': {
        const check = validatePath(input.path, projectDir);
        if (!check.ok) return `安全拒绝：${check.error}`;
        writeFileSync(check.resolved, input.content, 'utf8');
        return `文件已写入：${input.path}`;
      }
      case 'list_files': {
        const check = validatePath(input.path || '.', projectDir);
        if (!check.ok) return `安全拒绝：${check.error}`;
        const entries = readdirSync(check.resolved, { withFileTypes: true });
        let result = entries.map(e => (e.isDirectory() ? '[DIR] ' : '') + e.name).join('\n');
        if (input.pattern) {
          result = result.split('\n').filter(l => l.includes(input.pattern)).join('\n');
        }
        return result.substring(0, 2000);
      }
      case 'search_code': {
        const check = validatePath(input.path || '.', projectDir);
        if (!check.ok) return `安全拒绝：${check.error}`;
        // 转义 pattern 中的特殊字符防止命令注入
        const safePattern = (input.pattern || '').replace(/["`$\\]/g, '');
        const isWin = process.platform === 'win32';
        const grepCmd = `grep -r "${safePattern}" "${check.resolved}" --include="*.js" --include="*.jsx" --include="*.md" --include="*.json" --include="*.css" -l 2>/dev/null || echo "无匹配"`;
        const cmd = isWin ? `chcp 65001 >nul 2>&1 && ${grepCmd}` : grepCmd;
        const result = execSync(cmd, {
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
          env: UTF8_ENV,
          shell: true,
        });
        return result.substring(0, 1000);
      }
      default:
        return `未知工具：${name}`;
    }
  } catch (err) {
    return `工具执行错误：${err.message.substring(0, 500)}`;
  }
}

export { executeTool, TOOLS };
