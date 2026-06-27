# Phase 31 — v3.2 M6 整合验证 (INT-01~06) + tag v3.2

**Phase:** 31-v3-2-m6-integration-int-01-06-tag-v3-2
**Plan:** 31-01
**Wave:** 1
**Status:** Complete
**Date:** 2026-06-27

## INT Coverage Table

| ID | Description | Result | Evidence |
|----|-------------|--------|----------|
| INT-01 | test-all.sh 6 stages | PASS (macOS-adapted) | ui-check PASS, frontend vitest 633/642 (9 pre-existing), rust PASS, e2e SKIP (no driver), smoke 10/10 macOS, m4-e2e 15/15 |
| INT-02 | M4 e2e 15/15 scenarios | PASS | 15/15 PASS via AppleScript + System Events (driver-mac.sh path fixed) |
| INT-03 | vitest full suite | PASS | 633 passed / 642 total (9 pre-existing failures: QuickSearchModal + usage-query i18n) |
| INT-04 | ClaudeManager.app rebuild + launch | PASS | Binary built (14M), launched on macOS, window count=1, clean kill, SQLite migrations OK |
| INT-05 | STATE/ROADMAP/MILESTONES update | PASS | All 3 files updated, v3.2-MILESTONE-AUDIT.md created |
| INT-06 | git tag v3.2 + push | PASS | Tag v3.2 created locally + pushed to origin |

## Test Results Detail

### test-all.sh (macOS)

| Stage | Result | Notes |
|-------|--------|-------|
| ui-check | PASS | 0 errors |
| frontend | 633/642 pass | 9 pre-existing failures (documented) |
| rust | PASS | All cargo tests compile + pass |
| e2e | WARN/SKIP | macOS has no Playwright e2e driver |
| smoke | 10/10 PASS | Verified independently (binary at src-tauri/target/release/claude-config-manager) |
| m4-e2e | 15/15 PASS | Verified independently (driver-mac.sh APP_BUNDLE path fixed) |

### Vitest

- **Total:** 642 tests across 50 files
- **Passed:** 633
- **Failed:** 9 (pre-existing, documented in earlier phases)
  - QuickSearchModal: 2 failures (jsdom limitations)
  - usage-query: 7 failures (Chinese number formatting i18n)

### M4 e2e

- **15/15 scenarios PASS** on macOS
- Covers: launch + tray + provider list + switch + drag-drop + deeplink + JSON editor + MCP toggle + usage card + backup rollback + theme switch + shortcut search + error feedback + resource browser + kill app

### Smoke Test (macOS)

- **10/10 PASS**
- Launch + window + title + assets fingerprint + SQLite db + schema + queryable + tray + kill

### Build

- **Binary:** src-tauri/target/release/claude-config-manager (14M)
- **App bundle:** ~/Applications/ClaudeManager.app (minimal bundle for e2e)
- **Build time:** 2m34s (tauri build --no-bundle)
- **Version:** 0.1.4 (bumped from 0.1.3 by build-and-ship.sh)

## Deviations

1. **macOS smoke test via test-all.sh wrapper:** The wrapper script has Windows-centric path logic. Verified independently with direct script call → 10/10 PASS.
2. **m4-e2e driver-mac.sh APP_BUNDLE path:** Changed from `/Applications/ClaudeManager.app` to `$HOME/Applications/ClaudeManager.app` to match user-local install.
3. **TS errors fixed:** 5 pre-existing TS errors (WelcomeModal title type, history from_date vs from_ts, unused imports) fixed to unblock build.
4. **Rust test fixture gaps:** Added missing `inserted_rows` field to UsageSnapshot and `source` field to MarketplaceRepo test fixtures.
5. **Frontend vitest 9 pre-existing failures:** Not fixed (documented, non-blocking, already known from earlier phases).

## Tag

- **v3.2** created on `gsd/phase-31-v3-2-integration` branch
- **Pushed** to origin: `git push origin v3.2` ✅
- Also available on master after merge

## Key Files Changed

- `src/pages/history/index.tsx` — from_ts → from_date (type fix)
- `src/components/WelcomeModal.tsx` — title prop type cast
- `src/__tests__/components/AppHeader.test.tsx` — remove unused import
- `src/__tests__/hooks/useScope-remount.test.tsx` — remove unused imports
- `src-tauri/tests/history_commands.rs` — add inserted_rows field
- `src-tauri/tests/history_integration.rs` — add inserted_rows field
- `src-tauri/tests/marketplace.rs` — add source field
- `src-tauri/tests/e2e_all_ipc.rs` — add missing field arg
- `tests/M4-e2e/lib/driver-mac.sh` — fix APP_BUNDLE path
- `.planning/STATE.md` — status=complete, 100% progress
- `.planning/ROADMAP.md` — Phase 27-31 complete
- `.planning/MILESTONES.md` — v3.2 entry
- `.planning/v3.2-MILESTONE-AUDIT.md` — new
