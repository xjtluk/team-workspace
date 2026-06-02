import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// 验证 channel 枚举值
const VALID_CHANNELS = ['group', 'dm', 'system'];

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before || null;
  const since = req.query.since ? parseInt(req.query.since) : null;
  const channel = req.query.channel || null;

  // 验证 channel 参数
  const validChannel = channel && VALID_CHANNELS.includes(channel) ? channel : null;

  let messages;
  if (since && validChannel) {
    messages = query(
      `SELECT * FROM messages WHERE created_at > ? AND channel = ? ORDER BY created_at ASC LIMIT ?`,
      [since, validChannel, limit]
    );
  } else if (since) {
    messages = query(
      `SELECT * FROM messages WHERE created_at > ? ORDER BY created_at ASC LIMIT ?`,
      [since, limit]
    );
  } else if (before && validChannel) {
    messages = query(
      `SELECT * FROM messages WHERE created_at < (SELECT created_at FROM messages WHERE id = ?) AND channel = ? ORDER BY created_at DESC LIMIT ?`,
      [before, validChannel, limit]
    );
  } else if (before) {
    messages = query(
      `SELECT * FROM messages WHERE created_at < (SELECT created_at FROM messages WHERE id = ?) ORDER BY created_at DESC LIMIT ?`,
      [before, limit]
    );
  } else if (validChannel) {
    messages = query(
      `SELECT * FROM messages WHERE channel = ? ORDER BY created_at DESC LIMIT ?`,
      [validChannel, limit]
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
    channel: m.channel || 'group',
    timestamp: m.created_at,
    replyTo: m.reply_to,
  }));

  const hasMore = messages.length === limit;

  res.json({ messages: result, hasMore });
});

export default router;
