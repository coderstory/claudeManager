#!/usr/bin/env bash
# check-permissions.sh — macOS accessibility pre-flight check
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Per M4-PLAN.md §6 / §9 Q=A=2: M4 automates the accessibility permission
# detection — if AppleScript can't reach System Events, we exit 1 with
# user-facing instructions on how to grant Terminal/iTerm accessibility.
#
# macOS 14+ enforces Accessibility permission per app. The test runner is
# whatever shell launched the osascript (Terminal, iTerm, Cursor, etc.).
# Detection method: ask System Events for a stable list of running processes
# and check we got names back (not an error code or empty string).

# === check_macos_accessibility
# Returns 0 if accessibility is granted, 1 if not.
# On non-macOS, returns 0 (no permission to check).
check_macos_accessibility() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_info "check_macos_accessibility: non-macOS, skipping"
    return 0
  fi

  # Try a cheap probe. If it fails, we get an empty string or error.
  local probe
  probe="$(osascript -e 'tell application "System Events" to get name of every process' 2>&1)"
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    say_err "check_macos_accessibility FAILED: osascript exit $rc"
    say_err "Output: $probe"
    print_accessibility_instructions
    return 1
  fi

  # Even on success, some macOS versions return empty string if permission
  # is denied. If we got 0 process names, treat as denied.
  local count
  count="$(echo "$probe" | tr ',' '\n' | sed 's/^[[:space:]]*//' | grep -c '.' || echo 0)"
  if [[ "$count" -lt 1 ]]; then
    say_err "check_macos_accessibility FAILED: System Events returned 0 processes"
    print_accessibility_instructions
    return 1
  fi

  say_info "check_macos_accessibility OK: System Events reachable ($count processes)"
  return 0
}

# === print_accessibility_instructions
# Print the user-facing steps to grant accessibility to the calling shell.
print_accessibility_instructions() {
  cat >&2 <<EOF
================================================================
 macOS Accessibility permission is required for M4 e2e
================================================================

macOS 14+ requires explicit permission for each app that drives
System Events (osascript / AppleScript). The process that needs
this permission is the one running this script — typically
Terminal, iTerm, or Cursor.

To grant:

  1. Open System Settings
  2. Go to Privacy & Security -> Accessibility
  3. Click the lock and authenticate
  4. Enable the toggle next to your terminal app
     (e.g. "Terminal", "iTerm", "Cursor", "Warp")
  5. Re-run this test

If the toggle is already on, toggle it OFF then ON again
(known workaround for stale TCC entries after macOS upgrades).

After granting, run:
  ./tests/M4-e2e/run-all.sh --scenario=00-stub
================================================================
EOF
}
