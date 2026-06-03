# BKS Team Workspace

像素风格 AI 团队协作工作室 — 多 Agent 实时协作平台。

## 简介

BKS Team Workspace 是一个基于 WebSocket 的实时协作平台，支持 3 个 AI Agent（CC、CX、小马）在像素风格界面中协作完成软件开发任务。

### Agent 角色

| Agent | 角色 | 职责 | 模型 |
|-------|------|------|------|
| **CC** | 研发部 Leader | 架构设计、技术决策、代码审查终审 | Claude Code |
| **CX** | 代码工程师 | 代码实现、重构、PR 管理 | DeepSeek V4 Pro / GLM-4.7 |
| **小马** | 项目部 Leader | 需求拆解、进度管理、文档统筹 | GLM-4.7-Flash |

### 核心功能

- **Hub-Spoke 协作架构**：小马为 Hub，CC/CX 为 Spokes
- **AI 工具调用**：bash、read_file、write_file、list_files、search_code（含安全校验）
- **多模型降级链**：SiliconFlow → 火山方舟 → 智谱 → MiMo
- **实时状态同步**：Agent 位置、活动、进度实时更新
- **心跳检测**：Marvis（人类）/ xiaoma-ai（AI）分时值班

## 技术栈

- **前端**：Preact + Vite + CSS Grid（像素风格）
- **后端**：Express + WebSocket (ws)
- **数据库**：SQLite (sql.js WASM, WAL 模式)
- **AI 引擎**：Anthropic API / OpenAI 兼容 API

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装

```bash
cd D:/BKS/projects/team-workspace
npm install
```

### 配置

创建 `.env` 文件（已在 `.gitignore` 中排除）：

```
SILICONFLOW_API_KEY=sk-xxx
ARK_API_KEY=ark-xxx
ZHIPU_API_KEY_CX=xxx
ZHIPU_API_KEY_XIAOMA=xxx
XIAOMI_API_KEY=sk-xxx
```

### 启动

```bash
# 开发模式（前端热重载 + 后端 watch）
npm run dev

# 生产模式
npm run build
npm start

# 使用 watchdog 进程守护（推荐生产环境）
npm run watchdog
```

### 启动 Agent

```bash
# 在单独的终端中启动各 Agent
node start-cc.mjs       # CC Agent
node start-cx.mjs       # CX Agent
node start-xiaoma.mjs   # 小马 Agent
```

## 项目结构

```
team-workspace/
├── server/              # Express 后端
│   ├── index.js         # 服务入口
│   ├── db.js            # SQLite 数据库 (WAL 模式)
│   └── routes/          # API 路由
├── src/
│   ├── components/      # Preact 前端组件
│   ├── sdk/             # AI SDK
│   │   ├── ai-reply.js  # AI 回复引擎（含安全校验）
│   │   ├── agent-client.js
│   │   └── memory.js
│   └── workers/         # Agent 监听器
│       ├── cc-listener.mjs
│       └── cx-listener.mjs
├── scripts/             # 运维脚本
│   ├── watchdog.mjs     # 进程守护（PM2 替代）
│   └── backup-db.mjs    # 数据库备份
├── public/              # 静态资源
├── .env                 # API Key（gitignored）
├── start-cc.mjs         # CC 启动入口
├── start-cx.mjs         # CX 启动入口
└── start-xiaoma.mjs     # 小马启动入口
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/heartbeat` | GET/POST | Agent 心跳 |
| `/api/messages` | GET | 消息历史 |
| `/api/messages` | POST | 发送消息 |
| `/api/agents` | GET | Agent 列表 |
| `/api/agents/:id` | PUT | 更新 Agent 状态 |

## 运维

### 数据库备份

```bash
npm run backup                    # 手动备份
node scripts/backup-db.mjs --restore workspace_2026-06-03_120000.db  # 恢复
```

备份保存在 `data/backups/`，自动保留最近 30 份，watchdog 每日自动备份。

### 进程守护

```bash
npm run watchdog          # 启动所有服务 + 守护
npm run watchdog:no-cx    # 不启动 CX
```

功能：
- 崩溃自动重启（指数退避，最大 20 次）
- HTTP 健康探针（每 30 秒，连续 5 次失败自动重启服务）
- 每日数据库备份
- 优雅退出（SIGINT/SIGTERM）

### 日志

日志文件在 `logs/` 目录：
- `watchdog.log` — 守护进程日志
- `workspace-server.log` — 服务器日志
- `cc-listener.log` / `cx-listener.log` / `xiaoma-listener.log` — Agent 日志

## 安全

- API Key 存储在 `.env` 文件，不入源码
- AI 工具调用含安全校验：bash 命令黑名单、文件路径边界检查
- `generateReply` 支持 `modelOverride` 参数，避免 `process.env` 并发竞态

## 已知限制

- **PM2 在 Windows 上损坏**：使用 `scripts/watchdog.mjs` 替代
- **DeepSeek V4 Pro 工具调用格式不兼容**：XML 格式未被解析器识别
- **SQLite WASM 并发写入**：已启用 WAL + busy_timeout 缓解

## 许可证

私有项目，仅限 BKS 团队内部使用。
