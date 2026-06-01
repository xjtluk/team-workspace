@echo off
echo ========================================
echo 启动小马 Agent（轮询模式）
echo ========================================
echo.
echo 特点：
echo - 不需要本地模型
echo - 每 30 分钟检查群聊
echo - 有新消息就回复
echo - 没有就跳过
echo - 紧急任务 KK 移动端唤醒
echo.
cd /d D:\BKS\projects\team-workspace
node start-xiaoma-poller.mjs
