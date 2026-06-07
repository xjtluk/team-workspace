import { createHash } from 'crypto';

const recentMessages = new Map(); // hash -> timestamp
// 扩大到 8s，覆盖 WS + HTTP 心跳（15s 间隔）双通道竞态窗口
const DEDUP_WINDOW = 8000;

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

  // 定期清理过期条目，防止 Map 无限增长
  if (recentMessages.size > 1000) {
    for (const [key, time] of recentMessages) {
      if (now - time > DEDUP_WINDOW * 2) {
        recentMessages.delete(key);
      }
    }
  }

  return false;
}
