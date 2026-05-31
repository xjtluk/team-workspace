import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before || null;

  let messages;
  if (before) {
    messages = query(
      `SELECT * FROM messages WHERE created_at < (SELECT created_at FROM messages WHERE id = ?) ORDER BY created_at DESC LIMIT ?`,
      [before, limit]
    );
  } else {
    messages = query(
      `SELECT * FROM messages ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
  }

  messages.reverse();

  const result = messages.map(m => ({
    id: m.id,
    from: m.from_id,
    fromName: m.from_name,
    content: m.content,
    type: m.type,
    timestamp: m.created_at,
    replyTo: m.reply_to,
  }));

  const hasMore = messages.length === limit;

  res.json({ messages: result, hasMore });
});

export default router;
