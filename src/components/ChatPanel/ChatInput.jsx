import { useState } from 'preact/hooks';

export function ChatInput({ onSend }) {
  const [value, setValue] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form class="chat-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={value}
        onInput={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        class="chat-input-field"
      />
      <button type="submit" class="chat-send-btn">发送</button>
    </form>
  );
}
