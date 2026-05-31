import { Router } from 'express';
import { queryOne, query, run } from '../db.js';
import { broadcast } from '../ws/handler.js';

const router = Router();

const HEARTBEAT_TIMEOUT = 60000; // 60 秒

router.post('/', (req, res) => {
  const { agentId } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const now = Date.now();

  run('UPDATE agents SET online = 1, last_seen = ? WHERE id = ?', [now, agentId]);

  const pending = queryOne('SELECT COUNT(*) as count FROM offline_queue WHERE to_id = ? AND delivered = 0', [agentId]);

  run('UPDATE offline_queue SET delivered = 1 WHERE to_id = ? AND delivered = 0', [agentId]);

  broadcast({
    type: 'agent_online',
    payload: { agentId, online: true },
  });

  res.json({ ok: true, pendingMessages: pending ? pending.count : 0 });
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
