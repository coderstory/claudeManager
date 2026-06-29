# VERIFICATION-A4: Config optimizer "未知规则: <id>"

> Re-verification per CLAUDE.md §16 Bug Fix Protocol (2026-06-29).
> Branch: `verify-a4-optimizer` @ commit `6299376` (off `84eb979`).

---

## 1. Problem Details (§16 Step 1)

- **Bug ID**: A4 (per `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md` §1)
- **Symptom**: User clicks per-row "Fix" button on the optimizer page → backend rejects with `未知规则: <id>` even though the rule_id matches a registered rule.
- **Operation path**: `src/pages/optimizer/index.tsx` → `handleFixOne(ruleId)` → `applyRuleFix(ruleId)` → `invoke('apply_rule_fix', { ruleId })` → Rust dispatch layer → `OptimizerService::apply_rule_fix`.
- **Pre-conditions**: User has clicked Scan on the optimizer page; at least one auto-apply finding is rendered; user clicks per-row Fix.
- **Expected**: Backend runs the rule's apply for the matching finding, returns `Vec<ApplyResult>`, UI flips status to "applied".
- **Actual (pre-a6cfb3b)**: Backend reads empty string for rule_id, falls into the unknown-rule branch, returns `Err("未知规则: ")`.
- **Trigger condition**: Every Fix click — the bug is deterministic.
- **Impact**: Per-row Fix button completely broken; batch "Apply All Auto-Fix" path was unaffected because it uses different arg (`findingIds`).

---

## 2. Root Cause (§16 Step 2)

### Commit `a6cfb3b` (shipped 2026-06-29) — the actual fix

**File:** `src-tauri/src/plugins/stubs/optimizer/commands.rs:165-180` (originally) → refactored to `:90-105` + `:172-180` in this verification.

**Root cause:** The dispatch layer's payload read used `payload_str(&invoke, "rule_id")` (snake_case). The frontend `applyRuleFix` wrapper (`src/lib/api/optimizer.ts:44-46`) sends `invoke('apply_rule_fix', { ruleId })` — camelCase, because Tauri's default IPC convention uses the parameter name verbatim as the JSON key. The result was an empty string in the dispatch layer, which the service then reported as "unknown rule".

**Sibling evidence**: The same file's `dispatch_apply_optimizations` (lines 116-167) correctly reads `findingIds` (camelCase) — matching its frontend caller `applyOptimizations(findingIds)`. So the dispatcher convention was inconsistent before a6cfb3b — A4 was the lone snake_case holdout.

**Fix**: Read `ruleId` first (current frontend), fall back to `rule_id` (legacy bundles). Implemented in two steps:
- a6cfb3b: Inline 8-line ternary in `dispatch_apply_rule_fix`.
- This verification (6299376): Extracted to `extract_rule_id_from_payload(&Value)` pure helper for unit-testability.

---

## 3. Scope (§16 Step 3)

### Files affected by this verification commit (6299376)

| File | Lines changed | Reason |
|---|---|---|
| `src-tauri/src/plugins/stubs/optimizer/commands.rs` | +111 / -13 | Refactor to pure helper + 6 new unit tests |
| `src/__tests__/pages/optimizer.test.tsx` | +39 / 0 | New UI error-handling test |

**Total: 2 files** — well within CLAUDE.md §2.4 (≤2 files needs no whitelist).

### Files relevant to original a6cfb3b fix (already shipped)

| File | Change |
|---|---|
| `src-tauri/src/plugins/stubs/optimizer/commands.rs` | Inline ternary reading `ruleId` first |

### Out-of-scope (mentioned but NOT changed)

The verification checklist §3.1 flags 4 sites with `ANTHROPIC_AUTH_TOKEN`-only reads:
- `src-tauri/src/commands/usage.rs:60` (usage fingerprint)
- `src-tauri/src/plugins/stubs/usage_query/commands.rs:92` (usage query)
- `src-tauri/src/infrastructure/optimizer_rules.rs:144` (ORPHAN_PROVIDER rule scan)
- `src-tauri/src/commands/providers.rs:580` (write path — intentionally only writes `ANTHROPIC_AUTH_TOKEN` because that's the legacy env name)

**Decision: out of scope for A4.** The A4 symptom (`未知规则: <id>`) is purely the camelCase/snake_case mismatch in `dispatch_apply_rule_fix`. The §3.1 env var issue is a SEPARATE bug class:
- Affects ORPHAN_PROVIDER scan producing false positives
- Affects usage query "active provider fingerprint"
- Does NOT cause the A4 symptom

These should be addressed separately (e.g., a new bug ID) by extracting a helper that checks both `ANTHROPIC_API_KEY` (current standard) and `ANTHROPIC_AUTH_TOKEN` (legacy alias), as already done in `services/provider_service.rs:1170-1180`.

---

## 4. Technical Options (§16 Step 4)

### Option A — Refactor to pure helper + add unit tests (CHOSEN)

**Pros:**
- Unit-testable without Tauri runtime + Webview state.
- Single source of truth for the camelCase/snake_case contract.
- Existing inline logic is preserved 1:1 (no behavior change).
- 6 new tests cover all edge cases (missing keys, both keys present, wrong type, empty string, legacy fallback).

**Cons:**
- Tiny refactor scope (extract 1 function + delete dead helper).
- Adds 1 indirection level (dispatch → helper → return).

### Option B — Keep inline ternary + add integration test only

**Pros:** No refactor; minimal diff.
**Cons:** Cannot unit-test camelCase resolution without spinning up Tauri runtime; tests would be end-to-end only.

### Option C — Refactor all 4 §3.1 sites + A4

**Pros:** Single PR fixes both A4 and the systemic env var inconsistency.
**Cons:** Scope creep (§2.4 — "禁止既然要改顺便把 X 也改了"); harder to verify one bug at a time; not what A4's symptom demands.

### Chosen: Option A

The A4 symptom is definitively the camelCase mismatch. Option A provides strong regression coverage with the smallest surface area.

---

## 5. Verification (§16 Step 5)

### 5.1 Frontend evidence (vitest)

#### Baseline (pre-this-commit, run against `84eb979`)
```
✓ src/__tests__/pages/optimizer.test.tsx (20 tests) 156ms
Test Files  1 passed (1)
Tests       20 passed (20)
```

#### After commit (6299376)
```
✓ src/__tests__/pages/optimizer.test.tsx (21 tests) 158ms
Test Files  1 passed (1)
Tests       21 passed (21)
```

**New test added:** `A4: apply_rule_fix rejection surfaces the fix-error banner (no silent swallow)` — verifies that when backend rejects with `未知规则: <id>` (the A4 symptom), the UI shows the fix-error InfoBanner and keeps the Fix button enabled.

The existing `per-row Fix button invokes apply_rule_fix and flips status to applied` test (lines 139-177 in the post-commit file) already locks the camelCase contract on the frontend side:
```ts
expect(calls[0][1]).toMatchObject({ ruleId: 'DEPRECATED_FIELD' });
```

### 5.2 Backend evidence (cargo test --lib)

#### Baseline (pre-this-commit, run against `84eb979`)
```
running 8 tests
test apply_rule_fix_env001_writes_zero_with_backup ... ok
test apply_rule_fix_unknown_rule_returns_empty ... ok
test apply_rule_fix_clean_settings_returns_empty ... ok
test env001_attribution_header_apply_atomic_with_backup ... ok
test env002_disable_nonessential_traffic_apply_atomic_with_backup ... ok
test env003_effort_level_max_apply_atomic_with_backup ... ok
test multi_rule_apply_each_gets_its_own_backup ... FAILED  (pre-existing, unrelated to A4)
test r005_deprecated_field_apply_atomic_with_backup ... FAILED  (pre-existing, unrelated to A4)
```

> The 2 failures are pre-existing fixture/content mismatches in `optimizer_fix.rs:343` and `:158`, **not regressions from this verification**. They affect batch apply path (`apply_findings`) and `r005_deprecated_field`, not the per-row Fix path (A4).

#### After commit (6299376) — unit tests for `extract_rule_id_from_payload`
```
running 9 tests
test plugins::stubs::optimizer::commands::tests::dispatch_fn_symbols_exist ... ok
test plugins::stubs::optimizer::commands::tests::extract_rule_id_missing_keys_returns_empty ... ok
test plugins::stubs::optimizer::commands::tests::extract_rule_id_prefers_camel_case_over_snake_case ... ok
test plugins::stubs::optimizer::commands::tests::extract_rule_id_snake_case_legacy_fallback ... ok
test plugins::stubs::optimizer::commands::tests::extract_rule_id_empty_string_is_not_a_hit ... ok
test plugins::stubs::optimizer::commands::tests::extract_rule_id_camel_case_wins ... ok
test plugins::stubs::optimizer::commands::tests::extract_rule_id_wrong_type_falls_through ... ok
test plugins::stubs::optimizer::commands::tests::dispatch_table_routes_optimizer_commands ... ok
test plugins::stubs::optimizer::commands::tests::inventory_registers_four_optimizer_commands ... ok
test result: ok. 9 passed; 0 failed
```

#### TDD RED evidence (broken impl, demonstrating tests catch the bug)

When the helper is temporarily broken to only read snake_case (the pre-a6cfb3b behavior):
```
running 6 tests
test extract_rule_id_missing_keys_returns_empty ... ok       (doesn't depend on A4)
test extract_rule_id_snake_case_legacy_fallback ... ok      (doesn't depend on A4)
test extract_rule_id_wrong_type_falls_through ... ok         (doesn't depend on A4)
test extract_rule_id_empty_string_is_not_a_hit ... ok        (edge case, doesn't depend on A4)
test extract_rule_id_camel_case_wins ... FAILED              ← catches the A4 bug
test extract_rule_id_prefers_camel_case_over_snake_case ... FAILED  ← catches the A4 bug

failures:
---- extract_rule_id_camel_case_wins stdout ----
left: ""
right: "ENV001"
---- extract_rule_id_prefers_camel_case_over_snake_case stdout ----
left: "DEPRECATED_FIELD"
right: "ENV002"
```

This is **exactly** the A4 bug: dispatch reads empty string → service reports `未知规则: <id>` to the user.

### 5.3 `cargo check --tests` after commit

```
warning: `claude-config-manager` (lib test) generated 4 warnings
Finished `test` profile
```

Only the same 4 pre-existing warnings (3 from `infrastructure/encoding.rs` and `plugins/service_registry.rs`); no new errors, no new warnings from this commit.

### 5.4 Integration test (`cargo test --test optimizer_fix`)

```
running 8 tests
test apply_rule_fix_unknown_rule_returns_empty ... ok
test apply_rule_fix_clean_settings_returns_empty ... ok
test apply_rule_fix_env001_writes_zero_with_backup ... ok
test env001_attribution_header_apply_atomic_with_backup ... ok
test env002_disable_nonessential_traffic_apply_atomic_with_backup ... ok
test env003_effort_level_max_apply_atomic_with_backup ... ok
test multi_rule_apply_each_gets_its_own_backup ... FAILED     (pre-existing)
test r005_deprecated_field_apply_atomic_with_backup ... FAILED  (pre-existing)
```

**3 of 3 A4-related integration tests pass.** The 2 pre-existing failures (`multi_rule_apply_each_gets_its_own_backup` and `r005_deprecated_field_apply_atomic_with_backup`) are fixture mismatches unrelated to A4 (they test the batch `apply_findings` path, not the per-row `apply_rule_fix` path).

---

## 6. Verdict

**A4 IS VERIFIED FIXED.**

| Evidence | Result |
|---|---|
| Frontend test (vitest) | 21/21 PASS |
| Backend unit tests (cargo test --lib) | 9/9 PASS |
| TDD RED proof (broken impl) | 2/6 tests FAIL — exactly the A4 bug |
| Integration tests for A4 path (cargo test --test optimizer_fix) | 3/3 A4-related PASS |
| `cargo check --tests` | No new errors |
| Root cause confirmed by code | `dispatch_apply_rule_fix` reads `ruleId` first, falls back to `rule_id` |
| Behavior matches user expectation | Yes — per-row Fix button resolves rule, applies, returns results |

The remaining `multi_rule_apply_each_gets_its_own_backup` and `r005_deprecated_field_apply_atomic_with_backup` failures in `tests/optimizer_fix.rs` are pre-existing fixture drift unrelated to A4; recommend filing as a separate cleanup task.

---

## 7. Branch & Commits

- **Branch:** `verify-a4-optimizer`
- **Base:** `84eb979` (master HEAD as of 2026-06-29)
- **Commits on this branch (1):**
  - `6299376` — `test(optimizer): A4 verification — extract_rule_id_from_payload + UI error banner`

---

## 8. Known Limitations / Follow-ups

1. **Pre-existing test failures in `tests/optimizer_fix.rs`** (unrelated to A4): `multi_rule_apply_each_gets_its_own_backup` and `r005_deprecated_field_apply_atomic_with_backup` fail because fixture content drift; recommend separate fix.
2. **§3.1 env var inconsistency NOT addressed** — out of scope for A4. Recommend filing as a separate bug (e.g., A13: "ORPHAN_PROVIDER scan treats `ANTHROPIC_API_KEY` as missing").
3. **No e2e (Playwright/tauri-driver) test for the per-row Fix button.** Per CLAUDE.md §17.4, full UI verification (launching the app and clicking) is `main session exclusive`. This verification covers frontend unit + backend unit + integration test — per §16.2 hard-evidence requirements.

---

**Author:** Claude Code (subagent verify-a4)
**Date:** 2026-06-30
**Status:** A4 verified, locked by 6 unit tests + 1 frontend test + 3 integration tests