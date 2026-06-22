---
phase: 18-m1-l1-playwright-e2e-windows-only
plan: 02
subsystem: testing
tags: [playwright, e2e, vite, dev-server, layout, shortcuts, ui-verify]

# Dependency graph
requires:
  - phase: 18-m1-l1-playwright-e2e-windows-only-01
    provides: "playwright.config.ts webServer gating + fixtures.ts CDP-mode page.goto Proxy fix (commit b8361ce); scripts/run-e2e.sh Mode A dev-server path"
provides:
  - "3 dev-server specs validated against vite (m1-9-2-layout, m2-3-0-shortcuts-theme, m2-3-2-ui-layout-verify)"
  - "Per-spec result table for Plan 18-03 aggregate"
affects:
  - "18-03 aggregate summary"
  - "STATE.md v3.0 progress (will be updated by Plan 18-03 to 8/10 ship)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PLAYWRIGHT_BASE_URL=http://localhost:1420 + run-e2e.sh Mode A skips tauri-driver and runs raw playwright test (validated end-to-end)"
    - "vite dev server background lifecycle (nohup + /tmp/vite-dev.log + curl-poll wait + Get-NetTCPConnection cleanup)"

key-files:
  created:
    - .planning/phases/18-m1-l1-playwright-e2e-windows-only/18-02-SUMMARY.md
  modified: []

key-decisions:
  - "Run vite via `nohup npm run dev > /tmp/vite-dev.log 2>&1 &` with curl-poll wait (1s for ready in this session); cleanup via Get-NetTCPConnection LocalPort=1420 State=Listen"
  - "Reuse the same vite dev server across all 3 tasks (single start at Task 1; verified still listening between Tasks 2 and 3) — saves ~5s per task vs restart"
  - "test.afterAll in m2-3-2-ui-layout-verify calls scripts/kill-app.sh — harmless when no Tauri app is running; does NOT touch vite"

patterns-established:
  - "Dev-server e2e pattern: git status clean + HEAD verified (4fb03b5) -> port pre-cleanup -> vite background start -> 30s curl-poll -> run spec -> verify port still listening for next task -> final kill"

requirements-completed: []

# Metrics
duration: 4min
started: 2026-06-22T12:56:13Z
completed: 2026-06-22T13:00:00Z
tasks: 3
files-modified: 0
status: complete
---

# Phase 18 Plan 02: M1 L1 Dev-Server e2e Validation Summary

**All 3 dev-server Playwright specs (m1-9-2-layout / m2-3-0-shortcuts-theme / m2-3-2-ui-layout-verify) passed exit 0 against `npm run dev` on http://localhost:1420 without any code fix — the Wave 1 fixtures fix (`b8361ce`) plus prior M2.15/M2.16 polish locked the testid/selector contracts in place.**

## Performance

- **Duration:** ~4 min (start 12:56:13Z, end ~13:00Z)
- **Started:** 2026-06-22T12:56:13Z
- **Completed:** 2026-06-22T13:00:00Z
- **Tasks:** 3 / 3 complete (all pass, zero fix commits)
- **Files modified:** 0 (no atomic fix commits needed — no spec drift found)

## Accomplishments

- **3/3 dev-server specs PASS** on the vite dev server (8.2s + 5.6s + 7.3s = ~21s of spec execution; total wall clock ~4 min including startup + cleanup).
- **No code fixes required** — every spec assertion held against the current `main` state. The `data-testid` contracts (`app-header-*`, `app-sidebar`, `sidebar-item-*`, `quick-search-modal`, `quick-search-input`, `quick-search-backdrop`) all match the source. The Ctrl+1-9 keyboard handler and Ctrl+/ QuickSearchModal opening logic both still work. Theme trim (no theme toggle button, `<html data-theme>` = 'light') holds per M2.16.
- **Vite lifecycle cleanly managed**: started once via `nohup npm run dev > /tmp/vite-dev.log 2>&1 &`, reused across all 3 tasks (verified listening between tasks), killed via `Get-NetTCPConnection -LocalPort 1420 -State Listen` at end. No orphan process left.

## Results — Per-Spec Table

| Spec | Result | Cases | Commit | Notes |
| --- | --- | --- | --- | --- |
| `tests/e2e/m1-9-2-layout.spec.ts` | PASS | 4/4 | (no fix) | home @ 1024x640: header height 48px, chrome buttons at x=904/940/976 all in viewport, sidebar item count = 14 (MCP 管理 → 关于), sidebar 720x480 last item "关于" at y=546 has scroll access (`overflowY: auto`), dark theme pre-seed sets `data-theme=dark` but body bg remains cream (`#FAFAF7`) — single-theme lock confirmed |
| `tests/e2e/m2-3-0-shortcuts-theme.spec.ts` | PASS | 4/4 | (no fix) | Ctrl+/ opens QuickSearchModal (`quick-search-input` present + backdrop visible); Esc closes (modal + backdrop both gone); theme trim: `data-theme=light` + no `app-header-theme-toggle` button; Ctrl+2 navigates to "Provider 切换" (provider-switch) — confirms Ctrl+1-9 handler still maps digits to sidebar indices |
| `tests/e2e/m2-3-2-ui-layout-verify.spec.ts` | PASS | 3/3 | (no fix) | AppHeader min/max/close all 32x32 at x=904/940/976 inside 1024px viewport; back button (after `ccm.lastView=provider-list`) 32x32 at x=16 in viewport; QuickSearchModal X close button `aria-label="关闭窗口"` + `title="关闭"` (assertion `contains 关闭` passes), header strip `padding-top=12px` (assertion `<=16` passes) — M2.15 padding fix (`769293e`) still holds |

## Commits

**None.** No spec or app code edits were required. All assertions passed against the current `main` HEAD (`4fb03b5`).

The Wave 1 fixtures fix (`b8361ce`) plus the M2.15/M2.16 polish commits (`769293e` header padding, theme-toggle removal) had already aligned testids, selectors, and layout with what these specs assert. No new `test(18-02):` atomic commits were generated.

## Deviation Log

### Pre-flight workarounds (not committed as fixes)

- **Vite cleanup pattern**: `powershell.exe` `Get-NetTCPConnection -LocalPort 1420 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` worked first time. Used `State=Listen` filter to avoid killing TIME_WAIT entries left over from Playwright's Chromium connections (those have OwningProcess=0 and are harmless).
- **Vite startup**: `nohup` + `&` in Git Bash kept the process alive across subsequent bash tool calls (each call gets a fresh shell). Ready after 1s in this session (cold start ~1.5s based on vite log).

### No bugs found or fixed

Unlike Wave 1 (which needed `b8361ce` for `page.goto` ERR_ABORTED), no spec in this wave required a fix. All 11 cases (4+4+3) passed cleanly.

## Known Limitations

- **L-18-01**: `m1-9-2-layout` dark-theme case asserts `data-theme=dark` but reports `bodyBg=rgb(250,250,247)` (cream/light) — the theme lock at M2.16 means dark mode is effectively cosmetic-only (`document.documentElement.dataset.theme=dark` is set, but CSS variables in `:root` still resolve to the light tokens). This is INTENTIONAL per the M2.16 theme-trim decision (single 瓷白 theme), and the spec's assertion is intentionally loose (no body-bg assertion — only data-theme attribute). Not a regression; flagged for awareness.
- **L-18-02**: `m1-9-2-layout` sidebar-720x480 case reports `lastItemInsideSidebar=false` + `lastItemVisibleInViewport=false` — the last sidebar item "关于" at y=546 sits below the 432px sidebar clientHeight + 480px viewport. The sidebar has `overflow-y: auto` so it scrolls; the diagnostic just observes the un-scrolled state. This is the expected behavior of a scrollable sidebar — not a layout regression. The spec has no assertion on this; the screenshot + console.log is the diagnostic artifact.
- **No code-level issues found.** No follow-up task required.

## Verification

- All 3 spec files exist at the paths listed and were executed against the live vite dev server.
- `scripts/run-e2e.sh Mode A` triggered correctly for all 3 invocations (printed `>>> run-e2e.sh: dev-server mode (PLAYWRIGHT_BASE_URL=http://localhost:1420)` and ran `npx playwright test` directly).
- Each spec ended with `Playwright exit code: 0` (in tail output) and the final line `<N> passed (<T>s)`.
- `git status --short` before commit: clean (only the pre-existing `.planning/STATE.md` modified and the `tmp/` / `docs/superpowers/` / `.planning/milestones/` untracked entries from prior sessions — all unrelated to Phase 18).
- Port 1420 confirmed free at task exit (`Get-NetTCPConnection -LocalPort 1420` returned empty after final cleanup).

## Self-Check: PASSED

- All 3 spec files exist and were executed: `tests/e2e/m1-9-2-layout.spec.ts`, `tests/e2e/m2-3-0-shortcuts-theme.spec.ts`, `tests/e2e/m2-3-2-ui-layout-verify.spec.ts`.
- 18-01 SUMMARY consumed as context (verified fixtures fix `b8361ce` is present in `git log`).
- Vite dev server cleanly shut down (port 1420 free).
- No fix commits needed (verified by `git log --oneline -5` showing only the prior wave's commits + this summary commit).

## Next Steps

Pointer to Plan **18-03** (aggregate summary + STATE.md update). All 6 M1.8 specs are now validated (3 WebView2 via `b8361ce` fix + 3 dev-server zero-fix), so Plan 18-03 can:
1. Aggregate the per-spec tables from `18-01-SUMMARY.md` and this file into one final report.
2. Update `.planning/STATE.md` to advance v3.0 progress to 8/10 ship.
3. Replace the "Playwright e2e 402 blocked" placeholder with concrete Phase 18 outcomes.
4. Reference L-18-01 / L-18-02 from this file's Known Limitations if needed.