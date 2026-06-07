/**
 * CC 发消息工具 — 解决 Windows curl 编码问题
 *
 * 用法：
 *   node scripts/send-message.mjs --to cx --content "你好"
 *   node scripts/send-message.mjs --to kk --content "@KK [完成] 任务已完成"
 */

import { parseArgs } from 'node:util';

const SERVER_URL = 'http://localhost:3210';

const { values } = parseArgs({
  options: {
    to: { type: 'string', default: '' },
    content: { type: 'string' },
    channel: { type: 'string', default: 'group' },
  },
});

if (!values.content) {
  console.error('用法: node send-message.mjs --to <agent> --content <消息>');
  process.exit(1);
}

const payload = {
  content: values.content,
  from: 'cc',
  to: values.to || undefined,
  channel: values.channel,
};

try {
  const res = await fetch(`${SERVER_URL}/api/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`消息已发送 (ID: ${data.messageId})`);
  } else {
    console.error(`发送失败: ${JSON.stringify(data)}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`发送异常: ${e.message}`);
  process.exit(1);
}
