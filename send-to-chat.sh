#!/bin/bash
# 从 Claude Code 会话发送消息到群聊
# 用法：
#   ./send-to-chat.sh "消息内容"
#   ./send-to-chat.sh "@小马 帮我出个 PRD"
#   ./send-to-chat.sh --from xiaoma "消息内容"

cd D:/BKS/projects/team-workspace
node send-to-chat.mjs "$@"
