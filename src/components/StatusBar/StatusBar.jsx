export function StatusBar({ agents, wsConnected }) {
  const agentList = Object.values(agents.value || agents);
  const online = agentList.filter(a => a.online);

  return (
    <div class="status-bar">
      <div class="status-connection">
        <span class={`status-dot ${wsConnected.value || wsConnected ? 'dot-green' : 'dot-red'}`} />
        <span>{wsConnected.value || wsConnected ? '已连接' : '未连接'}</span>
      </div>
      <div class="status-agents">
        {agentList.map(a => (
          <span key={a.id} class={`status-agent ${a.online ? 'agent-online' : 'agent-offline'}`}>
            {a.name}
          </span>
        ))}
      </div>
    </div>
  );
}
