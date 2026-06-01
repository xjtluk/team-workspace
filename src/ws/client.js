import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

const WS_URL = `ws://${location.host}/ws`;

export function useWS() {
  const [agents, setAgents] = useState({});
  const [messages, setMessages] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
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
          const { agentId, ...statusData } = data.payload;
          setAgents(prev => ({
            ...prev,
            [agentId]: { ...prev[agentId], id: agentId, ...statusData }
          }));
        }
        // 处理 agent 上下线
        else if (data.type === 'agent_online' && data.payload) {
          const { agentId, online } = data.payload;
          setAgents(prev => ({
            ...prev,
            [agentId]: { ...prev[agentId], id: agentId, online }
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
      } catch (e) {
        console.error('WS message parse error:', e);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();

    // Load initial state (SSR-injected or fallback to API)
    const loadInitial = async () => {
      let initialData = window.__INITIAL_STATE__;

      if (!initialData) {
        try {
          const [agentsRes, msgsRes] = await Promise.all([
            fetch('/api/agents'),
            fetch('/api/history?limit=50')
          ]);
          const agentsList = await agentsRes.json();
          const msgsList = await msgsRes.json();
          initialData = { agents: agentsList, messages: msgsList };
        } catch (e) {
          console.error('Failed to load initial state:', e);
          return;
        }
      }

      if (initialData.agents?.length) {
        setAgents(prev => {
          const map = { ...prev };
          initialData.agents.forEach(a => { map[a.id] = a; });
          return map;
        });
      }

      // BUG FIX: load initial messages into state (was previously ignored)
      if (initialData.messages?.length) {
        setMessages(initialData.messages);
      }
    };

    loadInitial();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // BUG FIX: send via WS with HTTP fallback
  const sendMessage = useCallback((msg) => {
    const payload = {
      type: 'send_message',
      payload: {
        content: msg.content,
        from: msg.from || 'kk',
        fromName: msg.fromName || 'KK'
      }
    };

    // Try WebSocket first
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }

    // HTTP fallback when WS is not connected
    fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: msg.from || 'kk',
        content: msg.content,
        type: 'text'
      })
    }).then(res => {
      if (res.ok) {
        // Broadcast will come through WS when it reconnects,
        // but add locally for immediate feedback
        const localMsg = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          from: msg.from || 'kk',
          fromName: msg.fromName || 'KK',
          content: msg.content,
          type: 'text',
          timestamp: Date.now()
        };
        setMessages(prev => {
          if (prev.some(m => m.id === localMsg.id)) return prev;
          return [...prev, localMsg];
        });
      }
    }).catch(err => {
      console.error('HTTP send failed:', err);
    });

    return true;
  }, []);

  return { agents, messages, wsConnected, sendMessage };
}
