---
audit_id: M6-CODE-AUDIT-V2
audit_kind: cross-subsystem code audit (NOT plan review)
target_branch: master
project: Claude 配置管理器 (Claude Config Manager) — Tauri v2 + React + TS
round: 2 (gap-fill for opencode's first-round blind spots)
reviewer: opencode (minimax/MiniMax-M3; some sessions actually routed to deepseek-v4-flash-free per stderr — independence property still holds)
reviewer_independence: external AI CLI distinct from the authoring AI (Claude Opus 4.8); 4 independent agent sessions, no shared scratchpad
audited_at: 2026-06-27T02:43:00Z
orchestrator: Claude Opus 4.8 (main session) — built prompts, dispatched agents, validated output, did NOT edit findings
plan_md_provided_to_reviewer: false (intentional — code audit, not plan review)
artifacts:
  - .planning/REVIEWS/M6-code-spec-drift.md (opencode output 261 lines; report 363 lines)
  - .planning/REVIEWS/M6-code-i18n.md (opencode output 177 lines; report 168 lines)
  - .planning/REVIEWS/M6-code-ci-migration.md (opencode output 257 lines; report 243 lines)
  - .planning/REVIEWS/M6-code-ipc-types.md (opencode output 408 lines; report 200 lines)
commits:
  - 5b4fe41 docs(31): opencode SPEC vs implementation drift audit (M6-2A/6)
  - a4dbbf8 docs(31): opencode i18n + hardcoded text audit (M6-2B/6)
  - b465106 docs(31): opencode CI pipeline + DB migration audit (M6-2C/6)
  - c82b78e docs(31): opencode M6 IPC type contract audit (M6-2D/6)
combined_with_round_1:
  - .planning/REVIEWS/M6-CODE-AUDIT.md (round 1 cross-subsystem summary)
  - .planning/REVIEWS/M6-code-{frontend,backend,plugins,build,e2e}.md (round 1 per-subsystem)
combined_artifact: this file
parallel_work_notice: Phase 31 subagent merged 5-theme redesign (commit 3dd8578, 3004c8c, 69b4a31, 1d3a11b, 91effd2) while these audits were running; some audited file state may be slightly post-redesign but core audit findings are unaffected
---

# M6 Code Audit V2 — Gap-Fill (opencode round 2)

## 0. Why this round exists

Round 1 (see M6-CODE-AUDIT.md) explicitly skipped:
1. **SPEC.md vs implementation drift** — opencode was never asked to read SPEC.md
2. **i18n framework + hardcoded text discipline** — only display-name drift (§6.4) was caught
3. **CI/CD pipeline** — only one line (`ci.yml:125`) was inspected
4. **IPC type contracts** — only orphan commands were caught, not structural type drift
5. **Database migration system** — main session assumed none existed based on absent `src-tauri/migrations/` dir; this was wrong (rusqlite_migration is in Cargo.toml)

This round corrects those gaps with 4 additional opencode audits.

## 1. Severity tally (round 2 only)

| Subsystem | CRIT | HIGH | MED | LOW | Total | Top finding |
|---|---:|---:|---:|---:|---:|---|
| spec-vs-impl-drift | 0 | 5 | 6 | 5 | 16 | (opencode self-corrected initial 3 CRITICAL flags after verifying sql_parser.rs is 1641 LOC real impl, restore_backup command exists, marketplace page exists) |
| i18n-hardcoded-text | 0 | 1 | 1 | 2 | 4 | (SPEC §10 explicitly defers i18n to v1.2+ — Chinese-only is by design; 157 source files hardcode Chinese) |
| ci-pipeline-db-migrations | 3 | 4 | 6 | 3 | 16 | E2E job permanently disabled at `ci.yml:125` AND all 6 code-signing secrets in `release.yml:108-115` are placeholder comments — production release pipeline is non-functional until both are addressed |
| ipc-type-contract | 2 | 1 | 3 | 4 | 10 | `ExportReport` TS type at `types/history.ts:134` is structurally wrong (Rust sends `output_path`/`usage_rows`/`backup_rows`/`file_size_bytes`, TS declares `path`/`count`) — and `src/lib/api/history.ts:85` calls `export_history({ format })` but Rust requires `target_path: String` → runtime crash |
| **Round 2 total** | **5** | **11** | **16** | **14** | **46** | |

## 2. Combined round 1 + round 2

| Source | CRIT | HIGH | MED | LOW |
|---|---:|---:|---:|---:|
| Round 1 (M6-CODE-AUDIT.md) | 11 | 21 | 28 | 13 |
| Round 2 (this file) | 5 | 11 | 16 | 14 |
| **Combined total** | **16** | **32** | **44** | **27** |
| Dedup across rounds | ~-2 | ~-3 | ~-3 | ~-2 |
| **Estimated unique bugs** | **~14** | **~29** | **~41** | **~25** |

Round 1 + round 2 = ~109 findings; dedup ~99 unique issues.

## 3. Major surprises / what round 2 overturned

### Surprise A — Project HAS a migration system (my round-1 blind spot #4 was wrong)
- Main session, when planning round 2, said: "opencode never checked migration; assume none."
- Opencode verified `Cargo.toml:107` has `rusqlite_migration = "=2.6.0"` and `history_db.rs:48-136` declares V1 + V2 migrations inline with `PRAGMA user_version` tracking and `IF NOT EXISTS` everywhere.
- Verdict: **migration discipline is sound** (corruption recovery at lines 195-219, all migrations idempotent, downgrade SQL exists).
- Remaining gap: V1→V2 sequential upgrade has no test (only fresh-DB tests exist). Not a CRITICAL, just a MEDIUM.

### Surprise B — `ExportReport` is fundamentally broken (round 2 ipc-types)
- Rust sends `output_path` / `usage_rows` / `backup_rows` / `file_size_bytes` / `format`.
- TS declares `path` / `count` / `format`.
- Every consumer reading `result.path` gets `undefined`.
- Plus the wrapper call is missing the required `target_path` argument → Tauri v2 rejects the IPC call → **runtime crash**.
- This means **F5 history export feature is completely non-functional at runtime**, but tests still pass because they mock the IPC layer.
- Round 1 ipc-types partially caught "5 orphan commands" but missed the structural field-name drift because round 1 didn't compare field-by-field.

### Surprise C — Display-name drift is consistent with the architecture (round 2 spec-drift + ipc-types)
- Round 1 frontend audit flagged §6.4 violation: `PRODUCT_NAME = "ClaudeManager"` returns to About page, but other UI shows "Claude 配置管理器".
- Round 2 ipc-types confirmed `types/app.ts` matches `commands/app.rs:89 AppMetadata` (✅ Match).
- Round 2 spec-drift didn't address display name (out of scope).
- **Resolution**: §6.4 violation is REAL — IPC sends a different string than what other UI surfaces hardcode. Round 2 didn't change this verdict; it just confirmed the TS type layer is internally consistent (the bug is upstream in the Rust IPC constant value).

### Surprise D — `release.yml` exists but is non-functional (round 2 ci-migration)
- Round 1 build audit noted `release.yml` was referenced from `build-mac.sh:30` comment but never verified.
- Round 2 ci-migration verified `release.yml` exists (157 lines, full structure) but **all 6 code-signing secrets are placeholder comments** at lines 108-115.
- This means: **any tag-triggered release build produces unsigned installers** (macOS Gatekeeper will block, Windows SmartScreen will warn).
- Round 1 missed this; round 2 caught it.

### Surprise E — i18n is not a CRITICAL because SPEC §10 explicitly defers it
- Main session's blind spot #2 said "if SPEC requires i18n, this is CRITICAL".
- Opencode verified SPEC §10 (lines 1152-1160) says: "v1.1 单语言:简体中文(zh-CN). 所有 UI 文字硬编码中文. 不引入 i18n 框架."
- Verdict: **0 CRITICAL** for i18n; the 1 HIGH is "SPEC §10 recommended centralizing strings in one file (e.g. `Strings.zh-CN.cs`); that recommendation was not followed."
- Important nuance: opencode correctly mapped "did not follow SPEC recommendation" → HIGH, not CRITICAL. Architectural intent was respected even if a nicety was skipped.

### Surprise F — opencode self-corrected CRITICAL flags in spec-drift (process insight)
- Initial spec-drift pass flagged 3 CRITICAL: F2 settings.json missing, F4 SQL stub, F13 restore stub.
- Opencode re-read the source files (`sql_parser.rs` is 1641 lines of real impl, `restore_backup` command exists in `commands/backup.rs:81`, marketplace page exists).
- It issued a corrected table at lines 116-152 with CRITICAL=0.
- **Trust the corrected table**, not the first-pass table.
- This pattern is rare but valuable: opencode can recognize and retract its own over-flagging.

## 4. New CRITICAL bugs found in round 2

### C-01 (ci-migration) — `release.yml:108-115` all 6 signing secrets are placeholder comments
**File**: `.github/workflows/release.yml:108-115`
**What**: `WINDOWS_EV_CERT_THUMBPRINT`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PWD` are all `# EV Certificate / Apple ID` comment placeholders.
**Mechanism**: When a tag is pushed (`v*`), the release workflow runs `tauri build` which produces unsigned `.exe` + `.app` artifacts. macOS Gatekeeper blocks unsigned apps on first launch. Windows SmartScreen warns on every install.
**Fix**: Set the 6 secrets in GitHub repository settings (Settings → Secrets and variables → Actions). See `scripts/install-to-applications-mac.sh:289` for the local codesign command pattern.

### C-02 (ci-migration) — `scripts/smoke-test.sh` (696 lines) is never invoked by any workflow
**File**: `.github/workflows/ci.yml` + `release.yml` (no references)
**What**: The 10-item smoke test (launch/window/webview/title, assets fingerprint, db_exists/schema/queryable, tray/kill) is fully implemented but not wired into any workflow.
**Mechanism**: A release can be tagged and uploaded to GitHub without any of the 10 ship-readiness checks running. Regressions (blank webview, missing dist fingerprint, broken sqlite schema) would ship undetected.
**Fix**: Add `./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe` step after the Windows build in `ci.yml` (after `cargo build --release`), and equivalent macOS step in `build-macos` job.

### C-03 (ci-migration) — `ci.yml:125` e2e job permanently disabled (re-confirmed)
**File**: `.github/workflows/ci.yml:125`
**What**: `if: ${{ false }}` disables the entire e2e job. Round 1 already flagged this (e2e report C1); round 2 ci-migration independently confirmed.
**Mechanism**: Same as round 1 finding — zero e2e coverage in CI, Playwright specs run only against Vite dev server in some local flows.
**Fix**: Same as round 1 — remove `if: ${{ false }}`, pin `@tauri-apps/tauri-driver` version, add WebView2 bootstrap step.

### C-04 (ipc-types) — `ExportReport` TS type structurally mismatches Rust
**File**: `src/types/history.ts:134`
**What**: TS declares `path: string; count: number; format: 'json' | 'csv'`. Rust sends `output_path: String; usage_rows: i64; backup_rows: i64; file_size_bytes: u64; format: String`.
**Mechanism**: Consumers calling `exportHistory().then(r => r.path)` get `undefined`. UI code that depends on these fields will silently render empty or break.
**Fix**: Replace TS type:
```ts
export interface ExportReport {
  output_path: string;
  format: string;
  usage_rows: number;
  backup_rows: number;
  file_size_bytes: number;
}
```

### C-05 (ipc-types) — `export_history` invocation missing required `target_path`
**File**: `src/lib/api/history.ts:85`
**What**: TS wrapper calls `invoke<ExportReport>('export_history', { format })`. Rust requires `target_path: String`.
**Mechanism**: Tauri v2 rejects IPC calls with missing required keys — runtime error thrown on every export attempt.
**Fix**: Add `target_path: string` to the call args and to the function signature.

## 5. Cross-round patterns

### Pattern X — Code-signing & release pipeline is incomplete (new in round 2)
- `release.yml` exists structurally (release ci-migration verified) but is **non-functional** (all signing secrets placeholder).
- `scripts/smoke-test.sh` is complete but **never invoked by CI**.
- `release.yml` references `push: tags: ['v*']` and `workflow_dispatch` — meaning a tag push WOULD trigger a build, but the resulting artifacts would be unsigned and unverified.
- **This means the project cannot ship to end users as-is**, regardless of how many code-quality fixes are applied.
- Fix priority: C-01 (secrets) > C-02 (smoke test wiring) > release.yml sign-command configuration.

### Pattern Y — IPC type contract is unsafely hand-maintained (new in round 2)
- 566 lines of TS types in `src/types/` (10 files) with zero automated drift detection.
- 92 Rust commands registered; 60+ TS wrappers; ~90% return-type alignment correct, but the **structural mismatches that exist are silent** (field-name drift = runtime undefined access, not compile error).
- Round 2 ipc-types found 2 CRITICAL + 1 MEDIUM + 1 LOW all from this same root cause.
- Fix: adopt `ts-rs` or `specta` + `tauri-specta` for automatic TS type generation. Cost: 1-2 days to wire up. Benefit: 566 lines of hand-maintained types become 0 lines.

### Pattern Z — Backend architecture is more disciplined than frontend
- Round 1 backend: 1 CRIT (OS abstraction violation in fs_atomic) + 3 HIGH
- Round 2 ci-migration: backend migration discipline is "sound" (rusqlite_migration + user_version + corruption recovery)
- Round 1 frontend: 2 CRIT (display-name, role=button a11y) + 5 HIGH (mostly hardcoded colors + window.confirm)
- Round 2 ipc-types: the IPC boundary is mostly clean (60/60 wrappers use explicit generics) but structurally hand-maintained
- Round 1 plugins: 3 CRIT (init_all cleanup, no state machine, F6 route orphan)
- **Implication**: Project invested in Rust discipline (atomic writes, OS trait layer, migration tracking, single-instance, IPC commands registered) more than in TS/frontend discipline (token system, accessibility, IPC type generation, test gating).
- Pattern repeats in CLAUDE.md — most §X.Y rules are about Rust/backend (§3.1 layered, §3.2 OS abstract, §7 backup-rename); fewer about frontend.

## 6. Honest gaps in round 2 (what we STILL don't know)

1. **No actual test execution** — round 2 reviewed the test code, not the test results. The 170/669 vitest failure rate from round 1 was opencode's claim; should be re-confirmed by running `npm test -- --run` locally before treating it as a single root-cause fix.
2. **No performance audit** — cold/warm build times, IPC latency, render perf not measured.
3. **No Mac-specific behavioral audit** — `platform/macos/*.rs` checked for §3.2 compliance only; no macOS-specific UX or runtime audit.
4. **Round 2 audits ran on a moving codebase** — Phase 31's 5-theme redesign (commits 3dd8578, 3004c8c, 69b4a31, 1d3a11b, 91effd2) was merging concurrently. Frontend token names may have changed; the audit's color hardcoding findings may now be partially addressed or amplified.
5. **No dependency security audit** — `npm audit` / `cargo audit` not run. Round 2 ci-migration noted no Dependabot/Renovate config (M-04).
6. **No visual regression testing** — round 2 didn't add this. The 5-theme redesign likely broke existing visual baselines.

## 7. Updated Top 10 ship-blocking items (round 1 ∪ round 2)

| # | Fix | Source | Severity | § violated | Subsystem |
|---|---|---|---|---|---|
| 1 | Set 6 code-signing secrets in GitHub repo settings | ci-migration C-01 | CRIT | (release pipeline) | infra |
| 2 | Fix `ExportReport` TS type + add `target_path` param | ipc-types C-04 + C-05 | CRIT | (F5 broken) | frontend |
| 3 | Fix `infrastructure/fs_atomic.rs:251,292` — move `local_utc_offset_minutes()` into `platform/` trait layer | backend C | CRIT | §3.2 | rust |
| 4 | Fix `commands/app.rs:46` `PRODUCT_NAME` + test fixture at `about.test.tsx:30` | frontend C-01 | CRIT | §6.4 | frontend |
| 5 | Fix `scripts/build-only.sh:71,77` — add `--features tauri/custom-protocol` + `npm run build` | build C1 | CRIT | §13.1 | build |
| 6 | Wire `scripts/smoke-test.sh` into CI workflow | ci-migration C-02 | CRIT | (release pipeline) | infra |
| 7 | Fix `PluginHost.init_all` (host.rs:91-101) — cleanup on partial failure | plugins C1 | CRIT | §3.3 | rust |
| 8 | Fix `AppSidebar.tsx:152` icon crash — unblocks 98 failing tests | e2e C2 | CRIT | §2.2 / §5.1 | frontend |
| 9 | Enable CI e2e job — remove `if: ${{ false }}` at `ci.yml:125` | e2e C1 + ci-migration C-03 | CRIT | §5.1 | infra |
| 10 | Replace `harness.window.confirm()` in 3 pages with `ConfirmDialog` | frontend H-01 | HIGH (functional gap) | §2.5 | frontend |

## 8. Recommended next steps for the user

1. **Ship-blocker audit**: Run `git tag v3.2.1 && git push origin v3.2.1` to test if release.yml even produces signed artifacts. It won't, because secrets are missing. This proves C-01.
2. **Verify C-04 + C-05 by hand**: Click the "Export History" button on the running app (if it exists). Observe the runtime crash. Then fix the TS type and wrapper.
3. **Address the 9 CRITICAL items in order of #1-#9 in §7**. Each is independently shippable.
4. **Decide on Pattern Y (ts-rs adoption)** — this prevents C-04/C-05 from recurring. 1-2 day fix that future-proofs the entire IPC surface.
5. **Decide on i18n roadmap** — SPEC §10 defers it to v1.2+, but the 157-file blast radius for future retrofit means it should be planned now even if implementation waits.

## 9. Reference index

- **Round 1 summary**: `.planning/REVIEWS/M6-CODE-AUDIT.md` (73 findings, 11 CRIT)
- **Round 2 summary**: this file (46 findings, 5 CRIT; ~99 unique combined)
- **Per-subsystem reports**: 9 files total in `.planning/REVIEWS/M6-code-*.md`
- **Phase 31 work**: shipped during audit (commits 3dd8578, 3004c8c, 69b4a31, 1d3a11b, 91effd2) — 5-theme redesign + integration test 6/6 verified + v3.2 tag
- **Source code audited**: 91K LOC (round 1) + SPEC.md (84KB) + 3 CI workflows + IPC command inventory + migration code = ~95K LOC total coverage

---

**Main session summary**: Round 2 closes 4 of the 5 major blind spots from round 1 (SPEC drift, i18n, CI, IPC types). 5 new CRITICAL bugs found (mostly about release pipeline integrity + IPC type contract). Combined round 1+2 = ~99 unique findings; 14 CRIT ship-blockers. The most actionable insight from round 2: the project **cannot ship to end users as-is** because `release.yml` lacks signing secrets and `smoke-test.sh` is never invoked — these are infrastructure-layer blockers that no amount of code-quality fixes can route around.