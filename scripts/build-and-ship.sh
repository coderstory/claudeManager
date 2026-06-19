#!/usr/bin/env bash
# scripts/build-and-ship.sh — 构建 + 冒烟测试 + 复制到桌面
#
# 用法：
#   ./scripts/build-and-ship.sh --milestone M1 --task 1.1 --slug scaffold
#
# 流程：
#   1. cargo build --release 生成 release exe
#   2. 复制 exe + WebView2Loader.dll 到桌面
#   3. 跑 smoke test
#   4. smoke test 失败 → 从桌面删除 exe，exit 1
#   5. smoke test 通过 → 输出报告，等用户核定

set -euo pipefail

# === Auto-fix: ensure MinGW64 bin (windres/dlltool) on PATH for cargo build ===
# This machine's Git Bash PATH does not include msys2 mingw64 bin, but Rust's
# windows-gnu toolchain requires windres.exe to compile .rc → .res for PE
# resources. Auto-detect and add if present.
if ! command -v windres >/dev/null 2>&1; then
  for candidate in "/c/msys64/mingw64/bin" "/mingw64/bin" "/c/MinGW/msys/1.0/bin"; do
    if [[ -x "$candidate/windres.exe" ]]; then
      export PATH="$candidate:$PATH"
      echo ">>> Auto-added $candidate to PATH (windres found)"
      break
    fi
  done
fi

# Parse args
MILESTONE=""
TASK=""
SLUG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) MILESTONE="$2"; shift 2 ;;
    --task)      TASK="$2"; shift 2 ;;
    --slug)      SLUG="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$MILESTONE" || -z "$TASK" || -z "$SLUG" ]]; then
  echo "Usage: build-and-ship.sh --milestone <M1|M2|...> --task <1.1|1.2|...> --slug <kebab-case>"
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_BASE="/c/Users/e-Yunfei.Qian/Desktop"
DEST_DIR="$DESKTOP_BASE/ClaudeConfigManager-${MILESTONE}"
DEST_EXE="$DEST_DIR/ClaudeConfigManager-${MILESTONE}.${TASK}-${SLUG}.exe"
SOURCE_EXE="$PROJECT_ROOT/src-tauri/target/release/claude-config-manager.exe"
WEBVIEW2_DLL_SRC="$PROJECT_ROOT/src-tauri/target/release/WebView2Loader.dll"
WEBVIEW2_DLL_DST="$DEST_DIR/WebView2Loader.dll"

EXE_NAME="claude-config-manager.exe"

echo "================================================"
echo "Build & Ship"
echo "  milestone: $MILESTONE"
echo "  task:      $TASK"
echo "  slug:      $SLUG"
echo "  source:    $SOURCE_EXE"
echo "  dest:      $DEST_EXE"
echo "================================================"
echo ""

# === Step 1: Pre-cleanup ===
echo "[1/5] Pre-cleanup: killing any existing instances..."
powershell.exe -NoProfile -Command "Get-Process -Name '${EXE_NAME%.exe}' -ErrorAction SilentlyContinue | Stop-Process -Force" 2>&1 || true
sleep 1

# === Step 2: Build ===
echo ""
echo "[2/5] Building release exe..."
cd "$PROJECT_ROOT"

# Why we touch src-tauri/src/lib.rs:
# - `tauri build` runs `beforeBuildCommand: "npm run build"` automatically
# - But we're using `cargo build --release` directly, which does NOT
# - So we must rebuild frontend manually + invalidate Cargo's cache
# - Without the touch, Cargo sees unchanged Rust source and skips relink,
#   leaving the new `dist/` unused and the exe rendering the old bundle
# - This is a workaround until we migrate to `tauri build` (M1.10)
#
# Step 1/3: rebuild frontend so dist/ is fresh
echo "    Step 1/3: Rebuilding frontend (npm run build)..."
npm run build 2>&1 | tail -5
# Step 2/3: invalidate Cargo's cache so it actually re-links
echo "    Step 2/3: Touching src-tauri/src/lib.rs to invalidate Cargo cache..."
touch src-tauri/src/lib.rs
# Step 3/3: build the Rust binary (now re-links because lib.rs mtime changed)
#
# CRITICAL — the `--features tauri/custom-protocol` flag is REQUIRED when
# building with `cargo build --release` directly (i.e. NOT through `tauri
# build`). Without it, Tauri's `tauri::generate_context!()` proc macro
# sees `dev = true` (because `custom-protocol` is absent) and:
#   1. emits `EmbeddedAssets::default()` — ZERO dist files embedded
#   2. at runtime, the `cfg!(dev)` branch in `manager::get_app_url`
#      picks `build.devUrl` ("http://localhost:1420") instead of
#      `frontendDist`, so the webview tries to load the dev server
#      → "ERR_CONNECTION_REFUSED" / blank "无法访问此页面" page.
# `tauri build` enables this feature automatically; we have to do it
# ourselves. See `tauri-2.x/src/manager/mod.rs:354-360` and
# `tauri-codegen-2.x/src/context.rs:178-184` for the runtime/codegen
# branches that depend on this cfg.
echo "    Step 3/3: cargo build --release --features tauri/custom-protocol..."
BUILD_START=$(date +%s)
cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
BUILD_END=$(date +%s)
BUILD_DUR=$((BUILD_END - BUILD_START))
echo "    Build took ${BUILD_DUR}s"

if [[ ! -f "$SOURCE_EXE" ]]; then
  echo "FAIL: exe not produced at $SOURCE_EXE"
  exit 1
fi

EXE_SIZE=$(stat -c%s "$SOURCE_EXE" 2>/dev/null || stat -f%z "$SOURCE_EXE" 2>/dev/null || echo "?")
echo "    exe size: $EXE_SIZE bytes ($(echo "scale=1; $EXE_SIZE/1024/1024" | bc 2>/dev/null || echo "?") MB)"

# === Step 3: Copy exe + WebView2Loader.dll ===
echo ""
echo "[3/5] Copying to desktop..."
mkdir -p "$DEST_DIR"

cp "$SOURCE_EXE" "$DEST_EXE"
echo "    Copied exe → $DEST_EXE"

if [[ -f "$WEBVIEW2_DLL_SRC" ]]; then
  cp "$WEBVIEW2_DLL_SRC" "$WEBVIEW2_DLL_DST"
  echo "    Copied WebView2Loader.dll → $WEBVIEW2_DLL_DST"
else
  echo "    WARN: WebView2Loader.dll not found at $WEBVIEW2_DLL_SRC"
fi

# === Step 4: Smoke test ===
echo ""
echo "[4/5] Running smoke test..."
if "$PROJECT_ROOT/scripts/smoke-test.sh" "$DEST_EXE"; then
  SMOKE_RESULT="PASS"
else
  SMOKE_RESULT="FAIL"
fi

# === Step 5: Report ===
echo ""
echo "[5/5] Result"
if [[ "$SMOKE_RESULT" == "FAIL" ]]; then
  echo "FAIL: smoke test failed. Removing exe from desktop..."
  rm -f "$DEST_EXE" "$WEBVIEW2_DLL_DST"
  echo "Cleaned up. Fix issues and re-run."
  exit 1
fi

echo "================================================"
echo "SHIPPED ✓"
echo "  Desktop: $DEST_EXE"
echo "  WebView2 DLL: $WEBVIEW2_DLL_DST"
echo "  Smoke: 4/4 passed"
echo "  Build: ${BUILD_DUR}s"
echo ""
echo "Waiting for user review. Do NOT proceed to next task without explicit approval."
echo "================================================"
exit 0