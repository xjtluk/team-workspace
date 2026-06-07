import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

const WS_BASE = `ws://${location.host}/ws`;

// 消息状态枚举
export const MSG_STATUS = {
  SENDING: 'sending',    // 正在发送
  SENT: 'sent',          // 已发送（单勾）
  DELIVERED: 'delivered', // 已送达（双勾）
  EXECUTING: 'executing', // Agent 正在执行
  READ: 'read',          // 已读/已处理
};

export function useWS() {
  const [agents, setAgents] = useState({});
  const [messages, setMessages] = useState([]);
  const [messageStatuses, setMessageStatuses] = useState({});
  const [wsConnected, setWsConnected] = useState(false);
  const [currentChannel, setCurrentChannel] = useState('group');
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const pendingMessages = useRef({}); // 待确认的消息

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // 每次重连都重新获取 token（防止服务器重启后旧 token 失效）
    let wsUrl = WS_BASE;
    try {
      const res = await fetch('/api/auth/token');
      if (!res.ok) {
        throw new Error(`Token fetch failed: HTTP ${res.status}`);
      }
      const { token } = await res.json();
      if (!token) {
        throw new Error('Token endpoint returned empty token');
      }
      wsUrl = `${WS_BASE}?token=${token}`;
    } catch (e) {
      console.error('[WS] 获取 token 失败，3秒后重试:', e.message);
      reconnectTimer.current = setTimeout(connect, 3000);
      return;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] 连接成功');
      setWsConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 处理 agent 状态变更
        if (data.type === 'status_change' && data.payload) {
          const { agentId, status: agentStatus, activity, model, ...statusData } = data.payload;
          setAgents(prev => ({
            ...prev,
            [agentId]: { ...prev[agentId], id: agentId, status: agentStatus, activity, model: model || prev[agentId]?.model || '', ...statusData }
          }));
          // agent 进入工作状态 → 把最近的 KK 消息标记为"执行中"
          if (agentStatus === 'working') {
            setMessageStatuses(prev => {
              const updated = { ...prev };
              // 找到最近 5 条状态为 sent 的 KK 消息，标记为 executing
              let count = 0;
              for (let i = messages.length - 1; i >= 0 && count < 2; i--) {
                const m = messages[i];
                if (m.from === 'kk' && (prev[m.id] === MSG_STATUS.SENT || prev[m.id] === MSG_STATUS.DELIVERED)) {
                  updated[m.id] = MSG_STATUS.EXECUTING;
                  count++;
                }
              }
              return updated;
            });
          }
          // agent 回到空闲 → 把 executing 的消息标记为已读
          if (agentStatus === 'idle') {
            setMessageStatuses(prev => {
              const updated = { ...prev };
              Object.keys(updated).forEach(id => {
                if (updated[id] === MSG_STATUS.EXECUTING) {
                  updated[id] = MSG_STATUS.READ;
                }
              });
              return updated;
            });
          }
        }
        // 处理 agent 上下线（携带完整状态）
        else if ((data.type === 'agent_online' || data.type === 'agent_offline') && data.payload) {
          const { agentId, online, status, activity, progress, location, model } = data.payload;
          setAgents(prev => ({
            ...prev,
            [agentId]: {
              ...prev[agentId],
              id: agentId,
              online,
              status: status || prev[agentId]?.status || 'idle',
              activity: activity || '',
              progress: progress || 0,
              location: location || prev[agentId]?.location || 'sofa',
              model: model || prev[agentId]?.model || '',
              last_seen: Date.now(), // WS 事件到达时更新 last_seen
            }
          }));
        }
        // 处理新消息
        else if (data.type === 'new_message' && data.payload) {
          const msg = data.payload;
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
        // 处理消息确认（ack）
        else if (data.type === 'message_ack' && data.payload) {
          const { messageId, status, agentId } = data.payload;
          setMessageStatuses(prev => ({
            ...prev,
            [messageId]: status || MSG_STATUS.DELIVERED,
          }));
          // 如果 ack 带有 agent 信息，表示某个 agent 正在处理
          if (agentId) {
            setMessageStatuses(prev => ({
              ...prev,
              [messageId]: MSG_STATUS.EXECUTING,
              [`${messageId}_agent`]: agentId,
            }));
          }
        }
      } catch (e) {
        console.error('[WS] 消息解析错误:', e);
      }
    };

    ws.onclose = (event) => {
      setWsConnected(false);
      wsRef.current = null;
      // 非正常关闭（如 token 失效 401）加速重连
      const delay = event.code === 4001 ? 1000 : 3000;
      console.log(`[WS] 连接关闭 (code=${event.code})，${delay / 1000}秒后重连`);
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.warn('[WS] 连接错误');
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();

    // 加载初始数据：agents + 历史消息
    const loadInitial = async () => {
      try {
        const [agentsRes, historyRes] = await Promise.all([
          fetch('/api/agents'),
          fetch('/api/history?limit=50')
        ]);
        const agentsData = await agentsRes.json();
        const historyData = await historyRes.json();

        // 加载 agents（统一字段名：API 返回 current_status，WS 用 status）
        if (Array.isArray(agentsData) && agentsData.length) {
          setAgents(prev => {
            const map = { ...prev };
            agentsData.forEach(a => {
              map[a.id] = {
                ...a,
                status: a.current_status || a.status || 'idle',
                activity: a.current_activity || a.activity || '',
                model: a.model || '',
              };
            });
            return map;
          });
        }

        // 加载历史消息
        const historyMsgs = historyData?.messages;
        if (Array.isArray(historyMsgs) && historyMsgs.length) {
          setMessages(historyMsgs);
          // 历史消息统一标记为已读
          const statuses = {};
          historyMsgs.forEach(m => { statuses[m.id] = MSG_STATUS.READ; });
          setMessageStatuses(statuses);
        }
      } catch (e) {
        console.error('Failed to load initial state:', e);
      }
    };

    loadInitial();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // 发送消息（WS优先，HTTP降级）
  const sendMessage = useCallback((msg) => {
    const localId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = msg.channel || currentChannel;
    const payload = {
      type: 'send_message',
      payload: {
        content: msg.content,
        from: msg.from || 'kk',
        fromName: msg.fromName || 'KK',
        channel,
        messageId: localId,
      }
    };

    // 立即显示消息（sending 状态）
    const localMsg = {
      id: localId,
      from: msg.from || 'kk',
      fromName: msg.fromName || 'KK',
      content: msg.content,
      type: 'text',
      channel,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, localMsg]);
    setMessageStatuses(prev => ({
      ...prev,
      [localId]: MSG_STATUS.SENDING,
    }));

    // 尝试通过 WebSocket 发送
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      // 标记为已发送
      setTimeout(() => {
        setMessageStatuses(prev => ({
          ...prev,
          [localId]: prev[localId] === MSG_STATUS.SENDING ? MSG_STATUS.SENT : prev[localId],
        }));
      }, 100);
      return true;
    }

    // HTTP fallback
    fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: msg.from || 'kk',
        content: msg.content,
        type: 'text',
        channel,
        messageId: localId,
      })
    }).then(res => {
      if (res.ok) {
        setMessageStatuses(prev => ({
          ...prev,
          [localId]: MSG_STATUS.SENT,
        }));
      }
    }).catch(err => {
      console.error('HTTP send failed:', err);
      setMessageStatuses(prev => ({
        ...prev,
        [localId]: MSG_STATUS.SENT, // still mark as sent for UX
      }));
    });

    return true;
  }, [currentChannel]);

  // 切换频道
  const switchChannel = useCallback((channel) => {
    setCurrentChannel(channel);
    // 重新加载该频道的历史消息
    fetch(`/api/history?limit=50&channel=${channel}`)
      .then(res => res.json())
      .then(data => {
        if (data.messages) {
          setMessages(data.messages);
          const statuses = {};
          data.messages.forEach(m => { statuses[m.id] = MSG_STATUS.READ; });
          setMessageStatuses(statuses);
        }
      })
      .catch(err => {
        console.error('Failed to load channel history:', err);
      });
  }, []);

  // 获取当前频道的消息
  const channelMessages = messages.filter(m => (m.channel || 'group') === currentChannel);

  return { agents, messages: channelMessages, allMessages: messages, messageStatuses, wsConnected, sendMessage, currentChannel, switchChannel };
}
