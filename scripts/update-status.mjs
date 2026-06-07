/**
 * CC 状态上报工具 — 让前端显示CC在工作
 *
 * 用法：
 *   node scripts/update-status.mjs --status working --activity "正在审查代码"
 *   node scripts/update-status.mjs --status idle --activity "空闲中"
 */

import { parseArgs } from 'node:util';

const SERVER_URL = 'http://localhost:3210';

const { values } = parseArgs({
  options: {
    status: { type: 'string', default: 'idle' },
    activity: { type: 'string', default: '空闲中' },
    progress: { type: 'string', default: '0' },
  },
});

const payload = {
  agentId: 'cc',
  status: values.status,
  activity: values.activity,
  progress: parseInt(values.progress),
};

try {
  const res = await fetch(`${SERVER_URL}/api/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`状态已更新: ${values.status} - ${values.activity}`);
  } else {
    console.error(`更新失败: ${JSON.stringify(data)}`);
  }
} catch (e) {
  console.error(`更新异常: ${e.message}`);
}
