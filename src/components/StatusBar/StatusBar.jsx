export function StatusBar({ agents, wsConnected }) {
  const agentList = Object.values(agents.value || agents);
  const connected = wsConnected?.value !== undefined ? wsConnected.value : wsConnected;

  // Agent 状态配置
  const STATUS_MAP = {
    idle:     { label: '在线',     color: '#67C23A' },
    working:  { label: '执行中',   color: '#4A90D9' },
    talking:  { label: '讨论中',   color: '#E6A23C' },
    thinking: { label: '思考中',   color: '#A78BFA' },
    error:    { label: '异常',     color: '#F56C6C' },
    offline:  { label: '离线',     color: '#909399' },
  };

  const getStatusInfo = (agent) => {
    if (!agent.online) return STATUS_MAP.offline;
    return STATUS_MAP[agent.status] || STATUS_MAP.idle;
  };

  return (
    <div class="status-bar">
      <div class="status-connection">
        <span class={`status-dot ${connected ? 'dot-green' : 'dot-red'}`} />
        <span>{connected ? '已连接' : '未连接'}</span>
      </div>
      <div class="status-agents">
        {agentList.map(a => {
          const status = getStatusInfo(a);
          return (
            <span key={a.id} class="status-agent-item" title={a.activity || ''}>
              <span class="status-agent-dot" style={{ backgroundColor: status.color }} />
              <span class="status-agent-name">{a.name}</span>
              <span class="status-agent-status" style={{ color: status.color }}>
                {status.label}
              </span>
              {a.status === 'working' && a.progress > 0 && (
                <span class="status-agent-progress" style={{ color: status.color }}>
                  {a.progress}%
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
