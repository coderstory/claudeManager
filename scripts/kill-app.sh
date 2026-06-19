#!/usr/bin/env bash
# scripts/kill-app.sh — 关闭所有 Claude Config Manager 进程
#
# 用法：
#   ./scripts/kill-app.sh           # 优雅关闭（先 CloseMainWindow，超时 5s 再 force）
#   ./scripts/kill-app.sh --force   # 立即 taskkill /F
#
# 用于：smoke test 收尾 / 重新编译前清理 / 调试卡死时清理

set -euo pipefail

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

EXE_NAME="claude-config-manager.exe"

echo ">>> kill-app.sh: searching for $EXE_NAME processes..."

# 1) Find all matching PIDs (case-insensitive on Windows)
PIDS=$(tasklist 2>/dev/null | grep -i "${EXE_NAME%.exe}" | awk '{print $2}' || true)

if [[ -z "$PIDS" ]]; then
  echo ">>> No process found. Already clean."
  exit 0
fi

echo ">>> Found PIDs: $PIDS"

if [[ "$FORCE" == "true" ]]; then
  echo ">>> FORCE mode: taskkill -F -IM $EXE_NAME"
  # Use -F (dash) not /F — Git Bash mangles forward-slash flags
  taskkill -F -IM "$EXE_NAME" 2>&1 || true
else
  echo ">>> Graceful mode: sending CloseMainWindow via PowerShell..."
  for pid in $PIDS; do
    powershell.exe -NoProfile -Command "
      \$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      if (\$proc -and \$proc.MainWindowHandle -ne 0) {
        \$proc.CloseMainWindow() | Out-Null
      } else {
        # No main window (tray-only) → kill
        Stop-Process -Id $pid -Force
      }
    " 2>&1 || true
  done

  echo ">>> Waiting up to 5s for graceful exit..."
  for i in {1..10}; do
    sleep 0.5
    REMAINING=$(powershell.exe -NoProfile -Command "
      @(Get-Process -Name '${EXE_NAME%.exe}' -ErrorAction SilentlyContinue).Count
    " 2>&1 | tr -d '\r' | head -1)
    if [[ "$REMAINING" == "0" ]]; then
      echo ">>> Graceful exit successful."
      exit 0
    fi
  done

  echo ">>> Graceful exit timeout. Falling back to force kill..."
  # Use -F (dash) not /F — Git Bash mangles forward-slash flags
  taskkill -F -IM "$EXE_NAME" 2>&1 || true
fi

sleep 1
REMAINING=$(powershell.exe -NoProfile -Command "
  @(Get-Process -Name '${EXE_NAME%.exe}' -ErrorAction SilentlyContinue).Count
" 2>&1 | tr -d '\r' | head -1)
if [[ "$REMAINING" == "0" ]]; then
  echo ">>> All processes cleaned."
  exit 0
else
  echo ">>> FAIL: $REMAINING processes still alive after kill."
  exit 1
fi