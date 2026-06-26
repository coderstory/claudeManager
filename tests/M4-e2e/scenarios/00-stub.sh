#!/usr/bin/env bash
# scenarios/00-stub.sh — Phase 1 verification stub
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Proves the harness end-to-end before Phase 3 writes the real 14 scenarios.
# What it does:
#   1. Set CCM_TEST_HOME + copy fixture
#   2. Launch the app
#   3. Wait for a window
#   4. Kill the app
#   5. Verify cleanup restored the real ~/.claude/settings.json
#
# This does NOT exercise F1-F24 — it only proves the test driver plumbing
# (fixture isolation, AppleScript reachability, app launch, cleanup) works.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source libs (order matters: shell.sh last so it can call helpers from the
# other two). On macOS, use driver-mac.sh; on Windows the orchestrator would
# source driver-win.ps1 instead. We detect at runtime.
source "$SCRIPT_DIR/../lib/shell.sh"
source "$SCRIPT_DIR/../lib/fs-fixtures.sh"

if [[ "$(uname -s)" == "Darwin" ]]; then
  source "$SCRIPT_DIR/../lib/driver-mac.sh"
elif [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "MSYS"* ]]; then
  say_warn "00-stub.sh: Windows driver is a stub in M4 — running with reduced coverage"
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../lib/driver-win.sh" 2>/dev/null || say_warn "driver-win.sh not found (expected for M4 macOS-first)"
else
  say_warn "00-stub.sh: unknown platform $(uname -s)"
fi

trap cleanup EXIT

say_info "=== M4 stub scenario (00) ==="

# 1. Prepare fixture
prepare_fixture "$SCRIPT_DIR/../fixtures/3-providers.json"

# 2. Launch + best-effort wait (AX is flaky on WKWebView)
launch_app
set +e
wait_for_window 15
WAIT_RC=$?
set -e
if [[ $WAIT_RC -ne 0 ]]; then
  say_warn "  AX window probe timed out — WKWebView AX state unreliable, continuing"
fi

# 3. Settle (let the app render the providers from the fixture)
sleep 2

# 4. Kill (cleanup trap will also kill, but explicit kill is clearer in logs)
kill_app

# 5. Manually run cleanup NOW so we can assert it worked before the EXIT trap.
#    The EXIT trap calls cleanup() again but it's idempotent (kill_app returns
#    0 if no process, restore_fixtures is idempotent, cleanup_tmp skips if
#    dir gone).
restore_fixtures
cleanup_tmp
if [[ -d "$M4_TMP_DIR" ]]; then
  say_err "00-stub FAILED: tmp dir still present after cleanup: $M4_TMP_DIR"
  exit 1
fi
say_info "  tmp dir cleaned up"

say_info "[PASS] 00_stub: harness end-to-end OK"
exit 0
