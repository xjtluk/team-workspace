# git-push.ps1 — BKS 团队 Git 推送脚本
# 用法：
#   powershell scripts\git-push.ps1                    # 推送 team-workspace
#   powershell scripts\git-push.ps1 -Repo team         # 推送 BKS-team
#   powershell scripts\git-push.ps1 -Repo both         # 推送两个仓库

param(
    [string]$Repo = "workspace",  # workspace | team | both
    [string]$Message = ""
)

$PROXY = "http://127.0.0.1:7897"
$DATE = Get-Date -Format "yyyy-MM-dd"

function Push-Repo {
    param(
        [string]$Path,
        [string]$Name
    )

    Write-Host "`n=== 处理 $Name ===" -ForegroundColor Cyan

    if (-not (Test-Path $Path)) {
        Write-Host "[跳过] 目录不存在: $Path" -ForegroundColor Yellow
        return
    }

    Push-Location $Path

    # 检查是否有变更
    $status = git status --porcelain
    if ([string]::IsNullOrWhiteSpace($status)) {
        Write-Host "[跳过] $Name 无变更" -ForegroundColor Green
        Pop-Location
        return
    }

    # 显示变更
    Write-Host "[变更] $Name 有未提交的修改:" -ForegroundColor Yellow
    git status --short

    # 设置代理
    git config http.proxy $PROXY

    # 提交
    $commitMsg = if ($Message) { $Message } else { "sync: $DATE daily update" }
    git add -A
    git commit -m $commitMsg

    # 推送
    Write-Host "[推送] $Name -> origin master" -ForegroundColor Cyan
    git push origin master

    # 清理代理
    git config --unset http.proxy

    Write-Host "[完成] $Name 推送成功" -ForegroundColor Green
    Pop-Location
}

# 执行推送
switch ($Repo.ToLower()) {
    "workspace" {
        Push-Repo -Path "D:\BKS\projects\team-workspace" -Name "team-workspace"
    }
    "team" {
        Push-Repo -Path "D:\BKS\team" -Name "BKS-team"
    }
    "both" {
        Push-Repo -Path "D:\BKS\projects\team-workspace" -Name "team-workspace"
        Push-Repo -Path "D:\BKS\team" -Name "BKS-team"
    }
    default {
        Write-Host "[错误] 未知仓库: $Repo，可选值: workspace | team | both" -ForegroundColor Red
    }
}

Write-Host "`n=== 推送完成 ===" -ForegroundColor Cyan
