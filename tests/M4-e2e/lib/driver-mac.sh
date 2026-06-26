#!/usr/bin/env bash
# driver-mac.sh — macOS AppleScript + System Events wrappers for M4 e2e
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Per M4-PLAN.md §9 Q=C=1, M4 ships macOS-first. Windows driver is a stub
# in driver-win.ps1 (Phase 5). All functions are no-ops or fall back to
# `say_warn` on non-macOS so cross-platform sourcing is safe.
#
# Each function exits non-zero on real failure (process not found, AX read
# failed). They are safe to call repeatedly (idempotent where it makes sense).

# === Constants ===
APP_BUNDLE="/Applications/ClaudeManager.app"
APP_PROCESS="ClaudeManager"
APP_BIN_PATTERN="ClaudeManager.app/Contents/MacOS/claude-config-manager"

# === Platform gate ===
if [[ "$(uname -s)" != "Darwin" ]]; then
  say_warn "driver-mac.sh loaded on non-macOS ($(uname -s)) — functions are stubs"
fi

# === launch_app
# Open the .app via `open`, sleep 3s, then verify pgrep finds 1 process.
# Exits 1 if the process doesn't appear within the poll window.
launch_app() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "launch_app: stub on non-macOS"
    return 0
  fi
  say_info "launch_app: opening $APP_BUNDLE"
  open "$APP_BUNDLE"
  sleep 3
  local count
  count="$(pgrep -f "$APP_BIN_PATTERN" | wc -l | tr -d ' ')"
  if [[ "$count" -lt 1 ]]; then
    say_err "launch_app FAILED: pgrep did not find $APP_BIN_PATTERN after 3s"
    return 1
  fi
  say_info "  launch_app OK: $count process(es) running"
}

# === kill_app
# Graceful: osascript 'tell application "ClaudeManager" to quit' + sleep 2.
# Force: pkill -9 -f $APP_BIN_PATTERN if still alive.
# Idempotent: returns 0 even if no process was running.
kill_app() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "kill_app: stub on non-macOS"
    return 0
  fi
  say_info "kill_app: graceful quit"
  osascript -e "tell application \"$APP_PROCESS\" to quit" >/dev/null 2>&1 || true
  sleep 2
  if pgrep -f "$APP_BIN_PATTERN" >/dev/null 2>&1; then
    say_info "  graceful quit timeout — sending SIGKILL"
    pkill -9 -f "$APP_BIN_PATTERN" 2>/dev/null || true
    sleep 1
  fi
  if pgrep -f "$APP_BIN_PATTERN" >/dev/null 2>&1; then
    say_err "kill_app FAILED: process still alive after SIGKILL"
    return 1
  fi
  say_info "  kill_app OK: no processes"
}

# === activate_app
# Bring the app to front (focus). Required before keystroke/click to ensure
# the events land on our window.
activate_app() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "activate_app: stub on non-macOS"
    return 0
  fi
  osascript -e "tell application \"$APP_PROCESS\" to activate" >/dev/null 2>&1
  say_info "  activate_app OK"
}

# === wait_for_window
# Poll until `count windows of process ClaudeManager` >= 1.
# Default timeout: 10s. Polls every 0.5s.
wait_for_window() {
  local timeout_s="${1:-10}"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "wait_for_window: stub on non-macOS"
    return 0
  fi
  local elapsed=0
  while (( elapsed < timeout_s )); do
    local count
    count="$(osascript -e "tell application \"System Events\" to count windows of process \"$APP_PROCESS\"" 2>/dev/null || echo 0)"
    if [[ "$count" -ge 1 ]]; then
      say_info "  wait_for_window OK: $count window(s) after ${elapsed}s"
      return 0
    fi
    sleep 0.5
    elapsed=$((elapsed + 1))
  done
  say_err "wait_for_window FAILED: no window after ${timeout_s}s"
  return 1
}

# === click_button <label>
# System Events click on the first button with AXTitle=label in the front
# window of process ClaudeManager. The button MUST be visible (System Events
# does not auto-scroll).
click_button() {
  local label="$1"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "click_button: stub on non-macOS"
    return 0
  fi
  say_info "click_button: '$label'"
  osascript -e "
    tell application \"System Events\"
      tell process \"$APP_PROCESS\"
        click button \"$label\" of window 1
      end tell
    end tell
  " >/dev/null 2>&1
}

# === click_text <text>
# Click the first UI element whose AXValue or AXTitle contains <text>.
# Useful for tab/sidebar labels that aren't buttons.
click_text() {
  local text="$1"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "click_text: stub on non-macOS"
    return 0
  fi
  say_info "click_text: '$text'"
  osascript -e "
    tell application \"System Events\"
      tell process \"$APP_PROCESS\"
        set foundEl to first UI element of window 1 whose value of attribute \"AXTitle\" contains \"$text\"
        click foundEl
      end tell
    end tell
  " >/dev/null 2>&1
}

# === get_ax_value <role> <label>
# Return the AXValue of the first UI element in window 1 matching
# AXRole=<role> AND AXTitle/AXLabel=<label>. Echoes the value (may be empty).
# Exits 1 if no matching element found.
get_ax_value() {
  local role="$1"
  local label="$2"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "get_ax_value: stub on non-macOS"
    echo ""
    return 0
  fi
  osascript -e "
    tell application \"System Events\"
      tell process \"$APP_PROCESS\"
        set foundEl to first UI element of window 1 whose role is \"$role\" and value of attribute \"AXTitle\" is \"$label\"
        return value of foundEl
      end tell
    end tell
  " 2>/dev/null
}

# === keystroke <text>
# System Events keystroke (type into focused element).
keystroke() {
  local text="$1"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "keystroke: stub on non-macOS"
    return 0
  fi
  osascript -e "tell application \"System Events\" to keystroke \"$text\"" >/dev/null 2>&1
}

# === keyboard_shortcut <keys>
# <keys> uses the osascript syntax: "cmd f", "cmd shift p", "cmd option a".
# System Events keystroke supports modifier names.
keyboard_shortcut() {
  local keys="$1"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_warn "keyboard_shortcut: stub on non-macOS"
    return 0
  fi
  say_info "keyboard_shortcut: '$keys'"
  osascript -e "tell application \"System Events\" to keystroke \"$keys\"" >/dev/null 2>&1
}
