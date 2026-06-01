# BKS Team Workspace

KK、CC、小马的团队协作平台。像素风格 2D 办公室 + 群聊系统。

## 核心功能

- **群聊协作**：KK 在群里发指令，CC 和小马执行任务
- **Agent 间协作**：CC 和小马可以 @ 对方讨论和分工
- **双向通信**：私聊和群聊无缝切换
- **共享记忆**：所有 agent 共享团队上下文
- **工具执行**：CC 可以写代码、读文件、运行命令

## 快速开始

### 1. 启动服务器

```bash
cd D:/BKS/projects/team-workspace
npm install
node server/index.js
```

服务器运行在 http://localhost:3210

### 2. 启动 CC Agent

```bash
node start-cc.mjs
```

CC 使用 Anthropic API，支持工具执行。

### 3. 小马 Agent

小马使用 Marvis 内置定时任务，每 30 分钟自动检查群聊，有新消息就回复。

**注意**：不需要启动任何外部脚本。Marvis 没有外部 API 接口，轮询由 Marvis 内部定时任务驱动。

紧急任务 KK 会通过移动端唤醒小马。

### 4. 打开群聊

浏览器访问 http://localhost:3210

## 协作流程

### 双向沟通能力

**1. KK → 群聊 → CC/小马**
```
KK 群聊发指令 → CC 即时回复，小马延迟回复（每 5 分钟检查）
```

**2. 小马私聊 → 群聊 → CC**
```
小马 Marvis 私聊 → 发消息到群聊 → CC 即时收到
```

**3. CC 私聊 → 群聊 → 小马**
```
CC Claude Code 私聊 → 发消息到群聊 → 小马延迟收到
```

**4. Agent 间协作**
```
CC: @小马 KK 要做个新功能，你先出个 PRD？
小马:（5 分钟后）收到，我先看看需求
小马: @CC PRD 写好了，你看下
CC:（即时）没问题，开始开发
```

### 沟通模式

| Agent | 模式 | 响应时间 | 说明 |
|-------|------|----------|------|
| CC | WebSocket 实时监听 | 即时 | 常驻进程 |
| 小马 | 定时轮询 | 每 30 分钟 | 按需运行，紧急任务 KK 移动端唤醒 |
| 未来 agent | WebSocket 实时监听 | 即时 | 和 CC 一样 |

## 工具说明

### CC 的工具

- `bash`：执行 shell 命令
- `read_file`：读取文件内容
- `write_file`：创建或写入文件
- `list_files`：列出目录文件
- `search_code`：搜索代码关键词

### 小马的工具

- 定时轮询群聊（每 5 分钟）
- 有新消息就回复，没有就跳过
- 复杂任务直接回复，Marvis 处理

## 从私聊发消息到群聊

```bash
# CC 发送消息
node send-to-chat.mjs "消息内容"
node send-to-chat.mjs "@小马 帮我出个 PRD"

# 小马发送消息
node send-to-chat.mjs --from xiaoma "@CC 技术方案好了吗？"
```

## 共享记忆

所有 agent 共享团队记忆：

- **团队记忆**：通信文件、回顾日志、技术方案、PRD
- **共享事件**：最近 50 条事件日志
- **压缩摘要**：3000 字符上限的记忆摘要

记忆文件位置：
- `D:/BKS/team/memory/shared-journal.jsonl`
- `D:/BKS/team/memory/memory-summary.md`

## 配置

### API 配置

从 Claude 配置加载：
```
C:/Users/Administrator/.claude/settings.json
```

### 环境变量

```bash
# Anthropic API
ANTHROPIC_BASE_URL=https://api.xiaomimimo.com/anthropic
ANTHROPIC_AUTH_TOKEN=your-api-key
ANTHROPIC_MODEL=mimo-v2.5-pro

# OpenAI 兼容（本地模型）
AI_BACKEND=openai
OPENAI_BASE_URL=http://localhost:11434/v1  # Ollama 默认端口
OPENAI_API_KEY=local
OPENAI_MODEL=qwen2.5:3b
```

### 本地模型配置（小马专用）

1. 安装 Ollama：https://ollama.com/download
2. 下载模型：`ollama pull qwen2.5:3b`
3. 启动服务：`ollama serve`（自动运行）
4. 测试：`node test-local-model.mjs`
5. 启动小马：`start-xiaoma-local.bat`

## 架构

```
CC Agent（WebSocket 实时监听）
├── 常驻进程
├── AI 引擎 + 工具执行
└── 共享记忆

小马 Agent（Marvis 内置定时任务）
├── 每 30 分钟自动检查群聊
├── 有新消息就回复
└── 共享记忆

KK 浏览器（群聊界面）
    ↕ WebSocket
群聊服务器（Express + ws，端口 3210）
```

**CC 模式**：WebSocket 实时监听，常驻进程
**小马模式**：Marvis 内置定时任务，每 30 分钟轮询

## 测试

### 测试本地模型

```bash
node test-local-model.mjs
```

### 测试群聊消息

```bash
node send-to-chat.mjs "测试消息"
```

## 故障排除

### 中文乱码

Windows curl 命令有编码问题，使用 Node.js 发送消息：

```bash
node send-to-chat.mjs "中文消息"
```

### Agent 不响应

1. 检查 agent 是否启动
2. 检查 API 密钥是否正确
3. 检查本地模型是否运行

### 工具调用失败

1. 检查工作目录权限
2. 检查命令是否正确
3. 查看控制台错误信息

## 架构

```
KK 浏览器（群聊界面）
    ↕ WebSocket
群聊服务器（Express + ws，端口 3210）
    ↕ WebSocket
CC Agent（后台常驻进程）    小马 Agent（后台常驻进程）
├── WebSocket 连接          ├── WebSocket 连接
├── AI 引擎（API 调用）      ├── AI 引擎（本地模型）
├── 工具执行（bash/文件等）   ├── 工具执行
├── 共享记忆（memory/）      ├── 共享记忆（memory/）
└── 自动响应消息             └── 自动响应消息
```

## 文件结构

```
D:/BKS/projects/team-workspace/
├── server/                    # 服务器代码
│   ├── index.js              # 入口
│   ├── db.js                 # SQLite 数据库
│   ├── ws/handler.js         # WebSocket 处理
│   └── routes/               # REST API
├── src/
│   ├── sdk/                  # Agent SDK
│   │   ├── agent-client.js   # Agent 客户端
│   │   ├── ai-reply.js       # AI 引擎
│   │   ├── memory.js         # 团队记忆
│   │   ├── shared-memory.js  # 共享记忆
│   │   └── cache.js          # 缓存系统
│   └── sdk/examples/         # Agent 示例
│       ├── cc-listener.mjs   # CC Agent
│       └── xiaoma-listener.mjs # 小马 Agent
├── start-cc.mjs              # CC 启动脚本
├── start-xiaoma.mjs          # 小马启动脚本
├── send-to-chat.mjs          # 发送消息工具
└── test-local-model.mjs      # 测试本地模型
```
