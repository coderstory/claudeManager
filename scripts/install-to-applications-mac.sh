#!/usr/bin/env bash
# scripts/install-to-applications-mac.sh — Build + install ClaudeManager.app to /Applications/
#
# Purpose: macOS equivalent of scripts/build-and-ship.sh (Windows) for dev iteration.
# Unlike the Windows flow:
#   - Auto-runs `cargo tauri build --debug` via scripts/build-mac.sh (which already
#     handles `beforeBuildCommand` = `npm run build`)
#   - Installs to /Applications/ClaudeManager.app (no sudo needed on user-writable
#     volume; falls back to ~/Applications/ if SIP blocks /Applications/ writes)
#   - No code signing / notarization (CLAUDE.md §15.7: dev-only, no public release)
#   - Desktop copy uses §9.2 naming: ClaudeConfigManager-M{major}.{minor}-{slug}.app
#
# Usage:
#   ./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug mac-dev
#   ./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug mac-dev --no-cleanup
#   ./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug mac-dev --debug   # default
#   ./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug mac-dev --release # for ship-quality
#
# Cross-platform: macOS ONLY. Linux/Windows will exit 1 at pre-check.
# Depends on: scripts/build-mac.sh (same repo).
# Reference: CLAUDE.md §9.2 (naming), §15.2 (paths), §15.7 (no signing).
#
# Side effects:
#   1. Runs `cargo tauri build` (writes to src-tauri/target/debug|bundle/macos/)
#   2. Copies built .app to ~/Desktop/ClaudeConfigManager-M{major}/{name}.app
#   3. Backs up any pre-existing /Applications/ClaudeManager.app to ~/Desktop/.trash-<ts>/
#      and replaces with new build
#   4. (Unless --no-cleanup) leaves src-tauri/target/debug intact for incremental builds

set -eo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# === Argument parsing ===
MILESTONE=""
TASK=""
SLUG=""
BUILD_MODE="debug"   # default per task prompt (dev build, faster)
NO_CLEANUP=0

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME --milestone <M#> --task <x.y> --slug <kebab-slug> [--debug|--release] [--no-cleanup]

Example:
  $SCRIPT_NAME --milestone M4 --task 0.1 --slug mac-dev
  $SCRIPT_NAME --milestone M4 --task 0.1 --slug mac-dev --release --no-cleanup
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) MILESTONE="$2"; shift 2 ;;
    --task)      TASK="$2"; shift 2 ;;
    --slug)      SLUG="$2"; shift 2 ;;
    --debug)     BUILD_MODE="debug"; shift ;;
    --release)   BUILD_MODE="release"; shift ;;
    --no-cleanup) NO_CLEANUP=1; shift ;;
    -h|--help)   usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

if [[ -z "$MILESTONE" || -z "$TASK" || -z "$SLUG" ]]; then
  echo "ERROR: --milestone, --task, --slug are all required" >&2
  usage
fi

# === Color helpers (only when stdout is a tty) ===
if [[ -t 1 ]]; then
  C_OK="\033[0;32m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_INFO="\033[0;36m"; C_RESET="\033[0m"
else
  C_OK=""; C_WARN=""; C_ERR=""; C_INFO=""; C_RESET=""
fi
say_ok()   { echo -e "${C_OK}$*${C_RESET}"; }
say_warn() { echo -e "${C_WARN}$*${C_RESET}"; }
say_err()  { echo -e "${C_ERR}$*${C_RESET}" >&2; }
say_info() { echo -e "${C_INFO}$*${C_RESET}"; }

# === Step 1: Pre-check (macOS env) ===
echo "============================================"
echo "$SCRIPT_NAME"
echo "  milestone: $MILESTONE"
echo "  task:      $TASK"
echo "  slug:      $SLUG"
echo "  mode:      $BUILD_MODE"
echo "  root:      $PROJECT_ROOT"
echo "============================================"
echo ""
echo "[1/7] Pre-check (macOS env)..."

if [[ "$(uname -s)" != "Darwin" ]]; then
  say_err "FAIL: this script is macOS-only (got uname -s = $(uname -s))"
  exit 1
fi

if ! command -v xcode-select >/dev/null 2>&1; then
  say_err "FAIL: xcode-select not found. Install Xcode CLT: xcode-select --install"
  exit 1
fi

CLT_PATH="$(xcode-select -p 2>/dev/null || true)"
if [[ -z "$CLT_PATH" ]]; then
  say_err "FAIL: Xcode Command Line Tools not installed. Run: xcode-select --install"
  exit 1
fi
say_ok "  ✓ Xcode CLT: $CLT_PATH"

if ! command -v rustup >/dev/null 2>&1; then
  say_err "FAIL: rustup not found. Install: https://rustup.rs"
  exit 1
fi

INSTALLED_TARGETS="$(rustup target list --installed 2>/dev/null || true)"
if echo "$INSTALLED_TARGETS" | grep -qE "aarch64-apple-darwin|x86_64-apple-darwin"; then
  say_ok "  ✓ darwin target: $(echo "$INSTALLED_TARGETS" | grep -E "apple-darwin" | head -1)"
else
  say_err "FAIL: no apple-darwin target installed. Run: rustup target add aarch64-apple-darwin"
  exit 1
fi

if [[ ! -x "$SCRIPT_DIR/build-mac.sh" ]]; then
  say_err "FAIL: scripts/build-mac.sh not found or not executable"
  exit 1
fi
say_ok "  ✓ build-mac.sh present"

echo ""

# === Step 1.5: Auto-bump version (CLAUDE.md §11.4.1 scriptify) ===
echo "[1.5/7] Auto-bump version..."

if [[ ! -x "$SCRIPT_DIR/bump-version.sh" ]]; then
  say_err "FAIL: scripts/bump-version.sh not found or not executable"
  exit 1
fi

OLD_VER="$("$SCRIPT_DIR/bump-version.sh" --print 2>/dev/null || echo "unknown")"
if ! "$SCRIPT_DIR/bump-version.sh" --dry-run; then
  say_err "FAIL: bump-version.sh pre-check failed (3 files inconsistent or unparseable)"
  say_err "      Fix manually or run ./scripts/bump-version.sh --dry-run to diagnose"
  exit 1
fi
NEW_VER="$("$SCRIPT_DIR/bump-version.sh")" || { say_err "FAIL: bump-version.sh exited non-zero"; exit 1; }
say_ok "  ✓ version: $OLD_VER → $NEW_VER"
echo ""

# === Step 2: Build (delegated to build-mac.sh) ===
# v3.4.1 fix — always pass `--no-dmg` to skip the dmg step (we cp
# .app to /Applications directly, no distribution .dmg needed for
# dev iteration). Saves ~30s on every build.
echo "[2/7] Build: scripts/build-mac.sh --$BUILD_MODE --no-dmg"
BUILD_START=$(date +%s)

if ! "$SCRIPT_DIR/build-mac.sh" $( [[ "$BUILD_MODE" == "debug" ]] && echo "--debug" || echo "" ) --no-dmg; then
  say_err "FAIL: build-mac.sh exited non-zero. Tail: src-tauri/target/$BUILD_MODE/build.log"
  exit 1
fi

BUILD_END=$(date +%s)
BUILD_DUR=$((BUILD_END - BUILD_START))
say_ok "  ✓ build done in ${BUILD_DUR}s"
echo ""

# === Step 3: Verify build output ===
echo "[3/7] Verify build output..."
# Note: actual productName is "ClaudeManager" (per tauri.conf.json), NOT "Claude Manager.app"
# with space. Confirmed by inspecting target/debug/bundle/macos/ClaudeManager.app/Contents/Info.plist
APP_SRC="$PROJECT_ROOT/src-tauri/target/$BUILD_MODE/bundle/macos/ClaudeManager.app"
APP_BIN="$APP_SRC/Contents/MacOS/claude-config-manager"
APP_INFO="$APP_SRC/Contents/Info.plist"

if [[ ! -d "$APP_SRC" ]]; then
  say_err "FAIL: built .app not found at $APP_SRC"
  say_err "      (check that tauri.conf.json productName matches ClaudeManager)"
  exit 1
fi
say_ok "  ✓ app bundle: $APP_SRC"

if [[ ! -f "$APP_INFO" ]]; then
  say_err "FAIL: Info.plist missing: $APP_INFO"
  exit 1
fi
say_ok "  ✓ Info.plist present"

if [[ ! -x "$APP_BIN" ]]; then
  say_err "FAIL: executable missing or not executable: $APP_BIN"
  exit 1
fi
say_ok "  ✓ executable: $APP_BIN"

APP_SRC_SIZE=$(du -sh "$APP_SRC" 2>/dev/null | awk '{print $1}')
say_ok "  ✓ size: $APP_SRC_SIZE"
echo ""

# === Step 4: Copy to Desktop (per CLAUDE.md §9.2) ===
echo "[4/7] Copy to Desktop..."

DESKTAP_DIR="$HOME/Desktop/ClaudeConfigManager-${MILESTONE}"
DESKTOP_APP="$DESKTAP_DIR/ClaudeConfigManager-${MILESTONE}.${TASK}-${SLUG}.app"

mkdir -p "$DESKTAP_DIR"
# -R preserves bundle structure; remove any stale desktop copy first
rm -rf "$DESKTOP_APP"
cp -R "$APP_SRC" "$DESKTOP_APP"
say_ok "  ✓ desktop: $DESKTOP_APP"
echo ""

# === Step 5: Install to /Applications/ (with fallback to ~/Applications/) ===
echo "[5/7] Install to /Applications/..."

INSTALL_ROOT="/Applications"
INSTALL_APP="$INSTALL_ROOT/ClaudeManager.app"
FALLBACK_ROOT="$HOME/Applications"
FALLBACK_APP="$FALLBACK_ROOT/ClaudeManager.app"
TRASH_DIR="$HOME/Desktop/.trash-$(date +%s)"

# Probe: can we write to /Applications/?
INSTALL_TARGET=""
NEEDS_SUDO=0
if [[ -d "$INSTALL_ROOT" && -w "$INSTALL_ROOT" ]]; then
  INSTALL_TARGET="$INSTALL_ROOT"
elif [[ -d "$INSTALL_ROOT" ]]; then
  # /Applications exists but isn't writable by us (could be SIP / wrong ownership)
  if sudo -n true 2>/dev/null; then
    INSTALL_TARGET="$INSTALL_ROOT"
    NEEDS_SUDO=1
    say_warn "  ! /Applications/ requires sudo (passwordless sudo available)"
  else
    say_warn "  ! /Applications/ not user-writable and no passwordless sudo; using ~/Applications/"
    mkdir -p "$FALLBACK_ROOT"
    INSTALL_TARGET="$FALLBACK_ROOT"
  fi
else
  say_warn "  ! /Applications/ does not exist; using ~/Applications/"
  mkdir -p "$FALLBACK_ROOT"
  INSTALL_TARGET="$FALLBACK_ROOT"
fi

DEST_APP="$INSTALL_TARGET/ClaudeManager.app"

# Back up any existing install to ~/Desktop/.trash-<ts>/
if [[ -e "$DEST_APP" ]]; then
  mkdir -p "$TRASH_DIR"
  say_info "  · backing up existing $DEST_APP -> $TRASH_DIR/"
  if [[ "$NEEDS_SUDO" == "1" ]]; then
    sudo mv "$DEST_APP" "$TRASH_DIR/" || { say_err "FAIL: sudo mv failed"; exit 1; }
  else
    mv "$DEST_APP" "$TRASH_DIR/" || { say_err "FAIL: mv failed"; exit 1; }
  fi
  say_ok "  ✓ backup: $TRASH_DIR/ClaudeManager.app"
fi

# Copy new build
if [[ "$NEEDS_SUDO" == "1" ]]; then
  sudo cp -R "$APP_SRC" "$DEST_APP" || { say_err "FAIL: sudo cp failed"; exit 1; }
else
  cp -R "$APP_SRC" "$DEST_APP" || { say_err "FAIL: cp failed"; exit 1; }
fi
say_ok "  ✓ installed: $DEST_APP"

# Touch the app so Launch Services sees a fresh install
if [[ "$NEEDS_SUDO" == "1" ]]; then
  sudo touch "$DEST_APP" 2>/dev/null || true
else
  touch "$DEST_APP" 2>/dev/null || true
fi
echo ""

# === Step 6: Post-verify + report ===
echo "[6/7] Post-verify + report..."

# Re-resolve Info.plist path against the install target
VERIFY_INFO="$DEST_APP/Contents/Info.plist"
VERIFY_BIN="$DEST_APP/Contents/MacOS/claude-config-manager"

BUNDLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$VERIFY_INFO" 2>/dev/null || defaults read "$VERIFY_INFO" CFBundleName 2>/dev/null || echo "?")"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$VERIFY_INFO" 2>/dev/null || defaults read "$VERIFY_INFO" CFBundleIdentifier 2>/dev/null || echo "?")"
BUNDLE_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$VERIFY_INFO" 2>/dev/null || defaults read "$VERIFY_INFO" CFBundleShortVersionString 2>/dev/null || echo "?")"
MIN_MACOS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$VERIFY_INFO" 2>/dev/null || defaults read "$VERIFY_INFO" LSMinimumSystemVersion 2>/dev/null || echo "?")"

# Code signing status (expected: unsigned per CLAUDE.md §15.7).
# Tauri dev bundles get an ad-hoc signature automatically (Signature=adhoc),
# which is NOT the same as a real Developer ID signature. We classify:
#   - "no signature"        → developer ran `strip -no-stripcodesign` or unsquashed
#   - "adhoc (dev, OK)"     → Tauri default for dev builds, matches §15.7
#   - "hardened/runtime"    → real Developer ID or notarized — unexpected for dev
SIGN_OUT="$(codesign -dv "$DEST_APP" 2>&1 || true)"
if echo "$SIGN_OUT" | grep -q "Signature=adhoc"; then
  SIGN_STATUS="adhoc (dev build, matches §15.7 — no public signing)"
elif echo "$SIGN_OUT" | grep -q "^Signature=none$"; then
  SIGN_STATUS="no signature (dev build, matches §15.7)"
elif echo "$SIGN_OUT" | grep -qE "Signature=[A-Za-z0-9]"; then
  SIGN_STATUS="YES — real signature detected (unexpected for dev build, check §15.7)"
else
  SIGN_STATUS="unknown — codesign output below:"
  echo "         $SIGN_OUT"
fi

DEST_SIZE=$(du -sh "$DEST_APP" 2>/dev/null | awk '{print $1}')
DESKTOP_SIZE=$(du -sh "$DESKTOP_APP" 2>/dev/null | awk '{print $1}')

# sha256 — hash the inner executable (the .app bundle is a directory; shasum
# on a directory errors). Hashing the binary + the Info.plist gives a stable
# "did the install content actually change" check.
DESKTOP_BIN="$DESKTOP_APP/Contents/MacOS/claude-config-manager"
DESKTOP_INFO="$DESKTOP_APP/Contents/Info.plist"
if [[ -x "$DESKTOP_BIN" && -f "$DESKTOP_INFO" ]]; then
  DESKTOP_SHA="$( (shasum -a 256 "$DESKTOP_BIN" "$DESKTOP_INFO" 2>/dev/null) | shasum -a 256 | awk '{print $1}')"
else
  DESKTOP_SHA="(binary or Info.plist missing)"
fi

echo ""
echo "============================================"
say_ok "mac dev build installed"
echo "  Build mode:  $BUILD_MODE (took ${BUILD_DUR}s)"
echo "  Source:      $APP_SRC ($APP_SRC_SIZE)"
echo "  Desktop:     $DESKTOP_APP ($DESKTOP_SIZE)"
echo "               sha256: $DESKTOP_SHA"
echo "  Installed:   $DEST_APP ($DEST_SIZE)"
if [[ "$NEEDS_SUDO" == "1" ]]; then
  echo "               (installed via sudo — /Applications/ was not user-writable)"
fi
echo "  Bundle Name:        $BUNDLE_NAME"
echo "  Bundle ID:          $BUNDLE_ID"
echo "  Version:            $BUNDLE_VER"
echo "  Min macOS:          $MIN_MACOS"
echo "  Code signed:        $SIGN_STATUS"
if [[ -d "$TRASH_DIR" ]]; then
  echo "  Old version backed up to: $TRASH_DIR/"
fi
echo "============================================"

# === Cleanup (optional) ===
if [[ $NO_CLEANUP -eq 0 ]]; then
  echo ""
  say_info "Note: src-tauri/target/$BUILD_MODE/ kept for incremental rebuilds."
  say_info "      Run with --no-cleanup to skip, or: rm -rf src-tauri/target/$BUILD_MODE"
else
  echo ""
  say_info "--no-cleanup set: src-tauri/target/$BUILD_MODE/ preserved."
fi

echo ""
say_ok "DONE"
echo "  open '$DEST_APP'      # launch"
echo "  open '$DESKTOP_APP'   # or launch from Desktop"
exit 0