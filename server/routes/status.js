import { Router } from 'express';
import { queryOne, query, run } from '../db.js';
import { broadcastStatusChange } from '../ws/handler.js';

const router = Router();

router.post('/', (req, res) => {
  const { agentId, status, activity = '', progress = 0, location, model } = req.body;

  if (!agentId || !status) {
    return res.status(400).json({ error: 'agentId and status are required' });
  }

  const validStatuses = ['idle', 'working', 'talking', 'thinking', 'error', 'offline'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found. Register first via POST /api/register' });
  }

  // 榛樿浣嶇疆锛氭瘡涓?agent 鏈夎嚜宸辩殑宸ヤ綅
  const agentHome = { cc: 'cc_desk', xiaoma: 'xm_desk' };
  const resolvedLocation = location || agentHome[agentId] || 'xm_desk';
  const now = Date.now();

  run(
    `UPDATE agents SET current_status = ?, current_activity = ?, progress = ?, location = ?, online = 1, last_seen = ? WHERE id = ?`,
    [status, activity, progress, resolvedLocation, now, agentId]
  );

  // 濡傛灉鎻愪緵浜?model锛屽崟鐙洿鏂?
  if (model) {
    run(`UPDATE agents SET model = ? WHERE id = ?`, [model, agentId]);
  }

  run(
    `INSERT INTO status_log (agent_id, status, activity, progress, location, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [agentId, status, activity, progress, resolvedLocation, now]
  );

  broadcastStatusChange(agentId, status, activity, progress, resolvedLocation, model);

  res.json({ ok: true, timestamp: now });
});


// PUT /api/status — 状态联动：根据 taskId 更新任务状态
router.put('/', (req, res) => {
  const { agentId, activity, taskId } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  const now = Date.now();

  // 直接按 taskId 精确更新任务状态
  const result = run("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?", [now, taskId]);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Task not found or already completed' });
  }

  // 同时更新 agent 的 current_activity
  if (activity) {
    run("UPDATE agents SET current_activity = ? WHERE id = ?", [activity, agentId]);
  }

  res.json({ ok: true, taskId, updated: result.changes });
});
export default router;
