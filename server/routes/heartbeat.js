import { Router } from 'express';
import { queryOne, run } from '../db.js';
import { broadcast } from '../ws/handler.js';

const router = Router();

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

export default router;
