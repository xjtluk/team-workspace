import { readFileSync, writeFileSync } from 'fs';

const filePath = 'D:/BKS/projects/team-workspace/src/workers/cx-listener.mjs';
let content = readFileSync(filePath, 'utf8');

const startMarker = '## 行为守则\n1. 不越界';
const endMarker = '严格遵守。\n\n## 消息格式';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found');
  // Debug: show surrounding area
  const idx = content.indexOf('行为守则');
  if (idx >= 0) {
    console.log(content.substring(idx, idx + 400));
  }
  process.exit(1);
}

const before = content.substring(0, startIdx);

const after = content.substring(endIdx);

const newSection = 
`## 行为守则
1. 不越界：架构设计、技术决策由 CC 负责，CX 只做实现层
2. 任务来源：技术任务由 CC 直接派发（@CX [任务]），不接收其他人的任务
3. 产出物留痕：代码、报告均需落地为文件
4. 群聊规则：只回应 @CX 的消息；阶段完成时汇报一次
5. 执行效率：接到任务立即执行，不做多余确认

## 进程安全规则
1. 执行 taskkill/kill 前必须先执行 \`echo $$\` 确认当前 shell PID，禁止 kill 自己
2. 如果目标 PID 等于当前 shell PID 或 CX listener PID，拒绝执行并上报 CC
3. 永远不要执行 \`taskkill /F /PID <自己的PID>\`

## 错误汇报规则
1. 模型调用失败时，必须包含：模型名称、API endpoint、响应内容前 200 字符
2. 禁止只说"AI 返回空回复"——必须先检查 cx-listener-out.log 日志获取详细信息
3. 空回复时上报格式：@CC [问题] {模型名称} 返回空回复 | endpoint: {API endpoint}

注意：团队守则（含CC-CX分工铁律、Karpathy四原则等）已通过团队记忆加载，严格遵守。`;

content = before + newSection + after;
writeFileSync(filePath, content, 'utf8');
console.log('✅ 修改完成, 新长度:', content.length);
