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

# The Tauri exe process name is fixed at compile time (carved into the PE
# image). Renaming the file on disk (e.g. `ClaudeConfigManager-M1.1.2-...exe`
# for shipping) does NOT change the PE subsystem name, BUT `Start-Process`
# on Windows uses the FILE NAME as the process name unless the image
# resource specifies otherwise. We observed that the spawned process
# shows up as `ClaudeConfigManager-M1.x-...` (the renamed stem), not
# `claude-config-manager`. So we check BOTH names.
#
# Convention: source exe is always `claude-config-manager.exe` in
# `target/release/`. Shipped copies on the desktop have a different
# stem; the smoke test accepts either name.
SOURCE_PROCNAME="claude-config-manager"  # compiled into the PE image
PROCNAME="${EXE_NAME_NO_EXT}.exe"        # the renamed copy on disk
# Process names to query (Get-Process -Name is OR across these)
ALL_PROCNAMES=("${SOURCE_PROCNAME}" "${EXE_NAME_NO_EXT}")

# Convert EXE_PATH to a Windows-style path. The caller may pass either a
# bash-mangled path (`/c/Users/...`) or a Windows path (`C:\Users\...`).
# PowerShell's Start-Process inside this Git Bash subshell only accepts the
# Windows form, so always normalise.
EXE_PATH_WIN=$(cygpath -w "$EXE_PATH" 2>/dev/null || echo "$EXE_PATH")

echo ">>> smoke-test.sh"
echo ">>> exe: $EXE_PATH"
echo ">>> exe dir: $EXE_DIR"
echo ">>> proc name (PE image): $SOURCE_PROCNAME"
echo ">>> renamed copy: $PROCNAME"
echo ""

# Verify exe exists
if [[ ! -f "$EXE_PATH" ]]; then
  echo "FAIL: exe not found at $EXE_PATH"
  exit 1
fi

# Pre-cleanup
echo ">>> Pre-cleanup: killing any existing instances..."
# Kill any process matching either name (original PE image or renamed copy)
powershell.exe -NoProfile -Command "
  foreach (\$n in @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')) {
    Get-Process -Name \$n -ErrorAction SilentlyContinue | Stop-Process -Force
  }
" 2>&1 || true
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
powershell.exe -NoProfile -Command "Start-Process -FilePath '$EXE_PATH_WIN'" 2>&1 || true
sleep 5

PROC_COUNT=$(powershell.exe -NoProfile -Command "
  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  @(Get-Process -Name \$n -ErrorAction SilentlyContinue).Count
" 2>&1 | tr -d '\r' | head -1)
if [[ "$PROC_COUNT" -ge "1" ]]; then
  record "1_launch" "PASS" "process running (count=$PROC_COUNT)"
else
  record "1_launch" "FAIL" "process not found after 5s"
fi

# === Test 2: Main window visible ===
# M1.1 historical: Tauri webview window's MainWindowTitle is sometimes empty
# until the user gives the window focus (or the OS completes a delayed
# compositor handoff). The previous check `[[ -n "$WINDOW_TITLE" ]]` was a
# race-condition false positive. Switch to a structural check that doesn't
# depend on the title text being populated yet:
#   - MainWindowHandle != 0  → Tauri created the window
#   - Responding = True       → the message loop is alive
# If both hold, the GUI is up; title text is a separate concern.
echo ""
echo ">>> Test 2: Main window visible"
WINDOW_STATE=$(powershell.exe -NoProfile -Command "
  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  \$p = Get-Process -Name \$n -ErrorAction SilentlyContinue | Select-Object -First 1
  if (\$p -and \$p.MainWindowHandle -ne 0 -and \$p.Responding) {
    Write-Host 'OK'
  } else {
    Write-Host 'BAD'
  }
" 2>&1 | tr -d '\r' | head -1)

if [[ "$WINDOW_STATE" == "OK" ]]; then
  record "2_window" "PASS" "MainWindowHandle present + Responding=True"
else
  record "2_window" "FAIL" "window handle missing or process not responding (state=$WINDOW_STATE)"
fi

# === Test 3: Close → minimizes to tray (process survives) ===
echo ""
echo ">>> Test 3: Close minimizes to tray"
powershell.exe -NoProfile -Command "
  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  \$p = Get-Process -Name \$n -ErrorAction SilentlyContinue | Select-Object -First 1
  if (\$p -and \$p.MainWindowHandle -ne 0) {
    \$p.CloseMainWindow() | Out-Null
  }
" 2>&1 || true
sleep 2

PROC_AFTER_CLOSE=$(powershell.exe -NoProfile -Command "
  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  @(Get-Process -Name \$n -ErrorAction SilentlyContinue).Count
" 2>&1 | tr -d '\r' | head -1)
if [[ "$PROC_AFTER_CLOSE" -ge "1" ]]; then
  record "3_tray" "PASS" "process survived close (in tray)"
else
  record "3_tray" "FAIL" "process exited after close (should stay in tray)"
fi

# === Test 4: Force kill → process gone within 2s ===
echo ""
echo ">>> Test 4: Force kill"
powershell.exe -NoProfile -Command "
  foreach (\$n in @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')) {
    Get-Process -Name \$n -ErrorAction SilentlyContinue | Stop-Process -Force
  }
" 2>&1 || true
sleep 2

PROC_AFTER_KILL=$(powershell.exe -NoProfile -Command "
  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  @(Get-Process -Name \$n -ErrorAction SilentlyContinue).Count
" 2>&1 | tr -d '\r' | head -1)
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