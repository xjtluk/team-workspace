import { PixelOffice } from './components/PixelOffice/PixelOffice.jsx';
import { ChatPanel } from './components/ChatPanel/ChatPanel.jsx';
import { StatusBar } from './components/StatusBar/StatusBar.jsx';
import { ResizeHandle } from './components/ResizeHandle/ResizeHandle.jsx';
import { useWS } from './ws/client.js';

export function App() {
  const { agents, messages, messageStatuses, wsConnected, sendMessage, currentChannel, switchChannel } = useWS();

  return (
    <div class="workspace">
      <div class="workspace-left">
        <PixelOffice agents={agents} />
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
