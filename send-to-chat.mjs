#!/usr/bin/env node
/**
 * 从 Claude Code 会话发送消息到群聊
 *
 * 用法：
 *   node send-to-chat.mjs "消息内容"
 *   node send-to-chat.mjs "@小马 帮我出个 PRD"
 *   node send-to-chat.mjs --from cc "消息内容"
 *   node send-to-chat.mjs --from xiaoma "消息内容"
 */
const args = process.argv.slice(2);
let from = 'cc';  // 默认从 CC 发送
let content = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && args[i + 1]) {
    from = args[i + 1];
    i++;
  } else {
    content.push(args[i]);
  }
}

const message = content.join(' ');
if (!message) {
  console.log('用法: node send-to-chat.mjs [--from cc|xiaoma] "消息内容"');
  process.exit(1);
}

const fromName = from === 'cc' ? 'CC' : '小马';

async function send() {
  try {
    const res = await fetch('http://localhost:3210/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        fromName,
        content: message,
        type: 'text',
      }),
    });

    const data = await res.json();
    if (data.ok) {
      console.log(`[发送成功] ${fromName}: ${message}`);
      console.log(`消息 ID: ${data.messageId}`);
    } else {
      console.error('[发送失败]', data);
    }
  } catch (err) {
    console.error('[发送错误]', err.message);
  }
}

send();
