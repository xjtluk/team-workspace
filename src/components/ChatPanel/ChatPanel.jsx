import { useRef, useEffect } from 'preact/hooks';
import { MessageItem } from './MessageItem.jsx';
import { ChatInput } from './ChatInput.jsx';

const AVATARS = {
  kk: '👑',
  cc: '/assets/clawd.png',
  xiaoma: '/assets/xiaoma.png',
  hermes: '🔮',
  'xiaoma-ai': '🐴',
};

const ALIGN = {
  kk: 'right',
  cc: 'left',
  xiaoma: 'left',
  hermes: 'left',
  'xiaoma-ai': 'left',
};

export function ChatPanel({ messages, messageStatuses, agents, onSend }) {
  const listRef = useRef(null);
  const allMessages = messages.value || messages;
  // 只显示群聊消息，过滤掉私聊
  const msgList = allMessages.filter(m => !m.channel || m.channel === 'group');
  const statuses = messageStatuses?.value || messageStatuses || {};

  // 自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [msgList.length]);

  const agentList = Object.values(agents.value || agents);


  return (
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-title">BKS Studio</span>
        <span class="chat-online">
          {agentList.filter(a => a.online).length} / {agentList.length} online
        </span>
      </div>


      <div class="message-list" ref={listRef}>
        {msgList.map(msg => (
          <MessageItem
            key={msg.id}
            message={msg}
            avatar={AVATARS[msg.from] || '👤'}
            align={ALIGN[msg.from] || 'left'}
            isGold={msg.from === 'kk'}
            msgStatus={statuses[msg.id]}
          />
        ))}
      </div>

      <ChatInput onSend={onSend} currentChannel="group" />
    </div>
  );
}
