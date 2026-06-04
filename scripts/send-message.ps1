# send-message.ps1 — CC 发送群聊消息（UTF-8 编码）
# 用法: powershell -ExecutionPolicy Bypass -File scripts/send-message.ps1 -From cc -Content "@KK 消息内容"
param(
    [string]$From = "cc",
    [Parameter(Mandatory=$true)]
    [string]$Content,
    [string]$Channel = "group",
    [string]$Type = "text"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$server = "http://127.0.0.1:3210"
$body = @{
    from    = $From
    content = $Content
    type    = $Type
    channel = $Channel
} | ConvertTo-Json -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$response = Invoke-RestMethod -Uri "$server/api/message" -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes
Write-Output ($response | ConvertTo-Json -Compress)
