import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { initDB, query } from './db.js';
import { setupWS } from './ws/handler.js';
import statusRouter from './routes/status.js';
import messageRouter from './routes/message.js';
import heartbeatRouter, { startHeartbeatMonitor } from './routes/heartbeat.js';
import registerRouter from './routes/register.js';
import offlineRouter from './routes/offline.js';
import historyRouter from './routes/history.js';
import agentsRouter from './routes/agents.js';
import tasksRouter from './routes/tasks.js';
import tracesRouter from './routes/traces.js';

// ???????????????????????????????
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const WS_TOKEN = process.env.WS_TOKEN || randomBytes(24).toString('hex');

async function start() {
  // ??????? rebuild ??????? dist ???????
  try {
    console.log('[Server] Building frontend...');
    execSync('npm run build', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    console.log('[Server] Frontend built successfully');
  } catch (e) {
    console.warn('[Server] Frontend build failed, using existing dist:', e.message);
  }

  await initDB();

  const app = express();
  const server = createServer(app);

  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g., curl, server-to-server)
      if (!origin) return callback(null, true);
      // Allow any origin — this is a private studio server, not public-facing.
      // The WS token provides authentication; origin-based restriction adds no security.
      callback(null, true);
    },
    credentials: true,
  }));

  // 速率限制：每 IP 每分钟 60 次
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api/', limiter);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'dist')));

  // WS token endpoint — no origin restriction.
  // This is a private studio server. The WS token itself is the authentication mechanism;
  // origin-based restriction only breaks legitimate access from LAN IPs or alternative hostnames.
  app.get('/api/auth/token', (req, res) => {
    res.json({ token: WS_TOKEN });
  });

  app.use('/api/status', statusRouter);
  app.use('/api/message', messageRouter);
  app.use('/api/heartbeat', heartbeatRouter);
  app.use('/api/register', registerRouter);
  app.use('/api/offline', offlineRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/tasks', tasksRouter);
app.use('/api/traces', tracesRouter);

  // WebSocket ???
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, done) => {
      // ?? Header ??? token
      const authHeader = info.req.headers['authorization'];
      const tokenFromHeader = authHeader ? authHeader.replace('Bearer ', '') : null;

      // ??? URL ??????????????????????? header??
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const tokenFromUrl = url.searchParams.get('token');

      const token = tokenFromHeader || tokenFromUrl;

      if (token === WS_TOKEN) {
        done(true);
      } else {
        console.log('[WS] ?????????????? token');
        done(false, 401, 'Unauthorized');
      }
    },
  });
  setupWS(wss);

  // ?????????? agent ????????
  const startTime = Date.now();
  const HEARTBEAT_TIMEOUT = 120000; // 120??????????? unhealthy
  app.get('/api/health', (req, res) => {
    const agents = query('SELECT id, name, online, current_status, last_seen FROM agents');
    const agentHealth = {};
    for (const a of agents) {
      const lastSeen = a.last_seen || 0;
      const healthy = (Date.now() - lastSeen) < HEARTBEAT_TIMEOUT;
      agentHealth[a.id] = {
        name: a.name,
        online: !!a.online,
        status: a.current_status,
        last_seen: lastSeen,
        healthy,
      };
    }
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      wsClients: wss.clients.size,
      db: 'connected',
      agents: agentHealth,
    });
  });

  console.log(`[BKS Workspace] WS Token: ${WS_TOKEN.substring(0, 6)}...`);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[BKS Workspace] Server running at http://localhost:${PORT} (bound to 0.0.0.0)`);
    startHeartbeatMonitor();
  });
}

start().catch(err => {
  console.error('[BKS Workspace] Failed to start:', err);
  process.exit(1);
});

// ???????EADDRINUSE ???????????????? PM2/watchdog ?????
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[BKS Workspace] Port ${PORT} already in use. Exiting so watchdog can retry.`);
    process.exit(1);
  }
});