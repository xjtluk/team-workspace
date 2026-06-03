import { Router } from 'express';
import { query, run } from '../db.js';

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

// Cleanup endpoint: delete garbled/error messages
router.delete('/cleanup', (req, res) => {
  const { pattern, olderThan } = req.body || {};

  if (pattern) {
    const before = query('SELECT COUNT(*) as c FROM messages').c || 0;
    run('DELETE FROM messages WHERE content LIKE ?', [`%${pattern}%`]);
    const after = query('SELECT COUNT(*) as c FROM messages').c || 0;
    return res.json({ ok: true, deleted: before - after, pattern });
  }

  if (olderThan) {
    const before = query('SELECT COUNT(*) as c FROM messages').c || 0;
    run('DELETE FROM messages WHERE created_at < ?', [olderThan]);
    const after = query('SELECT COUNT(*) as c FROM messages').c || 0;
    return res.json({ ok: true, deleted: before - after, olderThan });
  }

  // Default: delete garbled messages (non-ASCII, non-Chinese)
  const all = query('SELECT id, content FROM messages');
  const toDelete = [];
  all.forEach(m => {
    if (!m.content) { toDelete.push(m.id); return; }
    const hasHighByte = /[^\x00-\x7f]/.test(m.content);
    const hasChinese = /[一-鿿]/.test(m.content);
    if (hasHighByte && !hasChinese) { toDelete.push(m.id); return; }
    if (m.content.includes('�')) { toDelete.push(m.id); return; }
    if (m.content.startsWith('<｜DSML｜') && !m.content.includes('@')) { toDelete.push(m.id); }
  });

  if (toDelete.length > 0) {
    const placeholders = toDelete.map(() => '?').join(',');
    run(`DELETE FROM messages WHERE id IN (${placeholders})`, toDelete);
  }

  res.json({ ok: true, deleted: toDelete.length });
});

export default router;
