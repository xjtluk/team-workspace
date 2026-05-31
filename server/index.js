import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import { setupWS } from './ws/handler.js';
import statusRouter from './routes/status.js';
import messageRouter from './routes/message.js';
import heartbeatRouter from './routes/heartbeat.js';
import registerRouter from './routes/register.js';
import historyRouter from './routes/history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;

async function start() {
  // 初始化数据库（异步）
  await initDB();

  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // 静态文件（生产模式）
  app.use(express.static(path.join(__dirname, '..', 'dist')));

  // API 路由
  app.use('/api/status', statusRouter);
  app.use('/api/message', messageRouter);
  app.use('/api/heartbeat', heartbeatRouter);
  app.use('/api/register', registerRouter);
  app.use('/api/history', historyRouter);

  // WebSocket
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWS(wss);

  server.listen(PORT, () => {
    console.log(`[BKS Workspace] Server running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('[BKS Workspace] Failed to start:', err);
  process.exit(1);
});
