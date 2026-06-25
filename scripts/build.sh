#!/usr/bin/env bash
# scripts/build.sh — Cross-platform build dispatcher
#
# Single-responsibility: detect the host OS via `uname -s` and delegate to the
# platform-specific build script. We don't duplicate cargo / tauri invocation
# here — each platform's script (`build-only.sh` on Windows, `build-mac.sh`
# on Darwin) already has the right env tweaks (windres PATH on Win, sccache
# on Mac, beforeBuildCommand handling, etc.).
#
# Usage:
#   ./scripts/build.sh                          # default: debug build (matches CI quick smoke)
#   ./scripts/build.sh --release                # release build
#   ./scripts/build.sh --check                  # cargo check only (fast type/lint check)
#   ./scripts/build.sh --clean                  # cargo clean + debug build
#   ./scripts/build.sh --ship                   # build + copy to Desktop + smoke test
#                                                # (requires --milestone/--task/--slug)
#
# `--ship` forwards the three milestone flags to the underlying ship script.
#
# Exit codes:
#   0  delegated build script succeeded
#   1  bad flag / unsupported OS (Linux) / delegation failure
#
# Reference: CLAUDE.md §15 (macOS constraints) — Linux is intentionally
# unsupported and must exit 1, not silently fall through.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

# === Platform detection (uname -s) ===
# Darwin           → macOS
# MINGW* / CYGWIN* / MSYS*  → Windows (Git Bash variants)
# Anything else    → unsupported (exit 1 per CLAUDE.md §15)
UNAME_S="$(uname -s)"
case "$UNAME_S" in
  Darwin)
    PLATFORM="macos"
    BUILD_SCRIPT="$SCRIPT_DIR/build-mac.sh"
    SHIP_SCRIPT="$SCRIPT_DIR/install-to-applications-mac.sh"
    ;;
  MINGW*|CYGWIN*|MSYS*)
    PLATFORM="windows"
    BUILD_SCRIPT="$SCRIPT_DIR/build-only.sh"
    SHIP_SCRIPT="$SCRIPT_DIR/build-and-ship.sh"
    ;;
  *)
    say_err "FAIL: unsupported platform: $UNAME_S"
    say_err "      This project targets Windows 11 + macOS 26 only (CLAUDE.md §1, §15)."
    say_err "      Linux is intentionally not supported."
    exit 1
    ;;
esac

# === Args ===
# Default action: debug build. `--clean` and `--release` are mutually exclusive
# (clean-build only makes sense in debug mode per build-only.sh semantics).
MODE="default"      # default | release | check | clean | ship
SHIP_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) MODE="release"; shift ;;
    --check)   MODE="check"; shift ;;
    --clean)   MODE="clean"; shift ;;
    --ship)    MODE="ship"; shift ;;
    # ship-mode triple — forward verbatim to the underlying ship script
    --milestone|--task|--slug)
      SHIP_ARGS+=("$1" "$2")
      shift 2
      ;;
    -h|--help|help)
      cat <<EOF
Usage: build.sh [--release | --check | --clean | --ship] [--milestone M# --task x.y --slug slug]

Default (no flag): debug build.
  --release  release build (matches ship-quality output)
  --check    cargo check only (no link) — fastest sanity gate
  --clean    cargo clean + debug build (from-scratch)
  --ship     build + copy to Desktop + smoke test (Win: build-and-ship.sh,
             Mac: install-to-applications-mac.sh). Requires the three flags
             below.

Ship flags (forwarded verbatim to the ship script):
  --milestone M#    e.g. M3
  --task      x.y   e.g. 3.4
  --slug      slug  kebab-case, e.g. fuzzy-search

Detected platform: $PLATFORM (uname -s = $UNAME_S)
EOF
      exit 0
      ;;
    *)
      say_err "FAIL: unknown arg: $1"
      say_err "      Run with --help for usage."
      exit 1
      ;;
  esac
done

echo "============================================"
echo "build.sh"
echo "  platform: $PLATFORM"
echo "  mode:     $MODE"
echo "  root:     $PROJECT_ROOT"
echo "============================================"
echo ""

# Pre-flight: the underlying scripts MUST exist. We assert instead of failing
# deep inside the dispatch — easier to diagnose.
for s in "$BUILD_SCRIPT"; do
  if [[ ! -x "$s" ]]; then
    say_err "FAIL: required script not found or not executable: $s"
    exit 1
  fi
done
if [[ "$MODE" == "ship" && ! -x "$SHIP_SCRIPT" ]]; then
  say_err "FAIL: ship-mode requires $SHIP_SCRIPT (not found or not executable)"
  exit 1
fi

# === Dispatch ===
case "$MODE" in
  default)
    # Default: debug build. Windows build-only.sh has no `--debug` flag (it
    # defaults to debug); macOS build-mac.sh defaults to release, so we pass
    # --debug explicitly there.
    if [[ "$PLATFORM" == "windows" ]]; then
      say_info "[build] -> $BUILD_SCRIPT"
      "$BUILD_SCRIPT"
    else
      say_info "[build] -> $BUILD_SCRIPT --debug"
      "$BUILD_SCRIPT" --debug
    fi
    ;;
  release)
    # Windows build-only.sh accepts --release; macOS build-mac.sh defaults to
    # release (no --release flag), so we omit the flag there to avoid
    # "Unknown arg" error.
    if [[ "$PLATFORM" == "windows" ]]; then
      say_info "[build] -> $BUILD_SCRIPT --release"
      "$BUILD_SCRIPT" --release
    else
      say_info "[build] -> $BUILD_SCRIPT (default release mode)"
      "$BUILD_SCRIPT"
    fi
    ;;
  check)
    # cargo check is the cheapest gate. Windows build-only.sh has a `--check`
    # flag that wraps `cargo check --manifest-path src-tauri/Cargo.toml`.
    # macOS build-mac.sh does NOT have --check, so we invoke cargo directly
    # here (no need to ship a new flag into build-mac.sh).
    if [[ "$PLATFORM" == "windows" ]]; then
      say_info "[build] -> $BUILD_SCRIPT --check"
      "$BUILD_SCRIPT" --check
    else
      say_info "[build] -> cargo check (direct, no build-mac.sh flag)"
      cd "$PROJECT_ROOT"
      cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
    fi
    ;;
  clean)
    # --clean is only meaningful on Windows (debug-mode clean rebuild).
    # On macOS, build-mac.sh delegates to `cargo tauri build` which manages
    # its own target dir — we don't expose --clean there.
    if [[ "$PLATFORM" == "windows" ]]; then
      say_info "[build] -> $BUILD_SCRIPT --clean"
      "$BUILD_SCRIPT" --clean
    else
      say_err "FAIL: --clean is not supported on macOS (build-mac.sh manages its own target dir)."
      say_err "      Run: rm -rf src-tauri/target/debug before re-running without --clean."
      exit 1
    fi
    ;;
  ship)
    # Ship-mode requires --milestone/--task/--slug. The downstream scripts
    # do their own arg validation — we just forward.
    say_info "[ship] -> $SHIP_SCRIPT ${SHIP_ARGS[*]}"
    "$SHIP_SCRIPT" "${SHIP_ARGS[@]}"
    ;;
esac

say_ok "DONE ✓"
exit 0