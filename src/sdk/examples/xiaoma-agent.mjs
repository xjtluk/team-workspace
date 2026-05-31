/**
 * 小马 Agent — 带 WebSocket 监听的完整接入
 * 能收消息、能发消息、能上报状态、能调度 Sub Agent
 */
import { createAgent } from '../agent-client.js';
import WebSocket from 'ws';

const xiaoma = createAgent({ id: 'xiaoma', name: '小马', color: '#E88D2A' });
await xiaoma.connect();
console.log('[小马] 已上线，正在监听群聊...');

// WebSocket 连接
const ws = new WebSocket('ws://localhost:3210/ws');

ws.on('open', () => {
  console.log('[小马] WebSocket 已连接');
});

ws.on('message', (raw) => {
  const event = JSON.parse(raw);

  if (event.type === 'new_message') {
    const msg = event.payload;
    if (msg.from === 'xiaoma') return;

    console.log(`[小马 收到] ${msg.fromName}: ${msg.content}`);
    handleMessage(msg);
  }
});

async function handleMessage(msg) {
  const content = msg.content;

  // 问候
  if (/你好|hi|hello/i.test(content)) {
    await xiaoma.send('你好！我是小马，项目部 Leader。负责需求分析、任务调度和跨部门协调。');
    return;
  }

  // 状态查询
  if (/状态|在做什么|忙什么/i.test(content)) {
    await xiaoma.send('我当前在线，正在协助 KK 推进团队工作室项目 P3 验收。');
    return;
  }

  // 提到 CC
  if (/CC|研发部|技术/i.test(content)) {
    await xiaoma.send('CC 是研发部 Leader，负责技术方案和编码。他现在应该也在线，可以直接在群里 @ 他。');
    return;
  }

  // 项目进度
  if (/进度|进展|到哪/i.test(content)) {
    await xiaoma.send('团队工作室项目：P0 ✅ 基础搭建、P1 ✅ 核心功能、P2 ✅ Agent 接入、P3 🔴 打磨验收中。CC 刚修了 ChatPanel，正在做最后联调。');
    return;
  }

  // 默认回复
  await xiaoma.send(`收到。我是项目部 Leader，需要我做需求分析、文档整理或调度 Sub Agent 的话尽管说。`);
}

process.on('SIGINT', async () => {
  console.log('[小马] 正在离线...');
  await xiaoma.disconnect();
  ws.close();
  process.exit(0);
});