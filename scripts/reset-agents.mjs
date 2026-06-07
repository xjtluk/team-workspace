#!/usr/bin/env node
/**
 * Reset Agent Status
 *
 * Resets all agent statuses to idle and clears offline message queues.
 * Used for recovery after crashes or stuck states.
 *
 * Usage:
 *   node scripts/reset-agents.mjs           # reset all agents
 *   node scripts/reset-agents.mjs cx        # reset specific agent
 *   node scripts/reset-agents.mjs --status  # show current status only
 */

const SERVER_URL = 'http://127.0.0.1:3210';

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

async function getAgents() {
  return fetchJSON('/api/agents');
}

async function resetAgent(agentId) {
  const body = JSON.stringify({
    agentId,
    status: 'idle',
    activity: '空闲中',
    progress: 0,
    model: agentId === 'cc' ? 'claude-sonnet-4-6' : agentId === 'cx' ? 'deepseek-v4-pro' : '',
  });

  const res = await fetch(`${SERVER_URL}/api/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const targetAgent = args.find(a => !a.startsWith('--'));

  console.log('=== Agent Status ===\n');

  let agents;
  try {
    agents = await getAgents();
  } catch (e) {
    console.error(`无法连接服务器 (${SERVER_URL}): ${e.message}`);
    console.error('请先启动服务器: npm run dev:server');
    process.exit(1);
  }

  // Display current status
  const activeAgents = agents.filter(a => ['cc', 'cx', 'xiaoma'].includes(a.id));
  for (const a of activeAgents) {
    const status = a.online ? `online (${a.current_status})` : 'offline';
    console.log(`  ${a.id}: ${status} | model: ${a.model || 'none'} | last_seen: ${a.last_seen ? new Date(a.last_seen).toLocaleString('zh-CN') : 'never'}`);
  }

  if (statusOnly) {
    process.exit(0);
  }

  // Reset agents
  console.log('\n=== Resetting ===\n');

  const toReset = targetAgent
    ? activeAgents.filter(a => a.id === targetAgent)
    : activeAgents.filter(a => a.online && a.current_status !== 'idle');

  if (toReset.length === 0) {
    if (targetAgent) {
      console.log(`Agent "${targetAgent}" 未找到或已是idle状态`);
    } else {
      console.log('所有agent已是idle状态，无需重置');
    }
    process.exit(0);
  }

  for (const a of toReset) {
    const result = await resetAgent(a.id);
    console.log(`  ${a.id}: ${result.ok ? '已重置为idle' : '重置失败'}`);
  }

  console.log('\n完成。离线消息队列会随sidecar重启自动清空（内存队列）。');
  console.log('如需重启sidecar: node scripts/watchdog-sidecar.mjs');
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
