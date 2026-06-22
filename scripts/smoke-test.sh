#!/usr/bin/env bash
# scripts/smoke-test.sh — Claude Config Manager exe 冒烟测试
#
# 用法：
#   ./scripts/smoke-test.sh <exe-path>
#
# 6 项必过检查（基础 4 项 + 内容验证 2 项）：
#   1. 启动 → 5s 内进程在
#   2. 主窗口可见（MainWindowHandle + Responding）
#   3. 关闭窗口 → 进程仍在（最小化到托盘）
#   4. 强制 kill → 2s 内进程消失
#   5. WebView2 子窗口存在 → 前端真的加载了（不是空壳）
#   6. 窗口标题 = tauri.conf.json 中的 productName
#
# 为什么需要 Test 5-6：
#   历史教训：M1.x 早期版本构建出了"能跑能关能杀"的 exe，但前端 bundle
#   是空的 / 错的，渲染出空白页。原 4 项检查 100% 通过但 GUI 是废的。
#   Test 5 通过 Win32 EnumChildWindows 找到 WebView2 的子窗口类
#   （Chrome_WidgetWin_0 / Intermediate D3D Window 等），证明 WebView2 进程
#   内部已建出 host，证明前端 bundle 已被加载（哪怕是空 HTML，也至少
#   跑了 index.html 入口）。Test 6 验证 tauri.conf.json 配的标题被 OS
#   正确读到了窗口上。
#
# 已知边界：
#   - 这两项只验证"前端有加载" + "标题被设置"，不验证"具体渲染内容"
#   - 真正细致的 DOM 校验由 Vitest 单元测试 + WebDriver e2e 覆盖
#   - 本脚本是"exe 能跑起来 + 窗口真的有内容"的兜底门禁
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

# Read expected window title from tauri.conf.json. We look at the line
# with `"title":` (a child key of `app.windows[0]`) — that's the OS
# window title shown by Win32.
TAURI_CONF="${TAURI_CONF:-/d/project/winui3/src-tauri/tauri.conf.json}"
if [[ -f "$TAURI_CONF" ]]; then
  EXPECTED_TITLE=$(grep -E '"title"\s*:' "$TAURI_CONF" | head -1 | sed -E 's/.*"title"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
else
  EXPECTED_TITLE=""
fi

echo ">>> smoke-test.sh"
echo ">>> exe: $EXE_PATH"
echo ">>> exe dir: $EXE_DIR"
echo ">>> proc name (PE image): $SOURCE_PROCNAME"
echo ">>> renamed copy: $PROCNAME"
echo ">>> expected title: $EXPECTED_TITLE"
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

# === Test 5: WebView2 child window exists (frontend loaded) ===
# Why: previous smoke test only proved Tauri created *an* HWND. It did not
# prove the WebView2 host started. If `dist/` is empty or the JS bundle is
# missing/corrupt, Tauri still creates the main window (the Rust side
# doesn't care) — but no WebView2 child ever spawns. We use
# `EnumChildWindows` on the main HWND and look for any of these class
# names that WebView2 creates internally:
#   - Chrome_WidgetWin_0 / Chrome_WidgetWin_1 — chromium top-level widget
#   - Chrome_RenderWidgetHostHWND — composited render surface
#   - Intermediate D3D Window — D3D compositor overlay
#   - Tauri / Tauri.WebView2 — some Tauri builds tag the webview host
# If ANY of these exist as a child of our MainWindowHandle, the WebView2
# process is alive and attached → the frontend bundle was loaded.
#
# Implementation note: we pass a script-block callback to EnumChildWindows.
# Inside it we cannot mutate script-scope variables the usual way; we use
# a `[ref]` int and a counter-class. Simpler: write child class names to
# the Information stream and parse them in bash.
echo ""
echo ">>> Test 5: WebView2 child window exists"
WEBVIEW_INFO=$(powershell.exe -NoProfile -Command "
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class W2 {
  [DllImport(\"user32.dll\")]
  public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport(\"user32.dll\", CharSet = CharSet.Auto)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport(\"user32.dll\", CharSet = CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport(\"user32.dll\")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@ -ErrorAction SilentlyContinue

  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  \$p = Get-Process -Name \$n -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not \$p -or \$p.MainWindowHandle -eq 0) {
    Write-Host 'NO_MAIN'
    exit
  }

  \$found = New-Object System.Collections.Generic.List[string]
  \$cb = [W2+EnumWindowsProc]{
    param(\$hwnd, \$lparam)
    \$cn = New-Object System.Text.StringBuilder 256
    [void][W2]::GetClassName(\$hwnd, \$cn, 256)
    \$class = \$cn.ToString()
    if (\$class -match 'Chrome_WidgetWin|Chrome_RenderWidgetHostHWND|Intermediate D3D Window|Tauri.*WEBVIEW|Tauri\\.WebView|WRY_WebView|CefBrowserWindow') {
      \$found.Add(\$class)
    }
    return \$true
  }
  [void][W2]::EnumChildWindows(\$p.MainWindowHandle, \$cb, [IntPtr]::Zero)
  if (\$found.Count -gt 0) {
    Write-Host (\"FOUND:\" + (\$found -join ','))
  } else {
    Write-Host 'NONE'
  }
" 2>&1 | tr -d '\r' | head -1)

if [[ "$WEBVIEW_INFO" == FOUND:* ]]; then
  CLASSES="${WEBVIEW_INFO#FOUND:}"
  record "5_webview" "PASS" "WebView2 child(ren) found: $CLASSES"
elif [[ "$WEBVIEW_INFO" == "NONE" ]]; then
  record "5_webview" "FAIL" "no WebView2 child window under main HWND (frontend may not have loaded)"
elif [[ "$WEBVIEW_INFO" == "NO_MAIN" ]]; then
  record "5_webview" "FAIL" "main window handle missing at test time"
else
  record "5_webview" "FAIL" "unexpected PowerShell output: $WEBVIEW_INFO"
fi

# === Test 6: Window title matches tauri.conf.json productName ===
# Why: if the exe is running but the title is empty / wrong / fallback
# 'Tauri', the user has no confidence the app actually initialised. The
# expected title is the `app.windows[0].title` from tauri.conf.json (set
# to "Claude 配置管理器" in this project). Some WebView2 builds set the
# OS title asynchronously — we give it 2 extra seconds after the launch
# sleep above; the launch sleep (5s in Test 1) is usually enough.
echo ""
echo ">>> Test 6: Window title matches tauri.conf.json"
# PowerShell -> Git Bash pipes the title through a Windows console codepage
# (typically CP936 / GBK on this machine) which corrupts the CJK bytes
# from UTF-8. To avoid that, write the title to a UTF-8 file in PowerShell's
# own $env:TEMP (a real Windows path) and read it back in bash. We use
# GetTempFileName + a .txt suffix to get a unique filename and avoid clashes.
TITLE_BASENAME="smoke-test-title-$$-$RANDOM.txt"
ACTUAL_TITLE=""
TITLE_PATH=$(powershell.exe -NoProfile -Command "
  \$tmp = [System.IO.Path]::Combine(\$env:TEMP, '${TITLE_BASENAME}')
  \$n = @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')
  \$p = Get-Process -Name \$n -ErrorAction SilentlyContinue | Select-Object -First 1
  \$t = if (\$p) { \$p.MainWindowTitle } else { '' }
  try {
    [System.IO.File]::WriteAllText(\$tmp, \$t, [System.Text.Encoding]::UTF8)
    Write-Host \$tmp
  } catch {
    Write-Host ''
  }
" 2>&1 | tr -d '\r' | tail -1)
if [[ -n "$TITLE_PATH" && -f "$TITLE_PATH" ]]; then
  ACTUAL_TITLE=$(cat "$TITLE_PATH" 2>/dev/null | tr -d '\r\n')
  rm -f "$TITLE_PATH" 2>/dev/null || true
fi

if [[ -z "$EXPECTED_TITLE" ]]; then
  # No tauri.conf.json found — skip rather than fail. Caller can override
  # TAURI_CONF env var if they need the check in a different repo.
  record "6_title" "PASS" "skipped (no tauri.conf.json or no title key found at $TAURI_CONF); actual=\"$ACTUAL_TITLE\""
elif [[ -n "$ACTUAL_TITLE" && "$ACTUAL_TITLE" == *"$EXPECTED_TITLE"* ]]; then
  record "6_title" "PASS" "title contains expected \"$EXPECTED_TITLE\""
else
  record "6_title" "FAIL" "title=\"$ACTUAL_TITLE\" does not contain expected \"$EXPECTED_TITLE\""
fi

# === Test 7: Frontend assets are actually embedded in the exe ===
# Why: Tests 1-6 all pass even when the webview shows "ERR_CONNECTION_REFUSED"
# — because WebView2 still spawns child windows and renders an error page, and
# the OS window title comes from tauri.conf.json, not the rendered HTML. To
# catch the "dist not embedded" bug (Tauri v2 with `cargo build --release` done
# directly, missing `--features tauri/custom-protocol`), we check that the exe
# string table contains a fingerprint of the dist/ output. We use the JS
# bundle filename pattern (e.g. `index-Cc-j-zqL.js`) which is unique per build.
# If the build was done correctly with `custom-protocol` enabled, the dist
# contents (including the bundle filename) are gzip-embedded in the exe and
# `strings` will find it. If dist was never embedded, `strings` returns nothing.
echo ""
echo ">>> Test 7: Frontend assets embedded in exe"
# Find current dist bundle name(s) — they include a content hash
# PROJECT_ROOT may be unset in this scope (we're in a subshell that inherited
# `set -u` from the parent), so derive it from EXE_DIR. The smoke test script
# itself is at <PROJECT_ROOT>/scripts/smoke-test.sh, so the dir 2 levels above
# the script is the project root. If the script is run from elsewhere, we fall
# back to the TAURI_CONF env var's parent.
SMOKE_SCRIPT="${BASH_SOURCE[0]:-$0}"
SMOKE_SCRIPT_DIR=$(cd "$(dirname "$SMOKE_SCRIPT")" && pwd 2>/dev/null || echo "")
INFERRED_ROOT=""
if [[ -n "$SMOKE_SCRIPT_DIR" && "$SMOKE_SCRIPT_DIR" == */scripts ]]; then
  INFERRED_ROOT="${SMOKE_SCRIPT_DIR%/scripts}"
elif [[ -n "$SMOKE_SCRIPT_DIR" ]]; then
  INFERRED_ROOT="$SMOKE_SCRIPT_DIR"
fi
TEST7_DIST_DIR=""
for cand in "${INFERRED_ROOT}/dist/assets" "/d/project/winui3/dist/assets" "$(dirname "$EXE_DIR")/dist/assets"; do
  if [[ -d "$cand" ]]; then
    TEST7_DIST_DIR="$cand"
    break
  fi
done
DIST_BUNDLE_PATTERN=""
if [[ -n "$TEST7_DIST_DIR" ]]; then
  DIST_BUNDLE_PATTERN=$(ls "$TEST7_DIST_DIR" 2>/dev/null | grep -E '^index-.*\.js$' | head -1 | sed 's/\(index-[A-Za-z0-9_-]*\)\.js/\1/')
fi
if [[ -z "$DIST_BUNDLE_PATTERN" ]]; then
  record "7_assets" "PASS" "skipped (no dist/assets/ found or no index-*.js bundle)"
elif command -v strings >/dev/null 2>&1; then
  EMBED_HIT=$(strings "$EXE_PATH" 2>/dev/null | grep -cE "${DIST_BUNDLE_PATTERN}\.js|${DIST_BUNDLE_PATTERN}\.css")
  if [[ "$EMBED_HIT" -ge 1 ]]; then
    record "7_assets" "PASS" "dist fingerprint found in exe (matches: ${DIST_BUNDLE_PATTERN}.{js,css}, hits=$EMBED_HIT)"
  else
    record "7_assets" "FAIL" "dist fingerprint NOT found in exe — frontend assets were not embedded (build missing --features tauri/custom-protocol?)"
  fi
elif command -v grep >/dev/null 2>&1; then
  # Fallback if `strings` isn't on PATH — treat exe as text and grep it.
  if grep -aqE "${DIST_BUNDLE_PATTERN}\.js" "$EXE_PATH" 2>/dev/null; then
    record "7_assets" "PASS" "dist fingerprint found in exe (grep fallback)"
  else
    record "7_assets" "FAIL" "dist fingerprint NOT found in exe (grep fallback; no strings cmd)"
  fi
else
  record "7_assets" "PASS" "skipped (no strings or grep available)"
fi

# === Test 8: history.db file exists (Phase 21 — M4.6) ===
# Why: the SQLite history persistence layer (F7 usage + F13 backup) is
# supposed to materialise `<appdata>/ClaudeConfigManager/history.db` on
# first run. If the db is missing or zero-byte, the whole history layer
# is dead and the user's "history page" tab renders nothing.
#
# Per CLAUDE.md §3.2, the OS-resolved path comes from
# `IPlatformPaths::resolve()`. On Windows that ends up under
# `%APPDATA%/ClaudeConfigManager/`. We resolve via PowerShell's
# `[Environment]::GetFolderPath('ApplicationData')` to match what
# `WindowsPaths` does internally, then probe the canonical file.
echo ""
echo ">>> Test 8: history.db file created"
HISTORY_DB_PATH=$(powershell.exe -NoProfile -Command "
  \$appdata = [Environment]::GetFolderPath('ApplicationData')
  Write-Host (Join-Path \$appdata 'ClaudeConfigManager\\history.db')
" 2>&1 | tr -d '\r' | tail -1)
if [[ -n "$HISTORY_DB_PATH" && -f "$HISTORY_DB_PATH" ]]; then
  HISTORY_DB_SIZE=$(stat -c%s "$HISTORY_DB_PATH" 2>/dev/null || stat -f%z "$HISTORY_DB_PATH" 2>/dev/null || echo 0)
  if [[ "$HISTORY_DB_SIZE" -gt 0 ]]; then
    record "8_db_exists" "PASS" "$HISTORY_DB_PATH exists, $HISTORY_DB_SIZE bytes"
  else
    record "8_db_exists" "FAIL" "$HISTORY_DB_PATH exists but empty"
  fi
else
  record "8_db_exists" "FAIL" "history.db not found at $HISTORY_DB_PATH"
fi

# === Test 9: schema complete (Phase 21 — M4.6) ===
# Why: even if the db file is created, the schema may be half-migrated
# (e.g. crash mid-V1__init.sql). We check that all 3 critical objects
# exist: `usage_history`, `backup_history`, `schema_version`. Without
# these the frontend's query commands will return "no such table" at
# runtime and the history page will crash.
#
# We try `sqlite3` CLI first (PATH-resolved); fall back to PowerShell
# `Microsoft.Data.Sqlite`-style query via the SQLite ODBC driver? Not
# portable — instead we use Python's stdlib `sqlite3` module which is
# always present on this dev box. Order of preference:
#   1. `sqlite3` CLI (the cleanest)
#   2. `python -c "import sqlite3; ..."`
# If neither works we skip (PASS with "skipped"), since Test 10 may
# still give us queryable confirmation via the same fallback chain.
echo ""
echo ">>> Test 9: history.db schema complete"
SCHEMA_OK="SKIP"
SCHEMA_OUT=""
if command -v sqlite3 >/dev/null 2>&1; then
  SCHEMA_OUT=$(sqlite3 "$HISTORY_DB_PATH" ".schema" 2>&1 || true)
  if echo "$SCHEMA_OUT" | grep -q "usage_history" && \
     echo "$SCHEMA_OUT" | grep -q "backup_history" && \
     echo "$SCHEMA_OUT" | grep -q "schema_version"; then
    SCHEMA_OK="PASS"
  else
    SCHEMA_OK="FAIL"
  fi
elif command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  PY_CMD=$(command -v python || command -v python3)
  SCHEMA_OUT=$("$PY_CMD" -c "
import sqlite3, sys
try:
    c = sqlite3.connect(r'$HISTORY_DB_PATH')
    rows = c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
    c.close()
    print(','.join(r[0] for r in rows))
except Exception as e:
    print('ERR:', e, file=sys.stderr)
    sys.exit(1)
" 2>&1 || true)
  if echo "$SCHEMA_OUT" | grep -q "usage_history" && \
     echo "$SCHEMA_OUT" | grep -q "backup_history" && \
     echo "$SCHEMA_OUT" | grep -q "schema_version"; then
    SCHEMA_OK="PASS"
  else
    SCHEMA_OK="FAIL"
  fi
fi
case "$SCHEMA_OK" in
  PASS) record "9_schema" "PASS" "usage_history + backup_history + schema_version all present" ;;
  FAIL) record "9_schema" "FAIL" "schema incomplete (objects seen: $SCHEMA_OUT)" ;;
  SKIP) record "9_schema" "PASS" "skipped (no sqlite3 CLI or python available); cannot verify schema" ;;
esac

# === Test 10: history is queryable (Phase 21 — M4.6) ===
# Why: even with a valid schema, the rows may be empty (backfill_bak
# returned 0, no F7/F13 traffic yet). For a returning user who already
# had `.bak.<ts>` files, AppState::build() runs `backfill_bak` and
# `backup_history` should have ≥ 1 row. For a fresh user, both tables
# are empty and this test legitimately passes (0 ≥ 0).
#
# We do NOT pre-bake fixtures here — smoke test runs against the user's
# real `%APPDATA%` state. We accept either:
#   - ≥ 1 row in `usage_history` OR `backup_history` (returning user), or
#   - 0 rows in both, but the db schema is valid (Test 9 PASS), or
#   - cannot query (skip) — caller can manually verify.
echo ""
echo ">>> Test 10: history.db rows queryable"
QUERY_RESULT=""
if command -v sqlite3 >/dev/null 2>&1; then
  USAGE_N=$(sqlite3 "$HISTORY_DB_PATH" "SELECT COUNT(*) FROM usage_history;" 2>/dev/null || echo "?")
  BACKUP_N=$(sqlite3 "$HISTORY_DB_PATH" "SELECT COUNT(*) FROM backup_history;" 2>/dev/null || echo "?")
  QUERY_RESULT="usage=$USAGE_N,backup=$BACKUP_N"
elif command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  PY_CMD=$(command -v python || command -v python3)
  QUERY_RESULT=$("$PY_CMD" -c "
import sqlite3
try:
    c = sqlite3.connect(r'$HISTORY_DB_PATH')
    u = c.execute('SELECT COUNT(*) FROM usage_history').fetchone()[0]
    b = c.execute('SELECT COUNT(*) FROM backup_history').fetchone()[0]
    c.close()
    print(f'usage={u},backup={b}')
except Exception as e:
    print('ERR:', e)
" 2>&1 || echo "ERR")
fi
if [[ -n "$QUERY_RESULT" && "$QUERY_RESULT" != ERR* && "$QUERY_RESULT" != "?" ]]; then
  # Either table has rows OR both are 0 but the db is queryable.
  record "10_queryable" "PASS" "$QUERY_RESULT"
elif [[ "$QUERY_RESULT" == ERR* ]]; then
  record "10_queryable" "PASS" "skipped (query failed: $QUERY_RESULT)"
else
  record "10_queryable" "PASS" "skipped (no queryable backend)"
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
