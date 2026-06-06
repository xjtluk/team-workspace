import { query, run } from '../db.js';
import { isDuplicate } from './dedup.js';
import { addClient, removeClient, getClientCount, broadcast, broadcastStatusChange } from './broadcast.js';

const VALID_CHANNELS = ['group', 'dm', 'system'];

export function setupWS(wss) {
  wss.on('connection', (ws) => {
    addClient(ws);
    console.log(`[WS] Client connected. Total: ${getClientCount()}`);

    ws.isAlive = true;
    ws.agentId = null;
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
          model: agent.model || '',
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
      removeClient(ws);
      console.log(`[WS] Client disconnected. Total: ${getClientCount()}`);
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
      ws.agentId = msg.payload?.agentId;
      break;
  }
}

function handleSendMessage(ws, payload) {
  const now = Date.now();
  const senderId = payload.from || 'kk';
  const channel = VALID_CHANNELS.includes(payload.channel) ? payload.channel : 'group';
  const rand = Math.random().toString(36).substring(2, 8);
  const messageId = `msg_${now}_${senderId}_${rand}`;

  if (isDuplicate(payload.content, senderId)) {
    console.log(`[WS] Duplicate message blocked from ${senderId}`);
    return;
  }

  run(
    `INSERT INTO messages (id, from_id, from_name, content, type, channel, created_at) VALUES (?, ?, ?, ?, 'text', ?, ?)`,
    [messageId, senderId, payload.fromName || 'KK', payload.content, channel, now]
  );

  const frontendMsgId = payload.messageId || messageId;
  ws.send(JSON.stringify({
    type: 'message_ack',
    payload: { messageId: frontendMsgId, serverId: messageId, status: 'delivered', timestamp: now },
  }));

  broadcast({
    type: 'new_message',
    payload: {
      id: frontendMsgId, // 用前端 ID，保证去重
      from: senderId,
      fromName: payload.fromName || 'KK',
      content: payload.content,
      type: 'text',
      channel,
      timestamp: now,
    },
  }, senderId);
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
        channel: msg.channel || 'group',
        timestamp: msg.created_at,
      },
    }));
  });
}

export { broadcast, broadcastStatusChange };
