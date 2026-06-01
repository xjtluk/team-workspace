@echo off
echo ========================================
echo BKS Team Workspace - 本地模型配置脚本
echo ========================================
echo.

echo [1/4] 检查 Ollama 是否已安装...
where ollama >nul 2>&1
if %errorlevel% equ 0 (
    echo Ollama 已安装
    ollama --version
    goto :download_model
)

echo [2/4] 安装 Ollama...
echo 请访问 https://ollama.com/download 下载并安装 Ollama
echo 安装完成后，按任意键继续...
pause >nul

:download_model
echo.
echo [3/4] 下载 Qwen 2.5 3B 模型...
echo 这可能需要几分钟，取决于网络速度...
ollama pull qwen2.5:3b

echo.
echo [4/4] 启动 Ollama 服务...
echo Ollama 将在后台运行，端口 11434
start /b ollama serve

echo.
echo ========================================
echo 配置完成！
echo.
echo 下一步：
echo 1. 运行 test-local-model.bat 测试模型
echo 2. 运行 start-xiaoma-local.bat 启动小马 agent
echo ========================================
pause
