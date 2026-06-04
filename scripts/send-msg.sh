#!/bin/bash
# send-msg.sh — CC 发送群聊消息（UTF-8 编码，防止乱码）
# 用法: bash scripts/send-msg.sh "消息内容"
# 或:   bash scripts/send-msg.sh "消息内容" cc group

CONTENT="${1:?用法: send-msg.sh \"消息内容\" [from] [channel]}"
FROM="${2:-cc}"
CHANNEL="${3:-group}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

powershell -ExecutionPolicy Bypass -Command "
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
\$body = @{from='$FROM'; content='$CONTENT'; type='text'; channel='$CHANNEL'} | ConvertTo-Json -Compress
\$bytes = [System.Text.Encoding]::UTF8.GetBytes(\$body)
Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/message' -Method Post -ContentType 'application/json; charset=utf-8' -Body \$bytes | ConvertTo-Json -Compress
"
