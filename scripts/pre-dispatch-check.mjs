#!/usr/bin/env node
/**
 * Pre-dispatch Check — CC 派发前三板斧验证器
 * 
 * 目标：程序化强制 CC 遵守三板斧规则
 * 对标：Routa (transition-gates) / ClawTeam (SprintContract test_command)
 * 
 * 三板斧规则：
 * 1. 文件范围 ≤ 5 个
 * 2. 任务描述必须包含 DOM 位置（UI 任务）
 * 3. 必须用 CX 执行的任务不能自己动手
 */

import { readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_DIR = 'D:/BKS/team';
const VIOLATIONS_LOG = join(__dirname, '..', 'data', 'violations.jsonl');

/**
 * 三板斧验证器
 * @param {Object} task - 任务对象 { title, description, assignee, files }
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateThreeAxes(task) {
  const errors = [];
  const warnings = [];
  
  // 斧 1：文件范围检查（≤ 5 个）
  if (task.files && Array.isArray(task.files)) {
    if (task.files.length > 5) {
      errors.push(`文件范围超限：${task.files.length} 个文件（最多 5 个）`);
    }
  }
  
  // 斧 2：UI 任务必须指定 DOM 位置
  const isUITask = /(按钮|弹窗|面板|界面|UI|样式|布局|CSS|组件)/i.test(task.title + ' ' + (task.description || ''));
  if (isUITask) {
    const hasDOMLocation = /(在.+中|在.+里|在.+内|添加到.+中)/i.test(task.title + ' ' + (task.description || ''));
    if (!hasDOMLocation) {
      errors.push('UI 任务未指定 DOM 位置（四要素不全）');
    }
  }
  
  // 斧 3：CC 不能越权执行 CX 的任务
  const ccOnlyPatterns = [
    '架构设计',
    '技术决策',
    '方案审查',
    '任务派发',
  ];
  const cxPatterns = [
    '代码实现',
    'BUG 修复',
    '代码重构',
    '单元测试',
    'function ',
    'const ',
    'class ',
    'import ',
  ];
  
  const isCCOnly = ccOnlyPatterns.some(p => (task.title + ' ' + (task.description || '')).includes(p));
  const isCXTask = cxPatterns.some(p => (task.title + ' ' + (task.description || '')).includes(p));
  
  if (isCXTask && task.assignee === 'cc') {
    errors.push('违反铁律：CC 不能执行 CX 的任务（代码实现类）');
  }
  
  // 警告：任务过大（可能需要拆分）
  if (task.description && task.description.length > 500) {
    warnings.push('任务描述过长，建议拆分（> 500 字符）');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 检查任务是否适合派发给 CX
 * @param {string} taskDescription - 任务描述
 * @returns {{ suitable: boolean, reason: string }}
 */
export function checkTaskSuitability(taskDescription) {
  // 轻量任务：可以直接执行
  const lightPatterns = ['读取', '查看', '列出', '检查', '验证', '统计'];
  if (lightPatterns.some(p => taskDescription.includes(p)) && taskDescription.length < 200) {
    return { suitable: true, reason: '轻量任务，适合快速执行' };
  }
  
  // 重量任务：需要拆分
  const heavyPatterns = ['批量', '重构', '多文件', '架构', '整个', '全部', '所有文件'];
  if (heavyPatterns.some(p => taskDescription.includes(p)) || taskDescription.length > 1000) {
    return { suitable: false, reason: '任务过大，建议拆分后派发' };
  }
  
  return { suitable: true, reason: '任务适中，可以派发' };
}

/**
 * 记录违规日志
 * @param {string} rule - 违反的规则
 * @param {string} taskTitle - 任务标题
 * @param {string} description - 违规描述
 */
export function logViolation(rule, taskTitle, description) {
  try {
    const logEntry = {
      timestamp: Date.now(),
      rule,
      taskTitle,
      description,
      agent: 'cc',
    };

    appendFileSync(VIOLATIONS_LOG, JSON.stringify(logEntry) + '\n');
    console.warn(`[PreDispatch] 违规已记录: ${rule} - ${taskTitle}`);
  } catch (err) {
    console.error('[PreDispatch] 记录违规日志失败:', err.message);
  }
}

/**
 * 从 CX 规则文件读取禁止 CC 操作的清单
 * @returns {string[]} 禁止操作的列表
 */
export function loadProhibitedActions() {
  try {
    const cxRulesPath = join(PROJECT_DIR, 'CLAUDE.md');
    const content = readFileSync(cxRulesPath, 'utf-8');
    
    // 提取禁止 CC 操作的规则（简单实现）
    const prohibitions = [];
    if (content.includes('CC 不动手写代码')) {
      prohibitions.push('CC 不能手写代码');
    }
    if (content.includes('CX 只做实现')) {
      prohibitions.push('CC 不能做实现类任务');
    }
    
    return prohibitions;
  } catch (err) {
    console.warn('[PreDispatch] 无法读取 CC 规则文件:', err.message);
    return [];
  }
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const taskJson = process.argv[2];
  if (!taskJson) {
    console.error('用法: node pre-dispatch-check.mjs \'{"title":"...","description":"...","assignee":"..."}\'');
    process.exit(1);
  }
  
  try {
    const task = JSON.parse(taskJson);
    const { valid, errors, warnings } = validateThreeAxes(task);
    
    if (warnings.length > 0) {
      console.log('[PreDispatch] 警告:');
      warnings.forEach(w => console.log(`  ⚠️  ${w}`));
    }
    
    if (!valid) {
      console.error('[PreDispatch] 三板斧验证失败:');
      errors.forEach(e => console.error(`  ❌ ${e}`));
      logViolation('three_axes', task.title, errors.join('; '));
      process.exit(1);
    }
    
    console.log('[PreDispatch] ✅ 三板斧验证通过');
    process.exit(0);
  } catch (err) {
    console.error('[PreDispatch] 解析任务 JSON 失败:', err.message);
    process.exit(1);
  }
}

export default {
  validateThreeAxes,
  checkTaskSuitability,
  logViolation,
  loadProhibitedActions,
};
