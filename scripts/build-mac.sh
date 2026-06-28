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
#
# v3.4.4 — Auto-clear stale Tauri codegen-assets + verify dist inlined.
#   [1.5/3] Before `cargo tauri build`: detect + clear stale
#           `target/$MODE/build/claude-config-manager-*/out/tauri-codegen-assets/`
#           (preserves sccache warm cache for other crates).
#   [2.5/3] After build: grep `BUILD_MARKER` (ccm-build-mtime-<hex>) from
#           the built binary, verify it matches current dist/ hash.
#           Fail loudly if mismatch (Tauri cache stale despite cleanup).
#   Implementation:
#     - src-tauri/build.rs emits `cargo:rustc-env=DIST_HASH=<hex>`.
#     - src-tauri/src/lib.rs `pub const BUILD_MARKER: &str =
#         concat!("ccm-build-mtime-", env!("DIST_HASH"))`.
#   See:
#     - .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
#     - docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md

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

# === Helper: compute dist hash (v3.4.4) ===
# Returns hex of max mtime epoch seconds across all files in $1.
# Mirrors `compute_dist_mtime_max` in src-tauri/build.rs — any
# divergence between the Rust and bash sides is caught at [2.5/3]
# verification. Uses macOS BSD `stat -f '%m'` (BSD mtime epoch seconds);
# GNU `stat --format='%Y'` does not exist on macOS.
compute_dist_hash_inline() {
  local dir="$1"
  [[ ! -d "$dir" ]] && { echo "0"; return; }
  local max=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    local secs
    secs=$(stat -f '%m' "$f" 2>/dev/null || echo 0)
    (( secs > max )) && max=$secs
  done < <(find "$dir" -type f 2>/dev/null)
  printf '%x\n' "$max"
}

MODE="release"
EXTRA_ARGS=()
NO_DMG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug)     MODE="debug"; shift ;;
    --no-bundle) EXTRA_ARGS+=("--no-bundle"); shift ;;
    --no-dmg)
      # v3.4.1 fix — `--no-dmg` previously only deleted the dmg
      # AFTER `cargo tauri build` spent time creating it. Now we
      # pass `--bundles app` so cargo tauri skips dmg/dmg step
      # entirely. `--bundles app` is supported on Tauri 2.x
      # (the "app" bundle = the .app folder; we still want that).
      NO_DMG=1
      EXTRA_ARGS+=("--bundles" "app")
      shift
      ;;
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

# === Pre-flight checks (v3.4.4) ===
# build.rs is required to embed BUILD_MARKER (DIST_HASH) into the
# binary so [2.5/3] verification can grep it post-build.
[[ -f "$PROJECT_ROOT/src-tauri/build.rs" ]] || {
  echo "FAIL: src-tauri/build.rs missing."
  echo "      v3.4.4 fix requires this file to embed BUILD_MARKER."
  echo "      See .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md"
  exit 1
}
command -v strings >/dev/null 2>&1 || {
  echo "WARN: 'strings' not found; verification step [2.5/3] will be skipped."
  echo "      Install Xcode CLT: xcode-select --install"
}

# === Step 1: Pre-cleanup ===
echo "[1/3] Pre-cleanup: killing any running ClaudeManager.app..."
# 'tell application "ClaudeManager"' resolves to CFBundleName from
# tauri.conf.json::productName. Using the bundle identifier
# "ClaudeConfigManager" (or the AppData folder name) would make
# AppleScript silently no-op because AppleEvent name resolution uses
# CFBundleName, not the identifier.
osascript -e 'tell application "ClaudeManager" to quit' 2>/dev/null || true
sleep 1
pkill -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" 2>/dev/null || true
sleep 1

# Pre-cleanup: detach stale DMG mounts from previous crashed builds + remove rw.*.dmg orphans
# (Tauri's bundle preflight wipes bundle/dmg/ but NOT bundle/macos/, where hdiutil
#  drops its temporary read-write image. Stale mounts + rw.*.dmg cause bundle_dmg.sh
#  to race / fail intermittently with "Not enough arguments".)
if command -v hdiutil >/dev/null 2>&1; then
  hdiutil info 2>/dev/null | { grep -E '/dev/disk[0-9]+.*(Apple_HFS|Apple_APFS)' || true; } | awk '{print $1}' | while read -r dev; do
    hdiutil detach "$dev" 2>/dev/null || true
  done
fi
find "$PROJECT_ROOT/src-tauri/target" -path '*/bundle/macos/rw.*.dmg' -delete 2>/dev/null || true

# === Step 1.5: Clear stale Tauri codegen-assets (v3.4.4) ===
# Tauri 2.x embeds frontendDist ("../dist") into the binary via
# `tauri::generate_context!()`. The codegen-assets output is cached
# under target/$MODE/build/claude-config-manager-<hash>/out/.
# `cargo tauri build` does NOT detect dist content changes; if you
# edit src/ and re-run, the binary can still contain the OLD dist.
#
# Fix: before each build, compare the max mtime of dist/ against
# the max mtime of each codegen-assets dir. If they differ, clear
# that hash dir so cargo regenerates it (preserves sccache warm
# cache for non-codegen crates). See:
#   .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
#   docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$PROJECT_ROOT/src-tauri/target/$MODE/build"

if [[ -d "$DIST_DIR" && -d "$BUILD_DIR" ]]; then
  DIST_HASH=$(compute_dist_hash_inline "$DIST_DIR")
  if [[ "$DIST_HASH" != "0" ]]; then
    CLEARED=0
    while IFS= read -r hashdir; do
      ASSETS_DIR="$hashdir/out/tauri-codegen-assets"
      [[ ! -d "$ASSETS_DIR" ]] && continue
      ASSETS_HASH=$(compute_dist_hash_inline "$ASSETS_DIR")
      if [[ "$ASSETS_HASH" != "$DIST_HASH" ]]; then
        echo "[1.5/3] Stale codegen-assets detected → rm -rf $hashdir"
        rm -rf "$hashdir"
        CLEARED=$((CLEARED + 1))
      fi
    done < <(find "$BUILD_DIR" -maxdepth 1 -type d -name 'claude-config-manager-*')
    if [[ $CLEARED -eq 0 ]]; then
      echo "[1.5/3] codegen-assets fresh (hash=$DIST_HASH matches)"
    else
      echo "[1.5/3] cleared $CLEARED stale hash dir(s)"
    fi
  fi
fi

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

# === Step 2.5: Verify dist content actually inlined into binary (v3.4.4) ===
# Greps for BUILD_MARKER (Rust `pub const` embedded as raw text in
# .rodata, NOT lz4-compressed). Marker value should match the current
# dist/ hash. If mismatch, Tauri did not re-inline. See:
#   .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md

APP_BIN="$PROJECT_ROOT/src-tauri/target/$MODE/bundle/macos/ClaudeManager.app/Contents/MacOS/claude-config-manager"

if [[ -x "$APP_BIN" ]] && command -v strings >/dev/null 2>&1; then
  echo "[2.5/3] Verifying BUILD_MARKER in binary..."

  EXPECTED_HASH=$(compute_dist_hash_inline "$DIST_DIR")
  EXPECTED_MARKER="ccm-build-mtime-$EXPECTED_HASH"

  ACTUAL_MARKER=$(strings "$APP_BIN" 2>/dev/null | \
    grep -oE 'ccm-build-mtime-[0-9a-f]+' | \
    head -1 || true)

  if [[ -z "$ACTUAL_MARKER" ]]; then
    echo "FAIL: BUILD_MARKER not found in binary." >&2
    echo "      Binary: $APP_BIN" >&2
    echo "      This suggests build.rs didn't run or src-tauri/src/lib.rs" >&2
    echo "      is missing the BUILD_MARKER const." >&2
    echo "      Remediation: cd src-tauri && cargo clean -p claude-config-manager && rerun" >&2
    exit 1
  fi

  if [[ "$ACTUAL_MARKER" != "$EXPECTED_MARKER" ]]; then
    echo "FAIL: BUILD_MARKER mismatch — dist content NOT inlined into binary." >&2
    echo "      Expected: $EXPECTED_MARKER" >&2
    echo "      Got:      $ACTUAL_MARKER" >&2
    echo "      This is the bug from .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md" >&2
    echo "      Tauri 2.x codegen-assets cache is stale despite [1.5/3] cleanup." >&2
    echo "      Remediation:" >&2
    echo "        rm -rf src-tauri/target/$MODE/build/claude-config-manager-*" >&2
    echo "        # OR:" >&2
    echo "        cd src-tauri && cargo clean -p claude-config-manager" >&2
    echo "        # Then rerun: $0" >&2
    exit 1
  fi

  echo "    ✓ BUILD_MARKER matches: $ACTUAL_MARKER"
fi

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