import { Router } from "express";
import { query, run } from "../db.js";

const router = Router();

// GET /api/offline/pull?agentId=cc
// 原子操作：拉取离线消息 + 标记 delivered=1
router.get("/pull", (req, res) => {
  const { agentId } = req.query;

  if (!agentId) {
    return res.status(400).json({ error: "agentId is required" });
  }

  // 1. 查询未投递的离线消息（JOIN messages 获取完整内容）
  const messages = query(
    `SELECT
       o.id AS queue_id,
       o.message_id AS id,
       m.from_id AS "from",
       m.from_name AS "fromName",
       m.content,
       m.type,
       m.channel,
       m.reply_to AS "replyTo",
       m.created_at AS "timestamp"
     FROM offline_queue o
     JOIN messages m ON o.message_id = m.id
     WHERE o.to_id = ? AND o.delivered = 0
     ORDER BY o.created_at ASC
     LIMIT 200`,
    [agentId]
  );

  // 2. 标记为已投递（原子完成：先查后标，同一请求内完成）
  if (messages.length > 0) {
    run("UPDATE offline_queue SET delivered = 1 WHERE to_id = ? AND delivered = 0", [agentId]);
  }

  res.json({
    ok: true,
    count: messages.length,
    messages,
  });
});

export default router;