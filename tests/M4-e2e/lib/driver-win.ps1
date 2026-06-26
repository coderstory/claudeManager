# driver-win.ps1 — Windows UI Automation stub for M4 e2e
# Part of M4 e2e framework (see .planning/phases/M4-e2e-framework/M4-PLAN.md)
#
# Per M4-PLAN.md §9 Q=C=1, M4 ships macOS-first. Windows port is Phase 5.
# This file mirrors the function names of driver-mac.sh so the orchestrator
# can source it unconditionally; every function is a no-op returning 0 with
# a warning so the test suite runs (with warnings) on Windows.

#Requires -Version 5.0

$APP_BUNDLE = "claude-config-manager.exe"
$APP_PROCESS = "claude-config-manager"

function launch_app {
    Write-Warning "driver-win.ps1 launch_app: not implemented (M4 Phase 5)"
    return 0
}

function kill_app {
    Write-Warning "driver-win.ps1 kill_app: not implemented (M4 Phase 5)"
    return 0
}

function activate_app {
    Write-Warning "driver-win.ps1 activate_app: not implemented (M4 Phase 5)"
    return 0
}

function wait_for_window {
    param([int]$TimeoutSeconds = 10)
    Write-Warning "driver-win.ps1 wait_for_window: not implemented (M4 Phase 5)"
    return 0
}

function click_button {
    param([string]$Label)
    Write-Warning "driver-win.ps1 click_button($Label): not implemented (M4 Phase 5)"
    return 0
}

function click_text {
    param([string]$Text)
    Write-Warning "driver-win.ps1 click_text($Text): not implemented (M4 Phase 5)"
    return 0
}

function get_ax_value {
    param([string]$Role, [string]$Label)
    Write-Warning "driver-win.ps1 get_ax_value($Role, $Label): not implemented (M4 Phase 5)"
    return ""
}

function keystroke {
    param([string]$Text)
    Write-Warning "driver-win.ps1 keystroke($Text): not implemented (M4 Phase 5)"
    return 0
}

function keyboard_shortcut {
    param([string]$Keys)
    Write-Warning "driver-win.ps1 keyboard_shortcut($Keys): not implemented (M4 Phase 5)"
    return 0
}
