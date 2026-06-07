import { useState, useRef, useEffect } from 'preact/hooks';
import './PrivateChatModal.css';

export function PrivateChatModal({ agent, onClose, onSend, allMessages }) {
  const [input, setInput] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // 过滤出与此 agent 的私聊消息
  const channel = `dm_${agent.id}`;
  const messages = (allMessages || []).filter(m => m.channel === channel);

  // 自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [messages.length]);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput('');

    if (onSend) {
      onSend({
        content: text,
        from: 'kk',
        fromName: 'KK',
        channel,
      });
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div class="private-chat-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="private-chat-modal">
        <div class="private-chat-header">
          <div class="private-chat-header-left">
            <span class="private-chat-avatar">
              {agent.id === 'cc' ? '🤖' : agent.id === 'cx' ? '⚡' : '👤'}
            </span>
            <span class="private-chat-name">{agent.name}</span>
            <span class={`private-chat-status ${agent.online ? 'online' : 'offline'}`}>
              {agent.online ? '在线' : '离线'}
            </span>
          </div>
          <button class="private-chat-close" onClick={onClose}>&times;</button>
        </div>

        <div class="private-chat-messages" ref={listRef}>
          {messages.length === 0 ? (
            <div class="private-chat-empty">暂无消息</div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} class={`private-chat-msg ${msg.from === 'kk' ? 'self' : 'other'}`}>
                <div class="private-chat-msg-content">{msg.content}</div>
                <div class="private-chat-msg-time">
                  {new Date(msg.timestamp || msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))
          )}
        </div>

        <div class="private-chat-input-area">
          <textarea
            ref={inputRef}
            class="private-chat-input"
            value={input}
            onInput={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`发消息给 ${agent.name}...`}
            rows={2}
          />
          <button class="private-chat-send" onClick={handleSend}>发送</button>
        </div>
      </div>
    </div>
  );
}
