import { Router } from 'express';
import { query } from '../db.js';

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

export default router;
