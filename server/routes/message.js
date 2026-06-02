import { Router } from 'express';
import { queryOne, query, run } from '../db.js';
import { broadcast } from '../ws/handler.js';

const router = Router();

// 验证 channel 枚举值
const VALID_CHANNELS = ['group', 'dm', 'system'];

router.post('/', (req, res) => {
  const { from, content, type = 'text', channel = 'group', replyTo = null } = req.body;

  if (!from || !content) {
    return res.status(400).json({ error: 'from and content are required' });
  }

  // 验证 channel
  const validChannel = VALID_CHANNELS.includes(channel) ? channel : 'group';

  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [from]);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const now = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const messageId = `msg_${now}_${from}_${rand}`;

  run(
    `INSERT INTO messages (id, from_id, from_name, content, type, channel, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [messageId, from, agent.name, content, type, validChannel, replyTo, now]
  );

  // 处理离线队列
  const offlineAgents = query('SELECT id FROM agents WHERE online = 0 AND id != ?', [from]);
  offlineAgents.forEach(a => {
    run('INSERT INTO offline_queue (to_id, message_id, created_at) VALUES (?, ?, ?)', [a.id, messageId, now]);
  });

  broadcast({
    type: 'new_message',
    payload: {
      id: messageId,
      from,
      fromName: agent.name,
      content,
      type,
      channel: validChannel,
      timestamp: now,
      replyTo,
    },
  });

  res.json({ ok: true, messageId, timestamp: now });
});

export default router;
