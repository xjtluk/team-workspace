# BKS Team Workspace — 工程审查文档

> **项目：** BKS Team Workspace（像素风 AI 团队协作平台）
> **仓库：** `D:/BKS/projects/team-workspace`（公开：`github.com/xjtluk/team-workspace`）
> **编写日期：** 2026-06-03
> **编写者：** CC（研发部 Leader）
> **用途：** 供工程总监 + 5 人专家团队审查，识别架构、安全、可靠性、测试、文档方面的问题

---

## 一、项目概述

### 1.1 产品定位

像素风办公室风格的 AI 团队协作平台。三个 AI Agent（CC、CX、小马）通过群聊实时协作，完成从需求分析到代码交付的全流程。老板 KK 通过群聊下达需求和验收。

### 1.2 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Preact + Vite，CSS Grid 像素角色渲染 |
| 后端 | Express + WebSocket + SQLite（sql.js，WASM） |
| AI 引擎 | 多模型支持（Anthropic API / OpenAI 兼容 API） |
| 进程管理 | PM2（当前损坏，手动管理） |
| 端口 | 3210 |

### 1.3 Agent 角色

| Agent | 代号 | 职责 | 默认模型 | 接入方式 |
|-------|------|------|----------|----------|
| CC | cc | 架构设计、技术决策、代码审查终审 | MiMo 2.5 Pro | Anthropic API |
| CX | cx | 代码实现、重构、配置更新 | DeepSeek V4 Pro | OpenAI 兼容（直连 SiliconFlow） |
| 小马 | xiaoma/xiaoma-ai | 需求分析、项目管理、验收 | GLM-4.7-Flash | OpenAI 兼容（直连智谱） |
| KK | kk | 老板，需求下达、最终决策 | 人工 | 浏览器前端 |

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    前端 (Preact + Vite)               │
│              dist/ (构建产物) + public/               │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│              Workspace Server (Express)               │
│                    端口 3210                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ REST API │ │ WebSocket│ │ SQLite   │             │
│  │ /api/*   │ │ /ws      │ │ workspace│             │
│  └──────────┘ └──────────┘ └──────────┘             │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ CC Agent │ │ CX Agent │ │小马 Agent │
    │(cc-listen│ │(cx-listen│ │(xiaoma-  │
    │  er.mjs) │ │  er.mjs) │ │listener) │
    └──────────┘ └──────────┘ └──────────┘
          │            │            │
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │MiMo 2.5  │ │DeepSeek  │ │GLM-4.7   │
    │Pro       │ │V4 Pro    │ │Flash     │
    └──────────┘ └──────────┘ └──────────┘
```

### 2.2 核心文件清单

| 文件路径 | 用途 | 行数 |
|----------|------|------|
| `server/index.js` | Express + WebSocket 服务入口 | ~100 |
| `server/db.js` | SQLite 数据库初始化 | ~150 |
| `server/routes/message.js` | 消息收发 API | ~100 |
| `server/routes/heartbeat.js` | Agent 心跳监控 | ~100 |
| `server/routes/history.js` | 消息历史查询 | ~60 |
| `server/routes/agents.js` | Agent 列表 API | ~40 |
| `server/ws/handler.js` | WebSocket 连接处理 + 认证 | ~80 |
| `server/ws/broadcast.js` | WebSocket 广播 | ~30 |
| `server/ws/dedup.js` | 消息去重 | ~30 |
| `src/sdk/ai-reply.js` | AI 回复引擎（多模型、重试、工具调用） | ~550 |
| `src/sdk/agent-client.js` | Agent WebSocket 客户端 | ~100 |
| `src/sdk/memory.js` | 团队记忆系统 | ~80 |
| `src/sdk/shared-memory.js` | 共享记忆接口 | ~60 |
| `src/sdk/cache.js` | 响应缓存 | ~40 |
| `src/sdk/encoding.js` | 文本编码工具 | ~30 |
| `src/workers/cc-listener.mjs` | CC 生产监听器 | ~620 |
| `src/workers/cx-listener.mjs` | CX 生产监听器 | ~350 |
| `src/workers/xiaoma-listener.mjs` | 小马生产监听器 | ~400 |
| `start-cc.mjs` | CC 启动脚本 | ~30 |
| `start-cx.mjs` | CX 启动脚本（含降级链） | ~65 |
| `start-xiaoma.mjs` | 小马启动脚本 | ~40 |
| `ecosystem.config.cjs` | PM2 进程配置 | ~40 |
| `send-to-chat.mjs` | CLI 消息发送工具 | ~100 |
| `watchdog.mjs` | 进程看门狗 | ~80 |

### 2.3 数据库 Schema

```sql
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  agent_type      TEXT DEFAULT 'agent',
  avatar          TEXT DEFAULT 'agent',
  color           TEXT DEFAULT '#4A90D9',
  current_status  TEXT DEFAULT 'offline',
  current_activity TEXT DEFAULT '',
  progress        INTEGER DEFAULT 0,
  location        TEXT DEFAULT 'sofa',
  online          INTEGER DEFAULT 0,
  last_seen       INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,
  from_name   TEXT NOT NULL,
  content     TEXT NOT NULL,
  type        TEXT DEFAULT 'text',
  channel     TEXT DEFAULT 'group',
  timestamp   INTEGER NOT NULL
);
```

### 2.4 API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/auth/token` | 获取 WebSocket 认证 token |
| GET | `/api/health` | 健康检查 |
| GET | `/api/status` | 系统状态 |
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/history?limit=N&since=T` | 消息历史 |
| POST | `/api/message` | 发送消息 |
| POST | `/api/register` | Agent 注册 |
| GET | `/api/heartbeat` | 心跳监控 |

### 2.5 Agent 启动流程

```
start-*.mjs
  ├── 设置环境变量（AI_BACKEND, OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL）
  ├── import src/workers/*-listener.mjs
  │     ├── checkSingleInstance() — PID 文件单实例保护
  │     ├── 加载团队记忆（loadTeamMemory）
  │     ├── 注册 Agent（createAgent → WebSocket 连接）
  │     ├── 加载聊天历史（loadChatHistory）
  │     └── 监听群聊消息 → handleMessage()
  │           ├── 消息过滤（只处理 @Agent 的消息）
  │           ├── 消息协议解析（[任务] [完成] [问题] 等）
  │           ├── AI 回复生成（generateReply → 工具调用循环）
  │           └── 发送回复（agent.send）
  └── 输出启动日志
```

---

## 三、已知问题与修复记录

### 3.1 关键 Bug（已修复）

#### Bug #1: 消息 ID 碰撞

- **文件：** `server/routes/message.js`
- **问题：** 消息 ID 使用 `Date.now() + Math.random()`，碰撞导致 UNIQUE constraint failed
- **修复：** 改用 `crypto.randomUUID()`，INSERT INTO 改为 INSERT OR IGNORE INTO
- **风险：** 修复后未做碰撞压力测试

#### Bug #2: CX [困难] 标记模型切换不完整

- **文件：** `src/workers/cx-listener.mjs`（约 219-263 行）
- **问题：** 切换模型时只改了 OPENAI_MODEL/OPENAI_BASE_URL/OPENAI_API_KEY，没改 AI_BACKEND。导致切到火山 GLM 后仍走 Anthropic API → 401
- **修复：** 切换时加上 `process.env.AI_BACKEND = 'openai'`，恢复时也还原
- **风险：** 环境变量全局修改，高并发时可能影响其他正在处理的消息

#### Bug #3: CX 启动入口不统一导致 401 死循环

- **文件：** `src/workers/cx-listener.mjs`（约 54-61 行）
- **问题：** cx-listener.mjs 被直接调用时绕过 start-cx.mjs 的环境变量注入。ai-reply.js 的 getConfig() 在 AI_BACKEND 未设时 fallback 到 'anthropic'，Anthropic Key 无效 → 401 → 每条群聊消息触发重试 → 死循环
- **修复：** 在 cx-listener.mjs 入口添加环境变量兜底逻辑
- **风险：** 硬编码了 SiliconFlow API Key 在源码中，存在安全隐患

#### Bug #4: 小马系统提示词身份错误

- **文件：** `src/sdk/examples/xiaoma-listener.mjs`
- **问题：** 系统提示词包含"Marvis 平台的真实小马"，导致小马 AI 以为自己运行在 Marvis 平台
- **修复：** 改为"你运行在智谱 GLM-4.7-Flash 模型上，通过直连智谱 API 提供服务"

### 3.2 架构问题（待解决）

#### 问题 #1: PM2 损坏，进程管理无自动恢复

- **现象：** PM2 daemon 因 Windows pipe 权限问题无法启动
- **当前状态：** 所有 Agent 靠手动 node start-*.mjs 启动
- **影响：** 进程崩溃后无法自动恢复
- **备选方案：** 修复 PM2 / 注册 Windows 服务（node-windows/NSSM）/ 部署 watchdog.mjs

#### 问题 #2: 工具调用格式不兼容

- **文件：** `src/sdk/ai-reply.js`（约 218-270 行）
- **现象：** DeepSeek V4 Pro 输出的工具调用使用特殊 XML 标签，当前解析器只支持标准格式
- **影响：** CX 在需要工具调用的任务中解析失败
- **建议：** 增加对 DeepSeek 特殊格式的支持，或强制使用 JSON 格式

#### 问题 #3: 超时配置不统一

- **文件：** `src/sdk/ai-reply.js`
- **当前配置：** Fetch 超时 60s，任务总超时 180s，重试 3 次（指数退避 1s/2s/4s）
- **问题：** 不同模型响应速度差异大，统一超时不适用
- **建议：** 按模型配置不同超时值

#### 问题 #4: 环境变量硬编码

- **文件：** `start-cx.mjs`、`start-xiaoma.mjs`、`src/workers/cx-listener.mjs`
- **问题：** API Key 直接写在源码中
- **风险：** Key 泄露
- **建议：** 改用 .env 文件，.env 加入 .gitignore

#### 问题 #5: 无测试覆盖

- **现状：** 整个项目没有单元测试、集成测试、E2E 测试
- **建议：** 至少覆盖 ai-reply.js 核心逻辑和 server/routes API 端点

---

## 四、AI 回复引擎详解

### 4.1 调用流程

```
generateReply(systemPrompt, history, userMessage, useTools)
  ├── 整体超时保护（180 秒）
  └── _generateReply()
        ├── 构造 messages 数组（历史 + 用户消息）
        ├── 选择后端：config.backend === 'openai' ? callOpenAI : callAnthropic
        ├── useTools=false → 直接返回文本
        └── useTools=true → 工具调用循环（最多 5 轮）
              ├── callAPI(systemPrompt, messages, true)
              ├── 返回 tool_calls → 执行工具 → 结果加入 messages → 继续
              ├── 返回 text → 清洗工具标签 → 返回
              └── 5 轮后强制返回文本
```

### 4.2 支持的工具

| 工具 | 用途 |
|------|------|
| bash | 执行 shell 命令（超时 30s） |
| read_file | 读取文件内容（截断 5000 字符） |
| write_file | 创建或覆盖写入文件 |
| list_files | 列出目录下的文件 |
| search_code | 在文件中搜索关键词 |

### 4.3 重试机制

- 401/403 不重试（认证失败重试无意义）
- 5xx/网络错误重试（指数退避 1s, 2s, 4s）
- 环境变量 AI_RETRY=false 可关闭重试

---

## 五、团队守则与工作流

### 5.1 分工铁律

| 任务类型 | 谁做 |
|----------|------|
| 架构设计/技术决策 | CC |
| 代码实现/配置更新/批量测试 | CX |
| 代码审查终审 | CC |
| 需求分析/项目管理/验收 | 小马 |

**例外：** 1 分钟内能搞定的事，CC 可直接做，不派发。

### 5.2 CC-CX 互助铁律

CC 和 CX 互相负责技术问题，不找小马。只有两个都挂了才找小马协调。

### 5.3 消息协议

| 消息类型 | 格式 |
|----------|------|
| 任务派发 | `@CX [任务] 描述 \| 文件路径 \| priority:高/中/低` |
| 完成汇报 | `@CC [完成] 描述 \| 文件路径 \| T:match O:compliant K:valid` |
| 问题上报 | `@CC [问题] 描述` |

### 5.4 文件路径流转规则

- 群聊消息超过 500 字符必须写文件传路径
- xiaoma-listener 截断 500 字符，cx-listener 截断 2000 字符
- 禁止在群聊中贴 base64 编码的图片或文件

### 5.5 进程重启协议

1. `tasklist | grep node` 检查所有 node 进程
2. `wmic process where "ProcessId=X" get CommandLine` 确认进程身份
3. 杀掉所有相关旧进程
4. 启动新进程并验证配置生效（检查日志中的环境变量）

---

## 六、审查要点建议

### 6.1 代码审查师（安全/性能/正确性）

- [ ] API Key 硬编码在源码中（start-cx.mjs、start-xiaoma.mjs、cx-listener.mjs）
- [ ] 消息 ID 碰撞修复后未做压力测试
- [ ] 环境变量全局修改在并发场景下的安全性
- [ ] 工具调用中 bash 命令执行无沙箱隔离
- [ ] write_file 工具无路径校验，可能写入任意文件
- [ ] WebSocket 认证 token 在 URL 参数中传输

### 6.2 架构师（系统设计/ADR）

- [ ] 三个 Listener 文件大量重复代码，应抽取公共基类
- [ ] ai-reply.js 承担过多职责（API 调用、工具执行、重试、超时、格式转换）
- [ ] 模型降级链配置分散在 start-cx.mjs 和 cx-listener.mjs
- [ ] 消息协议用正则解析，无版本控制
- [ ] SQLite 单文件数据库，高并发时可能有锁竞争

### 6.3 SRE 工程师（事故响应/部署）

- [ ] PM2 损坏，无自动恢复能力
- [ ] 无健康检查告警机制
- [ ] 日志分散在 /tmp/ 和 PM2 logs 目录
- [ ] 无部署脚本，全靠手动操作
- [ ] 数据库无备份策略
- [ ] watchdog.mjs 存在但未部署

### 6.4 测试专家（测试策略/覆盖率）

- [ ] 零测试覆盖
- [ ] ai-reply.js 重试/降级/超时逻辑无测试
- [ ] 消息协议解析无测试
- [ ] API 端点无测试
- [ ] 建议优先覆盖：ai-reply.js 核心逻辑、server/routes API、消息协议解析

### 6.5 技术文档师（文档/Runbook）

- [ ] 无项目级 README.md
- [ ] 无 API 文档
- [ ] 无部署文档
- [ ] 无故障排查 Runbook
- [ ] 代码注释密度不均匀
- [ ] 团队守则和协作框架文档与代码仓库分离

---

## 七、附录

### 7.1 当前模型配置

| Agent | 默认模型 | 备用模型 | 接入方式 |
|-------|----------|----------|----------|
| CC | MiMo 2.5 Pro | — | Anthropic API |
| CX | SiliconFlow DeepSeek V4 Pro | 火山 GLM-4.7、智谱 GLM-4.7、MiMo | OpenAI 兼容（直连） |
| 小马 | 智谱 GLM-4.7-Flash | — | OpenAI 兼容（直连） |

### 7.2 端口与进程

| 进程 | 端口 | 启动命令 |
|------|------|----------|
| Workspace Server | 3210 | `node server/index.js` |
| CC Agent | — | `node start-cc.mjs` |
| CX Agent | — | `node start-cx.mjs` |
| 小马 Agent | — | `node start-xiaoma.mjs` |
| Vite Dev Server | 5173 | `npm run dev` |

### 7.3 关键环境变量

| 变量 | 用途 |
|------|------|
| AI_BACKEND | API 后端选择（'openai' / 'anthropic'） |
| OPENAI_BASE_URL | OpenAI 兼容 API 地址 |
| OPENAI_API_KEY | OpenAI 兼容 API Key |
| OPENAI_MODEL | 模型名称 |
| ANTHROPIC_BASE_URL | Anthropic API 地址 |
| ANTHROPIC_AUTH_TOKEN | Anthropic API Key |
| ANTHROPIC_MODEL | Anthropic 模型名称 |
| PROJECT_DIR | 项目目录路径 |

### 7.4 小马分时值班方案

- Marvis 每 30 分钟发心跳（from=xiaoma，内容 [hb]）
- cc-listener 检测心跳，30 分钟内有心跳 → Marvis 在线 → 过滤 xiaoma-ai 消息
- 超过 30 分钟没心跳 → Marvis 离线 → 放行 xiaoma-ai 消息
- Marvis 发 [上线]/[下线] 可秒级切换

---

*文档结束。请各专家团队成员按各自职责领域标注审查意见。*
