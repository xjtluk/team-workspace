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
import { validateMessage, createMessage, isProtocolMessage } from '../sdk/message-schema.mjs';
import { validateThreeAxes, logViolation } from '../../scripts/pre-dispatch-check.mjs';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

// ── Trace 持久化 ──
const TRACE_DIR = 'D:/BKS/projects/team-workspace/traces/cc';
const today = new Date().toISOString().split('T')[0];
const todayTraceDir = join(TRACE_DIR, today);

if (!existsSync(todayTraceDir)) {
  mkdirSync(todayTraceDir, { recursive: true });
}

function writeTraceEvent(traceId, event) {
  try {
    const tracePath = join(todayTraceDir, `${traceId}.jsonl`);
    const line = JSON.stringify({ timestamp: Date.now(), ...event }) + '\n';
    appendFileSync(tracePath, line, 'utf-8');
  } catch (err) {
    console.error(`[CC-Sidecar] Trace 写入失败: ${err.message}`);
  }
}

// ── 单实例锁：防止 PM2 重启时产生多个进程 ──
const LOCK_FILE = join('D:/BKS/projects/team-workspace', 'data', 'cc-sidecar.lock');
function acquireLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      const pid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      // 检查旧进程是否还活着
      try {
        process.kill(pid, 0); // signal 0 = 只检查，不杀
        console.error(`[CC-Sidecar] 另一个实例正在运行 (PID ${pid})，退出`);
        process.exit(1);
      } catch {
        // 旧进程已死，清理残留锁文件
        unlinkSync(LOCK_FILE);
      }
    }
    writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    // 退出时清理锁
    const cleanupLock = () => { try { unlinkSync(LOCK_FILE); } catch {} };
    process.on('exit', cleanupLock);
    process.on('SIGINT', () => { cleanupLock(); process.exit(0); });
    process.on('SIGTERM', () => { cleanupLock(); process.exit(0); });
  } catch (e) {
    console.warn(`[CC-Sidecar] 锁文件处理异常: ${e.message}`);
  }
}
acquireLock();

// ── 配置 ──
const AGENT_ID = 'cc';
const AGENT_NAME = 'CC';
const PROJECT_DIR = process.env.PROJECT_DIR || 'D:/BKS/team';
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'mimo-v2.5-pro';
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
const REPLY_FILE = join('D:/BKS/projects/team-workspace', 'data', 'cc-reply.txt');

// 消息级处理锁：防止同一消息并发处理
const _processingMessageIds = new Set();
// 已发送确认的消息 ID：防止重复发送 [收到]
const _ackedMessageIds = new Set();
// 防抖：同源同内容消息 5 秒内不重复处理
const _recentMessages = new Map(); // key: from+content hash → timestamp

// ── 消息队列（FIFO 串行执行） ──
const messageQueue = [];
let isProcessing = false;

function enqueue(msg) {
  messageQueue.push({ msg, enqueuedAt: Date.now() });
  if (messageQueue.length > 5) {
    console.warn(`[CC-Sidecar] 队列积压 ${messageQueue.length} 条`);
  }
  processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  if (messageQueue.length === 0) return;
  isProcessing = true;
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    try {
      await handleOneMessage(item.msg);
    } catch (err) {
      console.error(`[CC-Sidecar] 处理失败: ${err.message}`);
    }
  }
  isProcessing = false;
}

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
      '你是 CC，BKS 研发部 Leader。',
      '【强制规则】所有回复必须使用中文，禁止使用英文。即使对方用英文提问，你也必须用中文回复。',
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
      // 强制 UTF-8 输出，解决 Windows GBK 乱码问题
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

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

// ── 消息入口：过滤 + Schema 校验 + 入队 ──
async function handleMessage(event) {
  if (event.type !== 'new_message') return;
  const { payload: msg } = event;
  if (!msg || !msg.content) return;

  // Schema 校验（接收前校验）
  const { valid, errors } = validateMessage(msg);
  if (!valid) {
    console.warn(`[CC-Sidecar] 消息 Schema 校验失败:`, errors);
    // 协议消息不做校验（向后兼容）
    if (!isProtocolMessage(msg.content)) {
      console.log(`[CC-Sidecar] 丢弃不符合 Schema 的消息`);
      return; // 非协议消息，校验失败直接丢弃
    }
  }

  // 忽略自己发的消息
  if (msg.from === AGENT_ID) return;

  // 频道过滤：只处理群聊和自己的私聊
  const ch = msg.channel || 'group';
  if (ch !== 'group' && ch !== `dm_${AGENT_ID}`) return;

  // 处理锁：同一消息 ID 在处理中时跳过
  if (_processingMessageIds.has(msg.id)) return;
  _processingMessageIds.add(msg.id);

  // 防抖：同源同内容 5 秒内不重复处理
  const debounceKey = `${msg.from}:${msg.content}`;
  const now = Date.now();
  const lastTime = _recentMessages.get(debounceKey);
  if (lastTime && (now - lastTime) < 5000) {
    console.log(`[CC-Sidecar] 防抖跳过重复: "${msg.content.substring(0, 40)}"`);
    _processingMessageIds.delete(msg.id);
    return;
  }
  _recentMessages.set(debounceKey, now);
  if (_recentMessages.size > 500) _recentMessages.clear();

  // 消息路由：
  const isPrivateChat = ch.startsWith('dm_');
  const isDirectToMe = isAtAgent(msg.content, AGENT_ID);
  if (isDirectToMe) {
    // @CC 的消息，直接处理
  } else if (isPrivateChat) {
    // 私聊消息——本身就是发给 CC 的，直接处理
  } else if (['kk', 'xiaoma', 'xiaoma-ai'].includes(msg.from)) {
    const mentionsOthers = ['@cx', '@xiaoma', '@xiaoma-ai', '@hermes'].some(m =>
      msg.content.toLowerCase().includes(m)
    );
    if (mentionsOthers) { _processingMessageIds.delete(msg.id); return; }
  } else {
    _processingMessageIds.delete(msg.id);
    return;
  }

  // 入队串行处理
  enqueue(msg);
}

// ── 单条消息处理（由队列串行调用） ──
async function handleOneMessage(msg) {
  const traceId = `cc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  writeTraceEvent(traceId, { event: 'start', message: msg.content.substring(0, 100), from: msg.from });
  
  console.log(`[CC-Sidecar] 处理消息: "${msg.content.substring(0, 80)}..."`);

  try {
    await reportStatus(AGENT_ID, 'working', '正在处理消息', 30, { model: CLAUDE_MODEL });
    writeTraceEvent(traceId, { event: 'status', status: 'working' });

    // 只给人类发确认，同一消息 ID 只发一次
    if (['kk', 'xiaoma', 'xiaoma-ai'].includes(msg.from) && !_ackedMessageIds.has(msg.id)) {
      _ackedMessageIds.add(msg.id);
      const ackMsg = createMessage({
        from: AGENT_ID,
        fromName: AGENT_NAME,
        content: `[收到] 消息已收到，正在处理...`,
        channel: msg.channel || 'group',
        replyTo: msg.id,
      });
      if (ackMsg) {
        await sendMessage(AGENT_ID, ackMsg.content, ackMsg.channel);
      } else {
        await sendMessage(AGENT_ID, `@${msg.from} [收到] 消息已收到，正在处理...`);
      }
      if (_ackedMessageIds.size > 1000) _ackedMessageIds.clear();
    }

    console.log(`[CC-Sidecar] 调用 claude --print (model: ${CLAUDE_MODEL})`);
    const reply = await execClaude(msg.content);

    await reportStatus(AGENT_ID, 'working', '正在组织回复', 70, { model: CLAUDE_MODEL });

    if (reply) {
      writeTraceEvent(traceId, { event: 'reply_generated', length: reply.length });
      
      // P2 硬约束：派发前自动检查（三板斧验证）
      if (reply.includes('@CX') || reply.includes('@cx')) {
        console.log(`[CC-Sidecar] 检测到派发任务给 CX，执行三板斧验证...`);
        writeTraceEvent(traceId, { event: 'pre_dispatch_check', type: 'three_axes' });
        
        // 提取任务信息（简单解析）
        const taskInfo = {
          title: reply.substring(0, 100),
          description: reply,
          assignee: 'cx',
        };
        
        const { valid, errors } = validateThreeAxes(taskInfo);
        if (!valid) {
          // 验证失败：记录违规 + 阻止派发
          const violationDesc = errors.join('; ');
          logViolation('three_axes', taskInfo.title, violationDesc);
          console.warn(`[CC-Sidecar] 三板斧验证失败: ${violationDesc}`);
          
          // 发送违规提示
          const violationMsg = createMessage({
            from: AGENT_ID,
            fromName: AGENT_NAME,
            content: `[@CX] 任务派发被阻止：\n${errors.map(e => `- ${e}`).join('\n')}\n\n请调整任务后重新派发。`,
            channel: msg.channel || 'group',
          });
          
          if (violationMsg) {
            await sendMessage(AGENT_ID, violationMsg.content, violationMsg.channel);
          }
          
          await reportStatus(AGENT_ID, 'idle', '空闲中（派发被阻止）', 0, { model: CLAUDE_MODEL });
          _processingMessageIds.delete(msg.id);
          return; // 阻止继续处理
        }
        
        console.log(`[CC-Sidecar] 三板斧验证通过`);
      }
      
      // Schema 校验：发送前校验回复消息
      const replyMsg = createMessage({
        from: AGENT_ID,
        fromName: AGENT_NAME,
        content: reply,
        channel: msg.channel || 'group',
      });
      
      if (replyMsg) {
        console.log(`[CC-Sidecar] 发送回复 (${reply.length} 字符)`);
        await sendMessage(AGENT_ID, replyMsg.content, replyMsg.channel);
        writeTraceEvent(traceId, { event: 'reply_sent', sent: true });
      } else {
        console.error(`[CC-Sidecar] 回复消息 Schema 校验失败，丢弃`);
        writeTraceEvent(traceId, { event: 'reply_dropped', reason: 'schema_validation_failed' });
      }
    } else {
      console.log(`[CC-Sidecar] 任务完成，无文本输出`);
      writeTraceEvent(traceId, { event: 'done', output: 'empty' });
    }

    await reportStatus(AGENT_ID, 'idle', '空闲中', 0);
    writeTraceEvent(traceId, { event: 'completed', status: 'success' });
  } catch (err) {
    console.error(`[CC-Sidecar] 处理失败: ${err.message}`);
    writeTraceEvent(traceId, { event: 'error', message: err.message });
    
    if (['kk', 'xiaoma', 'xiaoma-ai'].includes(msg.from)) {
      const errorMsg = createMessage({
        from: AGENT_ID,
        fromName: AGENT_NAME,
        content: `[问题] 任务执行失败: ${err.message.substring(0, 100)}`,
        channel: msg.channel || 'group',
      });
      if (errorMsg) {
        await sendMessage(AGENT_ID, errorMsg.content, errorMsg.channel);
      } else {
        await sendMessage(AGENT_ID, `@${msg.from} [问题] 任务执行失败: ${err.message.substring(0, 100)}`);
      }
    }
    await reportStatus(AGENT_ID, 'error', '任务执行失败', 0, { model: CLAUDE_MODEL });
    setTimeout(() => reportStatus(AGENT_ID, 'idle', '空闲中', 0, { model: CLAUDE_MODEL }), 30000);
    writeTraceEvent(traceId, { event: 'completed', status: 'error', message: err.message });
  } finally {
    _processingMessageIds.delete(msg.id);
  }
}

// ── 主流程 ──
async function main() {
  console.log(`[CC-Sidecar] 启动...`);
  console.log(`[CC-Sidecar] 项目目录: ${PROJECT_DIR}`);
  console.log(`[CC-Sidecar] 模型: ${CLAUDE_MODEL}`);
  console.log(`[CC-Sidecar] Claude 路径: ${CLAUDE_PATH}`);

  // ── 自检：验证 execClaude 函数是否完整（防止代码被损坏时无声运行）──
  if (typeof execClaude !== 'function') {
    console.error('[CC-Sidecar] FATAL: execClaude 函数丢失，请检查文件完整性');
    process.exit(1);
  }
  console.log('[CC-Sidecar] 自检通过：execClaude 函数完整');

  // 等待服务器就绪（最多重试 30 秒）
  conn.on('message', handleMessage);
  let connected = false;
  for (let i = 0; i < 10; i++) {
    try {
      await conn.connect();
      connected = true;
      break;
    } catch (e) {
      console.log(`[CC-Sidecar] 服务器未就绪 (${e.message})，${i + 1}/10 重试...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!connected) {
    console.error('[CC-Sidecar] 服务器连接失败，退出');
    process.exit(1);
  }
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

  // 未捕获异常：记录日志但不退出（让 PM2/watchdog 的 restart 策略生效）
  process.on('uncaughtException', (err) => {
    console.error('[CC-Sidecar] uncaughtException:', err.message);
    reportStatus(AGENT_ID, 'error', `异常: ${err.message.substring(0, 50)}`, 0, { model: CLAUDE_MODEL }).catch(() => {});
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[CC-Sidecar] unhandledRejection:', reason);
  });
}

main().catch(err => {
  console.error(`[CC-Sidecar] 启动失败:`, err);
  process.exit(1);
});
