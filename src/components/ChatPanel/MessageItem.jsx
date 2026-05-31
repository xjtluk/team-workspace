export function MessageItem({ message, avatar, align, isGold }) {
  const isRight = align === 'right';
  const isImage = avatar.startsWith('/');

  const time = new Date(message.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

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
          <div class="msg-content">{message.content}</div>
        </div>
        <div class="msg-time">{timeStr}</div>
      </div>
      {isRight && (
        <div class="msg-avatar">
          <span>{avatar}</span>
        </div>
      )}
    </div>
  );
}
