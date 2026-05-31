import { Router } from 'express';
import { queryOne, run } from '../db.js';
import { broadcast } from '../ws/handler.js';

const router = Router();

router.post('/', (req, res) => {
  const { id, name, agentType = 'agent', color = '#4A90D9', gridFile = null } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' });
  }

  const existing = queryOne('SELECT id FROM agents WHERE id = ?', [id]);
  if (existing) {
    return res.status(409).json({ error: `Agent '${id}' already exists` });
  }

  const now = Date.now();

  run(
    `INSERT INTO agents (id, name, agent_type, color, grid_file, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, agentType, color, gridFile, now]
  );

  broadcast({
    type: 'agent_registered',
    payload: { id, name, agentType, color, gridFile },
  });

  res.json({ ok: true, agent: { id, name, agent_type: agentType, color, grid_file: gridFile } });
});

export default router;
