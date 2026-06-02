#!/usr/bin/env node
/**
 * Codex Agent — Hub-Spoke 模式
 *
 * 职责：
 *   1. 注册 Codex 上线 + 心跳保活
 *   2. 监听群聊消息 → 只回应 @Codex 的消息
 *   3. 解析消息协议：[任务] [委托] [完成] [问题]
 *   4. 执行任务 → 完成后汇报
 *   5. 结果发回群聊
 */
import { createAgent } from '../sdk/agent-client.js';
import { execSync, spawn } from 'child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';

// ── 配置 ──
const CODEX_MODEL = process.env.CODEX_MODEL || 'o4-mini';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || 'D:/BKS/projects/team-workspace';

// ── 单实例保护 ──
const PID_FILE = join(process.cwd(), '.codex-listener.pid');

function checkSingleInstance() {
  if (existsSync(PID_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      const oldPid = data.pid;
      try {
        process.kill(oldPid, 0);
        console.error(`[Codex] 错误: codex-listener 已在运行 (PID: ${oldPid})`);
        console.error(`[Codex] 如需重启，请先运行: taskkill /F /PID ${oldPid}`);
        process.exit(1);
      } catch {
        // 进程不存在，可以继续
      }
    } catch {
      // PID 文件格式错误，清理后继续
    }
  }
  writeFileSync(PID_FILE, JSON.stringify({
    pid: process.pid,
    startTime: Date.now(),
  }), 'utf8');
}

checkSingleInstance();

// ── 清理工具调用标签 ──
function cleanToolCallTags(text) {
  if (!text) return '';
  const oc = String.fromCharCode(60);
  const cc = String.fromCharCode(62);
  const openTag = oc + 'tool_call' + cc;
  const closeTag = oc + '/tool_call' + cc;
  const openEsc = openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closeEsc = closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(openEsc + '[\\s\\S]*?' + closeEsc, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 调用 Codex CLI 执行任务 ──
async function executeCodexTask(prompt, workDir) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      '--model', CODEX_MODEL,
      '--sandbox', 'workspace-write',
      '--approval', 'never',
      '--quiet',
      '--prompt', prompt,
    ];

    console.log(`[Codex] 执行任务: ${prompt.substring(0, 80)}...`);
    console.log(`[Codex] 工作目录: ${workDir}`);
    console.log(`[Codex] 模型: ${CODEX_MODEL}`);

    const child = spawn('codex', args, {
      cwd: workDir,
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        HTTP_PROXY: process.env.HTTP_PROXY || 'http://127.0.0.1:7897',
        HTTPS_PROXY: process.env.HTTPS_PROXY || 'http://127.0.0.1:7897',
      },
      shell: true,
      timeout: 300000, // 5 分钟超时
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(cleanToolCallTags(stdout.trim()));
      } else {
        reject(new Error(`Codex exited with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// ── 解析消息协议 ──
function parseMessageProtocol(content) {
  const patterns = {
    task: /@\S+\s*\[任务\]\s*(.*)/s,
    delegate: /@\S+\s*\[委托\]\s*(.*)/s,
    complete: /@\S+\s*\[完成\]\s*(.*)/s,
    issue: /@\S+\s*\[问题\]\s*(.*)/s,
  };

  for (const [type, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern);
    if (match) {
      return { type, content: match[1].trim() };
    }
  }

  // 如果没有协议标签，当作普通任务
  return { type: 'task', content: content.replace(/@\S+\s*/, '').trim() };
}

// ── 主流程 ──
async function main() {
  // 注册 Codex Agent
  const codex = createAgent({
    id: 'codex',
    name: 'Codex',
    color: '#10A37F', // OpenAI 绿
    gridFile: 'grids/codex.js',
  });

  // 连接到 Workspace Server
  await codex.connect();
  console.log('[Codex] 已连接到 Workspace Server');

  // 监听群聊消息
  codex.onMessage(async (msg) => {
    // 只处理 @Codex 的消息
    if (!msg.content || !msg.content.includes('@Codex')) {
      return;
    }

    // 忽略自己发的消息
    if (msg.from === 'codex') {
      return;
    }

    console.log(`[Codex] 收到消息: ${msg.content.substring(0, 100)}`);

    // 解析消息协议
    const { type, content } = parseMessageProtocol(msg.content);

    // 只处理任务和委托
    if (type !== 'task' && type !== 'delegate') {
      console.log(`[Codex] 跳过非任务消息: ${type}`);
      return;
    }

    // 更新状态为工作中
    await codex.work('正在执行任务...', 10);

    try {
      // 执行 Codex 任务
      const result = await executeCodexTask(content, WORKSPACE_DIR);

      // 发送结果
      const reply = `@${msg.fromName} [完成] 任务执行完成\n\n${result}`;
      await codex.send(reply);

      // 更新状态为空闲
      await codex.work('任务完成', 100);
      setTimeout(async () => {
        await codex.work('', 0);
      }, 3000);

    } catch (err) {
      console.error(`[Codex] 任务执行失败:`, err);

      // 发送错误信息
      const reply = `@${msg.fromName} [问题] 任务执行失败: ${err.message}`;
      await codex.send(reply);

      // 更新状态为空闲
      await codex.work('任务失败', 0);
    }
  });

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('[Codex] 正在断开连接...');
    unlinkSync(PID_FILE);
    await codex.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Codex] 正在断开连接...');
    unlinkSync(PID_FILE);
    await codex.disconnect();
    process.exit(0);
  });

  console.log('[Codex] 监听启动，等待任务...');
}

main().catch(err => {
  console.error('[Codex] 启动失败:', err);
  process.exit(1);
});
