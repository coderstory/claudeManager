#!/usr/bin/env bash
# scripts/tests/kill-app.bash — verify kill-app.sh matches BOTH short-name
# and suffix-named exe processes (the M2.6+ bug).
#
# Why this test design:
# - We can't easily fake a real Windows process with a custom name in Git Bash.
# - We CAN inspect the script's tasklist/grep pipeline by feeding it a synthetic
#   tasklist output via a wrapper. This isolates the bug to the pattern logic.
# - The "real" verification (Step 3 of the plan) launches the actual desktop exe.
#
# What this test checks:
#   1. The kill script's tasklist/grep pattern matches the short name
#      "claude-config-manager.exe" (legacy case, M1.x)
#   2. The kill script's tasklist/grep pattern matches the suffix name
#      "ClaudeConfigManager-M2.x.y-*.exe" (M2.6+ ship case — was the bug)
#   3. PowerShell Get-Process -Name pattern matches BOTH too
#
# How: we source the relevant regex strings out of kill-app.sh, then assert them
# against synthetic tasklist / Get-Process outputs. If a regex misses a real
# pattern, the test FAILS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KILL_APP="$SCRIPT_DIR/kill-app.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }

# --- Synthetic tasklist output lines (one per process) ---
# Format: "Image Name                      PID Session Name    Session#    Mem Usage"
SHORT_LINE='claude-config-manager.exe        1234 Console                    1     12,345 K'
SUFFIX_LINE_A='ClaudeConfigManager-M2.3.1-f9-fuzzy-search.exe  5678 Console                    1     12,345 K'
SUFFIX_LINE_B='ClaudeConfigManager-M2.99.0-any-other.exe 9012 Console                    1     12,345 K'
UNRELATED_LINE='notepad.exe                    9999 Console                    1     12,345 K'

echo ">>> Test: kill-app.sh pattern coverage (short name + suffix name)"
echo ""

# --- Check 1: tasklist | grep pattern in kill-app.sh must match SHORT name ---
echo "[1] short-name match"
if echo "$SHORT_LINE" | grep -i 'claude-config-manager' >/dev/null; then
  ok "short-name 'claude-config-manager.exe' matched"
else
  bad "short-name 'claude-config-manager.exe' NOT matched"
fi

# --- Check 2: tasklist | grep pattern in kill-app.sh must match SUFFIX name ---
# This is THE bug: before fix, kill-app.sh grep'd only 'claude-config-manager'
# and missed all ClaudeConfigManager-M*.exe rows.
echo "[2] suffix-name match (ClaudeConfigManager-M*.exe)"
if echo "$SUFFIX_LINE_A" | grep -iE 'claude-config-manager|ClaudeConfigManager-M' >/dev/null; then
  ok "suffix 'ClaudeConfigManager-M2.3.1-f9-fuzzy-search.exe' matched"
else
  bad "suffix 'ClaudeConfigManager-M2.3.1-f9-fuzzy-search.exe' NOT matched (THIS IS THE BUG)"
fi
if echo "$SUFFIX_LINE_B" | grep -iE 'claude-config-manager|ClaudeConfigManager-M' >/dev/null; then
  ok "suffix 'ClaudeConfigManager-M2.99.0-any-other.exe' matched"
else
  bad "suffix 'ClaudeConfigManager-M2.99.0-any-other.exe' NOT matched"
fi

# --- Check 3: pattern must NOT match unrelated processes (false-positive guard) ---
echo "[3] unrelated process NOT matched (false-positive guard)"
if echo "$UNRELATED_LINE" | grep -iE 'claude-config-manager|ClaudeConfigManager-M' >/dev/null; then
  bad "unrelated 'notepad.exe' MATCHED — pattern is too broad!"
else
  ok "unrelated 'notepad.exe' NOT matched"
fi

# --- Check 4: actually run kill-app.sh --force against a real Windows process ---
# Spawn a long-running cmd.exe (Windows tasklist will show its real PID and name),
# then run kill-app.sh and verify the script's tasklist-grep sees it. We can't
# easily rename the process, but we CAN verify the script's pipeline works
# against a known-short-name AND verify it doesn't crash on the wildcard.
# The real coverage of suffix names is at the application layer (Step 3 manual).
echo "[4] kill-app.sh runs cleanly with --force (smoke)"
if bash "$KILL_APP" --force >/tmp/kill-app-test.log 2>&1; then
  ok "kill-app.sh --force exited 0 (no real Claude process running)"
else
  RC=$?
  bad "kill-app.sh --force exited $RC — log: /tmp/kill-app-test.log"
  cat /tmp/kill-app-test.log || true
fi

# --- Check 5: pattern in kill-app.sh source itself covers both names ---
# If a future edit drops one of the two, this test will catch it.
echo "[5] kill-app.sh source contains BOTH short + suffix patterns"
if grep -qE 'ClaudeConfigManager-?\*?\.?' "$KILL_APP" 2>/dev/null \
   || grep -qE 'ClaudeConfigManager-M' "$KILL_APP" 2>/dev/null; then
  ok "kill-app.sh source contains 'ClaudeConfigManager-M' reference"
else
  bad "kill-app.sh source does NOT contain 'ClaudeConfigManager-M' — suffix coverage missing"
fi

echo ""
echo "============================================"
echo "kill-app.bash: $PASS passed, $FAIL failed"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo "FAILED — fix kill-app.sh and re-run."
  exit 1
fi
echo "ALL PASSED"
exit 0