#!/usr/bin/env node
/**
 * 从 Claude Code 会话发送消息到群聊
 *
 * 用法：
 *   node send-to-chat.mjs "消息内容"          # 仅英文/非中文
 *   node send-to-chat.mjs --file <path>       # 从文件读取（推荐，避免编码问题）
 *   node send-to-chat.mjs --from cc "消息内容"
 *   node send-to-chat.mjs --from xiaoma --file <path>
 *
 * 注意：Windows Git Bash 传中文命令行参数会导致编码损坏（U+FFFD 替换字符）。
 *       发送中文消息时，请先写入临时文件，再用 --file 选项发送。
 *       调用者可通过 process.exit code: 0=成功, 1=参数错误, 2=乱码检测
 */
import { readFileSync, unlinkSync } from 'fs';

const args = process.argv.slice(2);
let from = 'cc';
let content = [];
let filePath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && args[i + 1]) {
    from = args[i + 1];
    i++;
  } else if (args[i] === '--file' && args[i + 1]) {
    filePath = args[i + 1];
    i++;
  } else if (args[i] === '--rm') {
    // 发送后删除文件（与 --file 配合使用）
    // 在下面的 finally 块中统一处理
  } else {
    content.push(args[i]);
  }
}

// --file 优先
let message;
if (filePath) {
  try {
    message = readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    console.error(`[错误] 无法读取文件: ${filePath} — ${err.message}`);
    process.exit(1);
  }
  if (!message) {
    console.error('[错误] 文件内容为空');
    process.exit(1);
  }
} else {
  message = content.join(' ');
  if (!message) {
    console.log('用法: node send-to-chat.mjs [--from cc|xiaoma] [--file <path>] [--rm] "消息内容"');
    process.exit(1);
  }
}

const fromName = from === 'cc' ? 'CC' : '小马';

// 检测命令行参数中的中文乱码
function hasGarbledText(text) {
  if (!text) return false;
  return /\?{3,}/.test(text) || /�/u.test(text);
}

async function send() {
  // 乱码检测：命令行直接传入的中文容易损坏
  if (!filePath && hasGarbledText(message)) {
    console.error('[错误] 检测到消息可能包含乱码（U+FFFD 替换字符）');
    console.error('[提示] 中文消息请使用 --file 参数从文件读取:');
    console.error('  echo "消息内容" > /tmp/msg.txt && node send-to-chat.mjs --file /tmp/msg.txt --rm');
    process.exit(2);
  }

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
      console.log(`[发送成功] ${fromName}: ${message.substring(0, 100)}`);
      console.log(`消息 ID: ${data.messageId}`);
    } else {
      console.error('[发送失败]', data);
    }
  } catch (err) {
    console.error('[发送错误]', err.message);
  } finally {
    // --rm: 发送后删除临时文件
    if (filePath && args.includes('--rm')) {
      try { unlinkSync(filePath); } catch {}
    }
  }
}

send();
