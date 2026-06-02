import { createHash } from 'crypto';

const recentMessages = new Map(); // hash -> timestamp
const DEDUP_WINDOW = 3000;

function getMessageHash(content, fromId) {
  return createHash('md5').update(`${fromId}:${content}`).digest('hex');
}

export function isDuplicate(content, fromId) {
  const hash = getMessageHash(content, fromId);
  const now = Date.now();
  const lastTime = recentMessages.get(hash);

  if (lastTime && (now - lastTime) < DEDUP_WINDOW) {
    return true;
  }

  recentMessages.set(hash, now);

  if (recentMessages.size > 1000) {
    for (const [key, time] of recentMessages) {
      if (now - time > DEDUP_WINDOW * 2) {
        recentMessages.delete(key);
      }
    }
  }

  return false;
}
