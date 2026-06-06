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

const CHANNELS = [
  { id: 'group', name: '群聊', icon: '👥' },
  { id: 'dm', name: '私聊', icon: '💬' },
];

export function ChatPanel({ messages, messageStatuses, agents, onSend, currentChannel, onSwitchChannel }) {
  const listRef = useRef(null);
  const msgList = messages.value || messages;
  const statuses = messageStatuses?.value || messageStatuses || {};
  const channel = currentChannel?.value || currentChannel || 'group';

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

  const handleSwitch = (ch) => {
    if (onSwitchChannel) onSwitchChannel(ch);
  };

  return (
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-title">BKS Studio</span>
        <span class="chat-online">
          {agentList.filter(a => a.online).length} / {agentList.length} online
        </span>
      </div>

      {/* 频道切换 */}
      <div class="channel-tabs">
        {CHANNELS.map(ch => (
          <button
            key={ch.id}
            class={`channel-tab ${channel === ch.id ? 'channel-active' : ''}`}
            onClick={() => handleSwitch(ch.id)}
          >
            <span class="channel-icon">{ch.icon}</span>
            <span class="channel-name">{ch.name}</span>
          </button>
        ))}
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

      <ChatInput onSend={onSend} currentChannel={channel} />
    </div>
  );
}
