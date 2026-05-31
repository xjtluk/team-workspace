/**
 * CC Agent 接入示例
 *
 * 在 CC（Claude Code）的工作流中引入此模块，即可自动向团队工作室上报状态和消息。
 *
 * 用法：
 *   import { ccAgent } from './sdk/examples/cc-agent.js';
 *   await ccAgent.connect();
 *   // ... 执行任务 ...
 *   await ccAgent.disconnect();
 */

import { createAgent } from '../agent-client.js';

export const ccAgent = createAgent({
  id: 'cc',
  name: 'CC',
  color: '#4A90D9',
  gridFile: 'grids/clawd.js',
});

/**
 * 快捷方法：在 Claude Code 会话中直接调用
 *
 * 示例（在 CC 的工具调用中）：
 *   // 开始工作
 *   await ccAgent.work('正在分析 PRD', 10);
 *
 *   // 更新进度
 *   await ccAgent.work('正在编写技术方案', 50);
 *
 *   // 完成
 *   await ccAgent.idle();
 *
 *   // 发消息给团队
 *   await ccAgent.send('技术方案初稿已完成，请小马 review');
 *
 *   // 执行完整任务（自动管理状态）
 *   await ccAgent.executeTask('编写 Agent SDK', async ({ onProgress }) => {
 *     onProgress(20, '正在设计接口');
 *     // ... 实际工作 ...
 *     onProgress(80, '正在写测试');
 *     // ... ...
 *     return result;
 *   });
 */
