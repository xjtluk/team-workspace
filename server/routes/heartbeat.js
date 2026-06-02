import { Router } from 'express';
import { queryOne, query, run } from '../db.js';
import { broadcast } from '../ws/handler.js';

const router = Router();

const HEARTBEAT_TIMEOUT = 60000; // 60 秒

router.post('/', (req, res) => {
  const { agentId, lastSeenTimestamp } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const now = Date.now();

  // 更新在线状态
  run('UPDATE agents SET online = 1, last_seen = ? WHERE id = ?', [now, agentId]);

  // 处理离线队列
  const pending = queryOne('SELECT COUNT(*) as count FROM offline_queue WHERE to_id = ? AND delivered = 0', [agentId]);
  run('UPDATE offline_queue SET delivered = 1 WHERE to_id = ? AND delivered = 0', [agentId]);

  // 广播上线状态
  broadcast({
    type: 'agent_online',
    payload: { agentId, online: true },
  });

  // 查询新消息（自上次心跳以来）
  let newMessages = [];
  if (lastSeenTimestamp) {
    newMessages = query(
      `SELECT id, from_id, from_name, content, type, created_at
       FROM messages
       WHERE created_at > ? AND from_id != ?
       ORDER BY created_at ASC
       LIMIT 50`,
      [lastSeenTimestamp, agentId]
    ).map(msg => ({
      id: msg.id,
      from: msg.from_id,
      fromName: msg.from_name,
      content: msg.content,
      type: msg.type,
      timestamp: msg.created_at,
    }));
  }

  res.json({
    ok: true,
    pendingMessages: pending ? pending.count : 0,
    newMessages,
    serverTimestamp: now,
  });
});

// 心跳超时检测 — 每 15 秒检查一次
export function startHeartbeatMonitor() {
  setInterval(() => {
    const now = Date.now();
    const offlineAgents = query(
      'SELECT id FROM agents WHERE online = 1 AND agent_type = ? AND last_seen < ?',
      ['agent', now - HEARTBEAT_TIMEOUT]
    );

    offlineAgents.forEach(agent => {
      run('UPDATE agents SET online = 0, current_status = ? WHERE id = ?', ['offline', agent.id]);
      broadcast({
        type: 'agent_offline',
        payload: { agentId: agent.id, online: false },
      });
      console.log(`[Heartbeat] Agent ${agent.id} marked offline (no heartbeat for ${HEARTBEAT_TIMEOUT / 1000}s)`);
    });
  }, 15000);
}

export default router;
