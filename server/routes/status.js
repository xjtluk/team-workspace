import { Router } from 'express';
import { queryOne, run } from '../db.js';
import { broadcastStatusChange } from '../ws/handler.js';

const router = Router();

router.post('/', (req, res) => {
  const { agentId, status, activity = '', progress = 0, location } = req.body;

  if (!agentId || !status) {
    return res.status(400).json({ error: 'agentId and status are required' });
  }

  const validStatuses = ['idle', 'working', 'talking', 'error', 'offline'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found. Register first via POST /api/register' });
  }

  const resolvedLocation = location || (status === 'idle' || status === 'offline' ? 'sofa' : status === 'error' ? 'bug' : 'desk');
  const now = Date.now();

  run(
    `UPDATE agents SET current_status = ?, current_activity = ?, progress = ?, location = ?, online = 1, last_seen = ? WHERE id = ?`,
    [status, activity, progress, resolvedLocation, now, agentId]
  );

  run(
    `INSERT INTO status_log (agent_id, status, activity, progress, location, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [agentId, status, activity, progress, resolvedLocation, now]
  );

  broadcastStatusChange(agentId, status, activity, progress, resolvedLocation);

  res.json({ ok: true, timestamp: now });
});

export default router;
