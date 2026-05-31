/**
 * 共享记忆模块 — 群聊 Agent 和 Claude Code 会话共享同一份记忆
 *
 * 记忆文件：D:/BKS/team/memory/shared-journal.jsonl
 * 格式：每行一条 JSON 记录 { time, source, event, content }
 *
 * 群聊 Agent 每次收到/回复消息时写入
 * Claude Code 会话每次启动时读取
 * 双方通过同一个文件了解发生了什么
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = 'D:/BKS/team/memory';
const JOURNAL_FILE = join(MEMORY_DIR, 'shared-journal.jsonl');
const MAX_ENTRIES = 200; // 最多保留 200 条

if (!existsSync(MEMORY_DIR)) {
  mkdirSync(MEMORY_DIR, { recursive: true });
}

/**
 * 写入一条记忆
 * @param {string} source — 'cc' | 'xiaoma' | 'cc-claude' | 'xiaoma-claude' | 'kk'
 * @param {string} event — 'message_received' | 'message_sent' | 'task_started' | 'task_done' | 'decision' | 'note'
 * @param {string} content — 内容描述
 */
export function writeMemory(source, event, content) {
  const entry = JSON.stringify({
    time: new Date().toISOString(),
    source,
    event,
    content: content.substring(0, 500), // 限制长度
  }) + '\n';
  appendFileSync(JOURNAL_FILE, entry, 'utf8');
}

/**
 * 读取最近 N 条记忆
 * @param {number} limit — 最多读取条数
 * @returns {Array} 记忆条目数组
 */
export function readMemory(limit = 50) {
  if (!existsSync(JOURNAL_FILE)) return [];
  try {
    const lines = readFileSync(JOURNAL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const entries = lines.slice(-limit).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    return entries;
  } catch {
    return [];
  }
}

/**
 * 获取记忆摘要（给 Agent 的 system prompt 用）
 * @param {number} limit — 最近 N 条
 * @returns {string} 格式化的记忆文本
 */
export function getMemorySummary(limit = 30) {
  const entries = readMemory(limit);
  if (entries.length === 0) return '(暂无共享记忆)';

  return entries.map(e => {
    const time = e.time.substring(11, 16); // HH:MM
    const source = { cc: 'CC', xiaoma: '小马', 'cc-claude': 'CC(外部)', 'xiaoma-claude': '小马(外部)', kk: 'KK' }[e.source] || e.source;
    return `[${time}] ${source} ${e.event}: ${e.content}`;
  }).join('\n');
}

/**
 * 清理旧记忆（保留最近 MAX_ENTRIES 条）
 */
export function trimMemory() {
  if (!existsSync(JOURNAL_FILE)) return;
  try {
    const lines = readFileSync(JOURNAL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length > MAX_ENTRIES) {
      const kept = lines.slice(-MAX_ENTRIES);
      writeFileSync(JOURNAL_FILE, kept.join('\n') + '\n', 'utf8');
    }
  } catch {}
}
