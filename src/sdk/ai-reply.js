/**
 * AI 回复模块 — 支持工具调用的 Agent 引擎
 * AI 可以执行 Bash、读写文件、搜索代码等操作
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.xiaomimimo.com/anthropic';
const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'mimo-v2.5-pro';

// 工具定义
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

// 执行工具
function executeTool(name, input) {
  const cwd = input.cwd || 'D:/BKS/projects/team-workspace';
  try {
    switch (name) {
      case 'bash': {
        const result = execSync(input.command, {
          cwd,
          encoding: 'utf8',
          timeout: 30000,
          windowsHide: true,
        });
        return result.substring(0, 3000);
      }
      case 'read_file': {
        const content = readFileSync(input.path, 'utf8');
        return content.substring(0, 5000);
      }
      case 'write_file': {
        writeFileSync(input.path, input.content, 'utf8');
        return `文件已写入: ${input.path}`;
      }
      case 'list_files': {
        const entries = readdirSync(input.path, { withFileTypes: true });
        let result = entries.map(e => (e.isDirectory() ? '[DIR] ' : '') + e.name).join('\n');
        if (input.pattern) {
          result = result.split('\n').filter(l => l.includes(input.pattern)).join('\n');
        }
        return result.substring(0, 2000);
      }
      case 'search_code': {
        const result = execSync(`grep -r "${input.pattern}" "${input.path}" --include="*.{js,jsx,md,json,css}" -l 2>/dev/null || echo "无匹配"`, {
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
        });
        return result.substring(0, 1000);
      }
      default:
        return `未知工具: ${name}`;
    }
  } catch (err) {
    return `工具执行错误: ${err.message.substring(0, 500)}`;
  }
}

/**
 * 生成 AI 回复（支持工具调用循环）
 */
export async function generateReply(systemPrompt, history, userMessage) {
  const messages = [];

  // 加入历史
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role === 'cc' || msg.role === 'xiaoma' || msg.role === 'assistant' ? 'assistant' : 'user',
      content: `${msg.name || msg.role}: ${msg.content}`,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  // 工具调用循环（最多 5 轮）
  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: TOOLS,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const content = data.content || [];

    // 检查是否有工具调用
    const toolUses = content.filter(b => b.type === 'tool_use');
    const textBlocks = content.filter(b => b.type === 'text');

    if (toolUses.length === 0) {
      // 没有工具调用，返回文本
      return textBlocks.map(b => b.text).join('\n') || '(无回复)';
    }

    // 有工具调用 → 执行 → 返回结果继续对话
    const assistantContent = content;
    messages.push({ role: 'assistant', content: assistantContent });

    const toolResults = [];
    for (const toolUse of toolUses) {
      console.log(`[工具] ${toolUse.name}(${JSON.stringify(toolUse.input).substring(0, 80)})`);
      const result = executeTool(toolUse.name, toolUse.input);
      console.log(`[结果] ${result.substring(0, 100)}`);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return '(工具调用轮次已达上限)';
}
