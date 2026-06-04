import { useRef, useCallback } from 'preact/hooks';
import { signal } from '@preact/signals';
import { PixelOffice } from './components/PixelOffice/PixelOffice.jsx';
import { ChatPanel } from './components/ChatPanel/ChatPanel.jsx';
import { StatusBar } from './components/StatusBar/StatusBar.jsx';
import { ResizeHandle } from './components/ResizeHandle/ResizeHandle.jsx';
import { InfoPanel } from './components/InfoPanel/InfoPanel.jsx';
import { useWS } from './ws/client.js';

// 工位悬停状态信号
const hoverSignal = signal({ target: null, visible: false });

export function App() {
  const { agents, messages, messageStatuses, wsConnected, sendMessage, currentChannel, switchChannel } = useWS();

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

  return (
    <div class="workspace">
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
