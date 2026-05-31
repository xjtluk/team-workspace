import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'workspace.db');

let db;
let SQL;

export async function initDB() {
  SQL = await initSqlJs();

  // 如果数据库文件存在则加载，否则新建
  let buffer;
  try {
    buffer = fs.readFileSync(DB_PATH);
  } catch {
    buffer = null;
  }

  db = buffer ? new SQL.Database(buffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      agent_type      TEXT DEFAULT 'agent',
      avatar          TEXT DEFAULT 'agent',
      color           TEXT DEFAULT '#4A90D9',
      grid_file       TEXT DEFAULT NULL,
      current_status  TEXT DEFAULT 'offline',
      current_activity TEXT DEFAULT '',
      progress        INTEGER DEFAULT 0,
      location        TEXT DEFAULT 'sofa',
      online          INTEGER DEFAULT 0,
      last_seen       INTEGER DEFAULT 0,
      created_at      INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      from_id     TEXT NOT NULL,
      from_name   TEXT NOT NULL,
      content     TEXT NOT NULL,
      type        TEXT DEFAULT 'text',
      reply_to    TEXT,
      delivered_to TEXT DEFAULT '[]',
      created_at  INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS status_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL,
      status      TEXT NOT NULL,
      activity    TEXT DEFAULT '',
      progress    INTEGER DEFAULT 0,
      location    TEXT,
      created_at  INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_status_log_agent_time ON status_log(agent_id, created_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS offline_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      to_id       TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      delivered   INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_offline_queue_pending ON offline_queue(to_id, delivered)`);

  // 插入初始 Agent 数据
  const now = Date.now();
  const agents = [
    ['cc', 'CC', 'agent', '#4A90D9', 'grids/clawd.js', now],
    ['xiaoma', '小马', 'agent', '#E6A23C', 'grids/marvis.js', now],
    ['kk', 'KK', 'human', '#FFD700', null, now],
  ];

  agents.forEach(([id, name, type, color, grid, ts]) => {
    db.run(
      `INSERT OR IGNORE INTO agents (id, name, agent_type, color, grid_file, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, type, color, grid, ts]
    );
  });

  saveDB();
  console.log('[DB] Initialized at', DB_PATH);
}

// 保存数据库到文件
function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

// 定期保存（每 30 秒）
setInterval(() => {
  if (db) saveDB();
}, 30000);

// 查询辅助方法
export function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function queryOne(sql, params = []) {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

export function run(sql, params = []) {
  db.run(sql, params);
}

export function getDB() {
  return db;
}
