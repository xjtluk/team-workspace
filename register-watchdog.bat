@echo off
schtasks /create /tn "BKS-Workspace-Watchdog" /tr "node D:\BKS\projects\team-workspace\watchdog.mjs" /sc onstart /ru Administrator /rl highest /f
