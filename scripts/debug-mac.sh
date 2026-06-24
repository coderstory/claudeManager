#!/usr/bin/env bash
# scripts/debug-mac.sh — macOS ClaudeManager 调试脚本
#
# Usage:
#   ./scripts/debug-mac.sh attach   # lldb attach 到运行中的 ClaudeManager
#   ./scripts/debug-mac.sh tail     # tail 应用日志，高亮 ERROR/WARN
#   ./scripts/debug-mac.sh stream   # macOS unified log stream
#   ./scripts/debug-mac.sh all      # attach + tail + stream (3 pane tmux)
#   ./scripts/debug-mac.sh          # 默认 = all
#
# 前置：先 `open src-tauri/target/debug/bundle/macos/ClaudeManager.app`
#
# macOS only。其他平台：`./scripts/debug-mac.sh` 第一行检查 uname。

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: debug-mac.sh is macOS-only (got $(uname))" >&2
    exit 1
fi

CMD="${1:-all}"

APP_NAME="ClaudeManager"
LOG_DIR="$HOME/Library/Logs/com.claudeconfigmanager.desktop"
LOG_FILE="$LOG_DIR/$APP_NAME.log"

cmd_attach() {
    local pid
    pid=$(pgrep -f "$APP_NAME.app" | head -1 || true)
    if [[ -z "$pid" ]]; then
        echo "ERROR: $APP_NAME.app not running. Start with: open src-tauri/target/debug/bundle/macos/$APP_NAME.app" >&2
        exit 1
    fi
    echo "Attaching lldb to PID $pid ..."
    exec lldb -p "$pid"
}

cmd_tail() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo "WARN: log file not found at $LOG_FILE. Start $APP_NAME first." >&2
    fi
    # tail -F 跟文件名变化（rotate 后继续跟）
    # grep --color=always 高亮 ERROR（红）/ WARN（黄）
    exec tail -F "$LOG_FILE" 2>/dev/null | grep --color=always -E "ERROR|WARN|$" || true
}

cmd_stream() {
    exec log stream --predicate "process == \"$APP_NAME\"" --style compact
}

cmd_all() {
    if ! command -v tmux >/dev/null 2>&1; then
        echo "ERROR: 'all' requires tmux. Install with: brew install tmux" >&2
        exit 1
    fi
    # 创建 detached session, 3 pane: tail / stream / 交互 shell
    tmux new-session -d -s "$APP_NAME-debug" -n "ClaudeManager" \; \
        new-window -t "$APP_NAME-debug" -n "tail" "$0 tail" \; \
        new-window -t "$APP_NAME-debug" -n "stream" "$0 stream" \; \
        select-window -t "$APP_NAME-debug:0"
    echo "tmux session '$APP_NAME-debug' created (3 windows)."
    echo "  - window 0: interactive shell (run 'lldb -p <pid>' here)"
    echo "  - window 1: tail (app log)"
    echo "  - window 2: stream (unified log)"
    echo "Attach: tmux attach -t $APP_NAME-debug"
}

case "$CMD" in
    attach) cmd_attach ;;
    tail)   cmd_tail ;;
    stream) cmd_stream ;;
    all)    cmd_all ;;
    -h|--help) sed -n '2,12p' "$0" ;;
    *)      echo "Unknown command: $CMD. Try: attach | tail | stream | all" >&2; exit 1 ;;
esac
