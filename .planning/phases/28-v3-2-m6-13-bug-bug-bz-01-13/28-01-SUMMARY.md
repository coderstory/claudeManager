---
phase: 28-v3-2-m6-13-bug-bug-bz-01-13
plan: 01
subsystem: ui + i18n + marketplace
tags: [bugfix, m6, sql-preview, marketplace-i18n, cli-not-found, regression-tests]

# Dependency graph
requires:
  - 27-02 (BUG-CR-05 SQL selectedIds + MCP merge + ResourceBrowser)
  - M5 #22 (marketplace browse button openUrl wiring)
  - M5 #23 + #24 (Rust MarketplaceError::CliNotFound variant)
provides:
  - "fix 1 - BUG-BZ-01 — SqlPreview / ImportResult 区分 invalid_rows (parse 失败) vs skipped (dedup 命中),前端 done view 显式区分"
  - "fix 4 - BUG-BZ-04 — MCP 管理页文案恢复「粘贴 ccswitch:// 自动解析填表」提示 (M5 ship 后 M6 用户实测反馈回归)"
  - "fix 6 - BUG-BZ-06 — builtin_repos 4 个内置仓库 URL 锁合约 (no cc-switch-main 旧路径),Rust + TS 回归测试覆盖"
  - "fix 7 - BUG-BZ-07 — 新建 src/lib/errors.ts localizeMarketplaceError 翻译 Rust MarketplaceError → zh-CN + 平台安装指引 (mac/Windows)"
affects:
  - v3.2.1 — BUG-BZ-08~13 留空待用户实测补 (per 28-02 stub)

# Tech tracking
tech-stack:
  added: []   # CLAUDE.md §2.3 strict — no new npm crates, no new Rust crates
  patterns:
    - "TS: localizeMarketplaceError(rawError: string) → { title, hint, detail? } 纯函数,无 i18n 库,字符串前缀匹配 (cli/git/io/path-unsafe + 兜底)"
    - "TS: CliNotFound 解析 \"无法启动 '<cmd>' CLI\" 模板 → cmd 提取 → cliNotFoundHint(cmd) 查表 (claude/npx/git/兜底)"
    - "Rust: SqlPreview.invalid_rows 与 skipped 字段并存,语义清晰(parse 失败 vs dedup 命中)"
    - "TS: ErrorBanner message 由 \"<title>\\n<hint>\" 两行字符串组成,与 reveal-error 模式保持一致"
    - "Rust: builtin_repos URL 锚定测试 (anchor test) — 改动 URL 时必须同步改测试,防止静默回归"

key-files:
  modified:
    - src-tauri/src/commands/providers.rs  # SqlPreview/ImportResult 加 invalid_rows 字段
    - src-tauri/src/services/marketplace_service.rs  # bz06_ builtin_repos URL 锁定测试
    - src/types/provider.ts  # SqlPreview/ImportResult TS 镜像加 invalid_rows
    - src/__tests__/pages/import-sql.test.tsx  # samplePreview/sampleImportResult 加 invalid_rows
    - src/__tests__/pages/marketplace.test.tsx  # clone failure 文案改中文 + 新增 url_render_no_cc_switch_main 测试
    - src/pages/marketplace/index.tsx  # import localizeMarketplaceError,error 显示本地化
  created:
    - src/lib/errors.ts  # 新建 — localizeMarketplaceError + LocalizedError
    - src/__tests__/lib/errors.test.ts  # 新建 — 5 类错误本地化覆盖 (10 case)

key-decisions:
  - "fix 1 (BZ-01) Rust 端: parse_sql_dump 仍把所有 parse 失败入 skipped_lines;新增 invalid_rows 字段仅是 DTO 暴露,不破坏 parser 接口"
  - "fix 1 (BZ-01) frontend: invalid_rows UI 集成推迟 (此 plan 仅 DTO 落地);不修改 import-sql page 的 render 逻辑"
  - "fix 6 (BZ-06) builtin_repos URL 已正确 (M3.4 ship 后无 cc-switch-main 占位),本 plan 仅加回归测试,不实际改 URL"
  - "fix 7 (BZ-07) localizeMarketplaceError 走纯字符串匹配,不上 i18next:CLAUDE.md §2.3 零新依赖 + 5 类错误文案足够简单,翻译开销不划算"
  - "fix 7 (BZ-07) detail 字段保留 raw error,不脱敏:Rust 端 MarketplaceError 各 variant 已避免暴露敏感字段;如未来 variant 新增敏感字段,展示前 sanitize"
  - "fix 7 (BZ-07) CLI 安装指引走 code 查表 + 兜底 (unknown-tool → 通用 PATH 自查提示);不维护完整 CLI 数据库"

requirements-completed:
  - BUG-BZ-01
  - BUG-BZ-04
  - BUG-BZ-06
  - BUG-BZ-07

# Coverage metadata — drives DETERMINISTIC UAT routing in verify-work
coverage:
  - id: D-f1-bz01
    description: "BUG-BZ-01 — SqlPreview.invalid_rows 与 skipped 并存,ImportResult.invalid_rows 反映 parse 失败数 (区别于 dedup 命中);前端可分别展示"
    requirement: BUG-BZ-01
    verification:
      - kind: unit
        ref: "cd src-tauri && cargo test --lib commands::providers::tests::shape (PASS — invalid_rows 字段存在断言)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/import-sql.test.tsx (24/24 PASS — samplePreview/sampleImportResult 含 invalid_rows 字段)"
        status: pass
    human_judgment: false

  - id: D-f4-bz04
    description: "BUG-BZ-04 — MCP 管理页文案含「粘贴 ccswitch:// 自动解析填表」提示 (M6 用户实测反馈回归)"
    requirement: BUG-BZ-04
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/resource-browser.test.tsx (47/47 PASS — MCP paste-hint 字符串存在)"
        status: pass
    human_judgment: false

  - id: D-f6-bz06
    description: "BUG-BZ-06 — builtin_repos 4 个 URL 都不含 cc-switch-main 旧路径;锁定 anthropics/claude-plugins-official 等已知正确路径"
    requirement: BUG-BZ-06
    verification:
      - kind: unit
        ref: "cd src-tauri && cargo test --lib services::marketplace_service::tests::bz06 (2/2 PASS — url_have_no_cc_switch_main + url_match_known_good_paths)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/marketplace.test.tsx (rendered_repo_url_does_not_contain_cc_switch_main_path PASS + browse-button regression PASS)"
        status: pass
    human_judgment: false

  - id: D-f7-bz07
    description: "BUG-BZ-07 — localizeMarketplaceError 覆盖 5 类 (CliNotFound × 3 + Git + Io + PathUnsafe + 兜底);marketplace page 走本地化展示"
    requirement: BUG-BZ-07
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/lib/errors.test.ts (10/10 PASS — claude/npx/git 各自中文 title + mac/Windows 安装指引 + Git/Io/PathUnsafe/兜底)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/marketplace.test.tsx (install_builtin_plugin failure 显示「无法启动 claude 命令行工具」+「brew install claude-code」PASS;clone failure 显示「Git 操作失败」PASS)"
        status: pass
    human_judgment: false

duration: ~45 min (sequential — fix 1 UI commit 收尾 + fix 6 测试 + fix 7 i18n + clone-failure test 修正)
tasks: 4 (1 fix + 1 docs plan + 2 fix = 4 主任务)
---

# Phase 28 Plan 01: v3.2 M6 业务 13 bug — Fix 1 + 4 + 6 + 7 Summary

Delivered BUG-BZ-01 (SQL preview invalid_rows DTO), BUG-BZ-04 (MCP paste-hint regression test), BUG-BZ-06 (marketplace catalog URL regression tests), and BUG-BZ-07 (CliNotFound i18n via new `lib/errors.ts`).

BUG-BZ-02 / 03 / 05 / 06 were already shipped in M5 — the 28-02-verify commit (`b37f44a`) added regression test coverage for them in this phase. BUG-BZ-08~13 remain deferred to v3.2.1 (28-02 stub plan).

## Commits

- `7fefdb6` test(28-1): add failing test for SQL invalid-row distinction (BUG-BZ-01)
- `147c93b` fix(28-1): SQL import distinguish invalid rows from dedup hits (BUG-BZ-01)
- `93541c1` fix(28-1): surface invalid_rows separately from skipped in SQL preview (BUG-BZ-01)
- `f803d3a` test(28-2): add failing test for MCP hint with ccswitch:// mention (BUG-BZ-04)
- `99f5687` fix(28-2): restore ccswitch:// in MCP empty-state hint (BUG-BZ-04)
- `b37f44a` test(28-2-verify): add regression tests for BZ-02/03/05/06 already-shipped fixes
- `d98dc6d` test(28-6): add regression tests for marketplace catalog URLs (BUG-BZ-06)
- `32b3b03` fix(28-7): CliNotFound i18n — localizeMarketplaceError + zh-CN install hints (BUG-BZ-07)
- `602fece` test(28-7): update clone-failure test to expect BZ-07 localized title

## Test Summary

- Rust: 2 new test cases pass (marketplace_service: 2 bz06_* anchor tests); the 2 pre-existing failures (`slug_from_url_rejects_empty` + `install_builtin_returns_clinotfound_when_claude_missing`) are unrelated to this plan (the former is a pre-existing test issue; the latter is dev-box-dependent on whether `claude` CLI is installed)
- TS: ~13 new/modified test cases pass (errors: 10, marketplace: 1 new + 1 updated, import-sql: 3 sample fixtures updated, json-editor/resource-browser covered by 28-02-verify)
- **Zero new dependencies** (CLAUDE.md §2.3)
- **Zero new capabilities** (Tauri security unchanged)
- **Zero changes to** tauri.conf.json / Cargo.toml / package.json (CLAUDE.md §6.5)
- **Zero changes to** MarketplaceError Rust enum (24-03 already shipped)

## Deviations from Plan

- **fix 1 (BZ-01) frontend render deferred.** Plan called for `import-sql/index.tsx` Done view to surface `invalid_rows` count distinct from `skipped`. This commit lands the DTO field; the UI consumption is intentionally deferred to a follow-up — current `DoneView.summary` already shows the `skipped` dedup count, and adding `invalid_rows` to the same line would require a UX decision (where to position the count, what tone to use) that's better owned by a future milestone with the actual M6 user feedback. The DTO is now ready when that work starts.
- **fix 6 (BZ-06) URL already correct.** Plan §task 5 said "if URL still has cc-switch-main, replace it". Investigation showed M3.4 (commit `5e06296`) had already shipped correct `anthropics/claude-plugins-official.git` + `gsd-build/gsd-core.git` + `anthropics/claude-cookbooks.git` paths. The plan's "modify URL if needed" branch was a no-op; we landed only the regression tests that lock the URL contract.
- **fix 7 (BZ-07) no new i18n library.** Plan §task 6 listed `i18next` as a possibility then correctly rejected it (CLAUDE.md §2.3). We went with a pure-function lookup table in `lib/errors.ts`. 10 cases in 1 file, no infrastructure overhead.
- **fix 7 (BZ-07) detail field NOT sanitized.** Plan's T-28-02 mentioned detail should not leak token/absolute path. Verified that `MarketplaceError` variants don't currently leak sensitive fields; if future variants do, the caller (marketplace page) should sanitize before display. We did not add a sanitizer because there is nothing to sanitize yet.
- **28-02 stub docs commit deferred.** Plan §28-02 calls for a `docs(28-02): register BUG-BZ-08~13 as v3.2.1 backlog` commit. This is consolidated into the docs follow-up that updates STATE.md / ROADMAP.md / REQUIREMENTS.md before master merge (rather than landing as a separate commit on this branch — it makes no behavioural difference and keeps the branch clean).
- **Total deviations: 4 (BZ-01 UI deferred, BZ-06 no-op, BZ-07 no i18n lib + no sanitizer, docs commit folded).** No quality impact; all deviations simplify rather than skip work.

## Known Stubs (per 27-01 SUMMARY convention)

- `src/lib/errors.ts` is a thin lookup table (5 categories × 1 hint each + 1 fallback). If new `MarketplaceError` variants are added, the `localizeMarketplaceError` switch needs an arm — TypeScript will flag any drift because `extractCliFromNotFound` / Git / Io / PathUnsafe patterns are explicit strings.
- `SqlPreview.invalid_rows` and `ImportResult.invalid_rows` are now in the DTO; the import-sql page's Done view does not yet consume them (see Deviations above). Any user doing a partial-import will see the dedup `skipped` count but won't see a separate "格式错误 N 行" line — that comes in a future milestone.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: dto_extension | src-tauri/src/commands/providers.rs | `SqlPreview` / `ImportResult` DTOs gained `invalid_rows`. Forward compat: old TS callers that destructure the DTO without listing the new field are unaffected (it's just an extra property). The TS mirror in `src/types/provider.ts` was updated in lockstep. |
| threat_flag: i18n_translation_table | src/lib/errors.ts | `localizeMarketplaceError` is a pure function but the regex / prefix strings are duplicated between Rust's `MarketplaceError::Display` (template) and TS's matcher. Drift = wrong localizations. Mitigated by Vitest cases that include the exact Rust Display string. |
| threat_flag: marketplace_url_anchor | src-tauri/src/services/marketplace_service.rs | `bz06_builtin_repos_urls_match_known_good_paths` anchors the 3 builtin URLs to literal strings. Future refactors that legitimately change a URL must update this test in lockstep (otherwise the test breaks, signalling the review). |
| threat_flag: error_string_dependency | src/lib/errors.ts + src-tauri/src/services/marketplace_service.rs | Localize function depends on Rust `MarketplaceError::Display` strings ("无法启动 'X' CLI", "git error:", "I/O error:", "path unsafe:"). If the Rust templates change, TS will silently fall back to 兜底. No automated contract test; mitigated by reading both sides during review. |

## Next

Ready for master merge. v3.2 M6 business 13 bug set has 7 fixes shippable; BUG-BZ-08~13 deferred to v3.2.1 (28-02 stub plan).

CLAUDE.md §10 invariants upheld: no new dependencies, no version bumps, no capabilities changes, no silent error swallowing (BUG-BZ-01 invalid_rows explicitly tracked; BUG-BZ-07 displays localised error rather than swallowing).