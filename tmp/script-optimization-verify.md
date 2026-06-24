# scripts/ optimization verification — M3.0.4

**Date**: 2026-06-24
**Target exe**: `C:\Users\e-Yunfei.Qian\Desktop\ClaudeConfigManager-M3\ClaudeConfigManager-M3.0.3-ui-text-cleanup-fix-v2.exe`
**Source scripts**: `D:\project\winui3\scripts\{smoke-test,kill-app,build-and-ship}.sh`

## Changes (4 files modified)

### 1. `scripts/smoke-test.sh` — A1 + A5
- **A1**: Folded Test 1/2/5 powershell calls (3 cold-starts @ ~200-400ms each) into **1 batched session** via temp `.ps1` file + `powershell -File`. Each test emits `TEST<n>_<KEY>=VALUE` lines parsed by bash `pwsh_get` helper.
- **A5**: Pre-cleanup now delegates to `kill-app.sh` (single source of truth for "kill all matching processes"). Falls back to inline powershell if `kill-app.sh` is missing (defensive).

### 2. `scripts/kill-app.sh` — C3
- **C3**: Extracted `check_remaining_count()` helper (was duplicated at L73-75 + L91-93). PID graceful-close loop folded from **N powershell cold-starts → 1** by passing PIDs as CSV via `$env:PID_CSV` env var to a heredoc powershell script (the previous `echo "..." | sed "s/'/\"/g"` approach produced malformed `@(""23708""` syntax — fixed by switching to heredoc + env var).

### 3. `scripts/build-and-ship.sh` — B1
- **B1**: Removed pre-build powershell kill (was L68-72). Re-numbered steps from `[1/5]` to `[1/4]`. Pre-cleanup is now solely the caller's responsibility (`kill-app.sh` is already invoked per CLAUDE.md §9.7; `smoke-test.sh` calls it internally too).

### 4. `scripts/_lib.sh` — NOT CREATED
- Helper skipped per the user's "avoid over-abstraction" guidance. Only 2 scripts share the `claude-config-manager` literal, and inlining is clearer than a 1-function helper.

## Key technical finding: `Add-Type` + `-Command -` stdin pipe

Initial A1 implementation used `powershell.exe -NoProfile -Command - <<PWSH_EOF` (heredoc stdin). This **silently hung** when `Add-Type` was reached — the C# compiler cannot initialise in a piped-stdin command context. Empirically:

- `powershell -Command -` reading from stdin: prints "BEFORE Add-Type", then **silently exits 0** without printing "AFTER" (4-line repro confirmed).
- `powershell -File path.ps1`: completes normally, "BEFORE" + "AFTER" both print in <1s.

**Fix**: write powershell body to a temp `.ps1` file under `/tmp/` and invoke `-File`. Cold-start cost is identical (~200ms) to `-Command`, but `Add-Type` works correctly. Comment in the script documents this gotcha for future maintainers.

## Verification

### Syntax
```bash
bash -n scripts/build-and-ship.sh  # OK
bash -n scripts/smoke-test.sh      # OK
bash -n scripts/kill-app.sh        # OK
```

### Smoke test results (3 runs)
| Run | Wall time | Result |
|---|---|---|
| Baseline (pre-optimization) | 25.271s | 10/10 PASS |
| Optimized #1 | 18.262s | 10/10 PASS |
| Optimized #2 | 17.519s | 10/10 PASS |

**Avg optimized: 17.9s** vs **baseline 25.3s** = **-7.4s / -29% faster**.

All 10 checks passed identically:
- 1_launch (count=1), 2_window (OK), 5_webview (WRY_WEBVIEW + 50+ Chrome_WidgetWin_0)
- 6_title ("Claude 配置管理器"), 7_assets (dist fingerprint embedded)
- 8_db_exists (4096 bytes), 9_schema (3 tables), 10_queryable (usage=11,backup=5)
- 3_tray (survived close), 4_kill (gone in 2s)

### Edge cases verified
- kill-app.sh standalone (no PIDs): "No process found. Already clean." ✓
- kill-app.sh on no-PID input does not spawn powershell at all (early exit) ✓
- smoke-test.sh invoked from build-and-ship.sh: `KILL_APP_SH` resolution still works via `BASH_SOURCE[0]` ✓
- build-and-ship.sh `[1/4]` numbering consistent across all echo statements ✓

## Files changed
- `D:\project\winui3\scripts\smoke-test.sh` — major rewrite (PowerShell batch session)
- `D:\project\winui3\scripts\kill-app.sh` — `check_remaining_count()` helper + batched PID kill
- `D:\project\winui3\scripts\build-and-ship.sh` — removed pre-cleanup, renumbered to [1/4]

## Rollback
All changes verified PASS. No rollback needed.