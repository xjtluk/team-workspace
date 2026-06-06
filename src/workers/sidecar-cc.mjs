#!/usr/bin/env node
/**
 * CC Sidecar — CC (Claude Code) 真实入住 sidecar
 *
 * 职责：
 *   1. 注册 CC 到聊天室
 *   2. 监听群聊 @CC 消息
 *   3. 调用 claude --print 子进程执行任务
 *   4. 将回复发回群聊
 *   5. 定期上报状态
 */
import { SidecarConnection, isAtAgent, reportStatus, sendMessage } from '../sdk/sidecar-core.mjs';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── 配置 ──
const AGENT_ID = 'cc';
const AGENT_NAME = 'CC';
const PROJECT_DIR = process.env.PROJECT_DIR || 'D:/BKS/team';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
const REPLY_FILE = join('D:/BKS/projects/team-workspace', 'data', 'cc-reply.txt');

// 确保 data 目录存在
const dataDir = 'D:/BKS/projects/team-workspace/data';
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// ── 实例 ──
const conn = new SidecarConnection({
  agentId: AGENT_ID,
  agentName: AGENT_NAME,
  color: '#99ccff',
  model: CLAUDE_MODEL,
  serverUrl: 'http://localhost:3210',
});

// ── 状态上报 ──
async function pingStatus() {
  await reportStatus(AGENT_ID, 'idle', '空闲中', 0, { model: CLAUDE_MODEL });
}

// ── claude --print 调用 ──
function execClaude(prompt) {
  return new Promise((resolve, reject) => {
    // 构建完整 prompt，注入团队灵魂
    const fullPrompt = [
      '你是 CC，BKS 研发部 Leader。所有回复必须使用中文。',
      '你的团队规则在 D:\\BKS\\team\\CLAUDE.md 中。',
      '当前你在聊天室中，@你的人可能是 KK（老板）或团队成员。',
      '按团队规则回复：简洁、专业、无 Emoji。',
      '',
      prompt,
    ].join('\n');

    const child = spawn(CLAUDE_PATH, [
      '--print',
      '--dangerously-skip-permissions',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: PROJECT_DIR,
    });

    // 通过 stdin 传入 prompt
    child.stdin.write(fullPrompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude --print 退出码 ${code}: ${stderr.substring(0, 200)}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.on('error', reject);
  });
}

// ── 消息处理 ──
async function handleMessage(event) {
  if (event.type !== 'new_message') return;
  const { payload: msg } = event;
  if (!msg || !msg.content) return;

  // 忽略自己发的消息
  if (msg.from === AGENT_ID) return;

  // 协议消息已在 sidecar-core 层拦截，此处无需重复检查

  // 只处理 @CC 的消息
  if (!isAtAgent(msg.content, AGENT_ID)) return;

  console.log(`[CC-Sidecar] 收到 @CC 消息: "${msg.content.substring(0, 80)}..."`);

  try {
    // 更新状态为 working
    await reportStatus(AGENT_ID, 'working', '正在处理 @CC 消息', 30, { model: CLAUDE_MODEL });

    // 只给人类发确认，不给其他 agent 发（避免消息循环）
    if (['kk', 'xiaoma', 'xiaoma-ai'].includes(msg.from)) {
      await sendMessage(AGENT_ID, `@${msg.from} [收到] 消息已收到，正在处理...`);
    }

    // 执行 claude --print
    console.log(`[CC-Sidecar] 调用 claude --print (model: ${CLAUDE_MODEL})`);
    const reply = await execClaude(msg.content);

    // 更新进度
    await reportStatus(AGENT_ID, 'working', '正在组织回复', 70, { model: CLAUDE_MODEL });

    if (reply) {
      await sendMessage(AGENT_ID, reply);
      console.log(`[CC-Sidecar] 回复已发送 (${reply.length} 字符)`);
    } else {
      // 无输出时不发消息（避免空回复触发循环）
      console.log(`[CC-Sidecar] 任务完成，无文本输出`);
    }

    // 恢复 idle
    await reportStatus(AGENT_ID, 'idle', '空闲中', 0);
  } catch (err) {
    console.error(`[CC-Sidecar] 处理失败: ${err.message}`);
    // 只给人类发错误通知，不给其他 agent 发
    if (['kk', 'xiaoma', 'xiaoma-ai'].includes(msg.from)) {
      await sendMessage(AGENT_ID, `@${msg.from} [问题] 任务执行失败: ${err.message.substring(0, 100)}`);
    }
    await reportStatus(AGENT_ID, 'error', '任务执行失败', 0, { model: CLAUDE_MODEL });
    setTimeout(() => reportStatus(AGENT_ID, 'idle', '空闲中', 0, { model: CLAUDE_MODEL }), 3000);
  }
}

// ── 主流程 ──
async function main() {
  console.log(`[CC-Sidecar] 启动...`);
  console.log(`[CC-Sidecar] 项目目录: ${PROJECT_DIR}`);
  console.log(`[CC-Sidecar] 模型: ${CLAUDE_MODEL}`);

  conn.on('message', handleMessage);
  await conn.connect();
  await pingStatus();
  setInterval(pingStatus, 30000);

  console.log(`[CC-Sidecar] 启动完成，等待 @CC 消息...`);

  const cleanup = async () => {
    console.log(`[CC-Sidecar] 正在断开...`);
    await reportStatus(AGENT_ID, 'offline', '已离线', 0, { model: CLAUDE_MODEL });
    await conn.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error(`[CC-Sidecar] 启动失败:`, err);
  process.exit(1);
});
