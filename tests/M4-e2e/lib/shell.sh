#!/usr/bin/env bash
# shell.sh — assert + log helpers for M4 e2e scenarios
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Pure-bash helpers, no project dependencies. Source from any scenario:
#   source "$SCRIPT_DIR/../lib/shell.sh"
#
# All assert_* helpers exit 1 on failure (consistent with `set -e`).
# say_* helpers are advisory only — they print colored output but never exit.

# === Color setup (only when stdout is a tty) ===
if [[ -t 1 ]]; then
  C_OK="\033[0;32m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_INFO="\033[0;36m"; C_RESET="\033[0m"
else
  C_OK=""; C_WARN=""; C_ERR=""; C_INFO=""; C_RESET=""
fi

# === Logging helpers ===
say_info() {
  echo -e "${C_INFO}[INFO]${C_RESET} $*"
}

say_warn() {
  echo -e "${C_WARN}[WARN]${C_RESET} $*"
}

say_err() {
  echo -e "${C_ERR}[ERR ]${C_RESET} $*" >&2
}

# === assert helpers ===
# assert_equal <actual> <expected> [label]
#   Compares strings literally. Use for: env vars, JSON literals, version strings.
#   For numeric compare, use (( )) or assert_eq_int.
assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="${3:-value}"
  if [[ "$actual" != "$expected" ]]; then
    say_err "assert_equal FAILED ($label):"
    say_err "  actual:   '$actual'"
    say_err "  expected: '$expected'"
    exit 1
  fi
  say_info "  assert_equal($label) OK: '$actual'"
}

# assert_file_exists <path>
#   Exits 1 if path missing. Accepts absolute or relative (resolved via test -e).
assert_file_exists() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    say_err "assert_file_exists FAILED: '$path' does not exist"
    exit 1
  fi
  say_info "  assert_file_exists OK: '$path'"
}

# assert_file_contains <path> <needle>
#   grep -F (literal, not regex) for substring. Exits 1 if not found.
assert_file_contains() {
  local path="$1"
  local needle="$2"
  if [[ ! -e "$path" ]]; then
    say_err "assert_file_contains FAILED: file '$path' missing"
    exit 1
  fi
  if ! grep -F -q -- "$needle" "$path"; then
    say_err "assert_file_contains FAILED: '$path' does not contain '$needle'"
    exit 1
  fi
  say_info "  assert_file_contains OK: '$path' contains '$needle'"
}

# assert_file_modified <path> <since_ts>
#   <since_ts> is a Unix epoch second (e.g. from `date +%s`).
#   Exits 1 if mtime <= since_ts (file was NOT modified after the marker).
assert_file_modified() {
  local path="$1"
  local since_ts="$2"
  if [[ ! -e "$path" ]]; then
    say_err "assert_file_modified FAILED: file '$path' missing"
    exit 1
  fi
  # mtime resolution: macOS BSD stat gives integer seconds; -f%m gives epoch
  local mtime
  mtime="$(stat -f '%m' "$path" 2>/dev/null || stat -c '%Y' "$path" 2>/dev/null || echo 0)"
  if [[ "$mtime" -le "$since_ts" ]]; then
    say_err "assert_file_modified FAILED: '$path' mtime=$mtime <= since_ts=$since_ts"
    exit 1
  fi
  say_info "  assert_file_modified OK: '$path' mtime=$mtime > $since_ts"
}

# assert_jq <path> <jq_expr> <expected>
#   Runs `jq -r <expr> <path>`, compares to <expected>. Exits 1 on mismatch or jq error.
assert_jq() {
  local path="$1"
  local expr="$2"
  local expected="$3"
  if [[ ! -e "$path" ]]; then
    say_err "assert_jq FAILED: file '$path' missing"
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    say_err "assert_jq FAILED: 'jq' command not found in PATH"
    exit 1
  fi
  local actual
  actual="$(jq -r "$expr" "$path" 2>/dev/null)"
  local jq_rc=$?
  if [[ $jq_rc -ne 0 ]]; then
    say_err "assert_jq FAILED: jq exited $jq_rc for expr '$expr' on '$path'"
    exit 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    say_err "assert_jq FAILED ($expr):"
    say_err "  actual:   '$actual'"
    say_err "  expected: '$expected'"
    exit 1
  fi
  say_info "  assert_jq OK: $expr = '$actual'"
}

# === Cleanup helper ===
# cleanup — trap EXIT handler, restores fixtures + kills app
#
# Caller should:
#   trap cleanup EXIT
#   export CCM_TEST_HOME=...
#   ... do work ...
#
# cleanup delegates to:
#   - restore_fixtures (from fs-fixtures.sh, if loaded)
#   - kill_app        (from driver-mac.sh / driver-win.ps1, if loaded)
#
# Order: kill first, then restore, then remove tmp dir. This avoids the app
# re-creating ~/.claude/ files after we already restored them.
cleanup() {
  local rc=$?
  say_info "cleanup: running EXIT trap (rc=$rc)"
  # kill_app is best-effort; if it fails (process already gone), continue
  if declare -F kill_app >/dev/null 2>&1; then
    kill_app >/dev/null 2>&1 || true
  fi
  if declare -F restore_fixtures >/dev/null 2>&1; then
    restore_fixtures >/dev/null 2>&1 || true
  fi
  if declare -F cleanup_tmp >/dev/null 2>&1; then
    cleanup_tmp >/dev/null 2>&1 || true
  fi
  exit $rc
}
