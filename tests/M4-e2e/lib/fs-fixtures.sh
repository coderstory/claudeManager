#!/usr/bin/env bash
# fs-fixtures.sh — fixture preparation for M4 e2e scenarios
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Mechanism (verified in src-tauri/src/platform/macos/paths.rs + windows/paths.rs):
#   Setting CCM_TEST_HOME short-circuits home / app_data derivation. The app
#   then reads/writes ~/.claude/* under $CCM_TEST_HOME/Library/Application
#   Support/ClaudeConfigManager/ instead of the real user home.
#
# Each scenario gets a unique tmp dir keyed by PID ($$), so concurrent runs
# don't trample each other.

# === Resolve tmp path (PID-scoped, set once per shell) ===
# $$ is the bash process ID. If this lib is sourced from a subshell, it gets
# a different PID — we rely on the test orchestrator using a stable PID.
M4_TMP_DIR="/tmp/cc-M4-e2e-$$"
export CCM_TEST_HOME="$M4_TMP_DIR/home"

# === prepare_fixture <src_fixture_json>
# 1. Export CCM_TEST_HOME (idempotent)
# 2. mkdir -p $CCM_TEST_HOME/.claude
# 3. Backup real ~/.claude/settings.json → $CCM_TEST_HOME/.real-backup (if exists)
# 4. Copy src → $CCM_TEST_HOME/.claude/settings.json
#
# The .real-backup is intentionally outside the real home, so cleanup_tmp can
# rm -rf the entire $M4_TMP_DIR without losing user data.
prepare_fixture() {
  local src="$1"
  if [[ ! -f "$src" ]]; then
    say_err "prepare_fixture FAILED: source fixture not found: $src"
    exit 1
  fi

  export CCM_TEST_HOME="$M4_TMP_DIR/home"
  mkdir -p "$CCM_TEST_HOME/.claude"

  # Backup real settings.json if it exists. We use a hidden dotfile inside
  # the tmp dir so it's automatically cleaned up on cleanup_tmp unless the
  # user explicitly calls restore_fixtures first.
  local real_settings="$HOME/.claude/settings.json"
  if [[ -f "$real_settings" ]]; then
    cp -p "$real_settings" "$M4_TMP_DIR/.real-backup"
    say_info "  backed up real settings.json → $M4_TMP_DIR/.real-backup"
  else
    say_info "  no real ~/.claude/settings.json to back up"
  fi

  # Copy fixture into the isolated test home
  cp "$src" "$CCM_TEST_HOME/.claude/settings.json"
  say_info "  fixture ready: $CCM_TEST_HOME/.claude/settings.json"
}

# === restore_fixtures
# Restore the real ~/.claude/settings.json from $M4_TMP_DIR/.real-backup
# (if a backup was created in prepare_fixture). Idempotent.
restore_fixtures() {
  local backup="$M4_TMP_DIR/.real-backup"
  if [[ -f "$backup" ]]; then
    cp -p "$backup" "$HOME/.claude/settings.json"
    say_info "  restored real settings.json from $backup"
  else
    say_info "  no backup to restore (real settings.json was never touched)"
  fi
}

# === cleanup_tmp
# rm -rf $M4_TMP_DIR. Safe to call multiple times.
cleanup_tmp() {
  if [[ -d "$M4_TMP_DIR" ]]; then
    rm -rf "$M4_TMP_DIR"
    say_info "  removed tmp dir: $M4_TMP_DIR"
  fi
}
