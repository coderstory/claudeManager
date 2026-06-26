#!/usr/bin/env bash
# run-all.sh — M4 e2e orchestrator
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Runs the 14 spec scenarios in order. Skips ones that don't exist yet
# (Phase 1+2 only ship libs + stub; scenarios land in Phase 3+).
#
# Usage:
#   ./run-all.sh                       # run all 14 (skipping missing)
#   ./run-all.sh --scenario=03-switch-provider
#   ./run-all.sh --scenario=03         # prefix match
#   ./run-all.sh --list                # show what would run
#
# Exit code: 0 if all *executed* scenarios passed (missing = SKIP, not fail);
# 1 if any executed scenario failed.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
SCEN_DIR="$SCRIPT_DIR/scenarios"

# === Source libs (always — for say_* + check) ===
# shellcheck source=lib/shell.sh
source "$LIB_DIR/shell.sh"
# shellcheck source=lib/check-permissions.sh
source "$LIB_DIR/check-permissions.sh"

# === Argument parsing ===
TARGET_SCENARIO=""
LIST_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario=*) TARGET_SCENARIO="${1#--scenario=}"; shift ;;
    --scenario)   TARGET_SCENARIO="${2:-}"; shift 2 ;;
    --list)       LIST_ONLY=1; shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--scenario=NN-name] [--list]
  --scenario   Run only the matching scenario (e.g. 03, 03-switch, 03-switch-provider)
  --list       List scenarios and exit
EOF
      exit 0
      ;;
    *) say_err "Unknown arg: $1"; exit 1 ;;
  esac
done

# === Scenario list (must match M4-PLAN.md §2.1) ===
ALL_SCENARIOS=(
  "01-launch-tray"
  "02-list-providers"
  "03-switch-provider"
  "04-switch-stack"
  "05-drag-drop-sql"
  "06-deeplink-import"
  "07-json-editor"
  "08-mcp-toggle"
  "09-usage-card"
  "10-backup-rollback"
  "11-theme-switch"
  "12-shortcut-search"
  "13-error-feedback"
  "14-resource-browser"
)
# Also include the stub (00) — it's the Phase 1 verification scenario.
ALL_SCENARIOS=("00-stub" "${ALL_SCENARIOS[@]}")

# === --list mode ===
if [[ $LIST_ONLY -eq 1 ]]; then
  say_info "M4 e2e scenarios:"
  for s in "${ALL_SCENARIOS[@]}"; do
    local_script="$SCEN_DIR/$s.sh"
    if [[ -f "$local_script" ]]; then
      echo "  [x] $s"
    else
      echo "  [ ] $s (pending)"
    fi
  done
  exit 0
fi

# === Pre-flight: macOS accessibility ===
if ! check_macos_accessibility; then
  say_err "Pre-flight FAILED: macOS accessibility permission is not granted"
  exit 1
fi

# === Run ===
PASSED=0
FAILED=0
SKIPPED=0
FAILED_NAMES=()
SKIPPED_NAMES=()

run_scenario() {
  local name="$1"
  local script="$SCEN_DIR/$name.sh"

  echo ""
  echo "========================================"
  say_info "Running scenario: $name"
  echo "========================================"

  if [[ ! -f "$script" ]]; then
    say_warn "SKIP: $script does not exist yet (Phase 3+ work)"
    SKIPPED=$((SKIPPED + 1))
    SKIPPED_NAMES+=("$name")
    return 0
  fi

  # Per-scenario timeout: 90s default. The plan budgets 5-10 min for 14,
  # so 90s per scenario is generous for the actual e2e work. The first
  # launch (00-stub) may take longer due to cold app start, so we allow 120s.
  local timeout_s=90
  if [[ "$name" == "00-stub" ]]; then
    timeout_s=120
  fi

  local start
  start=$(date +%s)
  set +e
  timeout "$timeout_s" bash "$script"
  local rc=$?
  set -e
  local end
  end=$(date +%s)
  local dur=$((end - start))

  if [[ $rc -eq 0 ]]; then
    say_info "[PASS] $name (${dur}s)"
    PASSED=$((PASSED + 1))
  elif [[ $rc -eq 124 ]]; then
    say_err "[FAIL] $name: timeout after ${timeout_s}s"
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  else
    say_err "[FAIL] $name (rc=$rc, ${dur}s)"
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  fi
}

# === Dispatch ===
if [[ -n "$TARGET_SCENARIO" ]]; then
  # Single-scenario mode: find first match
  matched=""
  for s in "${ALL_SCENARIOS[@]}"; do
    if [[ "$s" == "$TARGET_SCENARIO" || "$s" == "$TARGET_SCENARIO-"* || "$s" == *"$TARGET_SCENARIO"* ]]; then
      matched="$s"
      break
    fi
  done
  if [[ -z "$matched" ]]; then
    say_err "No scenario matches '$TARGET_SCENARIO'"
    say_info "Available:"
    for s in "${ALL_SCENARIOS[@]}"; do echo "  $s"; done
    exit 1
  fi
  run_scenario "$matched"
else
  for s in "${ALL_SCENARIOS[@]}"; do
    run_scenario "$s"
  done
fi

# === Report ===
echo ""
echo "========================================"
say_info "M4 e2e run-all summary"
echo "========================================"
echo "  PASSED:  $PASSED"
echo "  FAILED:  $FAILED"
echo "  SKIPPED: $SKIPPED"
if [[ ${#FAILED_NAMES[@]} -gt 0 ]]; then
  say_err "Failed scenarios:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
fi
if [[ ${#SKIPPED_NAMES[@]} -gt 0 ]]; then
  say_info "Skipped scenarios (not yet implemented):"
  for n in "${SKIPPED_NAMES[@]}"; do echo "  - $n"; done
fi

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
