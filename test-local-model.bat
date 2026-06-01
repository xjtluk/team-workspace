@echo off
echo ========================================
echo 测试本地模型
echo ========================================
echo.

echo 检查 Ollama 服务...
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误：Ollama 服务未运行
    echo 请先运行 setup-local-model.bat
    pause
    exit /b 1
)

echo Ollama 服务正常
echo.

echo 测试 Qwen 2.5 3B 模型...
echo 发送测试消息：你好，测试一下
echo.

curl -s http://localhost:11434/api/chat -d "{\"model\":\"qwen2.5:3b\",\"messages\":[{\"role\":\"user\",\"content\":\"你好，测试一下\"}],\"stream\":false}" | findstr "content"

echo.
echo ========================================
echo 测试完成！
echo.
echo 如果看到中文回复，说明模型正常工作
echo 下一步：运行 start-xiaoma-local.bat 启动小马 agent
echo ========================================
pause
