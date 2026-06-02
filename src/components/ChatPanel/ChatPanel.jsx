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

// Agent 状态显示文案
const STATUS_LABELS = {
  idle: '在线',
  working: '执行中',
  talking: '讨论中',
  error: '异常',
  offline: '离线',
  thinking: '思考中',
};

const STATUS_COLORS = {
  idle: '#67C23A',
  working: '#4A90D9',
  talking: '#E6A23C',
  error: '#F56C6C',
  offline: '#909399',
  thinking: '#A78BFA',
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
  const offlineAgents = agentList.filter(a => !a.online && a.id !== 'kk');
  const busyAgents = agentList.filter(a =>
    a.online && a.status && !['idle', 'offline'].includes(a.status)
  );

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

      {/* Agent 状态指示器 */}
      {busyAgents.length > 0 && (
        <div class="agent-status-indicator">
          {busyAgents.map(a => (
            <div key={a.id} class="agent-status-item">
              <span class="agent-status-dot" style={{ backgroundColor: STATUS_COLORS[a.status] || '#67C23A' }} />
              <span class="agent-status-name">{a.name}</span>
              <span class="agent-status-label">
                {STATUS_LABELS[a.status] || a.status}
                {a.activity ? `: ${a.activity}` : ''}
              </span>
              {a.status === 'working' && a.progress > 0 && (
                <div class="agent-status-progress-mini">
                  <div
                    class="agent-status-progress-fill"
                    style={{
                      width: `${a.progress}%`,
                      backgroundColor: STATUS_COLORS.working,
                    }}
                  />
                </div>
              )}
              {a.status === 'thinking' && (
                <span class="agent-status-thinking">
                  <span class="thinking-dot">.</span>
                  <span class="thinking-dot">.</span>
                  <span class="thinking-dot">.</span>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {offlineAgents.length > 0 && (
        <div class="offline-indicator">
          {offlineAgents.map(a => (
            <span key={a.id} class="offline-tag">
              {a.name} offline
            </span>
          ))}
        </div>
      )}

      <ChatInput onSend={onSend} currentChannel={channel} />
    </div>
  );
}
