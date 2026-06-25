#!/usr/bin/env bash
# scripts/run-e2e.sh — Run Playwright e2e against the real Tauri WebView2.
#
# Why this exists:
#   Tauri's official WebDriver path is tauri-driver + WebDriverIO. This
#   project uses Playwright, which speaks CDP (not WebDriver). The two
#   are bridged by the fact that tauri-driver's session response
#   includes `debuggerAddress` — the WebView2 CDP endpoint. We extract
#   that endpoint and hand it to Playwright via connectOverCDP.
#
#   This lets us run the 6 M1.8 specs (launch / tray / close-minimize)
#   against the REAL Tauri WebView2 (with __TAURI_INTERNALS__ IPC
#   bridge + tray icon + window-close interception) on the dev box.
#
# Prereqs (auto-detected, will skip with a clear message if missing):
#   - tauri-driver on PATH (~/.cargo/bin/tauri-driver; install via
#     `cargo install tauri-driver --version "^2.0"`)
#   - msedgedriver.exe on PATH or in %TEMP% (download matching your
#     Edge version from
#     https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/)
#   - release exe at src-tauri/target/release/claude-config-manager.exe
#     (build via `npm run tauri build -- --no-bundle`)
#
# Usage:
#   ./scripts/run-e2e.sh                       # run all 6 M1.8 specs
#   ./scripts/run-e2e.sh tests/e2e/launch.spec.ts  # run specific spec(s)
#   PLAYWRIGHT_BASE_URL=http://localhost:1420 ./scripts/run-e2e.sh
#                                              # dev-server mode (no tauri-driver)
#
# Env vars:
#   TAURI_DRIVER_PORT  (default 4444)  intermediary port
#   TAURI_NATIVE_PORT  (default 4445)  native msedgedriver port
#   EXE_PATH           (default src-tauri/target/release/claude-config-manager.exe)
#   PLAYWRIGHT_BASE_URL  if set, skip tauri-driver and run against this URL
#                        (e.g. http://localhost:1420 for Vite dev mode)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# ============================================================================
# Mode A: dev-server (no tauri-driver). PLAYWRIGHT_BASE_URL set externally.
# ============================================================================
if [[ -n "${PLAYWRIGHT_BASE_URL:-}" ]]; then
  echo ">>> run-e2e.sh: dev-server mode (PLAYWRIGHT_BASE_URL=$PLAYWRIGHT_BASE_URL)"
  echo ">>> Running: npx playwright test $*"
  npx playwright test "$@"
  exit $?
fi

# ============================================================================
# Mode B: real Tauri WebView2 via tauri-driver + CDP.
# ============================================================================

# --- Prereq 1: tauri-driver binary ---
if ! command -v tauri-driver >/dev/null 2>&1; then
  echo "FAIL: tauri-driver not on PATH."
  echo "      Install with: cargo install tauri-driver --version \"^2.0\""
  echo "      (or set PLAYWRIGHT_BASE_URL=http://localhost:1420 for dev-server mode)"
  exit 1
fi

# --- Prereq 2: WebDriver backend (platform-specific) ---
# tauri-driver talks to the host's WebDriver implementation. The backend
# differs by platform because Tauri uses different webview engines:
#   - Windows: WebView2 (Edge Chromium)  → needs msedgedriver.exe
#   - macOS:   WKWebView (Apple WebKit)  → needs safaridriver (built-in)
# The rest of the script (cygpath / powershell / .exe path) is Windows-only
# and is gated behind the non-Darwin branch.
if [[ "$(uname -s)" == "Darwin" ]]; then
  if ! command -v safaridriver >/dev/null 2>&1; then
    echo "FAIL: safaridriver not on PATH (macOS WebDriver backend)."
    echo "      safaridriver ships with macOS; enable with: safaridriver --enable"
    echo "      (System Settings → Privacy & Security → Developer Tools)"
    echo "      (or set PLAYWRIGHT_BASE_URL=http://localhost:1420 for dev-server mode)"
    exit 1
  fi
  echo ">>> Using safaridriver (macOS WKWebView backend)"
else
  # --- Windows / Git Bash: msedgedriver.exe ---
  # tauri-driver looks up msedgedriver.exe in PATH. Common cache locations
  # we can pre-add to PATH: %TEMP% (where the edgedriver npm package drops it)
  # and ~/.cache/msedgedriver.
  MSEDGEDRIVER_CANDIDATES=(
    "${LOCALAPPDATA:-}/Temp"
    "${TEMP:-}"
    "$HOME/.cache/msedgedriver"
    "/c/Users/${USER:-e-Yunfei.Qian}/AppData/Local/Temp"
  )
  for c in "${MSEDGEDRIVER_CANDIDATES[@]}"; do
    if [[ -n "$c" && -x "$c/msedgedriver.exe" ]] && ! command -v msedgedriver.exe >/dev/null 2>&1; then
      export PATH="$c:$PATH"
      echo ">>> Auto-added $c to PATH (msedgedriver.exe found)"
      break
    fi
  done
  if ! command -v msedgedriver.exe >/dev/null 2>&1; then
    echo "FAIL: msedgedriver.exe not on PATH."
    echo "      Download from https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/"
    echo "      matching your Edge version (run msedge --version to check)."
    echo "      Drop msedgedriver.exe anywhere on PATH or in %TEMP%."
    echo "      (or set PLAYWRIGHT_BASE_URL=http://localhost:1420 for dev-server mode)"
    exit 1
  fi
fi

# --- Prereq 3: release exe (path differs by platform) ---
if [[ "$(uname -s)" == "Darwin" ]]; then
  EXE_PATH="${EXE_PATH:-$PROJECT_ROOT/src-tauri/target/release/bundle/macos/ClaudeManager.app}"
else
  EXE_PATH="${EXE_PATH:-$PROJECT_ROOT/src-tauri/target/release/claude-config-manager.exe}"
fi
if [[ ! -e "$EXE_PATH" ]]; then
  echo "FAIL: release exe not found at $EXE_PATH"
  echo "      Build with: ./scripts/build.sh --release (mac) or build-only.sh (win)"
  exit 1
fi
# Convert to Windows-style path only on Windows; macOS keeps the .app path.
EXE_PATH_WIN=""
if [[ "$(uname -s)" != "Darwin" ]]; then
  EXE_PATH_WIN=$(cygpath -w "$EXE_PATH" 2>/dev/null || echo "$EXE_PATH")
fi

# --- Ports ---
DRIVER_PORT="${TAURI_DRIVER_PORT:-4444}"
NATIVE_PORT="${TAURI_NATIVE_PORT:-4445}"

# --- Kill stale instances ---
echo ">>> Pre-cleanup: killing any stale app/driver instances..."
./scripts/kill-app.sh >/dev/null 2>&1 || true
if [[ "$(uname -s)" == "Darwin" ]]; then
  pkill -x tauri-driver 2>/dev/null || true
else
  powershell.exe -NoProfile -Command "Get-Process -Name 'tauri-driver','msedgedriver' -ErrorAction SilentlyContinue | Stop-Process -Force" 2>&1 || true
fi
sleep 1

# --- Start tauri-driver in background ---
echo ">>> Starting tauri-driver (port $DRIVER_PORT, native port $NATIVE_PORT)..."
tauri-driver --port "$DRIVER_PORT" --native-port "$NATIVE_PORT" > /tmp/tauri-driver.log 2>&1 &
DRIVER_PID=$!
echo "    tauri-driver PID: $DRIVER_PID"

cleanup() {
  echo ">>> Cleanup: killing tauri-driver (PID $DRIVER_PID) + app..."
  kill "$DRIVER_PID" 2>/dev/null || true
  wait "$DRIVER_PID" 2>/dev/null || true
  ./scripts/kill-app.sh >/dev/null 2>&1 || true
  if [[ "$(uname -s)" == "Darwin" ]]; then
    pkill -x tauri-driver 2>/dev/null || true
  else
    powershell.exe -NoProfile -Command "Get-Process -Name 'tauri-driver','msedgedriver' -ErrorAction SilentlyContinue | Stop-Process -Force" 2>&1 || true
  fi
}
trap cleanup EXIT

# Wait for tauri-driver /status to report ready
echo ">>> Waiting for tauri-driver to be ready..."
for i in {1..20}; do
  if curl -sf --max-time 2 "http://127.0.0.1:$DRIVER_PORT/status" >/dev/null 2>&1; then
    echo "    tauri-driver ready (after ${i}s)"
    break
  fi
  sleep 1
  if [[ $i -eq 20 ]]; then
    echo "FAIL: tauri-driver did not become ready in 20s"
    cat /tmp/tauri-driver.log 2>&1 | tail -10
    exit 1
  fi
done

# --- Create WebDriver session = launch the Tauri app ---
# The session response includes `debuggerAddress` — the WebView2 CDP
# endpoint. We extract it and hand it to Playwright via connectOverCDP.
echo ">>> Creating WebDriver session (launches Tauri app)..."

# Build valid JSON payload via node (handles all escaping correctly).
SESSION_PAYLOAD_FILE=$(mktemp -t session-payload.XXXXXX.json)
node -e "
const fs = require('fs');
const exe = process.argv[1];
const payload = JSON.stringify({
  capabilities: { alwaysMatch: { 'tauri:options': { application: exe } } }
});
fs.writeFileSync(process.argv[2], payload, 'utf8');
" "$EXE_PATH_WIN" "$SESSION_PAYLOAD_FILE"

SESSION_RESP=$(curl -sf --max-time 60 -X POST "http://127.0.0.1:$DRIVER_PORT/session" \
  -H "Content-Type: application/json" \
  -d @"$SESSION_PAYLOAD_FILE" 2>&1)
rm -f "$SESSION_PAYLOAD_FILE"

CDP_ADDR=$(echo "$SESSION_RESP" | grep -oE '"debuggerAddress":"[^"]*"' | head -1 | cut -d'"' -f4)
SESSION_ID=$(echo "$SESSION_RESP" | grep -oE '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -z "$CDP_ADDR" || -z "$SESSION_ID" ]]; then
  echo "FAIL: could not extract debuggerAddress / sessionId from session response"
  echo "$SESSION_RESP" | head -c 500
  exit 1
fi
echo "    Session ID: $SESSION_ID"
echo "    CDP endpoint: http://$CDP_ADDR"

# Wait for the WebView2 to settle (frontend bundle load + React mount)
echo ">>> Waiting for WebView2 frontend to load..."
for i in {1..15}; do
  TITLE=$(curl -sf --max-time 2 "http://$CDP_ADDR/json/list" 2>/dev/null | grep -oE '"title":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [[ -n "$TITLE" ]]; then
    echo "    WebView2 page title: $TITLE (after ${i}s)"
    break
  fi
  sleep 1
done

# --- Run Playwright via CDP ---
# Playwright reads CDP_ENDPOINT env var (see tests/e2e/.cdp-connect.ts).
echo ">>> Running Playwright e2e via CDP..."
CDP_ENDPOINT="http://$CDP_ADDR" npx playwright test "$@"
RC=$?

echo ">>> Playwright exit code: $RC"
exit $RC
