/**
 * CC Agent — 带 WebSocket 监听的完整接入
 * 能收消息、能发消息、能上报状态
 */
import { createAgent } from '../agent-client.js';
import WebSocket from 'ws';

const cc = createAgent({ id: 'cc', name: 'CC', color: '#4A90D9' });
await cc.connect();
console.log('[CC] 已上线，正在监听群聊...');

// WebSocket 连接，用于接收消息
const ws = new WebSocket('ws://localhost:3210/ws');

ws.on('open', () => {
  console.log('[CC] WebSocket 已连接');
});

ws.on('message', (raw) => {
  const event = JSON.parse(raw);

  if (event.type === 'new_message') {
    const msg = event.payload;
    // 忽略自己发的消息
    if (msg.from === 'cc') return;

    console.log(`[CC 收到] ${msg.fromName}: ${msg.content}`);

    // 如果是 KK 发的消息，回复
    if (msg.from === 'kk') {
      handleKKMessage(msg);
    }
  }
});

// 回复 KK 的消息
async function handleKKMessage(msg) {
  const content = msg.content.toLowerCase();

  // 简单的关键词回复，展示交互能力
  if (content.includes('你好') || content.includes('hi') || content.includes('hello')) {
    await cc.send('你好 KK！我是 CC，研发部 Leader。有什么需要我做的？');
  } else if (content.includes('状态') || content.includes('在做什么')) {
    await cc.send('我当前在线待命，随时可以接任务。');
  } else if (content.includes('小马')) {
    await cc.send('小马应该也在线，你可以 @ 他。');
  } else {
    await cc.send(`收到你的消息："${msg.content}"。我是自动化 Agent，目前只能做简单回复。复杂任务需要通过 Claude Code 会话派发给我。`);
  }
}

// 保持进程存活
process.on('SIGINT', async () => {
  console.log('[CC] 正在离线...');
  await cc.disconnect();
  ws.close();
  process.exit(0);
});
