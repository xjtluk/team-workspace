/**
 * 共享记忆模块 — 从群聊历史 API 获取最近消息作为 Agent 上下文
 *
 * 设计变更（2026-06-01）：
 * - 去掉 shared-journal.jsonl，统一使用 /api/history 作为唯一数据源
 * - 消除跨进程写冲突和重复问题
 * - memory-summary.md 保留但不再自动更新
 */

const HISTORY_API = 'http://localhost:3210/api/history';

/**
 * 从 history API 获取最近消息并格式化为 Agent 上下文
 * @param {number} limit — 最近 N 条消息
 * @returns {Promise<string>} 格式化的记忆文本
 */
export async function getFullMemory(limit = 30) {
  try {
    const res = await fetch(`${HISTORY_API}?limit=${limit}`);
    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) return '(暂无群聊记录)';

    const lines = messages.map(m => {
      const time = new Date(m.timestamp).toISOString().substring(11, 16); // HH:MM
      const name = m.fromName || m.from;
      return `[${time}] ${name}: ${m.content}`;
    });

    return '=== 最近群聊记录 ===\n' + lines.join('\n');
  } catch (err) {
    return `(群聊历史加载失败: ${err.message})`;
  }
}
