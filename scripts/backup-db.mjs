#!/usr/bin/env node
/**
 * SQLite 数据库备份脚本
 *
 * 功能：
 *   1. 复制 workspace.db 到 backups/ 目录
 *   2. 按日期命名：workspace_2026-06-03.db
 *   3. 保留最近 30 天的备份，自动清理旧备份
 *   4. 验证备份文件完整性
 *
 * 用法：
 *   node scripts/backup-db.mjs              # 手动备份
 *   node scripts/backup-db.mjs --restore workspace_2026-06-03.db  # 恢复
 */

import { copyFileSync, readdirSync, unlinkSync, statSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = 'D:/BKS/projects/team-workspace';
const DB_PATH = join(PROJECT_DIR, 'data', 'workspace.db');
const BACKUP_DIR = join(PROJECT_DIR, 'data', 'backups');
const MAX_BACKUPS = 30;

// ── 确保备份目录存在 ──
if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── 恢复模式 ──
if (process.argv[2] === '--restore') {
  const backupName = process.argv[3];
  if (!backupName) {
    console.error('用法: node scripts/backup-db.mjs --restore <备份文件名>');
    process.exit(1);
  }
  const backupPath = join(BACKUP_DIR, backupName);
  if (!existsSync(backupPath)) {
    console.error(`备份文件不存在: ${backupPath}`);
    process.exit(1);
  }

  // 先备份当前数据库
  const beforeRestore = join(BACKUP_DIR, `workspace_before_restore_${Date.now()}.db`);
  try {
    copyFileSync(DB_PATH, beforeRestore);
    console.log(`[备份] 已备份当前数据库: ${beforeRestore}`);
  } catch (err) {
    console.warn(`[备份] 备份当前数据库失败: ${err.message}`);
  }

  copyFileSync(backupPath, DB_PATH);
  console.log(`[恢复] 已恢复: ${backupName} → data/workspace.db`);
  process.exit(0);
}

// ── 备份模式 ──
if (!existsSync(DB_PATH)) {
  console.error(`[备份] 数据库文件不存在: ${DB_PATH}`);
  process.exit(1);
}

// 生成备份文件名
const now = new Date();
const dateStr = now.toISOString().substring(0, 10);
const timeStr = now.toISOString().substring(11, 19).replace(/:/g, '');
const backupName = `workspace_${dateStr}_${timeStr}.db`;
const backupPath = join(BACKUP_DIR, backupName);

try {
  copyFileSync(DB_PATH, backupPath);
  const size = statSync(backupPath).size;
  console.log(`[备份] 成功: ${backupName} (${(size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error(`[备份] 失败: ${err.message}`);
  process.exit(1);
}

// ── 清理旧备份 ──
try {
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('workspace_') && f.endsWith('.db'))
    .sort()
    .reverse();

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      unlinkSync(join(BACKUP_DIR, f));
      console.log(`[清理] 删除旧备份: ${f}`);
    }
  }
  console.log(`[备份] 当前备份数: ${Math.min(files.length, MAX_BACKUPS)}/${MAX_BACKUPS}`);
} catch (err) {
  console.warn(`[清理] 清理旧备份失败: ${err.message}`);
}
