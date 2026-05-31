/**
 * 共享记忆模块 — 群聊 Agent 和 Claude Code 会话共享同一份记忆
 *
 * 记忆结构：
 * - shared-journal.jsonl — 最近的详细事件日志（保留 50 条）
 * - memory-summary.md — 往期记忆的压缩摘要（AI 生成）
 *
 * 当日志超过 50 条时，旧条目被压缩成摘要
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = 'D:/BKS/team/memory';
const JOURNAL_FILE = join(MEMORY_DIR, 'shared-journal.jsonl');
const SUMMARY_FILE = join(MEMORY_DIR, 'memory-summary.md');
const MAX_ENTRIES = 50; // 日志最多 50 条，超出部分压缩

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
 * 获取记忆摘要（给 Agent 的 system prompt 用）
 * 包含往期摘要 + 最近事件
 */
export function getFullMemory(limit = 30) {
  const parts = [];

  // 往期摘要
  if (existsSync(SUMMARY_FILE)) {
    const summary = readFileSync(SUMMARY_FILE, 'utf8').trim();
    if (summary) parts.push('=== 往期记忆摘要 ===\n' + summary);
  }

  // 最近事件
  const recent = readMemory(limit);
  if (recent.length > 0) {
    const lines = recent.map(e => {
      const time = e.time.substring(11, 16);
      const src = { cc: 'CC', xiaoma: '小马', 'cc-claude': 'CC(外部)', 'xiaoma-claude': '小马(外部)', kk: 'KK' }[e.source] || e.source;
      return `[${time}] ${src} ${e.event}: ${e.content}`;
    });
    parts.push('=== 最近事件 ===\n' + lines.join('\n'));
  }

  return parts.join('\n\n') || '(暂无共享记忆)';
}

/**
 * 压缩旧记忆 — 将超出 MAX_ENTRIES 的条目压缩成摘要
 * 返回需要被压缩的条目，由调用方发送给 AI 生成摘要
 */
export function getEntriesToCompress() {
  if (!existsSync(JOURNAL_FILE)) return [];
  try {
    const lines = readFileSync(JOURNAL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return [];
    const toCompress = lines.slice(0, lines.length - MAX_ENTRIES);
    return toCompress.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/**
 * 执行压缩：将旧条目替换为摘要
 * @param {string} summary — AI 生成的摘要文本
 */
export function compressMemory(summary) {
  if (!existsSync(JOURNAL_FILE)) return;
  try {
    const lines = readFileSync(JOURNAL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const kept = lines.slice(-MAX_ENTRIES);

    // 追加到现有摘要
    let existingSummary = '';
    if (existsSync(SUMMARY_FILE)) {
      existingSummary = readFileSync(SUMMARY_FILE, 'utf8').trim();
    }
    const newSummary = existingSummary
      ? existingSummary + '\n\n' + summary
      : summary;

    // 限制摘要长度（最多 3000 字符）
    const trimmedSummary = newSummary.length > 3000
      ? '...(早期记忆已省略)...\n\n' + newSummary.substring(newSummary.length - 2800)
      : newSummary;

    writeFileSync(SUMMARY_FILE, trimmedSummary, 'utf8');
    writeFileSync(JOURNAL_FILE, kept.join('\n') + '\n', 'utf8');
    console.log(`[Memory] 压缩了 ${lines.length - kept.length} 条旧记忆`);
  } catch {}
}

/**
 * 清理 + 自动压缩
 * 当日志超过 MAX_ENTRIES 时，触发压缩
 */
export function trimMemory() {
  const toCompress = getEntriesToCompress();
  if (toCompress.length === 0) return;

  // 生成简单摘要（不调 AI，用规则提取关键事件）
  const keyEvents = toCompress
    .filter(e => ['task_done', 'decision', 'online', 'offline'].includes(e.event))
    .map(e => `- [${e.time.substring(5, 16)}] ${e.source}: ${e.content}`)
    .join('\n');

  if (keyEvents) {
    compressMemory(keyEvents);
  } else {
    // 没有关键事件，直接截断
    if (!existsSync(JOURNAL_FILE)) return;
    const lines = readFileSync(JOURNAL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    writeFileSync(JOURNAL_FILE, lines.slice(-MAX_ENTRIES).join('\n') + '\n', 'utf8');
  }
}
