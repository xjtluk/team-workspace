import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { MSG_STATUS } from '../../ws/client.js';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(text) {
  try {
    const cleaned = text.replace(/\n+$/, '').replace(/^\n+/, '');
    const html = marked.parse(cleaned);
    return DOMPurify.sanitize(html);
  } catch {
    return text;
  }
}

// 消息状态图标和标签（视觉增强版 — 更直观的区分）
const STATUS_ICONS = {
  [MSG_STATUS.SENDING]:   { icon: '\u23F3', label: '\u53D1\u9001\u4E2D', cls: 'status-sending' },
  [MSG_STATUS.SENT]:      { icon: '\u2713', label: '\u5DF2\u53D1\u9001', cls: 'status-sent' },
  [MSG_STATUS.DELIVERED]: { icon: '\u2713\u2713', label: '\u5DF2\u9001\u8FBE', cls: 'status-delivered' },
  [MSG_STATUS.EXECUTING]: { icon: '\u25C9', label: 'Agent \u6267\u884C\u4E2D', cls: 'status-executing' },
  [MSG_STATUS.READ]:      { icon: '\u25C9\u25C9', label: '\u5DF2\u8BFB', cls: 'status-read' },
};

export function MessageItem({ message, avatar, align, isGold, msgStatus }) {
  const isRight = align === 'right';
  const isImage = avatar.startsWith('/');

  const time = new Date(message.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

  const isSystem = message.type === 'system';
  const status = STATUS_ICONS[msgStatus] || null;

  if (isSystem) {
    return (
      <div class="message-system">
        <span class="system-text">{message.content}</span>
        <span class="system-time">{timeStr}</span>
      </div>
    );
  }

  return (
    <div class={`message-item ${isRight ? 'msg-right' : 'msg-left'}`}>
      {!isRight && (
        <div class="msg-avatar">
          {isImage ? <img src={avatar} alt="" class="msg-avatar-img" /> : <span>{avatar}</span>}
        </div>
      )}
      <div class={`msg-body ${isGold ? 'msg-gold' : ''}`}>
        <div class={`msg-name ${isGold ? 'name-gold' : ''}`}>{message.fromName}</div>
        <div class="msg-bubble">
          <div
            class="msg-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        </div>
        <div class="msg-footer">
          <span class="msg-time">{timeStr}</span>
          {isRight && status && (
            <span class={`msg-status ${status.cls}`} title={status.label}>
              {status.icon}
            </span>
          )}
        </div>
      </div>
      {isRight && (
        <div class="msg-avatar">
          <span>{avatar}</span>
        </div>
      )}
    </div>
  );
}
