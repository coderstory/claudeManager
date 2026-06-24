#!/usr/bin/env bash
# scripts/bump-version.sh — Patch bump version across 3 config files
#
# Single-responsibility: read semver from package.json / tauri.conf.json /
# Cargo.toml, increment patch component, write back to all three.
#
# Usage:
#   ./scripts/bump-version.sh              # actually bump
#   ./scripts/bump-version.sh --dry-run    # show what would change, no writes
#   ./scripts/bump-version.sh --print      # just print current version (stdout, single line)
#
# Exit codes:
#   0  success (or dry-run with valid state)
#   1  pre-check failed (files missing / version field missing)
#   2  version mismatch across 3 files (refuses to auto-fix)
#   3  semver parse failed
#   4  write failed
#
# Reference: CLAUDE.md §2.3 (no dep version bumps) + §11.4.1 (scriptify)

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# === Args ===
MODE="bump"   # bump | dry-run | print
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --print)   MODE="print"; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# === File paths ===
PKG_JSON="$PROJECT_ROOT/package.json"
TAURI_JSON="$PROJECT_ROOT/src-tauri/tauri.conf.json"
CARGO_TOML="$PROJECT_ROOT/src-tauri/Cargo.toml"

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

# === Pre-check: files exist ===
for f in "$PKG_JSON" "$TAURI_JSON" "$CARGO_TOML"; do
  if [[ ! -f "$f" ]]; then
    say_err "FAIL: missing file: $f"
    exit 1
  fi
done

# === Read versions from the 3 files ===
# - package.json: JSON parse via python3
# - tauri.conf.json: JSON parse via python3 (verified standard JSON, not JSON5)
# - Cargo.toml: regex `^version = "X.Y.Z"` (line 3 in this project)
ver_pkg="$(python3 -c "import json,sys; print(json.load(open('$PKG_JSON'))['version'])" 2>/dev/null || true)"
ver_tau="$(python3 -c "import json,sys; print(json.load(open('$TAURI_JSON'))['version'])" 2>/dev/null || true)"
ver_cargo="$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' "$CARGO_TOML" | head -1)"

if [[ -z "$ver_pkg" ]]; then
  say_err "FAIL: could not parse 'version' field from $PKG_JSON (JSON parse error or field missing)"
  exit 1
fi
if [[ -z "$ver_tau" ]]; then
  say_err "FAIL: could not parse 'version' field from $TAURI_JSON (JSON parse error or field missing)"
  exit 1
fi
if [[ -z "$ver_cargo" ]]; then
  say_err "FAIL: could not parse '^version = \"X.Y.Z\"' from $CARGO_TOML (field missing or wrong format)"
  exit 1
fi

# === Semver validate each ===
SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+$'
for label_ver in "package.json:$ver_pkg" "tauri.conf.json:$ver_tau" "Cargo.toml:$ver_cargo"; do
  file="${label_ver%%:*}"
  v="${label_ver##*:}"
  if [[ ! "$v" =~ $SEMVER_RE ]]; then
    say_err "FAIL: $file version '$v' is not strict semver X.Y.Z"
    exit 3
  fi
done

# === Consistency check (must all match) ===
if [[ "$ver_pkg" != "$ver_tau" || "$ver_pkg" != "$ver_cargo" ]]; then
  say_err "FAIL: version mismatch across 3 files:"
  say_err "  package.json      : $ver_pkg"
  say_err "  tauri.conf.json   : $ver_tau"
  say_err "  Cargo.toml        : $ver_cargo"
  say_err "  Refusing to auto-bump inconsistent versions. Fix manually first."
  exit 2
fi

CUR_VER="$ver_pkg"

# === --print: just emit current version ===
if [[ "$MODE" == "print" ]]; then
  echo "$CUR_VER"
  exit 0
fi

# === Bump patch ===
MAJOR="${CUR_VER%%.*}"
REST="${CUR_VER#*.}"
MINOR="${REST%%.*}"
PATCH="${REST#*.}"

NEW_PATCH=$((PATCH + 1))
NEW_VER="$MAJOR.$MINOR.$NEW_PATCH"

# === Dry-run: print, no writes ===
if [[ "$MODE" == "dry-run" ]]; then
  say_info "[dry-run] would bump: $CUR_VER → $NEW_VER"
  say_info "         would update 3 files: package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml"
  exit 0
fi

# === Real bump: write to 3 files ===
# Strategy: use `sed -i.bak` with very precise regex matching `"version": "X.Y.Z"`
# (with the opening quote — distinguishes from `"versionName"` etc.) so we ONLY
# change the version field and preserve all surrounding formatting (whitespace,
# inline arrays, Unicode escapes, comments in JSON5 files, etc.). We bail if
# the exact pattern doesn't match exactly once (refuse to bulk-replace or miss).

# 1. package.json
PKG_PATTERN="\"version\": \"$CUR_VER\""
PKG_COUNT=$(grep -cF "$PKG_PATTERN" "$PKG_JSON" || true)
if [[ "$PKG_COUNT" != "1" ]]; then
  say_err "FAIL: expected exactly 1 line matching $PKG_PATTERN in $PKG_JSON, got $PKG_COUNT"
  say_err "      Refusing to modify. Manual fix needed."
  exit 4
fi
sed -i.bak "s|$PKG_PATTERN|\"version\": \"$NEW_VER\"|" "$PKG_JSON"
rm -f "$PKG_JSON.bak"

# 2. tauri.conf.json
TAU_PATTERN="\"version\": \"$CUR_VER\""
TAU_COUNT=$(grep -cF "$TAU_PATTERN" "$TAURI_JSON" || true)
if [[ "$TAU_COUNT" != "1" ]]; then
  say_err "FAIL: expected exactly 1 line matching $TAU_PATTERN in $TAURI_JSON, got $TAU_COUNT"
  say_err "      Refusing to modify. Manual fix needed."
  exit 4
fi
sed -i.bak "s|$TAU_PATTERN|\"version\": \"$NEW_VER\"|" "$TAURI_JSON"
rm -f "$TAURI_JSON.bak"

# 3. Cargo.toml
CARGO_PATTERN="^version = \"$CUR_VER\""
CARGO_COUNT=$(grep -cE "$CARGO_PATTERN" "$CARGO_TOML" || true)
if [[ "$CARGO_COUNT" != "1" ]]; then
  say_err "FAIL: expected exactly 1 line matching $CARGO_PATTERN in $CARGO_TOML, got $CARGO_COUNT"
  say_err "      Refusing to modify. Manual fix needed."
  exit 4
fi
sed -i.bak "s|$CARGO_PATTERN|version = \"$NEW_VER\"|" "$CARGO_TOML"
rm -f "$CARGO_TOML.bak"

# === Validate: re-read all 3 files and confirm they all == NEW_VER ===
post_pkg="$(python3 -c "import json; print(json.load(open('$PKG_JSON'))['version'])" 2>/dev/null || echo "ERR")"
post_tau="$(python3 -c "import json; print(json.load(open('$TAURI_JSON'))['version'])" 2>/dev/null || echo "ERR")"
post_cargo="$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' "$CARGO_TOML" | head -1)"

if [[ "$post_pkg" != "$NEW_VER" || "$post_tau" != "$NEW_VER" || "$post_cargo" != "$NEW_VER" ]]; then
  say_err "FAIL: post-write validation failed:"
  say_err "  package.json      : $post_pkg (expected $NEW_VER)"
  say_err "  tauri.conf.json   : $post_tau (expected $NEW_VER)"
  say_err "  Cargo.toml        : $post_cargo (expected $NEW_VER)"
  say_err "  Manual fix needed. Do NOT re-run."
  exit 4
fi

# === Report ===
say_ok "bumped: $CUR_VER → $NEW_VER"
say_ok "  ✓ package.json      : $NEW_VER"
say_ok "  ✓ tauri.conf.json   : $NEW_VER"
say_ok "  ✓ Cargo.toml        : $NEW_VER"

# Final stdout single-line: the new version, for caller parsing.
echo "$NEW_VER"
exit 0