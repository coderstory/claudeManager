#!/usr/bin/env bash
# scripts/build-mac.sh — macOS dev iteration build (M1.10)
#
# Purpose: macOS equivalent of scripts/build-and-ship.sh (Windows).
# Unlike the Windows script:
#   - Uses `cargo tauri build` (NOT `cargo build --release`) — runs
#     `beforeBuildCommand` (npm run build) automatically; no cache
#     touch / no custom-protocol flag needed
#   - No mingw64 windres workaround (Apple linker is native)
#   - No WebView2Loader.dll dance (WebKit ships with macOS)
#   - Does NOT copy to desktop (macOS dev iteration runs locally;
#     desktop delivery is for Windows M1.x user-review flow only —
#     see CLAUDE.md §9)
#
# Usage:
#   ./scripts/build-mac.sh                  # release bundle (.app + .dmg)
#   ./scripts/build-mac.sh --debug          # debug bundle (faster)
#   ./scripts/build-mac.sh --no-bundle      # cargo build only, no bundling
#   ./scripts/build-mac.sh --no-dmg         # build .app but skip .dmg (dev: 直接 cp 到 /Applications)
#
# Output:
#   src-tauri/target/release/bundle/macos/ClaudeManager.app
#   src-tauri/target/release/bundle/dmg/ClaudeConfigManager_<VERSION>_aarch64.dmg (除非 --no-dmg)
#
# Required env:
#   - macOS host with Xcode Command Line Tools (`xcode-select --install`)
#   - Rust stable toolchain (`rustup default stable`)
#   - Node 22 LTS (matches CI: actions/setup-node@v4 node-version: lts/*)
#
# This script does NOT sign or notarize the bundle. v1.1 signing lives
# in CI (.github/workflows/release.yml). See docs/SIGNING.md.

# Note: we deliberately omit `-u` from `set -e`. macOS ships bash 3.2.57
# by default (last GPLv2 release, 2007), where unset/empty array expansion
# under `set -u` is brittle (e.g. `${EXTRA_ARGS[*]}` when no flag was
# passed triggers "unbound variable" on bash 3.2 even though bash 4+ is
# fine). We use the array defensively and tolerate unset vars instead.
set -eo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# === sccache (shared compile cache, optional) ===
# sccache 不是硬依赖——未装就 fallback 到普通 cargo 编译,build 不会失败。
# 路径用项目专属目录,避免与本机其他项目共享缓存(混淆 + 体积叠加)。
# 缓存上限 5G:sccache 默认 10G 容易把磁盘撑爆,这里主动限。
# 若已装 ~/.cargo/bin/sccache,这两行 export 会在每次 cargo 链上生效。
if command -v sccache >/dev/null 2>&1; then
  export SCCACHE_DIR="${HOME}/Library/Caches/sccache-claude-config-manager"
  export SCCACHE_CACHE_SIZE="5G"
  echo "[sccache] enabled (dir: $SCCACHE_DIR, size cap: $SCCACHE_CACHE_SIZE)"
  echo "[sccache] run 'sccache --show-stats' after build to inspect hit rate"
else
  echo "[sccache] not installed, skipping (build will still work, just no shared cache)"
  echo "[sccache] install: brew install sccache   # or: cargo install sccache --locked"
fi
echo ""

MODE="release"
EXTRA_ARGS=()
NO_DMG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug)     MODE="debug"; shift ;;
    --no-bundle) EXTRA_ARGS+=("--no-bundle"); shift ;;
    --no-dmg)    NO_DMG=1; shift ;;
    *)           echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "============================================"
echo "build-mac.sh"
echo "  mode:    $MODE"
echo "  extra:   ${EXTRA_ARGS[*]:-(none)}"
echo "  root:    $PROJECT_ROOT"
echo "============================================"
echo ""

# === Step 1: Pre-cleanup ===
echo "[1/3] Pre-cleanup: killing any running ClaudeManager.app..."
osascript -e 'tell application "ClaudeConfigManager" to quit' 2>/dev/null || true
sleep 1
pkill -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null || true
sleep 1

# Pre-cleanup: detach stale DMG mounts from previous crashed builds + remove rw.*.dmg orphans
# (Tauri's bundle preflight wipes bundle/dmg/ but NOT bundle/macos/, where hdiutil
#  drops its temporary read-write image. Stale mounts + rw.*.dmg cause bundle_dmg.sh
#  to race / fail intermittently with "Not enough arguments".)
if command -v hdiutil >/dev/null 2>&1; then
  hdiutil info 2>/dev/null | grep -E '/dev/disk[0-9]+.*(Apple_HFS|Apple_APFS)' | awk '{print $1}' | while read -r dev; do
    hdiutil detach "$dev" 2>/dev/null || true
  done
fi
find "$PROJECT_ROOT/src-tauri/target" -path '*/bundle/macos/rw.*.dmg' -delete 2>/dev/null || true

# === Step 2: Build ===
START=$(date +%s)

echo ""
echo "[2/3] Running: cargo tauri build ($MODE) ${EXTRA_ARGS[*]}"
echo "    (this auto-runs 'npm run build' via beforeBuildCommand)"
echo ""

if [[ "$MODE" == "debug" ]]; then
  cargo tauri build --debug "${EXTRA_ARGS[@]}"
else
  cargo tauri build "${EXTRA_ARGS[@]}"
fi

BUILD_END=$(date +%s)
BUILD_DUR=$((BUILD_END - START))
echo ""
echo "    Build took ${BUILD_DUR}s"

# === Step 3: Report ===
APP_PATH="$PROJECT_ROOT/src-tauri/target/$MODE/bundle/macos/ClaudeManager.app"
DMG_DIR="$PROJECT_ROOT/src-tauri/target/$MODE/bundle/dmg"

echo ""
echo "[3/3] Output"
if [[ -d "$APP_PATH" ]]; then
  SIZE=$(du -sh "$APP_PATH" 2>/dev/null | awk '{print $1}')
  echo "    app:  $APP_PATH ($SIZE)"
  echo "    open: open '$APP_PATH'"
else
  echo "    WARN: .app not found at $APP_PATH (build may have failed or used --no-bundle)"
fi

if [[ -d "$DMG_DIR" ]]; then
  DMG_FILES=$(ls "$DMG_DIR"/*.dmg 2>/dev/null || true)
  if [[ -n "$DMG_FILES" ]]; then
    if [[ $NO_DMG -eq 1 ]]; then
      # dev: 用户直接 cp .app 到 /Applications, 不需要 dmg
      echo "    [--no-dmg] 删除 dmg: $DMG_DIR/"
      rm -f "$DMG_DIR"/*.dmg
    else
      for f in $DMG_FILES; do
        SIZE=$(du -sh "$f" 2>/dev/null | awk '{print $1}')
        echo "    dmg:  $f ($SIZE)"
      done
    fi
  fi
fi

echo ""
echo "============================================"
echo "DONE ✓"
echo "  Build: ${BUILD_DUR}s"
echo "============================================"
echo ""
echo "Note: this build is UNSIGNED. v1.1 release work happens in CI"
echo "(.github/workflows/release.yml + docs/SIGNING.md)."
exit 0