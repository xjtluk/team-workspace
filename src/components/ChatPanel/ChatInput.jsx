import { useState, useRef, useEffect } from 'preact/hooks';

const MIN_HEIGHT = 72;
const MAX_HEIGHT = 240;

export function ChatInput({ onSend }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  // 自适应高度
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${newHeight}px`;
  };

  useEffect(() => {
    autoResize();
  }, [value]);

  const handleKeyDown = (e) => {
    // Enter 发送（非 Shift 组合键）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const text = value.trim();
    if (!text) return;
    onSend({
      content: text,
      from: 'kk',
      fromName: 'KK'
    });
    setValue('');
    // 重置高度
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) el.style.height = `${MIN_HEIGHT}px`;
    }, 0);
  };

  const handleSendClick = (e) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <form class="chat-input" onSubmit={(e) => e.preventDefault()}>
      <textarea
        ref={textareaRef}
        value={value}
        onInput={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        class="chat-input-field"
        rows={1}
        style={{ height: `${MIN_HEIGHT}px` }}
      />
      <button type="button" class="chat-send-btn" onClick={handleSendClick}>发送</button>
    </form>
  );
}
