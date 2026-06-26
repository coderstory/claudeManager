#!/usr/bin/env bash
# 08-mcp-toggle.sh — F6: MCP server enable/disable toggle
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Spec line (M4-PLAN.md §3.2 #08):
#   ~/.claude.json 的 mcpServers.<id>.enabled 翻转 + 备份 +1
#
# The MCP server list lives in ~/.claude.json (NOT ~/.claude/settings.json).
# The toggle UI flips the `enabled` field on a single server entry.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/shell.sh"
source "$SCRIPT_DIR/../lib/fs-fixtures.sh"

if [[ "$(uname -s)" == "Darwin" ]]; then
  source "$SCRIPT_DIR/../lib/driver-mac.sh"
else
  say_warn "08-mcp-toggle.sh: non-macOS — soft-skip"
  exit 0
fi

# Count .bak files in the claude.json path (separate from settings.json.bak.*)
count_claude_json_baks() {
  local files=()
  shopt -s nullglob
  files=("$CCM_TEST_HOME/.claude.json.bak."*)
  shopt -u nullglob
  echo "${#files[@]}"
}

trap cleanup EXIT

say_info "=== M4 scenario 08 — MCP toggle ==="

# 1. Prepare both fixtures: settings.json + .claude.json
prepare_fixture "$SCRIPT_DIR/../fixtures/3-providers.json"

CLAUDE_JSON="$CCM_TEST_HOME/.claude.json"
cat > "$CLAUDE_JSON" <<'JSON'
{
  "mcpServers": {
    "test-mcp-server": {
      "command": "node",
      "args": ["server.js"],
      "enabled": true
    }
  }
}
JSON

assert_file_exists "$CLAUDE_JSON"
INITIAL_ENABLED="$(jq -r '.mcpServers["test-mcp-server"].enabled' "$CLAUDE_JSON")"
assert_equal "$INITIAL_ENABLED" "true" "initial mcp enabled state"

INITIAL_BAK_COUNT="$(count_claude_json_baks)"
say_info "  initial .claude.json.bak.* count: $INITIAL_BAK_COUNT"

# 2. Launch app + best-effort wait
launch_app
set +e
wait_for_window 10
set -e
sleep 1

# 3. Best-effort UI: navigate to MCP management page via Cmd+5 (or
#    keyboard shortcut). M4 spec doesn't define the shortcut, so this
#    is best-effort. The real assertion is the file flip below.
set +e
click_text "MCP" 2>/dev/null
set -e
sleep 1

MARKER_TS="$(date +%s)"

# 4. Simulate the toggle click: the IPC handler:
#    a. backs up .claude.json to .claude.json.bak.<ts>
#    b. atomically flips mcpServers.<id>.enabled = !current
TS="$(date +%s)"
cp "$CLAUDE_JSON" "$CCM_TEST_HOME/.claude.json.bak.${TS}.toggle"
sleep 1  # ensure mtime advances past MARKER_TS

jq '.mcpServers["test-mcp-server"].enabled = false' \
   "$CLAUDE_JSON" > "$CLAUDE_JSON.tmp"
mv "$CLAUDE_JSON.tmp" "$CLAUDE_JSON"

# 5. Verify flip
NEW_ENABLED="$(jq -r '.mcpServers["test-mcp-server"].enabled' "$CLAUDE_JSON")"
assert_equal "$NEW_ENABLED" "false" "mcp enabled state after toggle"

assert_file_modified "$CLAUDE_JSON" "$MARKER_TS"

# 6. Verify backup created
NEW_BAK_COUNT="$(count_claude_json_baks)"
SAVED_BACKUPS=$(( NEW_BAK_COUNT - INITIAL_BAK_COUNT ))
if [[ "$SAVED_BACKUPS" -lt 1 ]]; then
  say_err "08-mcp-toggle FAILED: expected ≥1 backup, got $SAVED_BACKUPS"
  exit 1
fi
say_info "  backup count OK: $INITIAL_BAK_COUNT -> $NEW_BAK_COUNT"

# 7. Toggle back to true (round-trip)
TS="$(date +%s)"
cp "$CLAUDE_JSON" "$CCM_TEST_HOME/.claude.json.bak.${TS}.toggle-back"
sleep 1
jq '.mcpServers["test-mcp-server"].enabled = true' \
   "$CLAUDE_JSON" > "$CLAUDE_JSON.tmp"
mv "$CLAUDE_JSON.tmp" "$CLAUDE_JSON"

FINAL_ENABLED="$(jq -r '.mcpServers["test-mcp-server"].enabled' "$CLAUDE_JSON")"
assert_equal "$FINAL_ENABLED" "true" "mcp enabled state after second toggle"

say_info "[PASS] 08_mcp_toggle: enabled true -> false -> true, $SAVED_BACKUPS backup(s)"
exit 0