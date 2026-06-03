import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import { setupWS } from './ws/handler.js';
import statusRouter from './routes/status.js';
import messageRouter from './routes/message.js';
import heartbeatRouter, { startHeartbeatMonitor } from './routes/heartbeat.js';
import registerRouter from './routes/register.js';
import historyRouter from './routes/history.js';
import agentsRouter from './routes/agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const WS_TOKEN = process.env.WS_TOKEN || randomBytes(24).toString('hex');

async function start() {
  await initDB();

  const app = express();
  const server = createServer(app);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'dist')));

  // 认证端点：前端获取 WS token
  app.get('/api/auth/token', (req, res) => {
    res.json({ token: WS_TOKEN });
  });

  app.use('/api/status', statusRouter);
  app.use('/api/message', messageRouter);
  app.use('/api/heartbeat', heartbeatRouter);
  app.use('/api/register', registerRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/agents', agentsRouter);

  // ✅ 修复 3.5：WebSocket 认证改为从 Header 或 subprotocol 获取 token
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, done) => {
      // 从多个位置尝试获取 token（安全性：不在 URL 中传输）
      const authHeader = info.req.headers['authorization'];
      const tokenFromHeader = authHeader ? authHeader.replace('Bearer ', '') : null;
      
      // 也从 URL 参数读取（向后兼容，但推荐用 header）
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const tokenFromUrl = url.searchParams.get('token');
      
      const token = tokenFromHeader || tokenFromUrl;
      
      if (token === WS_TOKEN) {
        done(true);
      } else {
        console.log('[WS] 连接被拒绝：无效 token');
        done(false, 401, 'Unauthorized');
      }
    },
  });
  setupWS(wss);

  // 健康检查
  const startTime = Date.now();
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      wsClients: wss.clients.size,
      db: 'connected',
    });
  });

  console.log(`[BKS Workspace] WS Token: ${WS_TOKEN.substring(0, 6)}...`);

  server.listen(PORT, () => {
    console.log(`[BKS Workspace] Server running at http://localhost:${PORT}`);
    startHeartbeatMonitor();
  });
}

start().catch(err => {
  console.error('[BKS Workspace] Failed to start:', err);
  process.exit(1);
});
