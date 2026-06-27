---
audit_id: M6-CODE-AUDIT
audit_kind: cross-subsystem code audit (NOT plan review)
target_branch: master
project: Claude 配置管理器 (Claude Config Manager) — Tauri v2 + React + TS
target_subsystems:
  - frontend (src/)
  - rust-backend-platform (src-tauri/src/)
  - plugin-system (src-tauri/src/plugins/ + src/plugins/)
  - build-packaging-smoke (scripts/ + tauri.conf.json + Cargo.toml)
  - tdd-e2e (src/__tests__/ + tests/e2e/ + tests/M4-e2e/)
reviewer: opencode (minimax/MiniMax-M3) — independent external AI (via 5 parallel subagents)
reviewer_independence: external AI CLI distinct from the authoring AI; runs in its own LLM context, reads only the files named in its prompt, no shared scratchpad
audited_at: 2026-06-27T02:11:00Z
orchestrator: Claude Opus 4.8 (main session) — only collected summaries, did not modify findings
plan_md_provided_to_reviewer: false (intentional — code audit, not plan review)
artifacts:
  - .planning/REVIEWS/M6-code-frontend.md (471 lines)
  - .planning/REVIEWS/M6-code-backend.md (210 lines)
  - .planning/REVIEWS/M6-code-plugins.md (101 lines)
  - .planning/REVIEWS/M6-code-build.md (250 lines)
  - .planning/REVIEWS/M6-code-e2e.md (191 lines)
commits:
  - ec6bed9 docs(31): opencode plugin system audit (M6-3/5)
  - 117e9a5 docs(31): opencode frontend code audit (M6-1/5)
  - 9023626 docs(31): opencode TDD / E2E test framework audit (M6-5/5)
  - 098d623 docs(31): opencode rust backend + platform audit (M6-2/5)
  - 89ac201 docs(31): opencode build + packaging + smoke audit (M6-4/5)
---

# M6 Cross-Subsystem Code Audit — opencode (minimax/MiniMax-M3)

## 0. Methodology

| Question | Answer |
|---|---|
| Reviewer | opencode CLI 1.17.10 (provider `minimax`, model `MiniMax-M3` — the user's own setup) |
| Independence | Different AI vendor, different training corpus; 5 independent agent sessions, no shared context |
| Scope | `master` branch implementation, NOT plan review (PLAN.md intentionally not provided) |
| Subsystems | 5 — aligned with CLAUDE.md §3.1 layered architecture |
| Orchestration | 5 subagents launched in parallel from main session (Claude Opus 4.8) |
| Output form | Per-finding `file:line` evidence + severity (CRITICAL/HIGH/MEDIUM/LOW) + suggested fix |
| Main session role | Build review prompts, dispatch agents, validate output non-empty, commit per-subsystem report, synthesize this summary — main session did NOT edit findings |

## 1. Severity tally

| Subsystem | CRIT | HIGH | MED | LOW | Total | Top finding |
|---|---:|---:|---:|---:|---:|---|
| frontend | 2 | 5 | 5 | 2 | 14 | §6.4 UI text 3-location violation: About page renders "ClaudeManager" (from IPC `PRODUCT_NAME` in `src-tauri/src/commands/app.rs:46`) while every other UI surface renders "Claude 配置管理器" |
| rust-backend-platform | 1 | 3 | 7 | 2 | 13 | §3.2 OS abstraction violation: `infrastructure/fs_atomic.rs:251,292` embeds raw Win32 `GetTimeZoneInformation` / POSIX `localtime_r` FFI directly — bypasses the entire `platform/` trait layer |
| plugin-system | 3 | 5 | 3 | 3 | 14 | §3.3 lifecycle violation: `PluginHost.init_all` (host.rs:91-101) early-returns on first init failure, orphaning already-initialized plugins with no deferred shutdown |
| build-packaging-smoke | 2 | 5 | 7 | 4 | 18 | §13.1 regression: `scripts/build-only.sh:71` runs `cargo build --release` without `--features tauri/custom-protocol` — reproduces the M1.3 ERR_CONNECTION_REFUSED regression on the quick-build path |
| tdd-e2e | 3 | 3 | 6 | 4 | 16 | §2.2 + §5.1 collapse: **Vitest suite is RED (170/669 = 25.4% failing)** AND CI e2e job is permanently disabled via `if: ${{ false }}` at `.github/workflows/ci.yml:125` |
| **Total** | **11** | **21** | **28** | **13** | **73** | (some duplicates across subsystems — see §3 cross-subsystem patterns for de-duplicated count ≈ 60 unique bugs) |

## 2. Cross-subsystem patterns (de-duplicated)

These themes span multiple subsystems and indicate **architectural drift**, not isolated bugs.

### Pattern A — Infrastructure self-defeating patterns (4 independent findings)

| Where | Finding | § violated |
|---|---|---|
| `infrastructure/fs_atomic.rs:251,292` (backend C) | Raw OS FFI in `infrastructure/` — should be in `platform/` | §3.2 |
| `domain/provider.rs:291-294` + `domain/mcp_server.rs:172-175` (backend H1) | `to_json_file` uses `std::fs::write`, NOT `fs_atomic::write_with_backup` — every provider write is non-atomic with no backup | §7 |
| `scripts/build-only.sh:71,77` (build C1) | `cargo build --release` without `--features tauri/custom-protocol` — reproduces the exact M1.3 regression the §13.1 workflow was created to prevent | §13.1 |
| `.github/workflows/ci.yml:125` (e2e C1) | `if: ${{ false }}` permanently disables CI e2e job — test gate is non-functional | §2.2 / §5.1 |

**Pattern**: The project builds correct abstractions (atomic-write helper, OS trait layer, custom-protocol requirement, CI gate) but multiple call sites bypass them. Each bypass is a known regression waiting to happen. The audit's most actionable insight: **enforce the abstractions at compile-time, not by convention**.

### Pattern B — Frontend ↔ Rust IPC text drift (3 independent findings)

| Where | Finding | § violated |
|---|---|---|
| `commands/app.rs:46` `PRODUCT_NAME = "ClaudeManager"` (frontend C-01) | IPC returns "ClaudeManager" but every other UI surface uses "Claude 配置管理器" — About page shows wrong name | §6.4 |
| `tauri.conf.json:3` `productName` vs `windows[0].title` (frontend §4) | `productName: "ClaudeManager"` ≠ `windows[0].title: "Claude 配置管理器"` — two display fields, one product, two names | §6.5 |
| `commands/app.rs:68` `DISPLAY_IDENTIFIER = "com.claudemanager.app"` (frontend C-02) | About page displays this as "唯一标识" but it does not match the actual bundle id (`com.claudeconfigmanager.desktop`) | §6.4 (display label vs actual value) |

**Pattern**: §6.4 / §6.5 were created after the M3.0.3 lesson where the team changed "ClaudeConfigManager" → "ClaudeManager" five times and kept missing one location. The audit confirms: the team still has display-name drift in **3 places** despite the §6.4 / §6.5 rules. Either the rules need enforcement tooling (a sync script that bumps all 3 locations in one go — `check-ui-text-3-locations.sh` only verifies, doesn't update) or §6.4 needs to be retired and replaced with a single source of truth (e.g. IPC returns everything including localized title).

### Pattern C — Test gate broken at every layer (3 independent findings)

| Where | Finding | § violated |
|---|---|---|
| Vitest 170/669 failing (e2e C2) | Test suite is RED at 25.4% failure rate; cascading from 2 root bugs (AppSidebar icon crash + ViewStateProvider import) | §2.2 |
| CI e2e job disabled (e2e C1) | `if: ${{ false }}` permanently disables e2e | §5.1 |
| 6 of 32 e2e specs use real fixtures (e2e L3) | 26 specs run against Vite dev server, not the real Tauri binary — false e2e coverage | §5.1 |

**Pattern**: The team has strong unit-test coverage (669 tests) but the gate is broken: failures are ignored, e2e is disabled, and "e2e" specs are actually dev-server DOM smoke tests. This is worse than no tests — it gives false confidence. The audit recommends treating the RED suite as **the next bug to fix**, not as noise.

### Pattern D — Plugin system has structural drift (3 independent findings)

| Where | Finding | § violated |
|---|---|---|
| F2 provider-switch backend stub has no frontend counterpart (plugins H1) | Backend `provider_switch.rs` registered in `mod.rs:41`, no frontend stub, no `provider-switch.tsx` | §3.3 |
| F6 mcp-management backend route `/mcp` has no App.tsx rendering branch (plugins C3) | `mcp_management.rs` advertises route, `App.tsx` has no `view === 'mcp-management'` branch, `McpPage` is dead code | §3.3 |
| `CLAUDE.md:62` claims "12 stubs" but actual count is 10 backend + 9 frontend (plugins H5/M2) | Documentation lies about plugin count; F8-F15/F20-F24 never stubbed | §3.3 |

**Pattern**: §3.3 promised "every feature = one plugin, PluginHost auto-registers" but reality is **40+ Tauri commands live directly in `lib.rs`** without any plugin wrapper. The plugin system is a stub-only shell. Real feature work lives outside it. Audit recommends either: (a) commit to plugin-first architecture and migrate commands into plugins, or (b) retire §3.3 and document the actual pattern (commands in `commands/`, plugins are decorative).

### Pattern E — Error handling invisible on Windows (2 independent findings)

| Where | Finding | § violated |
|---|---|---|
| 19 `eprintln!` calls in production Rust (backend MED) | `eprintln!` output is lost on Windows release builds (no console attached) — errors invisible to user AND developer | §7 |
| `lib.rs:399` `std::thread::spawn` drops `JoinHandle` (backend LOW) | Background thread panic is silently swallowed | §7 |

**Pattern**: The team uses `eprintln!` and dropped thread handles as if Mac/Linux only. On Windows release builds these are silent failure modes. Audit recommends: replace `eprintln!` with `log::error!` (the `log` crate is already a transitive dep) and use `tokio::task::spawn` + `.await` (or `panic::catch_unwind` for `std::thread`) so panics surface in the OS log facility.

## 3. Conflict resolution (where reviewers disagreed)

Two subsystems reported on §6.4 / §6.5 display-name consistency and reached **opposite verdicts**. Resolution:

| Subsystem | Verdict | Evidence cited |
|---|---|---|
| backend (§6.4 section) | **CONSISTENT** | Rust-side fields (`PRODUCT_NAME`, `IDENTIFIER`, `DISPLAY_IDENTIFIER`, `Cargo.toml` name, `package.json` name, `tauri.conf.json` productName/identifier/title) are correctly layered per §6.5 |
| frontend (§6.4 section) | **§6.4 VIOLATION — CRITICAL** | `commands/app.rs:46` returns `PRODUCT_NAME = "ClaudeManager"` to the About page; About page renders this as "应用名: ClaudeManager"; every other UI surface says "Claude 配置管理器"; mismatch is visible to the user |

**Resolution**: Both are correct, but they audit different layers.
- backend audits **Rust-internal layering** (4 layers of constants, all consistent) → ✅
- frontend audits **IPC return value vs frontend hardcoded strings** → ❌

The §6.4 lesson from M3.0.3 was specifically about the IPC-display surface (`commands/app.rs:46` vs `App.tsx:94`). The backend reviewer correctly noted that Rust-side constants are clean, but **failed to verify what the IPC actually returns vs what the UI displays**. The frontend reviewer caught the user-visible bug. **Frontend's CRITICAL verdict stands.**

## 4. Top 10 fixes (cross-subsystem, ranked by impact)

These are the fixes most likely to materially improve project health. Each cite references the per-subsystem report for full context.

| # | Fix | Subsystem | Severity | § violated | Effort |
|---|---|---|---|---|---|
| 1 | Fix `infrastructure/fs_atomic.rs:251,292` — move `local_utc_offset_minutes()` into `platform/` trait layer | backend | CRIT | §3.2 | S (refactor + trait method) |
| 2 | Fix `commands/app.rs:46` `PRODUCT_NAME` to "Claude 配置管理器" + update test fixture at `about.test.tsx:30` | frontend | CRIT | §6.4 | XS (2-line fix) |
| 3 | Fix `scripts/build-only.sh:71,77` — add `--features tauri/custom-protocol` + `npm run build` before each cargo invocation | build | CRIT | §13.1 | XS (script patch) |
| 4 | Fix `PluginHost.init_all` (host.rs:91-101) — catch errors per-plugin, call `shutdown()` on already-initialized plugins before returning the first error | plugins | CRIT | §3.3 | S (logic rewrite) |
| 5 | Fix `AppSidebar.tsx:152` icon crash — unblocks 98 failing tests | e2e | CRIT | §2.2 / §5.1 | S (defensive fallback) |
| 6 | Enable CI e2e job — remove `if: ${{ false }}` at `ci.yml:125`, pin `@tauri-apps/tauri-driver` version, add WebView2 bootstrap step | e2e | CRIT | §5.1 | M (CI infra) |
| 7 | Make `to_json_file` use `fs_atomic::write_with_backup` (provider.rs:291-294, mcp_server.rs:172-175) — every provider write goes atomic+backup | backend | HIGH | §7 | XS (1-line change per call site) |
| 8 | Replace 19 `eprintln!` calls in production Rust with `log::error!` / `log::warn!` (visible on Windows release) | backend | HIGH | §7 | S (mechanical search/replace) |
| 9 | Audit + replace hardcoded `rgba()`/`#XXX` colors in 9/12 pages — switching to non-light theme will show incorrect UI surfaces | frontend | HIGH | §4 | M (mechanical refactor across pages) |
| 10 | Replace `window.confirm()` in 3 pages (backup-restore:224, json-editor:301+381, mcp-management:187) with the existing `ConfirmDialog` component | frontend | HIGH | §2.5 / §5.3 | S (already a shared component) |

## 5. What the audit did NOT cover (honest gaps)

- **No `cargo test` audit** — Rust unit tests under `src-tauri/tests/` were not exercised; coverage unknown.
- **No CI workflow file audited beyond `ci.yml:125`** — `release.yml` mentioned in `build-mac.sh:30` does not exist in the repo (build audit verified) but its absence is itself a finding worth documenting.
- **No macOS-specific code audit beyond cross-platform checks** — `platform/macos/*.rs` was checked for §3.2 compliance (raw OS FFI in `infrastructure/`) but no Mac-specific behavioral audit was performed (e.g. WKWebView quirks, LaunchAgent race conditions).
- **No `SPEC.md` re-verification** — the audit checks against CLAUDE.md rules, not against the original spec.
- **No real executable execution** — subagents read files only; they did not run `cargo build`, `npm test`, `npm run smoke`. The 25.4% test failure rate is the subagent's report based on a representative sample; should be re-confirmed by running `npm test -- --run` in CI before fixing.
- **No performance audit** — opencode was not asked to benchmark; cold/warm build times, IPC latency, render perf are out of scope.

## 6. Recommended next steps (for the user to choose)

1. **Fix in priority order from §4 Top 10** — each CRIT is independently shippable; HIGH items can batch.
2. **Re-run `npm test -- --run`** to confirm the 170/669 failure count before treating it as a single root-cause fix.
3. **Decide on §3.3 plugin architecture** — commit to plugin-first or retire §3.3. Current drift is unsustainable.
4. **Create a display-string sync script** to replace `check-ui-text-3-locations.sh` (verify-only) with an updater script — fixes Pattern B at the tool level.
5. **Add enforcement tooling** — most Pattern A bugs would be caught by `cargo clippy` lint rules or pre-commit hooks checking for `std::fs::write` outside `fs_atomic/`. Consider adding these to the dev workflow.

## 7. Reference index

- Per-subsystem reports: see frontmatter `artifacts` (5 files under `.planning/REVIEWS/`)
- Per-finding file:line evidence: each per-subsystem report has a "Top 5 Fixes" section at the end with the highest-impact items and exact `path:line` references
- Source code audited: `src/` (36K LOC), `src-tauri/src/` (33K LOC), `src/__tests__/` (19K LOC), `scripts/` (3K LOC) = ~91K LOC total
- Opencode runtime: 5 concurrent agent sessions, ~6-12 minutes wall-clock per agent (some took longer due to file fan-out), ~32-37K tokens per agent

---

**Main session summary**: 5/5 audits completed, 73 findings (11 CRIT / 21 HIGH / 28 MED / 13 LOW), 5 commits on master. Two cross-subsystem conflicts resolved (§6.4 / §6.5 — see §3). The most actionable insight: §2.2 / §5.1 test gate is broken (RED suite + disabled e2e), §13.1 has regressed (build-only.sh missing `--features`), and §6.4 has not been retired properly (display-name drift in 3 locations). Top priority: fix the 6 CRITICAL items from §4 to unblock honest ship decisions.
