import { Router } from "express";
import { queryOne, query, run } from "../db.js";
import { broadcast } from "../ws/handler.js";

const router = Router();

const HEARTBEAT_TIMEOUT = 60000; // 60 秒

router.post("/", (req, res) => {
  const { agentId, lastSeenTimestamp, model } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: "agentId is required" });
  }

  const agent = queryOne("SELECT * FROM agents WHERE id = ?", [agentId]);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const now = Date.now();

  // 心跳只保活，不盲目重置状态
  // 只有 agent 之前是 offline 时才重置为 idle（首次上线）
  // working/talking/thinking 等状态由 agent 自己管理
  const wasOffline = agent.current_status === "offline" || !agent.online;
  const newStatus = wasOffline ? "idle" : agent.current_status;

  if (model) {
    run("UPDATE agents SET online = 1, last_seen = ?, model = ?, current_status = ? WHERE id = ?", [now, model, newStatus, agentId]);
  } else {
    run("UPDATE agents SET online = 1, last_seen = ?, current_status = ? WHERE id = ?", [now, newStatus, agentId]);
  }

  // 处理离线队列 — 仅计数，不标记 delivered
  // delivered=1 由 /api/offline/pull 原子完成（拉取+标记）
  const pending = queryOne("SELECT COUNT(*) as count FROM offline_queue WHERE to_id = ? AND delivered = 0", [agentId]);

  // 广播上线状态（含 model 和 status，确保前端实时更新）
  broadcast({
    type: "agent_online",
    payload: { agentId, online: true, model: model || agent.model, status: newStatus },
  });

  // 查询新消息（自上次心跳以来）
  let newMessages = [];
  if (lastSeenTimestamp) {
    newMessages = query(
      `SELECT id, from_id, from_name, content, type, created_at
       FROM messages
       WHERE created_at > ? AND from_id != ?
       ORDER BY created_at ASC
       LIMIT 50`,
      [lastSeenTimestamp, agentId]
    ).map(msg => ({
      id: msg.id,
      from: msg.from_id,
      fromName: msg.from_name,
      content: msg.content,
      type: msg.type,
      timestamp: msg.created_at,
    }));
  }

  res.json({
    ok: true,
    pendingCount: pending ? pending.count : 0,
    newMessages,
    serverTimestamp: now,
  });
});

// 心跳超时检测 — 每 15 秒检查一次
export function startHeartbeatMonitor() {
  setInterval(() => {
    const now = Date.now();
    const offlineAgents = query(
      "SELECT id FROM agents WHERE online = 1 AND agent_type = ? AND last_seen < ?",
      ["agent", now - HEARTBEAT_TIMEOUT]
    );

    offlineAgents.forEach(agent => {
      run("UPDATE agents SET online = 0, current_status = ? WHERE id = ?", ["offline", agent.id]);
      broadcast({
        type: "agent_offline",
        payload: { agentId: agent.id, online: false },
      });
      console.log(`[Heartbeat] Agent ${agent.id} marked offline (no heartbeat for ${HEARTBEAT_TIMEOUT / 1000}s)`);
    });
  }, 15000);
}

export default router;