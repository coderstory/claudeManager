#!/usr/bin/env bash
# scripts/test-frontend.sh — Vitest wrapper (run / watch / coverage / typecheck)
#
# Single-responsibility: dispatch to the right `npx vitest` / `npx tsc` command
# so the dev / CI flows don't have to remember the exact flags. The vitest
# config lives in `vitest.config.ts` (coverage provider etc.) — we don't
# re-declare any of it here.
#
# Usage:
#   ./scripts/test-frontend.sh                # alias for `run` (default)
#   ./scripts/test-frontend.sh run            # CI mode (exit when done)
#   ./scripts/test-frontend.sh watch          # local dev watch mode
#   ./scripts/test-frontend.sh coverage       # run + emit coverage/ report
#   ./scripts/test-frontend.sh typecheck      # tsc --noEmit only (no vitest)
#
# Exit codes:
#   0  vitest/tsc passed
#   1  invalid subcommand, or vitest/tsc failed
#
# Reference: CLAUDE.md §2.3 (no vitest version bumps here) + §11.4.1
# (scriptify the existing `npm test -- --run` invocation so callers don't
# have to know the flag).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# === Color helpers (only when stdout is a tty) ===
# Mirrors the helper used by bump-version.sh / install-to-applications-mac.sh
# so output is consistent across the scripts/* family.
if [[ -t 1 ]]; then
  C_OK="\033[0;32m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_INFO="\033[0;36m"; C_RESET="\033[0m"
else
  C_OK=""; C_WARN=""; C_ERR=""; C_INFO=""; C_RESET=""
fi
say_ok()   { echo -e "${C_OK}$*${C_RESET}"; }
say_warn() { echo -e "${C_WARN}$*${C_RESET}"; }
say_err()  { echo -e "${C_ERR}$*${C_RESET}" >&2; }
say_info() { echo -e "${C_INFO}$*${C_RESET}"; }

usage() {
  cat <<EOF
Usage: test-frontend.sh [run|watch|coverage|typecheck]

Subcommands (default = run):
  run         npx vitest run         (CI mode — exit when done)
  watch       npx vitest             (local dev watch mode)
  coverage    npx vitest run --coverage
  typecheck   npx tsc --noEmit       (type-only check, no vitest)

Exit codes: 0 on pass, 1 on bad arg / vitest-tsc failure.
EOF
  exit 1
}

# Default subcommand when none supplied (so `test-frontend.sh` alone == `run`)
SUBCMD="${1:-run}"

# Reject obvious mistakes up-front — saves users from a 5-second vitest startup
# followed by an obscure "command not found" message from npm.
case "$SUBCMD" in
  -h|--help|help)
    usage
    ;;
  run|watch|coverage|typecheck)
    : # known subcommand
    ;;
  *)
    say_err "FAIL: unknown subcommand: $SUBCMD"
    usage
    ;;
esac

echo ">>> test-frontend.sh"
echo ">>> cwd:   $PROJECT_ROOT"
echo ">>> mode:  $SUBCMD"
echo ""

case "$SUBCMD" in
  run)
    say_info "[1/1] npx vitest run"
    npx vitest run
    ;;
  watch)
    say_info "[1/1] npx vitest (watch mode)"
    # Note: vitest defaults to watch mode when invoked without `run`.
    npx vitest
    ;;
  coverage)
    # Coverage provider is wired in vitest.config.ts (v8). We just enable it.
    say_info "[1/1] npx vitest run --coverage"
    npx vitest run --coverage
    ;;
  typecheck)
    # Type-only check, matches CI's test-frontend job command exactly.
    # Deliberately does NOT run vitest — keeps CI fast and gives a separate
    # failure surface for type errors vs runtime errors.
    say_info "[1/1] npx tsc --noEmit"
    npx tsc --noEmit
    ;;
esac

say_ok "DONE ✓"
exit 0