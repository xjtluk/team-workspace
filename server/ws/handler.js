import { query, run } from '../db.js';

const clients = new Set();

export function setupWS(wss) {
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected. Total: ${clients.size}`);

    ws.isAlive = true;
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
  }
}

function handleSendMessage(ws, payload) {
  const now = Date.now();
  const messageId = `msg_${now}_user`;

  run(
    `INSERT INTO messages (id, from_id, from_name, content, type, created_at) VALUES (?, ?, ?, ?, 'text', ?)`,
    [messageId, 'kk', 'KK', payload.content, now]
  );

  ws.send(JSON.stringify({
    type: 'message_ack',
    payload: { messageId, timestamp: now },
  }));

  broadcast({
    type: 'new_message',
    payload: {
      id: messageId,
      from: 'kk',
      fromName: 'KK',
      content: payload.content,
      type: 'text',
      timestamp: now,
    },
  });
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

export function broadcast(event) {
  const data = JSON.stringify(event);
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
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
