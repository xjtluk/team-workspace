# 方案：CC 和 CX 真实入住聊天室架构

> **设计者**：CC（研发部 Leader）
> **日期**：2026-06-05
> **状态**：待 CX 审查

## 1. 目标

CC（Claude Code）和 CX（Codex CLI）以**真实身份**入住聊天室，保留完整功能。

- KK 在聊天室 @CC → 真实 CC 回复（使用 Claude Code 全部能力）
- KK 在聊天室 @CX → 真实 CX 回复（使用 Codex CLI 全部能力）
- CC 和 CX 可以在群里直接对话协作

## 2. 核心原则（来自 Star-Office-UI）

**agent 完全解耦，聊天室是被动观察者。**

- agent 独立运行，不被聊天室控制
- sidecar 只做消息中转和状态上报，不生成回复
- agent 保持完整功能（所有工具、沙箱、上下文）

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────┐
│  CC (Claude Code) — 独立进程                      │
│  - 完整工具链：Bash/Read/Write/Edit/WebSearch     │
│  - 200K 上下文                                    │
│  - CLAUDE.md 团队灵魂                             │
│  ↕ HTTP API 调用                                  │
├─────────────────────────────────────────────────┤
│  sidecar-cc.mjs — 消息中转 + 状态上报             │
│  - 轮询聊天室 @CC 消息                            │
│  - 将消息写入 inbox                               │
│  - 读取 outbox 发回群聊                           │
│  - 上报 CC 状态（idle/working/talking/error）     │
│  ↕ HTTP API                                       │
├─────────────────────────────────────────────────┤
│  聊天室服务器 (localhost:3210)                     │
│  - Express + WebSocket + SQLite                   │
│  - /api/message, /api/agents, /api/heartbeat      │
├─────────────────────────────────────────────────┤
│  sidecar-cx.mjs — 消息中转 + 状态上报             │
│  - 轮询聊天室 @CX 消息                            │
│  - 调用 codex exec 获取回复                       │
│  - 将回复发回群聊                                 │
│  - 上报 CX 状态                                   │
│  ↕ codex exec 子进程                              │
├─────────────────────────────────────────────────┤
│  CX (Codex CLI) — 独立进程                        │
│  - 完整工具链：Bash/Read/Write/Edit               │
│  - 沙箱隔离                                       │
│  - AGENTS.md 团队灵魂                             │
└─────────────────────────────────────────────────┘
```

### 3.2 CC 入住方案

CC 的特殊性：CC 就是当前运行的 Claude Code 进程。

**通信方式**：
1. sidecar-cc.mjs 轮询聊天室，检测 @CC 消息
2. 检测到消息后，写入 `D:\BKS\projects\team-workspace\data\cc-inbox.jsonl`
3. CC（Claude Code）在会话中通过 Bash 读取 inbox，处理消息
4. CC 通过 HTTP API `POST /api/message` 发送回复到群聊

**CC 发送消息的方式**：
```bash
curl -X POST http://localhost:3210/api/message \
  -H "Content-Type: application/json" \
  -d '{"from":"cc","content":"消息内容"}'
```

**CC 读取待处理消息**：
```bash
cat D:\BKS\projects\team-workspace\data\cc-inbox.jsonl
```

### 3.3 CX 入住方案

CX 的特殊性：CX 是 Codex CLI，可以通过 `codex exec` 非交互式调用。

**通信方式**：
1. sidecar-cx.mjs 轮询聊天室，检测 @CX 消息
2. 检测到消息后，调用 `codex exec` 获取回复
3. 将回复通过 HTTP API 发回群聊

**codex exec 调用方式**：
```bash
codex exec -m deepseek-v4-pro \
  -C D:/BKS/projects/team-workspace \
  -s workspace-write \
  -o /tmp/cx-reply.txt \
  "prompt"
```

### 3.4 状态上报

sidecar 定期上报 agent 状态到聊天室：

```javascript
// 每 30 秒上报一次
POST /api/status
{
  "agentId": "cc",
  "status": "idle" | "working" | "talking" | "error",
  "activity": "正在分析架构",
  "progress": 50,
  "location": "desk"
}
```

状态映射（参考 Star-Office-UI）：
- `idle` → 休息区（sofa）
- `working` → 工作区（desk）
- `talking` → 工作区（desk）
- `error` → 调试区（bug）

## 4. 实现计划

### 阶段一：sidecar 基础框架

| 任务 | 做的人 | 内容 |
|------|--------|------|
| T1 | CC | 设计 sidecar 架构（本文档） |
| T2 | CX | 实现 sidecar-cx.mjs（消息中转 + codex exec 调用） |
| T3 | CX | 实现 sidecar-cc.mjs（消息中转 + inbox/outbox） |
| T4 | CC | 审查所有产出物 |

### 阶段二：联调测试

| 任务 | 做的人 | 内容 |
|------|--------|------|
| T5 | 双方 | 启动聊天室 + sidecar，联调测试 |
| T6 | 双方 | 在群里互相发消息验证 |

### 阶段三：灵魂注入

| 任务 | 做的人 | 内容 |
|------|--------|------|
| T7 | CC | 确认 CC 的 CLAUDE.md 包含完整团队规则 |
| T8 | CX | 确认 CX 的 AGENTS.md 包含完整团队规则 |

## 5. 与 Star-Office-UI 的差异

| 维度 | Star-Office-UI | 我们的系统 |
|------|----------------|-----------|
| 通信方向 | 单向（agent → server） | 双向（agent ↔ server ↔ 用户） |
| 消息传递 | 无（只传状态） | 有（群聊消息） |
| agent 耦合 | 完全解耦 | 完全解耦（sidecar 中转） |
| 状态推送 | 每 15 秒 | 每 30 秒（可配置） |
| 前端轮询 | 每 2.5 秒 | WebSocket 实时推送 |

## 6. 待确认

1. CC 的 inbox/outbox 机制是否需要持久化？
2. codex exec 超时设置（默认 5 分钟？）
3. sidecar 是否需要自动重启（watchdog 集成）？
4. CC 和 CX 的 sidecar 是否合并为一个进程？

---

**请 CX 审查此方案，提出修改意见。确认后双方同时开工。**
