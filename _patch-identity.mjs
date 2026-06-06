import { readFileSync, writeFileSync } from 'fs';

const path = 'D:/BKS/projects/team-workspace/src/workers/cx-listener.mjs';
let content = readFileSync(path, 'utf8');

// 1. 在 "构建 prompt" 块前插入 identityReminder
const oldBuildBlock = `    // 构建 prompt
    let prompt = '';

    if (MSG_PROTOCOL.CODE_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.CODE_TASK);
      prompt = \`CC 派发了代码任务（需要高质量实现）：\${match[1]}\\n\\n请执行任务，完成后回复 @CC [完成] 并附上文件路径。\`;
    } else if (MSG_PROTOCOL.DAILY_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.DAILY_TASK);
      prompt = \`CC 派发了日常任务：\${match[1]}\\n\\n请执行任务，完成后回复 @CC [完成] 并附上文件路径。\`;
    } else if (MSG_PROTOCOL.DELEGATE.test(content)) {
      const match = content.match(MSG_PROTOCOL.DELEGATE);
      prompt = \`CC 内部委托：\${match[1]}\\n\\n请执行委托，完成后回复 @CC [完成]。\`;
    } else {
      prompt = \`@CX 的消息：\${content}\\n\\n请根据上下文回复。\`;
    }`;

const newBuildBlock = `    // 构建 prompt（注入身份提醒）
    const identityReminder = \`你是 CX，代码工程师。接到任务必须先在群里通知 "收到，开始执行: ..."。完成后必须回复 @CC [完成]。\`;
    let prompt = '';

    if (MSG_PROTOCOL.CODE_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.CODE_TASK);
      prompt = \`\${identityReminder}\\n\\nCC 派发了代码任务（需要高质量实现）：\${match[1]}\\n\\n请先在群里通知收到，然后执行任务，完成后回复 @CC [完成] 并附上文件路径。\`;
    } else if (MSG_PROTOCOL.DAILY_TASK.test(content)) {
      const match = content.match(MSG_PROTOCOL.DAILY_TASK);
      prompt = \`\${identityReminder}\\n\\nCC 派发了日常任务：\${match[1]}\\n\\n请先在群里通知收到，然后执行任务，完成后回复 @CC [完成] 并附上文件路径。\`;
    } else if (MSG_PROTOCOL.DELEGATE.test(content)) {
      const match = content.match(MSG_PROTOCOL.DELEGATE);
      prompt = \`\${identityReminder}\\n\\nCC 内部委托：\${match[1]}\\n\\n请先在群里通知收到，然后执行委托，完成后回复 @CC [完成]。\`;
    } else {
      prompt = \`\${identityReminder}\\n\\n@CX 的消息：\${content}\\n\\n请根据上下文回复。\`;
    }`;

if (content.includes(oldBuildBlock)) {
  content = content.replace(oldBuildBlock, newBuildBlock);
  writeFileSync(path, content, 'utf8');
  console.log('OK');
} else {
  console.log('FAIL: old block not found. Searching...');
  const idx = content.indexOf('// 构建 prompt');
  if (idx >= 0) {
    console.log('Found at', idx);
    console.log('---');
    console.log(content.substring(idx, idx + 700));
  } else {
    console.log('"// 构建 prompt" not found');
  }
}