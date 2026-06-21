# M1 — 4-Stage Review Archive (M1.11 + M1.12)

> **Milestone**: M1 架构期 (architecture phase)
> **Period**: 2026-06-18 (M1.1) → 2026-06-20 (M1.12)
> **Author**: M1.11 / M1.12 review subagents (each stage独立 ship)
> **Status**: ✅ Archived. All CRITICAL/HIGH addressed; MEDIUM/LOW
> filed in STATE.md.
>
> **Per CLAUDE.md §6** (评审纪律), every non-trivial change goes
> through 4 stages: 自审 → 头脑风暴 → 同行评审 → 业务流程分析.
> The M1 architecture period produced one canonical set of these
> documents; this file is the entry point.

---

## Source files

The full text of each stage lives in `docs/reviews/`. Read in order:

| # | Stage | File | Commit | Author |
|---|---|---|---|---|
| 1 | Self-review (5-level audit) | [`docs/reviews/m1-11-01-self-review.md`](../reviews/m1-11-01-self-review.md) | `6ea5e97` | M1.11 self-review subagent |
| 2 | Brainstorm (reverse-challenge) | [`docs/reviews/m1-11-02-brainstorm.md`](../reviews/m1-11-02-brainstorm.md) | (in `d79575d`) | M1.11 brainstorm subagent |
| 3 | Peer review (opencode hostile) | [`docs/reviews/m1-11-03-peer-review.md`](../reviews/m1-11-03-peer-review.md) | `0bd8128` | M1.11 peer subagent (opencode unavailable → self-simulated) |
| 4 | Business flow analysis | [`docs/reviews/m1-11-04-business-flow.md`](../reviews/m1-11-04-business-flow.md) | (in `d79575d`) | M1.11 flow subagent |
| 5 | Final audit (M1.12 收尾) | [`docs/reviews/m1-12-final-audit.md`](../reviews/m1-12-final-audit.md) | `5e5e8bf` → `9776ee9` | M1.12 final-audit subagent |

Note: stage 5 (final-audit) is itself a **4-stage review recap**
covering the entire M1 period — it re-organizes all findings into
TL;DR + 风险清单 + 移交清单. The earlier 4 stages feed into it.

---

## TL;DR — M1 final state (from M1.12-final-audit §1)

- **61 M1 commits**, 12 sub-tasks + 8 fix/improvement commits
- **14 ship exe** under `~/Desktop/ClaudeConfigManager-M1/`
- **Recommended exe**: `ClaudeConfigManager-M1.9.3-fix-layout.exe`
  (28.5 MB, last ship before M2 kick-off)
- **Vitest**: 73/73 全绿 (9 files)
- **Playwright e2e**: 6 specs (3 files)
- **Rust `#[test]`**: 60 (compile-clean; CI runs them on MSYS2)
- **TS/TSX code**: 1,995 lines (excl. tests)
- **TS test code**: 1,404 lines
- **Rust code**: 2,832 lines
- **Shell scripts**: 716 lines (4 files in `scripts/`)
- **SPEC.md**: 1,434 lines (immutable)

---

## Findings summary (by severity)

### CRITICAL (must fix before M2)

None outstanding. M1.11-fix (commit `b45196e`) addressed all
CRITICAL findings from stages 1-4.

### HIGH (should fix before M2)

Addressed in M1.11-fix:
- Theme 3-state (light / dark / auto) — fixed
- `WindowControls` close-error swallowing — fixed
- CI version pins (Node / Rust / Playwright) — fixed

### MEDIUM (filed to STATE.md, M2+ candidates)

A representative subset (full list in `m1-12-final-audit.md §3`):

- F-1.01 — `react-router-dom` unused dep; remove (M2.x removed)
- F-1.04 — ThemeProvider cold-boot race for 'auto' theme
- F-1.09 — Dark theme token overrides incomplete
  *(M2.16 trimmed theme surface to light瓷白 only; dark deferred)*
- F-1.11 — close-to-hide has no real e2e test
- F-1.14 — `useViewState.test.ts` registry id list is hard-coded
- F-1.22 — HANDOFF.json drifts from reality
- BP-1.01 — write panic to `AppPaths::logs_dir()`
- BP-1.06 — Vitest test for tokens.css body bg
- BP-3.01 — Theme toggle destroys 'auto' mode
- P-5 — Updater plugin enabled with empty pubkey (privacy)
- P-7 — `WindowControls` swallows close-button errors *(fixed)*
- P-8 — Build tag literal should be env-derived

### LOW (style / nice-to-have)

In `m1-12-final-audit.md §3.4`. Not blocking; pickup as encountered.

---

## Key decisions challenged in brainstorm (stage 2)

The brainstorm stage (m1-11-02) reverse-challenged 7 major design
decisions. Summary of conclusions:

| # | Decision | Verdict |
|---|---|---|
| 1 | Tauri v2 over Electron | ✅ Keep — bundle size + native window chrome + Rust perf win |
| 2 | OS abstraction 8 traits × Win + Mac | ✅ Keep — Mac stubs intentional (M1.2); live impls in M2 |
| 3 | Plugin system: 12 stubs + 业务延后 | ✅ Keep — enables parallel M2 work |
| 4 | View routing = `useViewState` (not react-router) | ✅ Keep — 12 routes is below react-router complexity threshold |
| 5 | Mica + CSS backdrop-filter 双轨 | ✅ Keep with caveat — Mica depends on DWM, fallback CSS for compatibility |
| 6 | Tauri release build = `--features tauri/custom-protocol` | ✅ Keep — workaround for `tauri::generate_context!()` proc-macro behavior |
| 7 | Subagent 并发上限 4 | ✅ Keep — matches `general-purpose` agent memory budget |

Full reasoning in `m1-11-02-brainstorm.md` §2.

---

## Business flows analyzed (stage 4)

The business-flow stage walked 4 end-to-end user journeys:

1. **First-time launch** — empty state, splash → main window, theme
   detection, tray creation, autostart registration (first run only)
2. **Close button → tray → quit** — hide-to-tray + tray context menu
   + Cmd-Q / right-click quit + single-instance enforcement
3. **Autostart toggle** — registry (Win) / LaunchAgent (Mac) write
   + immediate生效 verification
4. **Window resize → scroll behavior** — html/body reset +
   min-h-0 + main absolute positioning (M1.9.3 fix)

All 4 flows pass review. Detailed lifecycle diagrams in
`m1-11-04-business-flow.md`.

---

## Risk register (from M1.12-final-audit §3)

P0 (must fix before M2 launch):
- None (M1.11-fix closed all)

P1 (should fix in M2.1):
- HANDOFF.json drift (F-1.22)
- `applyEffects` uses `navigator.userAgent` instead of
  `tauri-plugin-os` (P-2)
- `tauri-plugin-positioner` not pinned (F-1.18)

P2 (M2+ candidates):
- All F-1.x / BP-x LOW items
- macOS platform impls (compile-only in M1.x)
- Tailwind adoption decision (deferred to M1.12, carried to M2)

---

## Migration checklist (M1 → M2)

From `m1-12-final-audit.md §5` (主 session 必读 before M2 kickoff):

- [x] M1-final-report.md accepted by user
- [x] M2-roadmap-draft.md reviewed
- [x] P0 P1 risk register resolved or queued
- [ ] Tailwind direction decided (deferred → M2.17+)
- [x] 12 plugin stubs ready for M2 implementation
- [x] HANDOFF.json regenerated (M2.1 actually)

---

*End of M1 review archive. M2 reviews live in
[`M2-REVIEWS.md`](M2-REVIEWS.md).*