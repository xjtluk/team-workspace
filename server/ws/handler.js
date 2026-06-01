import { query, run } from '../db.js';
import { createHash } from 'crypto';

const clients = new Set();

// ── 消息去重（防风暴核心） ──
const recentMessages = new Map(); // hash -> timestamp
const DEDUP_WINDOW = 3000; // 3 秒去重窗口

function getMessageHash(content, fromId) {
  return createHash('md5').update(`${fromId}:${content}`).digest('hex');
}

function isDuplicate(content, fromId) {
  const hash = getMessageHash(content, fromId);
  const now = Date.now();
  const lastTime = recentMessages.get(hash);

  if (lastTime && (now - lastTime) < DEDUP_WINDOW) {
    return true;
  }

  recentMessages.set(hash, now);

  // 定期清理过期记录
  if (recentMessages.size > 1000) {
    for (const [key, time] of recentMessages) {
      if (now - time > DEDUP_WINDOW * 2) {
        recentMessages.delete(key);
      }
    }
  }

  return false;
}

export function setupWS(wss) {
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected. Total: ${clients.size}`);

    ws.isAlive = true;
    ws.agentId = null; // 记录连接的 Agent ID
    ws.on('pong', () => { ws.isAlive = true; });

    // 发送当前 Agent 状态给新连接的客户端
    const agents = query('SELECT * FROM agents');
    agents.forEach(agent => {
      ws.send(JSON.stringify({
        type: agent.online ? 'agent_online' : 'agent_offline',
        payload: {
          agentId: agent.id,
          online: !!agent.online,
          status: agent.current_status,
          activity: agent.current_activity,
          progress: agent.progress,
          location: agent.location,
        },
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[WS] Invalid message:', e.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });
  });

  // 心跳检测
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'send_message':
      handleSendMessage(ws, msg.payload);
      break;
    case 'pong':
      break;
    case 'sync':
      handleSync(ws, msg.payload);
      break;
    case 'register_agent':
      // 记录连接的 Agent ID
      ws.agentId = msg.payload?.agentId;
      break;
  }
}

function handleSendMessage(ws, payload) {
  const now = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const messageId = `msg_${now}_${senderId}_${rand}`;
  const senderId = payload.from || 'kk';

  // 去重检查
  if (isDuplicate(payload.content, senderId)) {
    console.log(`[WS] Duplicate message blocked from ${senderId}`);
    return;
  }

  run(
    `INSERT INTO messages (id, from_id, from_name, content, type, created_at) VALUES (?, ?, ?, ?, 'text', ?)`,
    [messageId, senderId, payload.fromName || 'KK', payload.content, now]
  );

  ws.send(JSON.stringify({
    type: 'message_ack',
    payload: { messageId, timestamp: now },
  }));

  // 广播时排除发送者自己（防回音）
  broadcast({
    type: 'new_message',
    payload: {
      id: messageId,
      from: senderId,
      fromName: payload.fromName || 'KK',
      content: payload.content,
      type: 'text',
      timestamp: now,
    },
  }, senderId); // 传入发送者 ID 用于过滤
}

function handleSync(ws, payload) {
  const messages = query(
    `SELECT * FROM messages WHERE id > ? ORDER BY created_at ASC LIMIT 100`,
    [payload.afterId || '']
  );

  messages.forEach((msg) => {
    ws.send(JSON.stringify({
      type: 'new_message',
      payload: {
        id: msg.id,
        from: msg.from_id,
        fromName: msg.from_name,
        content: msg.content,
        type: msg.type,
        timestamp: msg.created_at,
      },
    }));
  });
}

/**
 * 广播消息给所有客户端
 * @param {Object} event - 要广播的事件
 * @param {string} [excludeSenderId] - 排除的发送者 ID（防回音）
 */
export function broadcast(event, excludeSenderId = null) {
  const data = JSON.stringify(event);
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      // 如果指定了排除的发送者，跳过该 Agent 的连接
      if (excludeSenderId && ws.agentId === excludeSenderId) {
        return;
      }
      ws.send(data);
    }
  });
}

export function broadcastStatusChange(agentId, status, activity, progress, location) {
  broadcast({
    type: 'status_change',
    payload: { agentId, status, activity, progress, location, timestamp: Date.now() },
  });
}
