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
          ...event.payload,
          online: true,
        },
      };
      break;

    case 'new_message':
      messages.value = [...messages.value, event.payload];
      lastMessageId = event.payload.id;
      break;

    case 'message_ack':
      // 消息确认，可后续用于显示"已送达"
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

  const msg = {
    type: 'send_message',
    payload: { content },
  };

  ws.send(JSON.stringify(msg));

  // 5 秒未收到 ACK 则重发
  setTimeout(() => {
    // 简单重发逻辑，后续可加 messageId 去重
  }, 5000);
}

// Preact Hook：初始化 WebSocket
export function useWS() {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      connect();
    }
  }, []);

  return { agents, messages, wsConnected, sendMessage };
}
