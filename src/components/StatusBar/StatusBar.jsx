export function StatusBar({ agents, wsConnected, onAgentClick }) {
  const agentList = Object.values(agents?.value || agents || {});
  const connected = wsConnected?.value !== undefined ? wsConnected.value : wsConnected;

  const aiAgents = agentList.filter(a => {
    if (a.agent_type !== 'agent') return false;
    if (!a.online) return false;
    return true;
  });

  const STATUS_MAP = {
    idle:     { label: '在线',    color: '#67C23A' },
    working:  { label: '工作中',  color: '#E6A23C' },
    talking:  { label: '讨论中',  color: '#E6A23C' },
    thinking: { label: '思考中',  color: '#A78BFA' },
    error:    { label: '异常',    color: '#F56C6C' },
    offline:  { label: '离线',    color: '#909399' },
  };

  const getStatusInfo = (agent) => {
    if (!agent.online) return STATUS_MAP.offline;
    return STATUS_MAP[agent.status] || STATUS_MAP.idle;
  };

  return (
    <div class="status-bar">
      <div class="status-connection">
        <span class="status-connection-prefix">工作室：</span>
        <span class={`status-dot ${connected ? 'dot-green' : 'dot-red'}`} />
        <span
          class="status-connection-state"
          style={{ color: connected ? '#67C23A' : '#F56C6C' }}
        >
          {connected ? '在线' : '离线'}
        </span>
      </div>

      <div class="status-agents">
        {aiAgents.map(a => {
          const status = getStatusInfo(a);
          return (
            <div
              key={a.id}
              class="status-agent-card"
              title={a.activity || ''}
              onClick={() => onAgentClick && onAgentClick(a)}
              style={{ cursor: 'pointer' }}
            >
              <div class="status-agent-row1">
                <span class="status-agent-name">{a.name}：</span>
                <span class="status-agent-status" style={{ color: status.color }}>
                  {status.label}
                </span>
                {a.status === 'working' && a.activity && (
                  <span class="status-agent-task">
                    | {a.activity}
                  </span>
                )}
                {a.status === 'working' && a.progress > 0 && (
                  <span class="status-agent-progress" style={{ color: status.color }}>
                    {a.progress}%
                  </span>
                )}
              </div>
              <div class="status-agent-row2">
                <span class="status-agent-model-label">当前模型：</span>
                <span class="status-agent-model-value">
                  {a.model || '—'}
                </span>
              </div>
            </div>
          );
        })}
        {aiAgents.length === 0 && (
          <div class="status-agent-empty">无活跃 Agent</div>
        )}
      </div>
    </div>
  );
}
