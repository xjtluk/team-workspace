/**
 * Agent 记忆模块
 * 从团队资源中加载上下文，让 Agent 知道"我们是谁、在做什么、聊过什么"
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TEAM_DIR = 'D:/BKS/team';
const PROJECT_DIR = 'D:/BKS/projects/team-workspace';

/**
 * 加载团队记忆
 * @returns {string} 格式化的上下文文本
 */
export function loadTeamMemory() {
  const parts = [];

  // 1. 通信记录 — CC 和小马的全部往来
  try {
    const toCC = readFileSync(join(TEAM_DIR, '通信', 'to_CC.md'), 'utf8');
    const toXiaoma = readFileSync(join(TEAM_DIR, '通信', 'to_小马.md'), 'utf8');
    parts.push('=== 团队通信记录 ===\n');
    parts.push('--- 小马发给CC的信 ---\n' + toCC.substring(0, 3000));
    parts.push('\n--- CC发给小马的信 ---\n' + toXiaoma.substring(0, 3000));
  } catch (e) {
    parts.push('通信记录加载失败: ' + e.message);
  }

  // 2. 回顾日志
  try {
    const retroDir = join(TEAM_DIR, '回顾日志');
    const files = readdirSync(retroDir).filter(f => f.endsWith('.md')).sort().slice(-2);
    files.forEach(f => {
      const content = readFileSync(join(retroDir, f), 'utf8');
      parts.push(`\n=== 回顾日志 ${f} ===\n` + content.substring(0, 2000));
    });
  } catch (e) {}

  // 3. 团队协作框架
  try {
    const framework = readFileSync(join(TEAM_DIR, '团队协作决策框架.md'), 'utf8');
    parts.push('\n=== 团队协作决策框架 ===\n' + framework.substring(0, 1500));
  } catch (e) {}

  // 4. 技术方案
  try {
    const techSpec = readFileSync(join(PROJECT_DIR, 'docs', '技术方案_团队工作室.md'), 'utf8');
    parts.push('\n=== 技术方案摘要 ===\n' + techSpec.substring(0, 2000));
  } catch (e) {}

  // 5. PRD
  try {
    const prd = readFileSync(join(PROJECT_DIR, 'docs', 'PRD_团队工作室.md'), 'utf8');
    parts.push('\n=== PRD 摘要 ===\n' + prd.substring(0, 2000));
  } catch (e) {}

  return parts.join('\n');
}

/**
 * 加载群聊历史
 * @param {number} limit — 消息条数
 * @returns {Array} 消息数组
 */
export async function loadChatHistory(limit = 50) {
  try {
    const res = await fetch(`http://localhost:3210/api/history?limit=${limit}`);
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}
