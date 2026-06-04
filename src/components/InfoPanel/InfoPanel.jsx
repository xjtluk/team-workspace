import { useRef, useEffect } from 'preact/hooks';
import './InfoPanel.css';

const DESK_INFO = {
  cx:     { name: 'CX', role: '代码工程师',   theme: '#ffaa66', activity: '正在优化项目底层核心引擎' },
  cc:     { name: 'CC', role: '软件架构师',   theme: '#99ccff', activity: '绘制系统微服务架构图纸' },
  xiaoma: { name: '小马', role: '项目经理',     theme: '#88dd88', activity: '拆解迭代需求、分配团队任务' },
  hermes: { name: 'Hermes', role: '技术主管',  theme: '#cc99ff', activity: '跨模块沟通协调、解决卡点问题' },
  emptyA: { name: '空位A', role: '待招聘',     theme: '#aaaaaa', activity: '岗位待定：Tessa/Wendy招募中' },
  emptyB: { name: '空位B', role: '待招聘',     theme: '#aaaaaa', activity: '岗位待定：Owen/Polly招募中' },
};

const PIXEL_AVATARS = {
  cc: [
    '  ████  ',
    ' ██████ ',
    '██ ██ ██',
    '████████',
    '████████',
    '████████',
    ' ██████ ',
    '  ████  ',
  ],
  xiaoma: [
    '   ███   ',
    ' ███████ ',
    '█████████',
    '██◉██◉██',
    '█████████',
    ' ███████ ',
    '  █████  ',
    '   ███   ',
  ],
  cx: [
    '  █████  ',
    ' ███████ ',
    '███ █ ███',
    '█████████',
    '█████████',
    ' ███████ ',
    '  █████  ',
    '   ███   ',
  ],
  hermes: [
    '  ██████  ',
    ' ████████ ',
    '██ ◇◇ ███',
    '██████████',
    '██████████',
    ' ████████ ',
    '  ██████  ',
    '   ████   ',
  ],
  emptyA: [
    '  ┌────┐  ',
    '  │ ?? │  ',
    '  │    │  ',
    '  └────┘  ',
    '    ??    ',
    ' 招募中   ',
  ],
  emptyB: [
    '  ┌────┐  ',
    '  │ ?? │  ',
    '  │    │  ',
    '  └────┘  ',
    '    ??    ',
    ' 招募中   ',
  ],
};

const STATUS_LABELS = {
  idle: '空闲中', working: '工作中', talking: '讨论中',
  error: '异常', offline: '离线', thinking: '思考中',
};

// 状态颜色：空闲=绿，工作中=黄，异常=红，离线=灰
const STATUS_COLORS = {
  idle: '#67C23A', working: '#E6A23C', talking: '#4A90D9',
  error: '#F56C6C', offline: '#909399', thinking: '#A78BFA',
};

export function InfoPanel({ hoverTarget, agents, visible }) {
  const panelRef = useRef(null);
  const timerRef = useRef(null);

  const deskInfo = hoverTarget ? DESK_INFO[hoverTarget.id] : null;
  // useWS() 返回 agents 为 useState({}) 普通对象，无 .value 属性
  // 统一使用防御模式：兼容 signal 和普通对象
  const agent = hoverTarget
    ? Object.values(agents?.value || agents || {}).find(a => a.id === hoverTarget.id)
    : null;

  const shouldShow = visible && deskInfo;
  const isOccupied = ['cx', 'cc', 'xiaoma', 'hermes'].includes(hoverTarget?.id);
  const isOffline = agent && !agent.online;
  const statusColor = agent ? (STATUS_COLORS[agent.status] || '#909399') : '#909399';
  const statusLabel = isOffline ? '离线' :
    (agent ? (STATUS_LABELS[agent.status] || agent.status) : '待定');
  const activity = agent?.activity || deskInfo?.activity || '';
  const theme = deskInfo?.theme || '#aaaaaa';

  if (!shouldShow) {
    return (
      <div
        class={`info-panel info-panel-hidden`}
        ref={panelRef}
        aria-hidden="true"
      />
    );
  }

  const avatarLines = PIXEL_AVATARS[hoverTarget.id] || PIXEL_AVATARS.emptyA;

  return (
    <div
      class={`info-panel info-panel-visible`}
      ref={panelRef}
      role="tooltip"
      aria-label={`${deskInfo.name} - ${deskInfo.role}`}
    >
      {/* 像素头像 */}
      <div class="info-avatar" style={{ borderColor: theme }}>
        {avatarLines.map((line, i) => (
          <div key={i} class="info-avatar-line" style={{ color: isOccupied ? theme : '#888' }}>
            {line}
          </div>
        ))}
      </div>

      {/* 角色信息 */}
      <div class="info-body">
        <div class="info-name" style={{ color: theme }}>
          {deskInfo.name}
          {isOffline && <span class="info-offline-badge">OFFLINE</span>}
          {!isOccupied && <span class="info-recruit-badge">招募中</span>}
        </div>
        <div class="info-role">{deskInfo.role}</div>

        {/* 实时状态 */}
        <div class="info-status-row">
          <span class="info-status-dot" style={{ backgroundColor: statusColor }} />
          <span class="info-status-text">{statusLabel}</span>
        </div>

        {/* 工作内容 */}
        <div class="info-activity">
          <span class="info-activity-label">当前任务：</span>
          <span class="info-activity-text">{activity}</span>
        </div>

        {/* 进度条 */}
        {agent?.status === 'working' && agent?.progress > 0 && (
          <div class="info-progress">
            <div class="info-progress-bar">
              <div
                class="info-progress-fill"
                style={{ width: `${agent.progress}%`, backgroundColor: theme }}
              />
            </div>
            <span class="info-progress-text">{agent.progress}%</span>
          </div>
        )}
      </div>

      {/* 三角指示器 */}
      <div class="info-arrow" style={{ borderTopColor: theme }} />
    </div>
  );
}
