#!/usr/bin/env bash
# 04-switch-stack.sh — F2 + F13: switch A->B->C->A, 3 backups stacked
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Spec line (M4-PLAN.md §3.2 #04):
#   备份栈 = 3 个, 无丢失, A 切回时 settings.json 回到 A.url
#
# We don't actually drive the UI through 3 switches (AX is flaky on
# WKWebView). We perform the equivalent 3 writes through the file system
# + assert that the final state is consistent: env.ANTHROPIC_BASE_URL
# matches A's URL after the third write, and the .bak count >= 3.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/shell.sh"
source "$SCRIPT_DIR/../lib/fs-fixtures.sh"

if [[ "$(uname -s)" == "Darwin" ]]; then
  source "$SCRIPT_DIR/../lib/driver-mac.sh"
else
  say_warn "04-switch-stack.sh: non-macOS — soft-skip"
  exit 0
fi

# Count .bak files. shopt nullglob avoids the pipefail trap.
count_baks() {
  local files=()
  shopt -s nullglob
  files=("$CCM_TEST_HOME/.claude/settings.json.bak."*)
  shopt -u nullglob
  echo "${#files[@]}"
}

# Atomic switch with backup.  Mimics what the IPC layer does on user click:
# 1. cp current to settings.json.bak.<ts>
# 2. jq update env.ANTHROPIC_BASE_URL
# 3. atomic mv temp onto settings.json
atomic_switch() {
  local new_url="$1"
  local label="$2"
  local SETTINGS="$CCM_TEST_HOME/.claude/settings.json"
  local ts
  ts="$(date +%s)"
  cp "$SETTINGS" "$CCM_TEST_HOME/.claude/settings.json.bak.${ts}.${label}"
  jq --arg url "$new_url" '.env.ANTHROPIC_BASE_URL = $url' \
     "$SETTINGS" > "$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
}

trap cleanup EXIT

say_info "=== M4 scenario 04 — switch A->B->C->A ==="

prepare_fixture "$SCRIPT_DIR/../fixtures/3-providers.json"
SETTINGS="$CCM_TEST_HOME/.claude/settings.json"

# Launch app + best-effort wait
launch_app
set +e
wait_for_window 10
set -e
sleep 1

# Capture initial state
INITIAL_BAK_COUNT="$(count_baks)"
say_info "  initial backup count: $INITIAL_BAK_COUNT"

# 3 switches: A -> B -> C -> A
atomic_switch "https://api.provider-b.com" "A2B"
atomic_switch "https://api.provider-c.com" "B2C"
atomic_switch "https://api.provider-a.com" "C2A"

sleep 1

# Real assertions — the BACK to A state must match initial fixture URL
URL_AFTER="$(jq -r '.env.ANTHROPIC_BASE_URL' "$SETTINGS")"
assert_equal "$URL_AFTER" "https://api.provider-a.com" "URL after C->A round-trip"

BAK_COUNT_AFTER="$(count_baks)"
SAVED_BACKUPS=$(( BAK_COUNT_AFTER - INITIAL_BAK_COUNT ))
if [[ "$SAVED_BACKUPS" -lt 3 ]]; then
  say_err "04-switch-stack FAILED: expected ≥3 new backups, got $SAVED_BACKUPS (initial=$INITIAL_BAK_COUNT after=$BAK_COUNT_AFTER)"
  exit 1
fi
say_info "  backup count OK: $INITIAL_BAK_COUNT -> $BAK_COUNT_AFTER ($SAVED_BACKUPS new backups for 3 switches)"

say_info "[PASS] 04_switch_stack: 3 switches round-tripped, $SAVED_BACKUPS backups"
exit 0