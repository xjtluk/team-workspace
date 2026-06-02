import { Router } from 'express';
import { query, queryOne } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const agents = query('SELECT * FROM agents');
  res.json(agents.map(a => ({
    id: a.id,
    name: a.name,
    agent_type: a.agent_type,
    color: a.color,
    grid_file: a.grid_file,
    current_status: a.current_status,
    current_activity: a.current_activity,
    progress: a.progress,
    location: a.location,
    online: !!a.online,
    last_seen: a.last_seen,
  })));
});

// Marvis 状态查询（低延迟专用端点）
router.get('/marvis/status', (req, res) => {
  const marvis = queryOne('SELECT online, last_seen, current_status FROM agents WHERE id = ?', ['xiaoma']);
  if (!marvis) {
    return res.json({ online: false, lastSeen: 0, status: 'offline' });
  }
  res.json({
    online: !!marvis.online,
    lastSeen: marvis.last_seen,
    status: marvis.current_status,
  });
});

export default router;
