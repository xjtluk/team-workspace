#!/usr/bin/env node
/**
 * 看门狗超时动态调整补丁 — 任务2
 * 替换固定的 WATCHDOG_TIMEOUT 为动态设置
 */
import fs from 'fs';

const filePath = 'D:/BKS/projects/team-workspace/src/workers/cx-listener.mjs';
let content = fs.readFileSync(filePath, 'utf8');

// 要替换的旧代码块（从 // 看门狗 到 setInterval 结束）
const oldBlock = `// 看门狗：必须大于 ai-reply.js 的 TASK_TIMEOUT（默认300s），否则会误杀正常任务
const WATCHDOG_TIMEOUT = parseInt(process.env.AI_TASK_TIMEOUT) || 300000;
const WATCHDOG_GRACE = 30000;
setInterval(() => {
  if (isProcessing && Date.now() - processingStartTime > WATCHDOG_TIMEOUT + WATCHDOG_GRACE) {
    console.error(\`[CX] 消息处理卡死超过 \${Math.round((WATCHDOG_TIMEOUT + WATCHDOG_GRACE)/1000)}秒，强制重置 isProcessing\`);
    isProcessing = false;
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}, 30000);`;

const newBlock = `// 看门狗：动态超时，根据任务复杂度调整
// 简单任务120s / 代码任务300s / 批量任务600s
const WATCHDOG_GRACE = 30000;
let currentWatchdogTimeout = 120000; // 默认120s

// 根据消息内容判断任务复杂度并设置超时
function setWatchdogTimeout(content) {
  if (/批量|batch|大量|全部|所有文件|全量|所有项目/i.test(content)) {
    currentWatchdogTimeout = 600000; // 批量600s
  } else if (/@CX\\s*\\[代码\\]/i.test(content)) {
    currentWatchdogTimeout = 300000; // 代码300s
  } else {
    currentWatchdogTimeout = 120000; // 简单120s
  }
  console.log(\`[CX] 看门狗超时: \${Math.round(currentWatchdogTimeout/1000)}秒 (\${currentWatchdogTimeout === 600000 ? '批量' : currentWatchdogTimeout === 300000 ? '代码' : '简单'}任务)\`);
}

setInterval(() => {
  if (isProcessing && Date.now() - processingStartTime > currentWatchdogTimeout + WATCHDOG_GRACE) {
    console.error(\`[CX] 消息处理卡死超过 \${Math.round((currentWatchdogTimeout + WATCHDOG_GRACE)/1000)}秒，强制重置 isProcessing\`);
    isProcessing = false;
    if (pendingMessages.length > 0) {
      const nextMsg = pendingMessages.shift();
      handleMessage(JSON.stringify({ type: 'new_message', payload: nextMsg }));
    }
  }
}, 30000);`;

const idx = content.indexOf(oldBlock);
if (idx === -1) {
  console.error('❌ 未找到旧看门狗代码块');
  // 调试输出附近内容
  const lines = content.split('\n');
  for (let i = 262; i < 282; i++) {
    console.log(`${i+1}: ${lines[i]}`);
  }
  process.exit(1);
}

content = content.replace(oldBlock, newBlock);
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ 看门狗已改为动态超时');
