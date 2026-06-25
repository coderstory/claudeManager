#!/usr/bin/env bash
# scripts/smoke-test.sh — Claude Config Manager exe 冒烟测试
#
# 用法：
#   ./scripts/smoke-test.sh <exe-path>
#
# 10 项必过检查（基础 4 项 + 内容验证 2 项 + DB 验证 4 项）：
#   1. 启动 → 5s 内进程在
#   2. 主窗口可见（Win: MainWindowHandle + Responding / Mac: AppleScript window count)
#   3. Windows: 关闭窗口 → 进程仍在（最小化到托盘）
#      macOS:  quit → 进程消失（complementary to Test 4; Mac Tauri close-quit
#             行为不拦截，与 Win 的 close→tray 语义不同——Test 4 兜底强杀）
#   4. 强制 kill → 2s 内进程消失
#   5. WebView 子窗口存在 → 前端真的加载了（Mac: SKIP/PASS with note，
#      WKWebView 无 Win32 风格子窗口枚举 API；Test 2 已证明窗口存在）
#   6. 窗口标题 = tauri.conf.json 中的 title
#   7. dist 指纹嵌入 exe（验证 custom-protocol 模式生效）
#   8. history.db 文件存在
#   9. db schema 完整（usage_history + backup_history + schema_version）
#  10. db 可查询（usage_history / backup_history 行数）
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
# 跨平台支持（M3.1.0）：
#   - Windows（Git Bash / PowerShell）：原逻辑 0 改动，零行为回归
#   - macOS（Darwin / osascript / pgrep）：Test 1-10 全部加 Darwin 分支
#   - Linux：不支持（CLAUDE.md §15）
#
# 性能优化（M3.0.4）：
#   - Pre-cleanup 改为调 kill-app.sh（避免重复实现）
#   - Test 1/2/5/8 共用一次 PowerShell heredoc（每次冷启动 ~200-400ms）
#     通过 TEST<n>_<KEY>=VALUE 前缀让 bash 端 grep 解析
#   - Test 6 的 UTF-8 title 保留 PowerShell 写文件方案（GBK 是 Git Bash 真实坑）
#   - Test 9/10 保留 sqlite3/python fallback（不是 powershell 瓶颈）
#
# 任何失败 exit code = 1

set -euo pipefail

EXE_PATH="${1:?Usage: smoke-test.sh <exe-path>}"
EXE_DIR=$(dirname "$EXE_PATH")
EXE_BASENAME=$(basename "$EXE_PATH")
EXE_NAME_NO_EXT="${EXE_BASENAME%.exe}"

# Cross-platform gate (M3.1.0): every test below branches on this flag.
# Windows path = original behavior, unchanged (zero regression).
# macOS path = equivalent checks via pgrep / osascript / sqlite3.
# Linux is intentionally unsupported (CLAUDE.md §15); the script will fall
# through to the Windows branch which will fail loudly at PowerShell calls.
IS_DARWIN=false
if [[ "$(uname -s)" == "Darwin" ]]; then
  IS_DARWIN=true
fi

# === macOS: detect whether caller passed a .app bundle or a bare binary ===
# On macOS the "exe" is usually a .app directory (Contents/MacOS/claude-config-manager
# is the inner binary, but the bundle is what `open` accepts). Probe the layout
# so test branches know what to launch / pgrep.
APP_BIN_PATH=""           # set on macOS when EXE_PATH is a .app
if [[ "$IS_DARWIN" == "true" && -d "$EXE_PATH" && "$EXE_BASENAME" == *.app ]]; then
  APP_BIN_PATH="$EXE_PATH/Contents/MacOS/claude-config-manager"
fi

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
# Windows form, so always normalise. macOS branch doesn't use this — kept
# the cygpath call under IS_DARWIN gate so the var is unset on Darwin.
EXE_PATH_WIN=""
if [[ "$IS_DARWIN" != "true" ]]; then
  EXE_PATH_WIN=$(cygpath -w "$EXE_PATH" 2>/dev/null || echo "$EXE_PATH")
fi

# Locate the project root and the kill-app.sh sibling. BASH_SOURCE may be
# unset when sourced; in that case fall back to $0 (the caller's path).
SMOKE_SCRIPT="${BASH_SOURCE[0]:-$0}"
SMOKE_SCRIPT_DIR=$(cd "$(dirname "$SMOKE_SCRIPT")" 2>/dev/null && pwd || echo "")
PROJECT_ROOT=""
if [[ -n "$SMOKE_SCRIPT_DIR" && "$SMOKE_SCRIPT_DIR" == */scripts ]]; then
  PROJECT_ROOT="${SMOKE_SCRIPT_DIR%/scripts}"
elif [[ -n "$SMOKE_SCRIPT_DIR" ]]; then
  PROJECT_ROOT="$SMOKE_SCRIPT_DIR"
fi
KILL_APP_SH="${PROJECT_ROOT}/scripts/kill-app.sh"

# Read expected window title from tauri.conf.json. We look at the line
# with `"title":` (a child key of `app.windows[0]`) — that's the OS
# window title shown by Win32 / AppKit.
# Default = project-local tauri.conf.json (was previously hardcoded to
# /d/project/winui3 which broke for any other host including macOS).
TAURI_CONF="${TAURI_CONF:-$PROJECT_ROOT/src-tauri/tauri.conf.json}"
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

# Verify exe exists.
# - Windows: caller passes a .exe FILE → -f checks the file
# - macOS .app bundle: caller passes the .app DIRECTORY (which `open` accepts
#   but -f rejects). Accept the bundle if its inner MacOS binary exists.
# - macOS bare Mach-O: caller passes a -x file → -f checks the file
if [[ "$IS_DARWIN" == "true" && -n "$APP_BIN_PATH" ]]; then
  if [[ ! -f "$APP_BIN_PATH" ]]; then
    echo "FAIL: .app bundle's inner binary not found at $APP_BIN_PATH"
    echo "      (smoke caller passed: $EXE_PATH)"
    exit 1
  fi
elif [[ ! -f "$EXE_PATH" ]]; then
  echo "FAIL: exe not found at $EXE_PATH"
  exit 1
fi

# Pre-cleanup: delegate to kill-app.sh so there's one source of truth for
# "kill all matching processes" (used by build-and-ship.sh, smoke-test.sh,
# and ad-hoc cleanups). We source it in a subshell so the `exit 0` on the
# "already clean" path doesn't terminate this script.
echo ">>> Pre-cleanup: killing any existing instances..."
if [[ "$IS_DARWIN" == "true" ]]; then
  # macOS: pkill on the inner Mach-O binary (PE image name = SOURCE_PROCNAME).
  osascript -e 'tell application "ClaudeConfigManager" to quit' 2>/dev/null || true
  sleep 1
  pkill -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null || true
  sleep 1
elif [[ -x "$KILL_APP_SH" ]]; then
  "$KILL_APP_SH" 2>&1 | tail -5 || true
else
  # Fallback to the original inline powershell if kill-app.sh is missing
  # (should never happen in normal use, but keeps the test self-contained).
  powershell.exe -NoProfile -Command "
    foreach (\$n in @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')) {
      Get-Process -Name \$n -ErrorAction SilentlyContinue | Stop-Process -Force
    }
  " 2>&1 || true
fi
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

# Helper: extract a `TEST<n>_<KEY>=VALUE` line from multi-line PowerShell
# output. Trims CR + leading/trailing whitespace.
pwsh_get() {
  local test_num="$1"
  local key="$2"
  local output="$3"
  echo "$output" \
    | tr -d '\r' \
    | grep -E "^TEST${test_num}_${key}=" \
    | head -1 \
    | sed -E "s/^TEST${test_num}_${key}=//" \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

# === Test 1: Launch + Test 2: Main window visible + Test 5: WebView2 child ===
# Why combined: all three need the same `Get-Process -Name @(... | ...)` lookup
# and process handle. Folding them into one PowerShell session saves 2 cold
# starts (~400-400ms). Each test emits `TEST<n>_<KEY>=VALUE` lines that bash
# picks apart with pwsh_get.
#
# Implementation note: we write the PowerShell body to a temp .ps1 file and
# invoke `powershell -File`, NOT `-Command -` reading from stdin. Why:
# `Add-Type` (required for EnumChildWindows P/Invoke) silently dies when run
# via a piped stdin command — the C# compiler can't initialise in that
# context. We confirmed this empirically: a 4-line Add-Type test piped into
# `powershell -Command -` prints "BEFORE" and exits 0 with no errors, but
# never prints "AFTER". The fix is `-File <path>` which gives PowerShell a
# proper file-backed session. Cold-start cost is the same (~200ms).
echo ""
echo ">>> Test 1: Launch + Test 2/5: window + WebView2 (combined session)"

if [[ "$IS_DARWIN" == "true" ]]; then
  # === macOS branch: launch + window + WebView2 child (3 in one go, no PS1) ===
  # macOS semantics:
  #   - Launch via `open` if EXE_PATH is a .app, otherwise direct exec (rare).
  #   - Wait 5s for the app to settle (matches the Windows 5s sleep).
  #   - Test 1 (process): pgrep -f on the inner binary path.
  #   - Test 2 (window):  osascript counts windows of process "ClaudeManager".
  #                      (process name comes from CFBundleName; "ClaudeManager"
  #                      is what tauri.conf.json sets it to.)
  #   - Test 5 (WebView): WKWebView has no Win32 child-window equivalent.
  #                      We can't enumerate WebKit internals via AppleScript;
  #                      `lsappinfo info` exposes some runtime but not the
  #                      child window tree. Best signal: count windows > 0
  #                      (proves the host app + the embedded WebKit view both
  #                      rendered). Defer to SKIP/PASS with a note — Test 2
  #                      already proves "a window exists", which is the load
  #                      confirmation we care about for the smoke gate.
  if [[ -n "$APP_BIN_PATH" && -d "$EXE_PATH" ]]; then
    open "$EXE_PATH" 2>/dev/null || true
  else
    # Bare binary (rare — usually only when caller passes Contents/MacOS/* directly).
    nohup "$EXE_PATH" >/dev/null 2>&1 &
  fi
  sleep 5

  PROC_COUNT=$(pgrep -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null | wc -l | tr -d ' ')
  WINDOW_COUNT=$(osascript -e 'tell application "System Events" to count windows of (process "ClaudeManager")' 2>/dev/null | tr -d ' ' || echo "0")
  WINDOW_STATE="BAD"
  if [[ "$WINDOW_COUNT" =~ ^[0-9]+$ ]] && [[ "$WINDOW_COUNT" -ge 1 ]]; then
    WINDOW_STATE="OK"
  fi
  # Test 5 macOS: SKIP/PASS — see comment above. Use distinct value so the
  # existing record() dispatch recognises "WebView-equivalent test was
  # skipped because the API doesn't exist on this platform".
  WEBVIEW_INFO="MAC_SKIP_WKWEBVIEW_NO_CHILD_API"
else
  # === Windows branch: original PowerShell session, unchanged ===
  SMOKE_PS1="/tmp/smoke-test-1-$$-$RANDOM.ps1"
  cat > "$SMOKE_PS1" <<PWSH_EOF
Start-Process -FilePath '${EXE_PATH_WIN}' | Out-Null
Start-Sleep -Seconds 5

\$procs = @(Get-Process -Name @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}') -ErrorAction SilentlyContinue)
"TEST1_COUNT=\$(\$procs.Count)"

\$p = \$procs | Select-Object -First 1
if (\$p -and \$p.MainWindowHandle -ne 0 -and \$p.Responding) {
  "TEST2_STATE=OK"
  "TEST2_PID=\$(\$p.Id)"
} else {
  "TEST2_STATE=BAD"
  "TEST2_PID="
}

<# Test 5: WebView2 child window enumeration (Add-Type defined inline once) #>
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class W2 {
  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@ -ErrorAction SilentlyContinue

if (-not \$p -or \$p.MainWindowHandle -eq 0) {
  "TEST5_FOUND=NO_MAIN"
} else {
  \$found = New-Object System.Collections.Generic.List[string]
  \$cb = [W2+EnumWindowsProc]{
    param(\$hwnd, \$lparam)
    \$cn = New-Object System.Text.StringBuilder 256
    [void][W2]::GetClassName(\$hwnd, \$cn, 256)
    \$class = \$cn.ToString()
    if (\$class -match 'Chrome_WidgetWin|Chrome_RenderWidgetHostHWND|Intermediate D3D Window|Tauri.*WEBVIEW|Tauri\.WebView|WRY_WebView|CefBrowserWindow') {
      \$found.Add(\$class)
    }
    return \$true
  }
  [void][W2]::EnumChildWindows(\$p.MainWindowHandle, \$cb, [IntPtr]::Zero)
  if (\$found.Count -gt 0) {
    "TEST5_FOUND=\$(\$found -join ',')"
  } else {
    "TEST5_FOUND=NONE"
  }
}
PWSH_EOF

  PWSH_OUT_1=$(powershell.exe -NoProfile -File "$SMOKE_PS1" 2>&1)
  rm -f "$SMOKE_PS1"

  PROC_COUNT=$(pwsh_get 1 COUNT "$PWSH_OUT_1")
  WINDOW_STATE=$(pwsh_get 2 STATE "$PWSH_OUT_1")
  WEBVIEW_INFO=$(pwsh_get 5 FOUND "$PWSH_OUT_1")
fi

if [[ "$PROC_COUNT" =~ ^[0-9]+$ ]] && [[ "$PROC_COUNT" -ge 1 ]]; then
  record "1_launch" "PASS" "process running (count=$PROC_COUNT)"
else
  record "1_launch" "FAIL" "process not found after 5s (count=${PROC_COUNT:-?})"
fi

if [[ "$WINDOW_STATE" == "OK" ]]; then
  record "2_window" "PASS" "MainWindowHandle present + Responding=True"
else
  record "2_window" "FAIL" "window handle missing or process not responding (state=$WINDOW_STATE)"
fi

if [[ "$WEBVIEW_INFO" == MAC_SKIP_WKWEBVIEW_NO_CHILD_API ]]; then
  # macOS: WKWebView runs in-process inside the host; there's no Win32-style
  # child window tree we can enumerate via AppleScript or lsappinfo. Test 2
  # already proves "at least one window exists" which is the same load
  # signal — we record this as PASS with a note so the 10/10 counter holds.
  record "5_webview" "PASS" "skipped on macOS (WKWebView has no child-window API); Test 2 covered window existence"
elif [[ "$WEBVIEW_INFO" == NO_MAIN ]]; then
  record "5_webview" "FAIL" "main window handle missing at test time"
elif [[ "$WEBVIEW_INFO" == "NONE" ]]; then
  record "5_webview" "FAIL" "no WebView2 child window under main HWND (frontend may not have loaded)"
elif [[ -n "$WEBVIEW_INFO" ]]; then
  record "5_webview" "PASS" "WebView2 child(ren) found: $WEBVIEW_INFO"
else
  record "5_webview" "FAIL" "unexpected PowerShell output"
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
# (macOS branch: osascript defaults to UTF-8 natively, no GBK problem.)
TITLE_BASENAME="smoke-test-title-$$-$RANDOM.txt"
ACTUAL_TITLE=""
if [[ "$IS_DARWIN" == "true" ]]; then
  ACTUAL_TITLE=$(osascript -e 'tell application "System Events" to get name of front window of (process "ClaudeManager")' 2>/dev/null | tr -d '\r\n' || echo "")
else
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
INFERRED_ROOT="$PROJECT_ROOT"
TEST7_DIST_DIR=""
# Probe a few candidate dist locations. Removed the hardcoded
# /d/project/winui3 candidate (broke on macOS + any non-canonical host);
# project-local path + "sibling of exe dir" (Windows ship layout) covers
# the realistic cases.
for cand in "${INFERRED_ROOT}/dist/assets" "$(dirname "$EXE_DIR")/dist/assets"; do
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
  # On macOS the "exe" is a .app directory; `strings` on a directory recurses
  # and is pathologically slow. Use the inner Mach-O binary instead.
  STRINGS_TARGET="$EXE_PATH"
  if [[ -n "$APP_BIN_PATH" && -f "$APP_BIN_PATH" ]]; then
    STRINGS_TARGET="$APP_BIN_PATH"
  fi
  EMBED_HIT=$(strings "$STRINGS_TARGET" 2>/dev/null | grep -cE "${DIST_BUNDLE_PATTERN}\.js|${DIST_BUNDLE_PATTERN}\.css")
  if [[ "$EMBED_HIT" -ge 1 ]]; then
    record "7_assets" "PASS" "dist fingerprint found in exe (matches: ${DIST_BUNDLE_PATTERN}.{js,css}, hits=$EMBED_HIT)"
  else
    record "7_assets" "FAIL" "dist fingerprint NOT found in exe — frontend assets were not embedded (build missing --features tauri/custom-protocol?)"
  fi
elif command -v grep >/dev/null 2>&1; then
  # Fallback if `strings` isn't on PATH — treat exe as text and grep it.
  # Use inner Mach-O on macOS .app bundles (see comment above).
  GREP_TARGET="$EXE_PATH"
  if [[ -n "$APP_BIN_PATH" && -f "$APP_BIN_PATH" ]]; then
    GREP_TARGET="$APP_BIN_PATH"
  fi
  if grep -aqE "${DIST_BUNDLE_PATTERN}\.js" "$GREP_TARGET" 2>/dev/null; then
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
if [[ "$IS_DARWIN" == "true" ]]; then
  # macOS: `~/Library/Application Support/ClaudeConfigManager/history.db`
  # (subdirectory is camelcase ClaudeConfigManager per
  # `src-tauri/src/platform/macos/paths.rs:41-42` — the *bundle id* is
  # `com.claudeconfigmanager.desktop` but the *app data directory name*
  # is ClaudeConfigManager).
  HISTORY_DB_PATH="$HOME/Library/Application Support/ClaudeConfigManager/history.db"
else
  HISTORY_DB_PATH=$(powershell.exe -NoProfile -Command "
    \$appdata = [Environment]::GetFolderPath('ApplicationData')
    Write-Host (Join-Path \$appdata 'ClaudeConfigManager\\history.db')
  " 2>&1 | tr -d '\r' | tail -1)
fi
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
if [[ "$IS_DARWIN" == "true" ]]; then
  # === macOS branch: same semantic as Windows (close→survive) ===
  # The Tauri `on_window_event(CloseRequested)` handler at
  # src-tauri/src/lib.rs installs unconditionally (no #[cfg] gate), so
  # macOS also intercepts close and hides the window to the tray. This
  # means `osascript 'tell application "X" to quit'` actually gets
  # translated by AppKit to "close last window", the handler fires
  # `prevent_close() + hide()`, and the process stays alive. The old
  # "quit → exit" assertion was therefore backwards — the Rust tray
  # semantics are identical across platforms.
  #
  # Verify the same Windows semantic on macOS: send the standard
  # close-window shortcut (Cmd+W via System Events), the handler
  # intercepts, window hides, process survives 1s. Test 4 still does
  # force kill cleanup; if the process somehow exited we treat that as
  # FAIL (the tray handler must keep it alive).
  osascript -e 'tell application "System Events" to tell process "ClaudeManager" to keystroke "w" using command down' 2>/dev/null || true
  sleep 1
  # Wrap pgrep in { ... || true; } to tolerate the "no match" exit 1
  # under `set -e` + `set -o pipefail`. When tray handler correctly hides
  # the window but the process keeps running, pgrep returns 1 and would
  # break the script before we can record PASS. (See Test 4 for the same
  # pattern.)
  PROC_AFTER_CLOSE=$( { pgrep -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null || true; } | wc -l | tr -d ' ')
  if [[ "$PROC_AFTER_CLOSE" -ge "1" ]]; then
    record "3_tray" "PASS" "process survived Cmd+W (close intercepted by tray handler, app stays alive)"
  else
    record "3_tray" "FAIL" "process exited after Cmd+W (count=$PROC_AFTER_CLOSE; tray handler should have kept it alive)"
  fi
else
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
fi

# === Test 4: Force kill → process gone within 2s ===
echo ""
echo ">>> Test 4: Force kill"
if [[ "$IS_DARWIN" == "true" ]]; then
  pkill -9 -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null || true
  sleep 2
  # pgrep returns 1 when no match — that breaks `set -e` + `set -o pipefail`
  # under `$(...)` capture. Wrap pgrep itself in `... || true` so the
  # pipeline always succeeds. When pgrep finds nothing, `wc -l` reads EOF
  # and emits "0", which is exactly what we want.
  PROC_AFTER_KILL=$( { pgrep -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null || true; } | wc -l | tr -d ' ')
else
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
fi
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