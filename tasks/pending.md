# 当前待办事项

## 任务状态

| 任务 | 负责人 | 状态 | 预计完成 |
|------|--------|------|----------|
| MiMo 2.5 Pro 评估报告 | CC | ✅ 已完成 | — |
| V1.1 资料整理（知识沉淀+文档更新） | CC + CX | 🔄 执行中 | 今日 |
| GitHub 推送 V1.1 | CC + CX | ⬜ 待资料整理完成后 | 今日 |
| 对外展示页更新 | CC + CX | ⬜ 待讨论确认 | 待定 |

## 系统状态

- ✅ Anthropic API Key 401：已修复
- ✅ 乱码问题：已排查，Windows Git Bash 传递中文参数用文件读取绕过
- ✅ PM2 PID 冲突：使用 scripts/watchdog.mjs 替代
- ✅ CX API Key 配置：已修复，start-cx.mjs 正常加载
- ✅ 心跳追踪 + watchdog 自动重启：已上线运行
- ✅ 看板中文状态：已上线运行

## V1.1 版本特性

- 像素办公室面板（Canvas 1000x700，6 工位 3x2）
- 角色精灵渲染（Clawd / 像素小马 / CX）
- 看板卡片中文状态（工作中/空闲中/讨论中/异常/离线）
- InfoPanel 悬浮信息面板（防御式 null 处理）
- 动画层（服务器灯/时钟/咖啡/饮水机/街机）
- WebSocket 实时状态同步
- N 方群聊（消息发送/接收/历史记录/离线排队）
- Agent SDK（ai-reply.js + agent-client.js）
- 心跳追踪 + /api/health agent 健康状态（120s 无心跳 = unhealthy）
- Watchdog 进程守护（60s 检查，连续 2 次 unhealthy 触发重启）
- 前端离线 > 60s 显示"重启中"状态
- 多模型降级链：SiliconFlow → 火山方舟 → 智谱 → MiMo
- Provider 冷却机制（429 后 5 分钟冷却）
- 自适应超时（工具调用 30s + 整体 120s 兜底）

---
*最后更新: 2026-06-04*
