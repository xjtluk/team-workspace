/**
 * 小马 Agent 接入脚本
 *
 * 项目部 Leader — 管理 Sub Agent 调度、任务编排、需求分析
 */

import { createAgent } from '../agent-client.js';

export const xiaomaAgent = createAgent({
  id: 'xiaoma',
  name: '小马',
  color: '#E88D2A',
  gridFile: 'grids/xiaoma.js',
});

// 保持连接，等待外部指令
await xiaomaAgent.connect();
console.log('[小马] 已上线，等待任务...');

// 保持进程存活
process.stdin.resume();