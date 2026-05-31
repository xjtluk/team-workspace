import { PixelOffice } from './components/PixelOffice/PixelOffice.jsx';
import { ChatPanel } from './components/ChatPanel/ChatPanel.jsx';
import { StatusBar } from './components/StatusBar/StatusBar.jsx';
import { useWS } from './ws/client.js';

export function App() {
  const { agents, messages, wsConnected, sendMessage } = useWS();

  return (
    <div class="workspace">
      <div class="workspace-left">
        <PixelOffice agents={agents} />
      </div>
      <div class="workspace-right">
        <ChatPanel messages={messages} agents={agents} onSend={sendMessage} />
      </div>
      <StatusBar agents={agents} wsConnected={wsConnected} />
    </div>
  );
}
