import { useRef, useCallback, useState, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { PixelOffice } from './components/PixelOffice/PixelOffice.jsx';
import { ChatPanel } from './components/ChatPanel/ChatPanel.jsx';
import { StatusBar } from './components/StatusBar/StatusBar.jsx';
import { ResizeHandle } from './components/ResizeHandle/ResizeHandle.jsx';
import { InfoPanel } from './components/InfoPanel/InfoPanel.jsx';
import { useWS } from './ws/client.js';
import './App.css';

// 工位悬停状态信号
const hoverSignal = signal({ target: null, visible: false });

export function App() {
  const { agents, messages, messageStatuses, wsConnected, sendMessage, currentChannel, switchChannel } = useWS();
  const [restartToast, setRestartToast] = useState(null);
  const prevOnlineRef = useRef({});

  const hoverTimerRef = useRef(null);

  const handleHoverDesk = useCallback((deskInfo) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (deskInfo) {
      hoverSignal.value = { target: deskInfo, visible: true };
    } else {
      hoverTimerRef.current = setTimeout(() => {
        hoverSignal.value = { target: null, visible: false };
      }, 300);
    }
  }, []);

  // Agent 重启检测：从离线变在线时显示 toast
  const agentsList = Object.values(agents?.value || agents || {});
  useEffect(() => {
    const currentOnline = {};
    agentsList.forEach(a => {
      currentOnline[a.id] = a.online;
    });

    Object.keys(currentOnline).forEach(id => {
      const wasOnline = prevOnlineRef.current[id];
      if (wasOnline === false && currentOnline[id] === true) {
        const agent = agentsList.find(a => a.id === id);
        setRestartToast({
          agentId: id,
          agentName: agent?.name || id,
          timestamp: Date.now(),
        });
        setTimeout(() => setRestartToast(null), 4000);
      }
    });

    prevOnlineRef.current = currentOnline;
  }, [agentsList]);

  return (
    <div class="workspace">
      {/* 重启通知 Toast */}
      {restartToast && (
        <div class="restart-toast">
          <span class="restart-toast-icon">🔄</span>
          <span class="restart-toast-text">
            {restartToast.agentName} 已重新连接
          </span>
        </div>
      )}
      <div class="workspace-left">
        <PixelOffice agents={agents} onHoverDesk={handleHoverDesk} />
        <InfoPanel
          hoverTarget={hoverSignal.value.target}
          agents={agents}
          visible={hoverSignal.value.visible}
        />
      </div>
      <ResizeHandle />
      <div class="workspace-right">
        <ChatPanel
          messages={messages}
          messageStatuses={messageStatuses}
          agents={agents}
          onSend={sendMessage}
          currentChannel={currentChannel}
          onSwitchChannel={switchChannel}
        />
      </div>
      <StatusBar agents={agents} wsConnected={wsConnected} />
    </div>
  );
}
