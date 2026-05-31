import { useRef, useEffect } from 'preact/hooks';
import { MessageItem } from './MessageItem.jsx';
import { ChatInput } from './ChatInput.jsx';

const AVATARS = {
  kk: '👑',
  cc: '/assets/clawd.png',
  xiaoma: '🐴',
};

const ALIGN = {
  kk: 'right',
  cc: 'left',
  xiaoma: 'left',
};

export function ChatPanel({ messages, agents, onSend }) {
  const listRef = useRef(null);

  // 自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const agentList = Object.values(agents.value || agents);
  const offlineAgents = agentList.filter(a => !a.online && a.id !== 'kk');

  return (
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-title">BKS Studio</span>
        <span class="chat-online">
          {agentList.filter(a => a.online).length} / {agentList.length} online
        </span>
      </div>

      <div class="message-list" ref={listRef}>
        {(messages.value || messages).map(msg => (
          <MessageItem
            key={msg.id}
            message={msg}
            avatar={AVATARS[msg.from] || '👤'}
            align={ALIGN[msg.from] || 'left'}
            isGold={msg.from === 'kk'}
          />
        ))}
      </div>

      {offlineAgents.length > 0 && (
        <div class="offline-indicator">
          {offlineAgents.map(a => (
            <span key={a.id} class="offline-tag">
              {a.name} offline
            </span>
          ))}
        </div>
      )}

      <ChatInput onSend={onSend} />
    </div>
  );
}
