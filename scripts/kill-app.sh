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

echo ">>> kill-app.sh: searching for ${ALL_NAMES[*]} processes..."

# 1) Find all matching PIDs (case-insensitive on Windows)
PIDS=$(tasklist 2>/dev/null | grep -iE "${NAME_REGEX}" | awk '{print $2}' || true)

if [[ -z "$PIDS" ]]; then
  echo ">>> No process found. Already clean."
  exit 0
fi

echo ">>> Found PIDs: $PIDS"

if [[ "$FORCE" == "true" ]]; then
  echo ">>> FORCE mode: taskkill -F -IM for ${ALL_NAMES[*]}"
  # Use -F (dash) not /F — Git Bash mangles forward-slash flags.
  # taskkill -IM accepts wildcards (ClaudeConfigManager-M*) so one call covers all
  # suffix variants; the short name is passed explicitly for the legacy case.
  for name in "${ALL_NAMES[@]}"; do
    taskkill -F -IM "${name}.exe" 2>&1 || true
  done
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
    # Get-Process -Name accepts wildcards, so the SUFFIX_WILDCARD covers all
    # ClaudeConfigManager-M*.exe variants; SHOR­T_NAME covers the legacy case.
    REMAINING=$(powershell.exe -NoProfile -Command "
      @(Get-Process -Name @('${ALL_NAMES[0]}','${ALL_NAMES[1]}') -ErrorAction SilentlyContinue).Count
    " 2>&1 | tr -d '\r' | head -1)
    if [[ "$REMAINING" == "0" ]]; then
      echo ">>> Graceful exit successful."
      exit 0
    fi
  done

  echo ">>> Graceful exit timeout. Falling back to force kill..."
  # Use -F (dash) not /F — Git Bash mangles forward-slash flags
  for name in "${ALL_NAMES[@]}"; do
    taskkill -F -IM "${name}.exe" 2>&1 || true
  done
fi

sleep 1
REMAINING=$(powershell.exe -NoProfile -Command "
  @(Get-Process -Name @('${ALL_NAMES[0]}','${ALL_NAMES[1]}') -ErrorAction SilentlyContinue).Count
" 2>&1 | tr -d '\r' | head -1)
if [[ "$REMAINING" == "0" ]]; then
  echo ">>> All processes cleaned."
  exit 0
else
  echo ">>> FAIL: $REMAINING processes still alive after kill."
  exit 1
fi