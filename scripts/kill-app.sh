#!/usr/bin/env bash
# scripts/kill-app.sh — 关闭所有 Claude Config Manager 进程
#
# 用法：
#   ./scripts/kill-app.sh           # 优雅关闭（先 CloseMainWindow，超时 5s 再 force）
#   ./scripts/kill-app.sh --force   # 立即 taskkill /F
#
# 用于：smoke test 收尾 / 重新编译前清理 / 调试卡死时清理
#
# 性能优化（M3.0.4）：
#   - PID 循环里 N 次 powershell 合并为 1 次（一次性把 PIDs 数组传进去）
#   - 抽 check_remaining_count() 复用（L73-75 + L91-93 共用）

set -euo pipefail

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

# === Platform gate (M3.1.x macOS support) ===
# Original script was Windows-only (tasklist / taskkill / powershell).
# On macOS use pkill on the inner Mach-O binary; Linux is unsupported
# per CLAUDE.md §15.
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo ">>> kill-app.sh [macOS]: pkill ClaudeManager.app/Contents/MacOS/claude-config-manager..."
  INNER_BIN_PATTERN="ClaudeManager.app/Contents/MacOS/claude-config-manager"
  if [[ "$FORCE" == "true" ]]; then
    pkill -9 -f "$INNER_BIN_PATTERN" 2>/dev/null || true
  else
    # macOS has no CloseMainWindow equivalent that the tray-app handler
    # will honor (it always intercepts); send SIGTERM and let the app
    # exit cleanly. Fall back to SIGKILL after 3s.
    pkill -TERM -f "$INNER_BIN_PATTERN" 2>/dev/null || true
    for i in {1..6}; do
      sleep 0.5
      if ! pgrep -f "$INNER_BIN_PATTERN" >/dev/null 2>&1; then
        echo ">>> Graceful exit successful."
        exit 0
      fi
    done
    echo ">>> Graceful exit timeout. Falling back to SIGKILL..."
    pkill -9 -f "$INNER_BIN_PATTERN" 2>/dev/null || true
  fi
  sleep 1
  if pgrep -f "$INNER_BIN_PATTERN" >/dev/null 2>&1; then
    echo ">>> FAIL: process still alive after kill."
    exit 1
  fi
  echo ">>> All processes cleaned."
  exit 0
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  echo ">>> kill-app.sh: Linux is not supported (CLAUDE.md §15)." >&2
  exit 1
fi

EXE_NAME="claude-config-manager.exe"
# M2.6+ ships the release exe with a suffix (e.g. ClaudeConfigManager-M2.3.1-f9-fuzzy-search.exe).
# The PE image name is still carved at compile time, but Windows Start-Process shows the
# on-disk filename as the process name in tasklist — so we must match BOTH the short
# (legacy dev-box / target/release/) name AND the suffix (desktop ship) name everywhere.
# taskkill -IM accepts a wildcard like "ClaudeConfigManager-M*" so one call covers all
# suffix variants; the short name stays explicit to avoid the wildcard also matching
# hypothetical unrelated "ClaudeConfigManager*" exes we don't own.
SHORT_NAME="${EXE_NAME%.exe}"          # claude-config-manager
SUFFIX_WILDCARD="ClaudeConfigManager-M*" # matches ClaudeConfigManager-M2.3.1-foo.exe etc.
ALL_NAMES=("${SHORT_NAME}" "${SUFFIX_WILDCARD}")

# Build a regex that matches any of the names (for tasklist | grep -E).
NAME_REGEX=$(printf '%s|' "${ALL_NAMES[@]}")
NAME_REGEX="${NAME_REGEX%|}"

# check_remaining_count: prints the number of ClaudeConfigManager processes
# still alive (matches BOTH SHORT_NAME and SUFFIX_WILDCARD). Replaces two
# duplicated inline powershell calls in the original script.
check_remaining_count() {
  powershell.exe -NoProfile -Command "
    @(Get-Process -Name @('${ALL_NAMES[0]}','${ALL_NAMES[1]}') -ErrorAction SilentlyContinue).Count
  " 2>&1 | tr -d '\r' | head -1
}

echo ">>> kill-app.sh: searching for ${ALL_NAMES[*]} processes..."

# 1) Find all matching PIDs (case-insensitive on Windows)
PIDS=$(tasklist 2>/dev/null | grep -iE "${NAME_REGEX}" | awk '{print $2}' || true)

if [[ -z "$PIDS" ]]; then
  echo ">>> No process found. Already clean."
  exit 0
fi

echo ">>> Found PIDs: $PIDS"

if [[ "$FORCE" == "true" ]]; then
  echo ">>> FORCE mode: taskkill -F -PID for $PIDS"
  # Use -F (dash) not /F — Git Bash mangles forward-slash flags.
  # Use the already-discovered PIDs (taskkill -IM wildcards don't expand under Git Bash
  # on Windows 11, so we MUST target by PID). We have PIDs because step 1 grep'd
  # the tasklist output ourselves.
  for pid in $PIDS; do
    taskkill -F -PID "$pid" 2>&1 || true
  done
else
  echo ">>> Graceful mode: sending CloseMainWindow via PowerShell (one batched call)..."
  # Build a CSV of PIDs (comma-separated, no trailing comma). We pass all PIDs
  # in ONE powershell call instead of N (the original loop spawned powershell
  # per PID — each cold start ~200-400ms, so multi-process scenarios paid N*cost).
  # We use a powershell heredoc + $pid_csv arg-passing via environment variable
  # to avoid bash quoting hell (mixing single/double quotes inside `-Command` is
  # brittle — `echo "$X" | sed "s/'/\"/g"` can produce ""23708""' which breaks
  # PowerShell parsing. A heredoc + env var is rock solid.)
  PIDS_CSV=$(echo $PIDS | tr '\n' ',' | sed 's/,$//')
  PID_CSV="$PIDS_CSV" powershell.exe -NoProfile -Command - <<PWSH_EOF 2>&1 || true
\$idStr = \$env:PID_CSV
\$ids = @(\$idStr -split ',' | Where-Object { \$_ -match '^\d+\$' } | ForEach-Object { [int]\$_ })
foreach (\$id in \$ids) {
  \$proc = Get-Process -Id \$id -ErrorAction SilentlyContinue
  if (\$proc -and \$proc.MainWindowHandle -ne 0) {
    \$proc.CloseMainWindow() | Out-Null
  } else {
    Stop-Process -Id \$id -Force
  }
}
PWSH_EOF

  echo ">>> Waiting up to 5s for graceful exit..."
  for i in {1..10}; do
    sleep 0.5
    REMAINING=$(check_remaining_count)
    if [[ "$REMAINING" == "0" ]]; then
      echo ">>> Graceful exit successful."
      exit 0
    fi
  done

  echo ">>> Graceful exit timeout. Falling back to force kill..."
  # Use -F (dash) not /F — Git Bash mangles forward-slash flags.
  # Same reason as above: target by PID, not by -IM wildcard.
  for pid in $PIDS; do
    taskkill -F -PID "$pid" 2>&1 || true
  done
fi

sleep 1
REMAINING=$(check_remaining_count)
if [[ "$REMAINING" == "0" ]]; then
  echo ">>> All processes cleaned."
  exit 0
else
  echo ">>> FAIL: $REMAINING processes still alive after kill."
  exit 1
fi