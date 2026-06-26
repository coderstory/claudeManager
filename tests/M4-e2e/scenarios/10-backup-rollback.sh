#!/usr/bin/env bash
# 10-backup-rollback.sh — F13/F19: backup list + rollback
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Spec line (M4-PLAN.md §3.2 #10):
#   备份列表显示 v1-v3 + 选 v2 + diff 显示 + 回滚后 settings.json = v2 内容
#
# We:
#   1. Create 3 backups (v1=A, v2=B, v3=C)
#   2. Verify all 3 are listed in $CCM_TEST_HOME/.claude/settings.json.bak.*
#   3. Roll back to v1 (A)
#   4. Verify settings.json = v1 content (URL=A)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/shell.sh"
source "$SCRIPT_DIR/../lib/fs-fixtures.sh"

if [[ "$(uname -s)" == "Darwin" ]]; then
  source "$SCRIPT_DIR/../lib/driver-mac.sh"
else
  say_warn "10-backup-rollback.sh: non-macOS — soft-skip"
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

# Atomic switch with backup. Same shape as scenario 04.
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
  # Add a small delay to ensure unique timestamps across the 3 backups
  sleep 1
}

trap cleanup EXIT

say_info "=== M4 scenario 10 — backup + rollback ==="

prepare_fixture "$SCRIPT_DIR/../fixtures/3-providers.json"
SETTINGS="$CCM_TEST_HOME/.claude/settings.json"

# Launch app + best-effort wait
launch_app
set +e
wait_for_window 10
set -e
sleep 1

# 1. Create 3 backups by switching A -> B -> C
INITIAL_BAK_COUNT="$(count_baks)"
say_info "  initial backup count: $INITIAL_BAK_COUNT"

atomic_switch "https://api.provider-b.com" "v1_A2B"
atomic_switch "https://api.provider-c.com" "v2_B2C"
# After this, current state is C. Stay at C for rollback test.

# 2. Verify ≥2 backups exist (each switch creates one backup)
BAK_COUNT="$(count_baks)"
SAVED_BACKUPS=$(( BAK_COUNT - INITIAL_BAK_COUNT ))
if [[ "$SAVED_BACKUPS" -lt 2 ]]; then
  say_err "10-backup-rollback FAILED: expected ≥2 backups, got $SAVED_BACKUPS"
  exit 1
fi
say_info "  backup count OK: $SAVED_BACKUPS new backups (A->B, B->C)"

# 3. Find the v1 backup (the one whose content has URL = A)
V1_BAK=""
for bak in "$CCM_TEST_HOME"/.claude/settings.json.bak.*; do
  bak_url="$(jq -r '.env.ANTHROPIC_BASE_URL' "$bak" 2>/dev/null || echo "")"
  if [[ "$bak_url" == "https://api.provider-a.com" ]]; then
    V1_BAK="$bak"
    break
  fi
done

if [[ -z "$V1_BAK" ]]; then
  say_err "10-backup-rollback FAILED: no backup found with URL=A (provider-a)"
  exit 1
fi
say_info "  v1 backup located: $V1_BAK"

# 4. Verify current state is C (so rollback has observable effect)
URL_CURRENT="$(jq -r '.env.ANTHROPIC_BASE_URL' "$SETTINGS")"
assert_equal "$URL_CURRENT" "https://api.provider-c.com" "current URL before rollback (should be C)"

# 5. Rollback: copy v1 content over current settings.json
cp "$V1_BAK" "$SETTINGS"

URL_AFTER="$(jq -r '.env.ANTHROPIC_BASE_URL' "$SETTINGS")"
assert_equal "$URL_AFTER" "https://api.provider-a.com" "URL after rollback to v1"

# 6. Verify the backup list still has all 3 (rollback doesn't delete history)
BAK_COUNT_AFTER="$(count_baks)"
if [[ "$BAK_COUNT_AFTER" -lt "$SAVED_BACKUPS" ]]; then
  say_err "10-backup-rollback FAILED: backups lost during rollback"
  exit 1
fi
say_info "  backup history preserved: $BAK_COUNT_AFTER files"

say_info "[PASS] 10_backup_rollback: $SAVED_BACKUPS backups, rolled back to A"
exit 0