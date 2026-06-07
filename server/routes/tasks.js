import { Router } from "express";
import { randomUUID } from "crypto";
import { broadcast } from "../ws/broadcast.js";
import { query, run, queryOne } from "../db.js";

const router = Router();

// Helper: fetch subtasks and assemble the full task response object
function assembleTask(row) {
  const subtaskRows = query(
    "SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order, created_at",
    [row.id]
  );
  
  // Parse dependency fields (stored as JSON strings)
  let blockedBy = [];
  let blocks = [];
  try {
    blockedBy = JSON.parse(row.blocked_by || '[]');
  } catch {
    blockedBy = [];
  }
  try {
    blocks = JSON.parse(row.blocks || '[]');
  } catch {
    blocks = [];
  }
  
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    blockedBy,  // Tasks that block this task
    blocks,      // Tasks that this task blocks
    subtasks: subtaskRows.map(s => ({
      id: s.id,
      title: s.title,
      assignee: "",
      status: s.status,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/tasks
router.get("/", (_req, res) => {
  const rows = query("SELECT * FROM tasks ORDER BY created_at DESC");
  res.json(rows.map(assembleTask));
});

// GET /api/tasks/yesterday
router.get("/yesterday", (_req, res) => {
  const now = new Date();
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const yesterdayEnd = yesterdayStart + 24 * 60 * 60 * 1000 - 1;

  const rows = query(
    "SELECT * FROM tasks WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC",
    [yesterdayStart, yesterdayEnd]
  );

  const completed = [];
  const incomplete = [];
  for (const row of rows) {
    const task = assembleTask(row);
    if (row.status === "completed") {
      completed.push(task);
    } else {
      incomplete.push(task);
    }
  }

  res.json({
    date: new Date(yesterdayStart).toISOString().split("T")[0],
    completed,
    incomplete,
    summary: {
      total: rows.length,
      completed: completed.length,
      incomplete: incomplete.length,
    },
  });
});

// POST /api/tasks
router.post("/", (req, res) => {
  const { title, subtasks, blocked_by, blocks } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title 不能为空" });
  }

  const now = Date.now();
  const taskId = randomUUID();

  // Validate and serialize dependency fields
  const blockedByStr = JSON.stringify(Array.isArray(blocked_by) ? blocked_by : []);
  const blocksStr = JSON.stringify(Array.isArray(blocks) ? blocks : []);

  run(
    "INSERT INTO tasks (id, title, status, blocked_by, blocks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [taskId, title.trim(), "pending", blockedByStr, blocksStr, now, now]
  );

  const taskSubtasks = [];
  if (Array.isArray(subtasks) && subtasks.length > 0) {
    let sortOrder = 0;
    for (const st of subtasks) {
      if (!st.title || typeof st.title !== "string" || !st.title.trim()) continue;
      const VALID = ["pending", "in_progress", "completed"];
      const subId = randomUUID();
      const subStatus = VALID.includes(st.status) ? st.status : "pending";
      run(
        "INSERT INTO subtasks (id, task_id, title, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [subId, taskId, st.title.trim(), subStatus, sortOrder++, now, now]
      );
      taskSubtasks.push({
        id: subId,
        title: st.title.trim(),
        assignee: (st.assignee || "").trim(),
        status: subStatus,
      });
    }
  }

  // Auto-complete parent if all subtasks are completed
  const finalStatus = taskSubtasks.length > 0 && taskSubtasks.every(s => s.status === "completed")
    ? "completed"
    : "pending";
  if (finalStatus === "completed") {
    run("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", ["completed", now, taskId]);
  }

  const task = {
    id: taskId,
    title: title.trim(),
    status: finalStatus,
    blockedBy: JSON.parse(blockedByStr),
    blocks: JSON.parse(blocksStr),
    subtasks: taskSubtasks,
    createdAt: now,
    updatedAt: now,
  };

  broadcast({ type: "task_update", payload: { action: "created", taskId: task.id, task } });
  res.status(201).json(task);
});

// Helper: Check if a task can be started (all blocked_by tasks are completed)
function canTaskStart(taskRow) {
  try {
    const blockedBy = JSON.parse(taskRow.blocked_by || '[]');
    if (blockedBy.length === 0) return true;
    
    const placeholders = blockedBy.map(() => '?').join(',');
    const blockingTasks = query(
      `SELECT id, status FROM tasks WHERE id IN (${placeholders})`,
      blockedBy
    );
    
    return blockingTasks.every(t => t.status === 'completed');
  } catch {
    return true; // If parse error, allow start
  }
}

// Helper: Auto-unlock downstream tasks when a task is completed
function autoUnlockDownstream(taskId) {
  try {
    const taskRow = queryOne("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (!taskRow) return;
    
    const blocks = JSON.parse(taskRow.blocks || '[]');
    if (blocks.length === 0) return;
    
    // Check each blocked task to see if it can now start
    for (const blockedTaskId of blocks) {
      const blockedTask = queryOne("SELECT * FROM tasks WHERE id = ?", [blockedTaskId]);
      if (blockedTask && blockedTask.status === 'pending') {
        if (canTaskStart(blockedTask)) {
          console.log(`[Tasks] Task ${blockedTaskId} can now start (all dependencies completed)`);
          broadcast({ 
            type: "task_update", 
            payload: { 
              action: "unlocked", 
              taskId: blockedTaskId,
              message: `依赖任务 ${taskId} 已完成，现在可以开始`
            } 
          });
        }
      }
    }
  } catch (err) {
    console.error('[Tasks] Error in autoUnlockDownstream:', err.message);
  }
}

// PUT /api/tasks/:id
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { title, status, blocked_by, blocks } = req.body;

  const taskRow = queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!taskRow) {
    return res.status(404).json({ error: "任务不存在" });
  }

  const now = Date.now();
  
  // Update title if provided
  if (title && typeof title === "string" && title.trim()) {
    run("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?", [title.trim(), now, id]);
  }
  
  // Update dependencies if provided
  if (Array.isArray(blocked_by)) {
    const blockedByStr = JSON.stringify(blocked_by);
    run("UPDATE tasks SET blocked_by = ?, updated_at = ? WHERE id = ?", [blockedByStr, now, id]);
  }
  if (Array.isArray(blocks)) {
    const blocksStr = JSON.stringify(blocks);
    run("UPDATE tasks SET blocks = ?, updated_at = ? WHERE id = ?", [blocksStr, now, id]);
  }
  
  // Update status if provided
  if (status && ["pending", "in_progress", "completed"].includes(status)) {
    run("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", [status, now, id]);
    
    // If task is completed, auto-unlock downstream tasks
    if (status === "completed") {
      autoUnlockDownstream(id);
    }
  }

  broadcast({ type: "task_update", payload: { action: "updated", taskId: id } });
  const updated = queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
  res.json(assembleTask(updated));
});

// PUT /api/tasks/:id/subtasks/:subId
router.put("/:id/subtasks/:subId", (req, res) => {
  const { id, subId } = req.params;
  const { status } = req.body;

  const VALID_STATUSES = ["pending", "in_progress", "completed"];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status 必须是 ${VALID_STATUSES.join(" / ")} 之一` });
  }

  const taskRow = queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!taskRow) {
    return res.status(404).json({ error: "任务不存在" });
  }

  const subtaskRow = queryOne("SELECT * FROM subtasks WHERE id = ? AND task_id = ?", [subId, id]);
  if (!subtaskRow) {
    return res.status(404).json({ error: "子任务不存在" });
  }

  const now = Date.now();
  run("UPDATE subtasks SET status = ?, updated_at = ? WHERE id = ?", [status, now, subId]);

  // Auto-sync parent task status
  const allSubtasks = query("SELECT * FROM subtasks WHERE task_id = ?", [id]);
  if (allSubtasks.length > 0 && allSubtasks.every(s => s.status === "completed")) {
    run("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", ["completed", now, id]);
  } else if (allSubtasks.some(s => s.status === "in_progress")) {
    run("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", ["pending", now, id]);
  }

  broadcast({ type: "task_update", payload: { action: "subtask_updated", taskId: id, subtaskId: subId, status } });
  const updated = queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
  res.json(assembleTask(updated));
});

// DELETE /api/tasks/:id
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const taskRow = queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!taskRow) {
    return res.status(404).json({ error: "任务不存在" });
  }
  run("DELETE FROM subtasks WHERE task_id = ?", [id]);
  run("DELETE FROM tasks WHERE id = ?", [id]);
  broadcast({ type: "task_update", payload: { action: "deleted", taskId: id } });
  res.json({ ok: true, deleted: id });
});

// DELETE /api/tasks
router.delete("/", (_req, res) => {
  const countRow = queryOne("SELECT COUNT(*) as cnt FROM tasks");
  const count = countRow ? countRow.cnt : 0;
  run("DELETE FROM subtasks");
  run("DELETE FROM tasks");
  broadcast({ type: "task_update", payload: { action: "cleared" } });
  res.json({ ok: true, deletedCount: count });
});

export default router;