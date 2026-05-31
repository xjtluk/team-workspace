import { signal, computed } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

// 全局状态信号
export const agents = signal({
  cc: { id: 'cc', name: 'CC', status: 'offline', activity: '', progress: 0, location: 'sofa', online: false },
  xiaoma: { id: 'xiaoma', name: '小马', status: 'offline', activity: '', progress: 0, location: 'sofa', online: false },
  kk: { id: 'kk', name: 'KK', status: 'idle', activity: '', progress: 0, location: null, online: true },
});

export const messages = signal([]);
export const wsConnected = signal(false);

// 计算属性
export const onlineCount = computed(() =>
  Object.values(agents.value).filter(a => a.online).length
);

// WebSocket 客户端
let ws = null;
let reconnectDelay = 1000;
let lastMessageId = null;
let pendingAcks = new Map(); // messageId → timeout

// 加载历史消息
async function loadHistory() {
  try {
    const res = await fetch('/api/history?limit=50');
    const data = await res.json();
    if (data.messages && data.messages.length > 0) {
      messages.value = data.messages;
      lastMessageId = data.messages[data.messages.length - 1].id;
    }
  } catch (err) {
    console.error('[WS] Failed to load history:', err);
  }
}

// 加载 Agent 列表
async function loadAgents() {
  try {
    // 通过 /api/history 触发一次连接，同时用已知的初始 agents
    // Agent 状态会通过 WebSocket 实时更新
  } catch (err) {
    console.error('[WS] Failed to load agents:', err);
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    wsConnected.value = true;
    reconnectDelay = 1000;

    // 断线重连后补拉消息
    if (lastMessageId) {
      ws.send(JSON.stringify({ type: 'sync', payload: { afterId: lastMessageId } }));
    }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleEvent(data);
  };

  ws.onclose = () => {
    wsConnected.value = false;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };
}

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, reconnectDelay);
}

function handleEvent(event) {
  switch (event.type) {
    case 'status_change':
      agents.value = {
        ...agents.value,
        [event.payload.agentId]: {
          ...agents.value[event.payload.agentId],
          id: event.payload.agentId,
          ...event.payload,
          online: true,
        },
      };
      break;

    case 'new_message':
      // 去重：如果消息已存在则跳过
      if (!messages.value.find(m => m.id === event.payload.id)) {
        messages.value = [...messages.value, event.payload];
        lastMessageId = event.payload.id;
      }
      break;

    case 'message_ack':
      // 清除重发定时器
      if (pendingAcks.has(event.payload.messageId)) {
        clearTimeout(pendingAcks.get(event.payload.messageId));
        pendingAcks.delete(event.payload.messageId);
      }
      break;

    case 'agent_online':
      agents.value = {
        ...agents.value,
        [event.payload.agentId]: {
          ...agents.value[event.payload.agentId],
          online: event.payload.online,
        },
      };
      break;

    case 'agent_offline':
      agents.value = {
        ...agents.value,
        [event.payload.agentId]: {
          ...agents.value[event.payload.agentId],
          online: false,
          status: 'offline',
        },
      };
      break;

    case 'agent_registered':
      // 新成员注册，自动添加到 agents
      agents.value = {
        ...agents.value,
        [event.payload.id]: {
          id: event.payload.id,
          name: event.payload.name,
          status: 'idle',
          activity: '',
          progress: 0,
          location: 'sofa',
          online: false,
        },
      };
      break;

    case 'ping':
      ws?.send(JSON.stringify({ type: 'pong' }));
      break;
  }
}

// 发送消息（带 ACK 重试）
export function sendMessage(content) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const tempId = `msg_${Date.now()}_user`;
  const msg = {
    type: 'send_message',
    payload: { content },
  };

  ws.send(JSON.stringify(msg));

  // 5 秒未收到 ACK 则重发
  const timeout = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, 5000);
  pendingAcks.set(tempId, timeout);
}

// Preact Hook：初始化 WebSocket + 加载历史
export function useWS() {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // 先加载历史消息，再连接 WebSocket
      loadHistory().then(() => {
        connect();
      });
    }
  }, []);

  return { agents, messages, wsConnected, sendMessage };
}
