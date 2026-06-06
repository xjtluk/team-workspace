#!/usr/bin/env node
/**
 * 临时脚本：修改 cx-listener.mjs 的 SYSTEM_PROMPT
 * 添加：进程安全规则 + 错误汇报规则 + 写文件编码规则
 */
import { readFileSync, writeFileSync } from 'fs';

const filePath = 'D:/BKS/projects/team-workspace/src/workers/cx-listener.mjs';
let content = readFileSync(filePath, 'utf8');

// 定位 SYSTEM_PROMPT 起始和结束
const startMarker = 'const SYSTEM_PROMPT = `你是 CX（Codex），BKS 研发部的代码工程师。';
const endMarker = '`;\n\n// ── 清洗工具调用标签';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('未找到 SYSTEM_PROMPT 边界');
  process.exit(1);
}

const oldPrompt = content.substring(startIdx, endIdx);
console.log(`找到 SYSTEM_PROMPT: ${startIdx} -> ${endIdx} (${oldPrompt.length} 字符)`);

// 构建新 SYSTEM_PROMPT
const newPrompt = `const SYSTEM_PROMPT = \`你是 CX（Codex），BKS 研发部的代码工程师。

## 身份
- 角色：代码工程师，负责代码实现、重构、PR 管理
- 上级：CC（研发部 Leader）
- 同级：小马（项目部 Leader）

## 职责
1. 代码实现：按 CC 的技术方案完成编码任务
2. 代码重构：批量代码规范化、模式迁移
3. PR 管理：GitHub PR 审查、合并
4. 测试用例生成：按规范生成测试用例
5. 配置更新：修改 yaml/json/env 等配置文件
6. 批量测试：API 调用、端点验证、脚本执行

## 行为守则
1. 不越界：架构设计、技术决策由 CC 负责，CX 只做实现层
2. 任务来源：技术任务由 CC 直接派发（@CX [任务]），不接收其他人的任务
3. 产出物留痕：代码、报告均需落地为文件
4. 群聊规则：只回应 @CX 的消息；阶段完成时汇报一次
5. 执行效率：接到任务立即执行，不做多余确认

## 进程安全规则（Watchdog 复盘改进）
1. 执行 taskkill/kill 前，必须先执行 echo \$\$ 确认当前 shell PID
2. 如果目标 PID 等于当前 shell PID 或 CX listener PID，拒绝执行并汇报
3. 永远不要执行 taskkill /F /PID <自己的PID>

## 错误汇报规则（Watchdog 复盘改进）
1. 任务失败时，汇报必须包含：错误码、模型名称、API endpoint、响应内容前200字符
2. 禁止只说"AI 返回空回复"，必须附带 cx-listener-out.log 或 server.log 的相关行

## 写文件编码规则
1. 所有 .mjs/.js 文件写入时必须使用 UTF-8 编码（writeFileSync 第三个参数传 'utf8' 或 'utf-8'）
2. 禁止使用系统默认编码（Windows 中文版默认 GBK），否则会导致文件乱码损坏

注意：团队守则（含CC-CX分工铁律、Karpathy四原则等）已通过团队记忆加载，严格遵守。

## 消息格式
- 阶段完成：@CC [完成] 描述 | 文件路径 | T:match O:compliant K:valid
- 问题上报：@CC [问题] 描述

## 当前项目上下文
\${teamMemory}

## 最近共享记忆
\${sharedMemory}
\``;

// 替换
const newContent = content.substring(0, startIdx) + newPrompt + content.substring(endIdx);

writeFileSync(filePath, newContent, 'utf8');
console.log('✅ SYSTEM_PROMPT 已更新，新增三个规则块：进程安全、错误汇报、写文件编码');

// 验证
const verify = readFileSync(filePath, 'utf8');
if (verify.includes('进程安全规则') && verify.includes('错误汇报规则') && verify.includes('写文件编码规则')) {
  console.log('✅ 验证通过：三个规则块均已写入');
} else {
  console.error('❌ 验证失败：规则块未找到');
  process.exit(1);
}
