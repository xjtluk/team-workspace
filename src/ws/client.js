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
        if (data.type === 'agent:status') {
          setAgents(prev => ({
            ...prev,
            [data.agent_id]: { ...prev[data.agent_id], ...data }
          }));
        } else if (data.type === 'chat:message') {
          setMessages(prev => {
            if (prev.some(m => m.id === data.id)) return prev;
            return [...prev, data];
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
      type: 'chat:message',
      content: msg.content,
      sender_id: msg.sender_id,
      sender_name: msg.sender_name,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
        id: payload.id,
        sender_id: payload.sender_id,
        sender_name: payload.sender_name,
        content: payload.content
      })
    }).then(res => {
      if (res.ok) {
        // Broadcast will come through WS when it reconnects,
        // but add locally for immediate feedback
        setMessages(prev => {
          if (prev.some(m => m.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
    }).catch(err => {
      console.error('HTTP send failed:', err);
    });

    return true;
  }, []);

  return { agents, messages, wsConnected, sendMessage };
}
