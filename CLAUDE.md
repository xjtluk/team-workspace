<!-- CC的身份定义在 D:\BKS\team\agents\CC.md，不在本文件中。本文件仅含项目上下文。

# Team Workspace — Project Context

This is the main team collaboration project. CC is the technical lead, CX is the code engineer.

## Project State

- **Phase**: V1.1 deployed and running
- **PRD**: `docs/PRD_团队工作室.md`
- **Tech Spec**: `docs/技术方案_团队工作室.md` (v1.2 — Preact + Vite chosen)
- **Optimization List**: `优化清单.md`
- **Prototype Ref**: `docs/原型_像素工作室.html` (initial design reference)

## Tech Stack (current)

- **Backend**: Express + WebSocket (ws) + SQLite (sql.js WASM, WAL mode)
- **Frontend**: Preact + Vite (CSS pixel-grid rendering)
- **AI Engine**: Anthropic API / OpenAI compatible API (ai-reply.js + agent-client.js)
- **Process Mgmt**: watchdog.mjs (PM2 alternative for Windows)
- **Character Rendering**: CSS pixel-grid (Canvas 2D fallback)

## Team Members

| Agent | Role | Model |
|-------|------|-------|
| **CC** | Tech Lead (Architecture, Decision, Review) | MiMo 2.5 Pro |
| **CX** | Code Engineer (Implementation, Refactor, PR) | DeepSeek V4 Pro / GLM-4.7 |
| **小马** | Project Lead (Requirements, Docs, Progress) | GLM-4.7-Flash |

## Current Status (V1.1)

- ✅ Canvas pixel office (1000x700, 6 workstations 3x2)
- ✅ Character sprites rendering
- ✅ Dashboard cards (name/role/status/progress bar) with Chinese status
- ✅ InfoPanel (hover detail panel)
- ✅ Animation layer (server lights/clock/coffee/water/arcade)
- ✅ WebSocket real-time updates
- ✅ Group chat panel (N-party, history, offline queuing)
- ✅ Heartbeat tracking + agent health check (/api/health)
- ✅ Watchdog auto-restart (60s check, 120s unhealthy threshold)
- ✅ Chinese status display on dashboard
- ✅ Chinese activity summary in listener

## Completed Milestones

| Date | Milestone |
|------|-----------|
| 06-01 | P0: Project skeleton + WebSocket + DB + Agent SDK |
| 06-01 | P1: Pixel office + Group chat + Character animation |
| 06-02 | P2: Agent listeners + model configuration |
| 06-03 | Process flow + API key fixes + encoding fixes |
| 06-04 | Chinese dashboard + heartbeat/watchdog + V1.1 stabilization |

## Known Issues

- **PM2 broken on Windows**: Using scripts/watchdog.mjs instead
- **DeepSeek V4 Pro tool call format**: XML format not fully compatible with parser
- **SQLite WASM concurrent writes**: Mitigated with WAL + busy_timeout

## Quick Start

```bash
npm install
npm run dev    # development (hot reload + backend watch)
npm run build  # production build
npm start      # production serve
npm run watchdog  # with process guardian
```

## File Paths

All paths relative to `D:\BKS\projects\team-workspace\`. Use absolute paths in all operations.
*（内容由AI生成，仅供参考）*
