/**
 * SDK 联调测试脚本
 * 模拟 CC Agent 的完整工作流程
 */
import { createAgent } from './src/sdk/agent-client.js';

const cc = createAgent({
  id: 'cc',
  name: 'CC',
  color: '#4A90D9',
  gridFile: 'grids/clawd.js',
});

async function main() {
  console.log('--- 1. connect ---');
  const r1 = await cc.connect();
  console.log('connected:', r1);

  console.log('--- 2. work 30% ---');
  const r2 = await cc.work('正在编写 Agent SDK', 30);
  console.log('status:', r2);

  console.log('--- 3. send message ---');
  const r3 = await cc.send('SDK 联调测试中，状态上报正常');
  console.log('message:', r3);

  console.log('--- 4. work 80% ---');
  const r4 = await cc.work('正在验证心跳保活', 80);
  console.log('status:', r4);

  console.log('--- 5. idle ---');
  const r5 = await cc.idle();
  console.log('idle:', r5);

  console.log('--- 6. executeTask ---');
  const r6 = await cc.executeTask('测试 executeTask 封装', async ({ onProgress }) => {
    onProgress(50, '进度 50%');
    await new Promise(r => setTimeout(r, 500));
    onProgress(100, '完成');
    return 'task-done';
  });
  console.log('executeTask result:', r6);

  console.log('--- 7. disconnect ---');
  await cc.disconnect();
  console.log('disconnected');

  console.log('\n✅ SDK 联调测试全部通过');
}

main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
