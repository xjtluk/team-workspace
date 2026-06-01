@echo off
echo ========================================
echo 启动小马 Agent（本地模型版）
echo ========================================
echo.

echo 配置环境变量...
set AI_BACKEND=openai
set OPENAI_BASE_URL=http://localhost:11434/v1
set OPENAI_API_KEY=local
set OPENAI_MODEL=qwen2.5:3b

echo 启动 xiaoma-listener...
echo.
cd /d D:\BKS\projects\team-workspace
node start-xiaoma.mjs
