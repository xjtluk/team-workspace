/**
 * 小马 Agent — 群聊模式（共享记忆版）
 */
import { createAgent } from '../agent-client.js';
import { generateReply } from '../ai-reply.js';
import { loadTeamMemory, loadChatHistory } from '../memory.js';
import { setCache, getCache } from '../cache.js';
import { getFullMemory } from '../shared-memory.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';

// ── 单实例保护 ──
const PID_FILE = join(process.cwd(), '.xiaoma-listener.pid');

function checkSingleInstance() {
  if (existsSync(PID_FILE)) {
    const oldPid = readFileSync(PID_FILE, 'utf8').trim();
    try {
      process.kill(parseInt(oldPid), 0);
      console.error(`[小马] 错误: xiaoma-listener 已在运行 (PID: ${oldPid})`);
      console.error(`[小马] 如需重启，请先运行: taskkill /F /PID ${oldPid}`);
      process.exit(1);
    } catch {
      // 进程不存在，可以继续
    }
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

checkSingleInstance();

// ── 项目路径（支持命令行参数或环境变量）──
const PROJECT_DIR = process.argv[2] || process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace';
console.log(`[小马] 项目目录: ${PROJECT_DIR}`);

let teamMemory = getCache('team_memory');
if (!teamMemory) {
  teamMemory = loadTeamMemory(PROJECT_DIR);
  setCache('team_memory', teamMemory, 60 * 60 * 1000);
}

const sharedMemory = await getFullMemory(30);
console.log(`[小马] 团队记忆 ${teamMemory.length} 字符，共享记忆 ${sharedMemory.length} 字符`);

const SYSTEM_PROMPT = `你是小马（Marvis），BKS 项目部 Leader。需求分析、产品设计、项目管理。

三人群聊：KK（老板）、CC（研发部 Leader）、小马（你）。

你的团队记忆：
${teamMemory}

最近发生的事件（包括你在群聊外的工作）：
${sharedMemory}

你的工具能力：bash、read_file、write_file、list_files、search_code。
重要：只有在 KK 明确要求你执行具体任务（如"帮我写个代码"、"查看某个文件"、"运行某个命令"）时才使用工具。对于问候、讨论、问题回复等日常对话，直接用文字回复，不要调用任何工具。

## 行为规则
1. 收到 KK 的消息，判断是否和你相关，相关就回复
2. 收到 @小马 的消息，必须评估并回复
3. 收到 @CC 的消息，不要回复（那是给 CC 的）
4. 其他消息可以 SKIP
5. 同一件事只回复一次，不要重复

## 任务执行规则
- KK 说"做 XXX"，如果可行，直接用工具执行
- 执行过程中需要 CC 配合，在消息里 @CC 说明需求
- 执行完成后，汇报结果
- 遇到问题，说明具体卡点

## 输出格式（严格遵守）
- 只用中文回复，不要出现英文、代码片段、随机字符串
- 回复简洁，1-3 句话，不要长篇大论
- 不要输出思考过程、分析步骤、内部标记
- 直接说结论和行动，不要解释推理

## 协作规则
- 需要 CC 配合时，用 @CC 开头
- 讨论产品方案时，直接说重点
- 不要每次问候，直接回应内容

## 特殊情况
- 如果任务超出你的能力范围（如复杂的 PRD 编写、深度分析、需要调用外部服务），在回复开头加上 [需要小马处理]
- 日常对话、简单问题、状态汇报不需要标记
- 群聊就是通知系统：处理不了的消息在群里说一声就行，KK 自然能看到

记住：你是产品负责人，有任务就执行，有问题就讨论，有结果就汇报。超出能力范围的，标记 [需要小马处理]，群聊会通知 KK 唤醒真实的你。`;

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
console.log('[小马] Agent 注册完成');

const chatHistory = [];
const historyMsgs = await loadChatHistory(30);
historyMsgs.forEach(m => chatHistory.push({ role: m.from, name: m.fromName, content: m.content }));
console.log(`[小马] 加载了 ${historyMsgs.length} 条历史消息`);

let lastReplyTime = 0;
const COOLDOWN = 5000;
const recentMsgKeys = new Set();

const ws = new WebSocket('ws://localhost:3210/ws');
ws.on('open', () => console.log('[小马] WebSocket 已连接'));

ws.on('message', async (raw) => {
  const event = JSON.parse(raw);
  if (event.type !== 'new_message') return;
  const msg = event.payload;
  if (msg.from === 'xiaoma') return;

  // 去重（用消息 ID）
  if (recentMsgKeys.has(msg.id)) return;
  recentMsgKeys.add(msg.id);
  if (recentMsgKeys.size > 50) {
    const arr = Array.from(recentMsgKeys);
    arr.splice(0, 25);
    recentMsgKeys.clear();
    arr.forEach(k => recentMsgKeys.add(k));
  }

  chatHistory.push({ role: msg.from, name: msg.fromName, content: msg.content });
  if (chatHistory.length > 30) chatHistory.shift();

  // 如果 @CC 且没有 @小马，跳过
  if (/@CC/i.test(msg.content) && !/@(小马|xiaoma)/i.test(msg.content)) return;

  const now = Date.now();
  if (now - lastReplyTime < COOLDOWN) return;

  const recent = chatHistory.slice(-6).map(m => `${m.name}: ${m.content}`).join('\n');
  const prompt = `${recent}\n\n${msg.fromName}："${msg.content}"\n\n你需要回复吗？如果消息和你无关，回复 [SKIP]。如果需要执行任务或参与讨论，直接回复。`;

  // 判断是否需要工具：必须是明确的执行指令，不是讨论
  const needsTool = /(?:帮我(?:写|创建|修改|删除|安装|部署|执行|运行|查看|读取|搜索|查找)|(?:执行|运行|部署|安装)(?:一下|命令|脚本|测试)|(?:写|创建|修改|删除)(?:一个|这个|文件|代码|脚本|配置))/i.test(msg.content);

  try {
    await xiaoma.work('正在思考...', 30);
    const reply = await generateReply(SYSTEM_PROMPT, chatHistory.slice(-6, -1), prompt, needsTool);
    const clean = reply.trim();
    if (clean.includes('[SKIP]') || clean === 'SKIP' || clean.length < 2 || clean.includes('工具调用轮次已达上限')) { await xiaoma.idle(); return; }

    // 检查是否标记为需要真实小马处理
    if (clean.includes('[需要小马处理]') || clean.includes('需要小马处理')) {
      // 在群聊里直接通知，KK 看到后会唤醒 Marvis
      await xiaoma.send(`@小马 需要处理: ${msg.content.substring(0, 100)}`);
      await xiaoma.idle();
      return;
    }

    // 移除 AI 可能添加的名字前缀
    const finalReply = clean.replace(/^(?:小马|xiaoma)[：:]\s*/i, '');
    await xiaoma.send(finalReply);
    await xiaoma.idle();
    lastReplyTime = now;
    chatHistory.push({ role: 'xiaoma', name: '小马', content: finalReply });
    console.log(`[小马] ${clean.substring(0, 80)}`);
  } catch (err) {
    console.error('[小马] AI 错误:', err.message);
    await xiaoma.idle();
  }
});

process.on('SIGINT', async () => {
  await xiaoma.disconnect();
  ws.close();
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

process.on('exit', () => {
  try { unlinkSync(PID_FILE); } catch {}
});
