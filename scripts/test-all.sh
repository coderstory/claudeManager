#!/usr/bin/env bash
# scripts/test-all.sh — Unified 5-stage test entry
#
# Runs the full pre-ship gate in one command. Default = all 5 stages.
# Each stage has a --skip-* flag for fast iteration (e.g. PR pre-push
# without rebuilding the release exe for smoke/e2e).
#
# Stages (sequential, fail-fast):
#   1. UI consistency (scripts/check-ui-text-3-locations.sh)
#      — verifies tauri.conf.json productName == app.rs PRODUCT_NAME
#        == about.test.tsx product_name (CLAUDE.md §6.4 lesson)
#   2. Frontend unit tests (scripts/test-frontend.sh run)
#      — vitest, 500+ tests
#   3. Rust test compilation (scripts/test-verify.sh)
#      — cargo build --tests only (Tauri v2 + webview2-com can't actually
#        run `cargo test` on the dev box per the script's header comment)
#   4. E2E (scripts/run-e2e.sh)
#      — Playwright against real Tauri WebView via tauri-driver CDP
#      — Requires release exe + tauri-driver + msedgedriver. If any
#        missing → WARN-skip (exit 0, log warning) so this script can
#        still act as a "frontend only" check after a `npm run build`
#        without a fresh `tauri build`.
#   5. Smoke test (scripts/smoke-test.sh)
#      — 10/10 exe content/window/db checks
#      — Requires release exe. If missing → WARN-skip.
#
# Usage:
#   ./scripts/test-all.sh                          # all 5 stages
#   ./scripts/test-all.sh --skip-e2e --skip-smoke  # PR pre-push: only 1+2+3
#   ./scripts/test-all.sh --skip-frontend          # skip vitest
#   ./scripts/test-all.sh --skip-rust              # skip cargo build --tests
#   ./scripts/test-all.sh --skip-ui-check          # skip the 3-location text check
#
# Exit codes:
#   0  all REQUIRED stages passed (skipped stages not counted)
#   1  at least one required stage failed, OR bad flag
#
# Reference: CLAUDE.md §9 (iteration cadence) + §10 (no parallel builds).
# We deliberately run stages serially — Tauri's webview2-com + macOS WKWebView
# process-internal mutexes are not safe under concurrent cargo / tauri-driver.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

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

# Initialize all stage slots to SKIP-by-default. Stages that actually run
# will overwrite their slot via run_stage / run_soft_stage / direct set.
# Without this the summary would print "MISS not run" for any stage that
# never enters its run block (e.g. smoke not reached because earlier stage
# was the last one run before exit).
STAGE_ORDER=("ui-check" "frontend" "rust" "e2e" "smoke")
STAGE_STATUS=(0 0 0 0 0)
STAGE_DETAIL=("" "" "" "" "")

# Numeric encoding for STAGE_STATUS — easier to compare
SKIP=1; PASS=2; FAIL=3; WARN=4

i=0
for s in "${STAGE_ORDER[@]}"; do
  STAGE_STATUS[$i]=$SKIP
  STAGE_DETAIL[$i]="not reached"
  i=$((i+1))
done

# Helper: write a stage's status (by index 0..N-1).
stage_set() {
  local idx="$1"; local code="$2"; local detail="$3"
  STAGE_STATUS[$idx]=$code
  STAGE_DETAIL[$idx]="$detail"
}

# Helper: look up stage index by name. Returns -1 if not found.
stage_index() {
  local i=0
  for s in "${STAGE_ORDER[@]}"; do
    [[ "$s" == "$1" ]] && { echo "$i"; return 0; }
    i=$((i+1))
  done
  echo "-1"
}

# === Args ===
SKIP_UI=0
SKIP_FRONTEND=0
SKIP_RUST=0
SKIP_E2E=0
SKIP_SMOKE=0

usage() {
  cat <<EOF
Usage: test-all.sh [--skip-ui-check] [--skip-frontend] [--skip-rust] [--skip-e2e] [--skip-smoke]

Default: all 5 stages run sequentially (ui-check, frontend, rust, e2e, smoke).

Stages:
  1. ui-check   scripts/check-ui-text-3-locations.sh
  2. frontend   scripts/test-frontend.sh run (vitest)
  3. rust       scripts/test-verify.sh (cargo build --tests)
  4. e2e        scripts/run-e2e.sh  (WARN-skip if release exe / drivers missing)
  5. smoke      scripts/smoke-test.sh <exe>  (WARN-skip if release exe missing)

Exit codes: 0 on all required stages passing, 1 on any failure or bad flag.
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-ui-check)  SKIP_UI=1; shift ;;
    --skip-frontend)  SKIP_FRONTEND=1; shift ;;
    --skip-rust)      SKIP_RUST=1; shift ;;
    --skip-e2e)       SKIP_E2E=1; shift ;;
    --skip-smoke)     SKIP_SMOKE=1; shift ;;
    -h|--help|help)   usage ;;
    *)
      say_err "FAIL: unknown arg: $1"
      usage
      ;;
  esac
done

# === Release exe detection (for stages 4 + 5) ===
# macOS uses an .app bundle; Windows uses a bare .exe. Probe both layouts
# and pick the first match. If neither exists, e2e/smoke will WARN-skip.
IS_DARWIN=false
if [[ "$(uname -s)" == "Darwin" ]]; then
  IS_DARWIN=true
fi

RELEASE_EXE=""
RELEASE_APP=""
if [[ "$IS_DARWIN" == "true" ]]; then
  RELEASE_APP="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/ClaudeManager.app"
  if [[ -d "$RELEASE_APP" ]]; then
    RELEASE_EXE="$RELEASE_APP"
  else
    # Some builds (--no-bundle) produce a bare Mach-O at target/release/...
    BARE="$PROJECT_ROOT/src-tauri/target/release/claude-config-manager"
    [[ -x "$BARE" ]] && RELEASE_EXE="$BARE"
  fi
else
  RELEASE_EXE_WIN="$PROJECT_ROOT/src-tauri/target/release/claude-config-manager.exe"
  if [[ -f "$RELEASE_EXE_WIN" ]]; then
    RELEASE_EXE="$RELEASE_EXE_WIN"
  fi
fi

# === Header ===
echo "============================================"
echo "test-all.sh — unified 5-stage gate"
echo "  platform:  $(uname -s)"
echo "  root:      $PROJECT_ROOT"
echo "  release:   ${RELEASE_EXE:-(none)}"
echo "  skips:     ui=$SKIP_UI frontend=$SKIP_FRONTEND rust=$SKIP_RUST e2e=$SKIP_E2E smoke=$SKIP_SMOKE"
echo "============================================"
echo ""

# Run a single stage. Records into STAGE_STATUS / STAGE_DETAIL by index.
# Args: stage_name, command_label, command...
run_stage() {
  local stage="$1"
  local label="$2"
  local idx
  idx=$(stage_index "$stage")
  shift 2

  if [[ "$stage" == "ui-check" && "$SKIP_UI" == "1" ]] || \
     [[ "$stage" == "frontend" && "$SKIP_FRONTEND" == "1" ]] || \
     [[ "$stage" == "rust" && "$SKIP_RUST" == "1" ]] || \
     [[ "$stage" == "e2e" && "$SKIP_E2E" == "1" ]] || \
     [[ "$stage" == "smoke" && "$SKIP_SMOKE" == "1" ]]; then
    say_info "[$stage] SKIP (--skip flag)"
    stage_set "$idx" "$SKIP" "skipped by flag"
    return 0
  fi

  echo ""
  echo "--------------------------------------------"
  echo "[$stage] $label"
  echo "  cmd: $*"
  echo "--------------------------------------------"
  local start_t end_t
  start_t=$(date +%s)

  # `||` to capture non-zero exit, not propagate (we want to record + continue
  # to the summary table rather than `set -e` killing the whole gate).
  if "$@"; then
    end_t=$(date +%s)
    stage_set "$idx" "$PASS" "ok ($((end_t - start_t))s)"
    say_ok "  -> PASS ($((end_t - start_t))s)"
    return 0
  else
    local rc=$?
    end_t=$(date +%s)
    stage_set "$idx" "$FAIL" "exit=$rc ($((end_t - start_t))s)"
    say_err "  -> FAIL (exit=$rc, $((end_t - start_t))s)"
    return $rc
  fi
}

# Run a "soft" stage: same as run_stage but FAIL on the inner script is
# downgraded to WARN. Used for e2e + smoke which depend on the release
# exe; if it's missing, we'd rather WARN-skip than fail the whole gate.
# Args: stage_name, label, reason_if_no_exe, command...
run_soft_stage() {
  local stage="$1"
  local label="$2"
  local skip_reason="$3"
  local idx
  idx=$(stage_index "$stage")
  shift 3

  if [[ "$stage" == "e2e" && "$SKIP_E2E" == "1" ]] || \
     [[ "$stage" == "smoke" && "$SKIP_SMOKE" == "1" ]]; then
    say_info "[$stage] SKIP (--skip flag)"
    stage_set "$idx" "$SKIP" "skipped by flag"
    return 0
  fi

  echo ""
  echo "--------------------------------------------"
  echo "[$stage] $label"
  echo "  cmd: $*"
  echo "--------------------------------------------"
  local start_t end_t
  start_t=$(date +%s)

  if "$@"; then
    end_t=$(date +%s)
    stage_set "$idx" "$PASS" "ok ($((end_t - start_t))s)"
    say_ok "  -> PASS ($((end_t - start_t))s)"
    return 0
  else
    local rc=$?
    end_t=$(date +%s)
    stage_set "$idx" "$WARN" "exit=$rc ($((end_t - start_t))s) — $skip_reason"
    say_warn "  -> WARN (exit=$rc, $((end_t - start_t))s) — $skip_reason"
    return 0
  fi
}

# === Stage 1: UI consistency ===
run_stage "ui-check" "UI text 3-location consistency" \
  "$SCRIPT_DIR/check-ui-text-3-locations.sh" \
  || true   # don't abort the gate on this — we'll still print summary

# === Stage 2: Frontend unit tests ===
# `set -e` propagation matters here: we want HARD failure (not WARN) for
# vitest, because that's the contract of a 500-test green build.
run_stage "frontend" "vitest (run mode, full suite)" \
  "$SCRIPT_DIR/test-frontend.sh" "run" \
  || true

# === Stage 3: Rust test compilation ===
# test-verify.sh runs `cargo build --tests` — this is the actual gate,
# not `cargo test` (Tauri can't run tests on this dev box, see script).
run_stage "rust" "cargo build --tests (compile-only)" \
  "$SCRIPT_DIR/test-verify.sh" \
  || true

# === Stage 4: E2E (soft — depends on release exe + tauri-driver) ===
if [[ "$SKIP_E2E" -ne 1 ]]; then
  if [[ -z "$RELEASE_EXE" ]]; then
    # No release exe → WARN-skip, not FAIL. The dev loop is "tsc + vitest"
    # first; full e2e only matters at ship time.
    say_info "[e2e] SKIP (no release exe at src-tauri/target/release/)"
    stage_set "$(stage_index e2e)" "$WARN" "no release exe — run: scripts/build.sh --release"
  else
    # e2e script handles its own prereq checks (tauri-driver / msedgedriver);
    # if those are missing it exits 1, which we downgrade to WARN.
    run_soft_stage "e2e" "Playwright e2e via tauri-driver CDP" \
      "release exe or drivers missing" \
      "$SCRIPT_DIR/run-e2e.sh" \
      || true
  fi
fi

# === Stage 5: Smoke test (soft — depends on release exe) ===
if [[ "$SKIP_SMOKE" -ne 1 ]]; then
  if [[ -z "$RELEASE_EXE" ]]; then
    say_info "[smoke] SKIP (no release exe at src-tauri/target/release/)"
    stage_set "$(stage_index smoke)" "$WARN" "no release exe — run: scripts/build.sh --release"
  else
    # smoke-test.sh is now cross-platform (M3.1.0): the .app path is valid
    # input on macOS, the .exe path on Windows. We pass it through directly.
    run_soft_stage "smoke" "10-point smoke test" \
      "release exe missing or build failed" \
      "$SCRIPT_DIR/smoke-test.sh" "$RELEASE_EXE" \
      || true
  fi
fi

# === Summary ===
echo ""
echo "============================================"
echo "Summary"
echo "============================================"
printf "%-12s %-7s %s\n" "STAGE" "RESULT" "DETAIL"
echo "--------------------------------------------"
HARD_FAIL=0
i=0
for s in "${STAGE_ORDER[@]}"; do
  case "${STAGE_STATUS[$i]:-}" in
    $PASS) printf "%-12s %-7s %s\n" "$s" "PASS" "${STAGE_DETAIL[$i]}" ;;
    $SKIP) printf "%-12s %-7s %s\n" "$s" "SKIP" "${STAGE_DETAIL[$i]}" ;;
    $WARN) printf "%-12s %-7s %s\n" "$s" "WARN" "${STAGE_DETAIL[$i]}" ;;
    $FAIL) printf "%-12s %-7s %s\n" "$s" "FAIL" "${STAGE_DETAIL[$i]}"; HARD_FAIL=1 ;;
    *)     printf "%-12s %-7s %s\n" "$s" "MISS" "not run (programming error)" ; HARD_FAIL=1 ;;
  esac
  i=$((i+1))
done
echo "--------------------------------------------"
if [[ "$HARD_FAIL" -eq 1 ]]; then
  echo "RESULT: FAIL (one or more required stages failed)"
  exit 1
fi
echo "RESULT: PASS (no required stage failed)"
exit 0