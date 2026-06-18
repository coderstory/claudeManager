#!/usr/bin/env bash
# scripts/smoke-test.sh — Claude Config Manager exe 冒烟测试
#
# 用法：
#   ./scripts/smoke-test.sh <exe-path>
#
# 4 项必过检查：
#   1. 启动 → 5s 内进程在
#   2. 主窗口可见（标题非空）
#   3. 关闭窗口 → 进程仍在（最小化到托盘）
#   4. 强制 kill → 2s 内进程消失
#
# 任何失败 exit code = 1

set -euo pipefail

EXE_PATH="${1:?Usage: smoke-test.sh <exe-path>}"
EXE_DIR=$(dirname "$EXE_PATH")
EXE_BASENAME=$(basename "$EXE_PATH")
EXE_NAME_NO_EXT="${EXE_BASENAME%.exe}"
PROCNAME="${EXE_NAME_NO_EXT}.exe"

echo ">>> smoke-test.sh"
echo ">>> exe: $EXE_PATH"
echo ">>> exe dir: $EXE_DIR"
echo ">>> proc name: $PROCNAME"
echo ""

# Verify exe exists
if [[ ! -f "$EXE_PATH" ]]; then
  echo "FAIL: exe not found at $EXE_PATH"
  exit 1
fi

# Pre-cleanup
echo ">>> Pre-cleanup: killing any existing instances..."
powershell.exe -NoProfile -Command "Get-Process -Name '${EXE_NAME_NO_EXT}' -ErrorAction SilentlyContinue | Stop-Process -Force" 2>&1 || true
sleep 1

PASS=0
FAIL=0
RESULTS=()

# Helper: record result
record() {
  local name="$1"
  local status="$2"
  local detail="${3:-}"
  if [[ "$status" == "PASS" ]]; then
    PASS=$((PASS+1))
    echo "  [PASS] $name — $detail"
  else
    FAIL=$((FAIL+1))
    echo "  [FAIL] $name — $detail"
  fi
  RESULTS+=("$status $name")
}

# === Test 1: Launch & process running within 5s ===
echo ""
echo ">>> Test 1: Launch & process running"
powershell.exe -NoProfile -Command "Start-Process -FilePath '$EXE_PATH'" 2>&1 || true
sleep 5

PROC_COUNT=$(tasklist 2>/dev/null | grep -ic "${EXE_NAME_NO_EXT}" || echo "0")
if [[ "$PROC_COUNT" -ge "1" ]]; then
  record "1_launch" "PASS" "process running (count=$PROC_COUNT)"
else
  record "1_launch" "FAIL" "process not found after 5s"
fi

# === Test 2: Main window visible ===
echo ""
echo ">>> Test 2: Main window visible"
WINDOW_TITLE=$(powershell.exe -NoProfile -Command "
  \$p = Get-Process -Name '${EXE_NAME_NO_EXT}' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (\$p) { \$p.MainWindowTitle } else { '' }
" 2>&1 | tr -d '\r' | head -1)

if [[ -n "$WINDOW_TITLE" ]]; then
  record "2_window" "PASS" "title=\"$WINDOW_TITLE\""
else
  record "2_window" "FAIL" "MainWindowTitle is empty"
fi

# === Test 3: Close → minimizes to tray (process survives) ===
echo ""
echo ">>> Test 3: Close minimizes to tray"
powershell.exe -NoProfile -Command "
  \$p = Get-Process -Name '${EXE_NAME_NO_EXT}' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (\$p -and \$p.MainWindowHandle -ne 0) {
    \$p.CloseMainWindow() | Out-Null
  }
" 2>&1 || true
sleep 2

PROC_AFTER_CLOSE=$(tasklist 2>/dev/null | grep -ic "${EXE_NAME_NO_EXT}" || echo "0")
if [[ "$PROC_AFTER_CLOSE" -ge "1" ]]; then
  record "3_tray" "PASS" "process survived close (in tray)"
else
  record "3_tray" "FAIL" "process exited after close (should stay in tray)"
fi

# === Test 4: Force kill → process gone within 2s ===
echo ""
echo ">>> Test 4: Force kill"
powershell.exe -NoProfile -Command "
  Get-Process -Name '${EXE_NAME_NO_EXT}' -ErrorAction SilentlyContinue | Stop-Process -Force
" 2>&1 || true
sleep 2

PROC_AFTER_KILL=$(tasklist 2>/dev/null | grep -ic "${EXE_NAME_NO_EXT}" || echo "0")
if [[ "$PROC_AFTER_KILL" == "0" ]]; then
  record "4_kill" "PASS" "process gone within 2s"
else
  record "4_kill" "FAIL" "process still alive after force kill (count=$PROC_AFTER_KILL)"
fi

# Summary
echo ""
echo "============================================"
echo "Smoke test summary: $PASS passed, $FAIL failed"
echo "============================================"
if [[ "$FAIL" -gt 0 ]]; then
  echo "FAILED checks:"
  for r in "${RESULTS[@]}"; do
    [[ "$r" == FAIL* ]] && echo "  - $r"
  done
  exit 1
fi
echo "ALL CHECKS PASSED"
exit 0