#!/usr/bin/env node
/**
 * 清理数据库中的 401 错误消息
 * 使用方式: node scripts/clean-401-errors.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import initSqlJs from 'sql.js';

const DB_PATH = join(process.cwd(), 'data', 'workspace.db');
const BACKUP_DIR = join(process.cwd(), 'data', 'backups');
const BACKUP_PATH = join(BACKUP_DIR, `workspace.db.backup_${Date.now()}.bin`);

async function clean401Errors() {
  console.log('[Clean] 开始清理 401 错误消息...');
  
  // 0. 确保备份目录存在
  if (!existsSync(BACKUP_DIR)) {
    console.log('[Clean] 创建备份目录...');
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  // 1. 备份数据库
  console.log('[Clean] 1. 备份数据库...');
  const dbData = readFileSync(DB_PATH);
  writeFileSync(BACKUP_PATH, dbData);
  console.log(`[Clean] 备份已保存: ${BACKUP_PATH}`);
  
  // 2. 加载数据库
  const SQL = await initSqlJs();
  const db = new SQL.Database(dbData);
  
  // 3. 查找实际的 401 错误消息（不是讨论）
  console.log('[Clean] 2. 查找 401 错误消息...');
  const result = db.exec(`
    SELECT id, from_name, substr(content, 1, 100) as preview 
    FROM messages 
    WHERE content LIKE '%Anthropic API error: 401%' 
    OR content LIKE '%401 Invalid API Key%'
    OR content LIKE '%401%Unauthorized%'
  `);
  
  if (!result.length || !result[0].values.length) {
    console.log('[Clean] ✅ 未找到需要清理的 401 错误消息');
    console.log('[Clean] （数据库中的 401 相关消息都是正常讨论）');
    return;
  }
  
  const messages = result[0].values;
  console.log(`[Clean] 找到 ${messages.length} 条 401 错误消息:`);
  messages.forEach(([id, from, preview]) => {
    console.log(`  - ID: ${id}, From: ${from}`);
    console.log(`    Content: ${preview}...`);
  });
  
  // 4. 删除错误消息
  console.log('\n[Clean] 3. 删除错误消息...');
  db.run(`
    DELETE FROM messages 
    WHERE content LIKE '%Anthropic API error: 401%' 
    OR content LIKE '%401 Invalid API Key%'
    OR content LIKE '%401%Unauthorized%'
  `);
  
  // 5. 验证删除
  const remaining = db.exec("SELECT COUNT(*) as cnt FROM messages WHERE content LIKE '%Anthropic API error: 401%'");
  console.log(`[Clean] 剩余 401 错误消息: ${remaining[0].values[0][0]}`);
  
  // 6. 保存数据库
  console.log('\n[Clean] 4. 保存数据库...');
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
  
  console.log('\n[Clean] ✅ 清理完成！');
  console.log(`[Clean] 备份文件: ${BACKUP_PATH}`);
  
  db.close();
}

clean401Errors().catch(err => {
  console.error('[Clean] ❌ 清理失败:', err);
  process.exit(1);
});
