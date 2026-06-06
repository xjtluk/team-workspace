const clients = new Set();

export function addClient(ws) {
  clients.add(ws);
}

export function removeClient(ws) {
  clients.delete(ws);
}

export function getClientCount() {
  return clients.size;
}

export function broadcast(event, excludeSenderId = null) {
  const data = JSON.stringify(event);
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      if (excludeSenderId && ws.agentId === excludeSenderId) {
        return;
      }
      ws.send(data);
    }
  });
}

export function broadcastStatusChange(agentId, status, activity, progress, location, model = '') {
  broadcast({
    type: 'status_change',
    payload: { agentId, status, activity, progress, location, model, timestamp: Date.now() },
  });
}
