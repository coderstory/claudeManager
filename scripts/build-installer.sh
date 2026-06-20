#!/usr/bin/env bash
# scripts/build-installer.sh — F8 single-file installer generator (M2.8)
#
# Purpose: produce a production-grade installer for the platform passed
# as $1, alongside a SHA256 checksum file. This is the script the
# SingleFileDeployPage instructs users to run.
#
# Usage:
#   bash scripts/build-installer.sh windows   # NSIS .exe installer
#   bash scripts/build-installer.sh macos     # DMG (requires macOS host)
#
# Output:
#   installers/<productName>_<version>_x64-setup.exe (or .dmg)
#   installers/<above>.sha256
#
# NOTE on output path: we use `installers/` (NOT `dist/installers/`)
# because `dist/` is the Vite frontend bundle output (cleared on every
# `npm run build`), and `tauri build` runs `npm run build` first as
# its `beforeBuildCommand`. Putting installers under `dist/` would
# wipe them on the next dev build. `installers/` is in .gitignore.
#
# Why a separate script (NOT part of build-and-ship.sh):
#   - build-and-ship.sh emits the dev-build exe (~30 MB, with
#     WebView2Loader.dll alongside). That's the iteration shipping path.
#   - This script emits the production installer (~7 MB single .exe).
#     It uses `tauri build`, which:
#       * runs `npm run build` itself (via beforeBuildCommand)
#       * enables the `tauri/custom-protocol` feature automatically
#       * produces NSIS / DMG bundles (build-and-ship.sh does NOT)
#   - Keeping them separate means changes to one path don't churn the
#     other. Per CLAUDE.md §2.4 ("谨慎修改文件 + 不要顺便把 X 也改了").
#
# Prerequisites:
#   - Rust + cargo on PATH
#   - Node.js + npm on PATH
#   - tauri CLI: provided via package.json (`@tauri-apps/cli ^2`).
#     This script invokes it through `npm run tauri --` so no separate
#     install is needed; just run `npm install` once.
#   - Windows: NSIS toolchain. tauri-cli auto-downloads `nsis-3.x` to
#     ~/.cargo/.../tauri/NSIS on first build. No manual install needed.
#   - macOS: Xcode command-line tools (`xcode-select --install`).
#
# Failure modes:
#   - tauri CLI missing → script aborts with the install command.
#   - Wrong target platform (e.g. asking for `windows` on macOS) → tauri
#     handles cross-build itself or surfaces a clear error.

set -euo pipefail

# ---- Auto-fix PATH for windres on Windows dev box ----------------------------
# Mirrors scripts/build-and-ship.sh — Git Bash here doesn't include
# msys2 mingw64 bin by default, but the windows-gnu Rust toolchain
# needs windres.exe to compile .rc → .res. tauri build silently
# truncates output if it fails; auto-detect and prepend.
if ! command -v windres >/dev/null 2>&1; then
  for candidate in "/c/msys64/mingw64/bin" "/mingw64/bin" "/c/MinGW/msys/1.0/bin"; do
    if [[ -x "$candidate/windres.exe" ]]; then
      export PATH="$candidate:$PATH"
      echo ">>> Auto-added $candidate to PATH (windres found)"
      break
    fi
  done
fi

# ---- Args + paths ------------------------------------------------------------
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $(basename "$0") <windows|macos>" >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

PRODUCT_NAME=$(grep -E '"productName"' src-tauri/tauri.conf.json | head -1 \
  | sed 's/.*"productName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
VERSION=$(grep -E '^version' src-tauri/Cargo.toml | head -1 \
  | sed 's/.*"\([^"]*\)".*/\1/')

if [[ -z "$PRODUCT_NAME" || -z "$VERSION" ]]; then
  echo "FAIL: could not parse productName / version from manifests" >&2
  echo "  productName='$PRODUCT_NAME' version='$VERSION'" >&2
  exit 1
fi

OUT_DIR="$PROJECT_ROOT/installers"
mkdir -p "$OUT_DIR"

echo "================================================"
echo "F8 — single-file installer build"
echo "  target:       $TARGET"
echo "  product:      $PRODUCT_NAME"
echo "  version:      $VERSION"
echo "  out dir:      $OUT_DIR"
echo "================================================"
echo ""

# ---- Verify tauri CLI -------------------------------------------------------
# We prefer the npm-managed `@tauri-apps/cli` (via `npm run tauri`)
# over the cargo-installed `cargo tauri` binary because:
#   - package.json already pins `@tauri-apps/cli` to ^2 (locked there).
#   - On this dev box the cargo-installed binary is absent and the
#     network may be offline (`cargo install tauri-cli` would fail).
#   - npm's CLI is functionally equivalent for `tauri build`.
if ! command -v npm >/dev/null 2>&1; then
  echo "FAIL: npm not on PATH" >&2
  exit 1
fi
TAURI_CMD=(npm run --silent tauri --)
# Sanity probe.
if ! "${TAURI_CMD[@]}" --version >/dev/null 2>&1; then
  echo "FAIL: tauri CLI not available via 'npm run tauri'." >&2
  echo "  Run 'npm install' first." >&2
  exit 1
fi

# ---- Build per target -------------------------------------------------------
case "$TARGET" in
  windows)
    echo ">>> Building Windows NSIS installer (this takes 3-5 min)..."
    BUILD_START=$(date +%s)
    # tauri build runs npm run build first, then cargo build --release,
    # then assembles the NSIS bundle. We do NOT pass
    # --features tauri/custom-protocol — tauri-cli sets it itself.
    "${TAURI_CMD[@]}" build --bundles nsis 2>&1 | tail -40
    BUILD_END=$(date +%s)
    echo ">>> Build took $((BUILD_END - BUILD_START))s"

    # Locate output. Tauri 2.x uses
    # src-tauri/target/release/bundle/nsis/<Product>_<Ver>_<Arch>-setup.exe
    BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/nsis"
    INSTALLER=$(ls "$BUNDLE_DIR"/*-setup.exe 2>/dev/null | head -1 || true)
    if [[ -z "$INSTALLER" || ! -f "$INSTALLER" ]]; then
      echo "FAIL: NSIS installer not produced. Bundle dir contents:" >&2
      ls -la "$BUNDLE_DIR" 2>&1 || echo "(bundle dir does not exist)" >&2
      exit 1
    fi
    EXTENSION="exe"
    ;;

  macos)
    echo ">>> Building macOS DMG..."
    BUILD_START=$(date +%s)
    "${TAURI_CMD[@]}" build --bundles app,dmg 2>&1 | tail -40
    BUILD_END=$(date +%s)
    echo ">>> Build took $((BUILD_END - BUILD_START))s"

    BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg"
    INSTALLER=$(ls "$BUNDLE_DIR"/*.dmg 2>/dev/null | head -1 || true)
    if [[ -z "$INSTALLER" || ! -f "$INSTALLER" ]]; then
      echo "FAIL: DMG not produced. Bundle dir contents:" >&2
      ls -la "$BUNDLE_DIR" 2>&1 || echo "(bundle dir does not exist)" >&2
      exit 1
    fi
    EXTENSION="dmg"
    ;;

  *)
    echo "FAIL: unknown target '$TARGET'. Use 'windows' or 'macos'." >&2
    exit 1
    ;;
esac

# ---- Copy + checksum --------------------------------------------------------
INSTALLER_BASENAME=$(basename "$INSTALLER")
cp "$INSTALLER" "$OUT_DIR/$INSTALLER_BASENAME"

INSTALLER_SIZE=$(stat -c%s "$OUT_DIR/$INSTALLER_BASENAME" 2>/dev/null \
  || stat -f%z "$OUT_DIR/$INSTALLER_BASENAME" 2>/dev/null \
  || echo "?")

# SHA256 — sha256sum on Linux/Git Bash, shasum -a 256 on macOS as fallback.
cd "$OUT_DIR"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$INSTALLER_BASENAME" > "$INSTALLER_BASENAME.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$INSTALLER_BASENAME" > "$INSTALLER_BASENAME.sha256"
else
  echo "WARN: no sha256sum or shasum on PATH; skipping checksum" >&2
fi

CHECKSUM=""
if [[ -f "$OUT_DIR/$INSTALLER_BASENAME.sha256" ]]; then
  CHECKSUM=$(awk '{print $1}' "$OUT_DIR/$INSTALLER_BASENAME.sha256")
fi

echo ""
echo "================================================"
echo "INSTALLER READY ✓"
echo "  Path:     $OUT_DIR/$INSTALLER_BASENAME"
echo "  Size:     $INSTALLER_SIZE bytes ($(echo "scale=1; $INSTALLER_SIZE/1024/1024" | bc 2>/dev/null || echo "?") MB)"
echo "  SHA256:   ${CHECKSUM:-<unavailable>}"
echo "  Type:     $EXTENSION"
echo "================================================"
exit 0
