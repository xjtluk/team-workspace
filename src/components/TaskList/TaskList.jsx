import { useState, useEffect } from "preact/hooks";
import "./TaskList.css";

const STATUS_COLORS = {
  pending: "#909399",
  in_progress: "#E6A23C",
  completed: "#67C23A",
};

const STATUS_LABELS = {
  pending: "pending",
  in_progress: "doing",
  completed: "done",
};

const TASK_STATUS_LABELS = {
  pending: "PENDING",
  completed: "DONE",
};

const TASK_STATUS_COLORS = {
  pending: "#E6A23C",
  completed: "#67C23A",
};

// Helper: Check if a task is blocked (has uncompleted dependencies)
function isTaskBlocked(task) {
  if (!task.blockedBy || task.blockedBy.length === 0) return false;
  // This is a simplified check - in real app, need to fetch status of blockedBy tasks
  return task.status === 'pending' && task.blockedBy.length > 0;
}

// Helper: Get dependency tooltip text
function getDependencyText(task) {
  const parts = [];
  if (task.blockedBy && task.blockedBy.length > 0) {
    parts.push(`Blocked by: ${task.blockedBy.join(', ')}`);
  }
  if (task.blocks && task.blocks.length > 0) {
    parts.push(`Blocks: ${task.blocks.join(', ')}`);
  }
  return parts.join(' | ');
}

export function TaskList() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showYesterday, setShowYesterday] = useState(false);
  const [yesterdayData, setYesterdayData] = useState(null);
  const [yesterdayLoading, setYesterdayLoading] = useState(false);

  function fetchTasks() {
    return fetch("/api/tasks")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        setTasks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchTasks();

    let ws = null;
    let reconnectTimer = null;

    const connect = async () => {
      try {
        const res = await fetch("/api/auth/token");
        const { token } = await res.json();
        ws = new WebSocket(`ws://${location.host}/ws?token=${token}`);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "task_update") {
              fetchTasks();
            }
          } catch (_) { /* ignore malformed messages */ }
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => ws?.close();
      } catch (_) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  function openYesterday() {
    setShowYesterday(true);
    setYesterdayLoading(true);
    fetch("/api/tasks/yesterday")
      .then((res) => res.json())
      .then((data) => { setYesterdayData(data); setYesterdayLoading(false); })
      .catch(() => { setYesterdayData(null); setYesterdayLoading(false); });
  }

  function closeYesterday() {
    setShowYesterday(false);
  }

  function handleSubtaskClick(taskId, subId) {
    fetch(`/api/tasks/${taskId}/subtasks/${subId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(() => fetchTasks())
      .catch((err) => {
        console.error("Failed to update subtask:", err);
      });
  }

  let body;
  if (loading) {
    body = <div class="task-list-empty">loading...</div>;
  } else if (error) {
    body = <div class="task-list-error">err: {error}</div>;
  } else if (tasks.length === 0) {
    body = <div class="task-list-empty">no tasks yet</div>;
  } else {
    body = (
      <div class="task-list-body">
        {tasks.map((task) => (
          <div key={task.id} class={`task-card ${isTaskBlocked(task) ? 'task-blocked' : ''}`}>
            <div class="task-card-head">
              <span class="task-card-title">
                {task.title}
                {isTaskBlocked(task) && <span class="task-blocked-badge" title="Waiting for dependencies">🔒</span>}
              </span>
              <span
                class="task-card-status"
                style={{ color: TASK_STATUS_COLORS[task.status] || "#909399" }}
              >
                {TASK_STATUS_LABELS[task.status] || task.status}
              </span>
            </div>
            {(task.blockedBy || task.blocks) && (task.blockedBy?.length > 0 || task.blocks?.length > 0) && (
              <div class="task-dependencies" title={getDependencyText(task)}>
                {task.blockedBy && task.blockedBy.length > 0 && (
                  <span class="dep-badge dep-blocked-by">
                    ⏳ Waits for: {task.blockedBy.slice(0, 2).join(', ')}{task.blockedBy.length > 2 ? '...' : ''}
                  </span>
                )}
                {task.blocks && task.blocks.length > 0 && (
                  <span class="dep-badge dep-blocks">
                    🔓 Unlocks: {task.blocks.slice(0, 2).join(', ')}{task.blocks.length > 2 ? '...' : ''}
                  </span>
                )}
              </div>
            )}
            {task.subtasks.length > 0 && (
              <div class="task-subtasks">
                {task.subtasks.map((sub) => (
                  <div key={sub.id} class="subtask-row" onClick={() => handleSubtaskClick(task.id, sub.id)}>
                    <span
                      class="subtask-dot"
                      style={{ backgroundColor: STATUS_COLORS[sub.status] || "#909399" }}
                    />
                    <span class="subtask-title">{sub.title}</span>
                    {sub.assignee && (
                      <span class="subtask-assignee">@{sub.assignee}</span>
                    )}
                    <span
                      class="subtask-status"
                      style={{ color: STATUS_COLORS[sub.status] || "#909399" }}
                    >
                      {STATUS_LABELS[sub.status] || sub.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div class="task-list">
      <div class="task-list-header">
        TASKS
        <div class="task-list-header-right">
          {!loading && !error && <span class="task-list-count">{tasks.length}</span>}
          <button class="task-list-yday-btn" onClick={openYesterday} title="昨日小记">Y-DAY</button>
        </div>
      </div>
      {body}
      {showYesterday && (
        <div class="yesterday-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeYesterday(); }}>
          <div class="yesterday-panel">
            <div class="yesterday-header">
              <button class="yesterday-back" onClick={closeYesterday}>&larr; 返回</button>
              <span class="yesterday-title">昨日小记 {yesterdayData?.date || ''}</span>
            </div>
            <div className="yesterday-body">
              {yesterdayLoading ? (
                <div class="yesterday-loading">loading...</div>
              ) : !yesterdayData || (!yesterdayData.completed?.length && !yesterdayData.incomplete?.length) ? (
                <div class="yesterday-empty">昨日无任务记录</div>
              ) : (
                <>
                  {yesterdayData.completed?.length > 0 && (
                    <div class="yesterday-section">
                      <div class="yesterday-section-title" style={{ color: '#67C23A' }}>
                        已完成 ({yesterdayData.completed.length})
                      </div>
                      {yesterdayData.completed.map((t) => (
                        <div key={t.id} class="yesterday-item done">
                          <span class="yesterday-item-title">{t.title}</span>
                          {t.assignee && <span class="yesterday-item-assignee">@{t.assignee}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {yesterdayData.incomplete?.length > 0 && (
                    <div class="yesterday-section">
                      <div class="yesterday-section-title" style={{ color: '#E6A23C' }}>
                        未完成 ({yesterdayData.incomplete.length})
                      </div>
                      {yesterdayData.incomplete.map((t) => (
                        <div key={t.id} class="yesterday-item incomplete">
                          <span class="yesterday-item-title">{t.title}</span>
                          {t.assignee && <span class="yesterday-item-assignee">@{t.assignee}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div class="yesterday-footer">
                    共 {yesterdayData.summary?.total || 0} 项 | 完成 {yesterdayData.summary?.completed || 0} | 未完成 {yesterdayData.summary?.incomplete || 0}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
