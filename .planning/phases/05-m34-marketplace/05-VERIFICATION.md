---
phase: 05-m34-marketplace
verified: 2026-06-26T00:35:22Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
behavior_unverified_items: []
overrides_applied: 0
overrides: []
---

# Phase 5: M3.4 资源市场重构 - Verification Report

**Phase Goal**: 安装流程重设计 (内置 vs 第三方 vs npx 三类统一 API) + 删除克隆源码流程 + superpowers + GSD 内置源 + GSD-* 合并展示 + 资源浏览过滤规则。
**Verified**: 2026-06-26T00:35:22Z
**Status**: passed
**Re-verification**: No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | F17 marketplace 安装流程三类统一 API (`install_builtin` / `install_third_party` / `install_npx`) | ✓ VERIFIED | `src-tauri/src/services/marketplace_service.rs` 暴露三个 public method (lines 504/579/626) + `src-tauri/src/commands/marketplace.rs` 三个 Tauri command (lines 97/116/141) + `src/lib.rs:172-174` 注册。Frontend `src/lib/api/marketplace.ts:88/97/113` 调 `invoke('install_builtin_plugin'/'install_third_party_repo'/'install_npx_package')`。每个 method 走独立路径: Builtin → `claude plugin install <target>`, Npx → `npx <pkg> --global --silent`, Third-party → `clone_and_scan + install_resource` 单步完成。 |
| 2   | 删除"克隆源码"分支 | ✓ VERIFIED | 内置 superpowers (Builtin mode) 和 GSD (Npx mode) 都**不走 git clone**,直接调 CLI。第三方仓库用单步 `install_third_party_repo` 一步到位,用户不再需要先手动克隆源码。`clone_and_scan` 仅保留为"预览资源"辅助按钮 (page index.tsx:11/82/194)。`src-tauri/src/services/marketplace_service.rs:137/145` 明确标注"无需 git clone"。 |
| 3   | 内置 superpowers + GSD (`@opengsd/gsd-core@latest`) | ✓ VERIFIED | `builtin_repos()` (lines 131-158) 返回 3 个内置源: `superpowers` (Builtin 模式, `claude plugin install superpowers@claude-plugins-official`) + `gsd-core` (Npx 模式, `@opengsd/gsd-core@latest`) + `claude-cookbooks` (Git 模式示例)。`builtin_repos_returns_real_urls` 测试 (line 1166) 验证 URL 全部为真 URL。 |
| 4   | GSD-* 合并展示为 "Get Shit Done" 分类 | ✓ VERIFIED | `src/pages/marketplace/index.tsx:108-113` `detectCategoryBadge()` 把 `gsd-` 前缀资源映射为 "Get Shit Done" 标签。Test `GSD-* resources get the "Get Shit Done" category badge (清单 16)` (marketplace.test.tsx:670) 验证合并逻辑: gsd-discuss + gsd-plan.md 显示 "Get Shit Done",code-review (非 gsd-*) 不显示。 |
| 5   | 资源浏览过滤 `cache/` / `node_modules/` / `.git/` | ✓ VERIFIED | `src-tauri/src/infrastructure/resource_scanner.rs:107-112` 列出污染目录 (cache/.cache/Cache/node_modules/.git/__pycache__),`line 151` 调用 `should_skip_dir` 过滤;`line 685` 插件扫描 + `line 699` 技能扫描循环过滤。`scan_plugins_dir_excludes_pollution_dirs` + `scan_skills_dir_excludes_pollution_dirs` + `scan_commands_lsp_unaffected_by_excluded_dir_filter` 三个测试覆盖。 |
| 6   | 安装命令 mock + GSD 合并 fixture + 过滤规则单测 | ✓ VERIFIED | Marketplace 22 vitest + resource-browser 46 vitest + marketplace_service 33 cargo tests (1 失败为 M2.16 预存,不在 M3.4 scope) + scanner 18 cargo tests。安装 mock: `it('clicking a Builtin repo card triggers install_builtin_plugin')` (line 539) + `it('clicking an Npx repo card triggers install_npx_package')` (line 576) + `it('batch install (M3.4): ... install_third_party_repo')` (line 715)。GSD 合并: `it('GSD-* resources get the "Get Shit Done" category badge')` (line 670)。过滤规则: scanner 3 个 tests + `it('does not render items named cache / node_modules / .git (后端已过滤)')` (resource-browser.test.tsx:1359)。 |

**Score**: 6/6 truths verified

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src-tauri/src/services/marketplace_service.rs` | 三类 install 业务逻辑 | ✓ VERIFIED | 1582 行,`install_builtin` / `install_third_party` / `install_npx` + `_with_active_root` 变体 (M3.12) + 33 单元测试 |
| `src-tauri/src/commands/marketplace.rs` | Tauri command 薄封装 | ✓ VERIFIED | 6 个 command (list/clone_and_scan/install_from/3 个 M3.4 新),`command_symbols_exist` 测试钉 6 个符号 |
| `src-tauri/src/lib.rs:172-174` | 注册 3 个新 command | ✓ VERIFIED | `commands::marketplace::install_builtin_plugin, install_third_party_repo, install_npx_package` 都注册到 invoke_handler |
| `src/lib/api/marketplace.ts` | Frontend invoke 包装 | ✓ VERIFIED | `installBuiltinPlugin` / `installThirdPartyRepo` / `installNpxPackage` 三个 export |
| `src/pages/marketplace/index.tsx` | UI 整合三类 install + GSD badge | ✓ VERIFIED | 1093 行; 3 install 路径按 `install_mode` 分支,`detectCategoryBadge` GSD 合并 |
| `src-tauri/src/infrastructure/resource_scanner.rs` | 过滤 cache/node_modules/.git | ✓ VERIFIED | `should_skip_dir` + 污染目录列表; 3 个新测试覆盖 plugins/skills/commands 扫描 |
| `src/pages/resource-browser/index.tsx` | 资源浏览 (复用 scanner 过滤) | ✓ VERIFIED | 1345 行, 46 vitest 通过 |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `src/pages/marketplace/index.tsx` | `src-tauri/src/commands/marketplace.rs` | `invoke('install_builtin_plugin', { pluginId })` via `installBuiltinPlugin()` | ✓ WIRED | `src/lib/api/marketplace.ts:88-90` 调 invoke, marketplace/index.tsx:189 用 `installBuiltinPlugin(repo.id)` |
| `src/pages/marketplace/index.tsx` | `src-tauri/src/commands/marketplace.rs` | `invoke('install_npx_package', { package })` via `installNpxPackage()` | ✓ WIRED | `src/lib/api/marketplace.ts:113-115` 调 invoke, marketplace/index.tsx:192 用 `installNpxPackage(target)` |
| `src/pages/marketplace/index.tsx` | `src-tauri/src/commands/marketplace.rs` | `invoke('install_third_party_repo', { url, selections })` via `installThirdPartyRepo()` | ✓ WIRED | `src/lib/api/marketplace.ts:97-103` 调 invoke, marketplace/index.tsx:230 用 `installThirdPartyRepo(customUrl.trim(), selections)` |
| `MarketplaceService::install_builtin` | `claude plugin install` CLI | `std::process::Command::new("claude").args(["plugin","install",&repo.install_target])` | ✓ WIRED | marketplace_service.rs:534-541; test `install_builtin_returns_error_when_claude_cli_missing` 验证 spawn 错误处理 |
| `MarketplaceService::install_npx` | `npx <pkg>` CLI | `std::process::Command::new("npx").args([pkg,"--global","--silent"])` | ✓ WIRED | marketplace_service.rs:645-651; test `install_npx_handles_spawn_or_exit_failure_gracefully` 验证失败处理 |
| `MarketplaceService::install_third_party` | `clone_and_scan` + `install_resource` 循环 | `self.clone_and_scan(url)?` + loop `install_resource_with_active_root` | ✓ WIRED | marketplace_service.rs:599-612; test `install_third_party_installs_all_selected_resources` 验证批量 install |
| `ResourceBrowser` 列表 | `resource_scanner` 过滤 | scanner `should_skip_dir` 排除污染目录 | ✓ WIRED | scanner.rs:151 (M3.4 注释: "Skip excluded pollution directories (清单 17)"); resource-browser.test.tsx:1359 验证 |
| `marketplace repo cards` (UI) | `MarketplaceRepo.install_mode` (data) | `defaultInstallLabel(installMode)` 决定按钮文案 | ✓ WIRED | marketplace/index.tsx:87-97; test `renders install_mode badge (CLI / NPX / GIT) on each builtin card` (line 515) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `marketplace/index.tsx` builtin cards | `repos` (MarketplaceRepo[]) | `listMarketplaceRepos()` → `MarketplaceService::list_builtin_repos()` → `builtin_repos()` const | ✓ FLOWING | 3 hardcoded but real URLs (anthropics/claude-plugins-official, gsd-build/gsd-core, anthropics/claude-cookbooks); test `builtin_repos_returns_real_urls` 验证非 placeholder |
| `marketplace/index.tsx` GSD badge | `category` (badge text) | `detectCategoryBadge(name)` from `scanResult.resources` (clone_and_scan output) | ✓ FLOWING | Real name `gsd-discuss`/`gsd-plan.md` → "Get Shit Done"; 真实 npx 装的资源名都以 gsd- 开头 |
| `resource-browser/index.tsx` rows | `state.items` | `listResources(kind)` → scanner | ✓ FLOWING | scanner 过滤污染目录后返回; resource-browser.test.tsx:1359 验证 cache/node_modules/.git 不渲染 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Cargo check 整体编译 | `cd src-tauri && cargo check --quiet` | 0 errors, 1 warning (unused import in unrelated file) | ✓ PASS |
| marketplace_service 33 tests | `cd src-tauri && cargo test --lib --quiet services::marketplace_service` | 32 passed, 1 failed (M2.16 预存失败: `slug_from_url_rejects_empty`, 不在 M3.4 scope) | ✓ PASS (M3.4 scope) |
| scanner filter tests (M3.4 新增) | `cd src-tauri && cargo test --lib --quiet -- infrastructure::resource_scanner::tests::scan_plugins_dir_excludes_pollution_dirs infrastructure::resource_scanner::tests::scan_skills_dir_excludes_pollution_dirs` | 2/2 passed | ✓ PASS |
| builtin URL 真值测试 | `cd src-tauri && cargo test --lib --quiet -- services::marketplace_service::tests::builtin_repos_returns_real_urls` | 1/1 passed | ✓ PASS |
| third_party 批量 install | `cd src-tauri && cargo test --lib --quiet -- services::marketplace_service::tests::install_third_party_installs_all_selected_resources` | 1/1 passed | ✓ PASS |
| builtin 拒绝未知 id | `cd src-tauri && cargo test --lib --quiet -- services::marketplace_service::tests::install_builtin_rejects_unknown_id` | 1/1 passed | ✓ PASS |
| frontend marketplace 22 vitest | `npx vitest run src/__tests__/pages/marketplace.test.tsx` | 22/22 passed | ✓ PASS |
| frontend resource-browser 46 vitest | `npx vitest run src/__tests__/pages/resource-browser.test.tsx` | 46/46 passed | ✓ PASS |
| frontend 2 文件联合 | `npx vitest run src/__tests__/pages/marketplace.test.tsx src/__tests__/pages/resource-browser.test.tsx` | 68/68 passed (2 files) | ✓ PASS |

### Probe Execution

N/A — 本 phase 不涉及 migration/CLI probe。无 `scripts/*/tests/probe-*.sh` 文件。

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| 清单 11 | Phase 5 SC #1 | F17 marketplace 三类 install API 统一 | ✓ SATISFIED | install_builtin / install_third_party / install_npx 三方法 + 三 command 完整实现 |
| 清单 12 | Phase 5 SC #2 | 删除克隆源码流程 | ✓ SATISFIED | superpowers + GSD 不再走 git clone, 走 CLI 一步到位; third_party 单步 install_third_party_repo |
| 清单 13 | Phase 5 SC #3 | 内置 superpowers 源 | ✓ SATISFIED | builtin_repos()[0] = superpowers (Builtin mode, `claude plugin install superpowers@claude-plugins-official`) |
| 清单 14 | Phase 5 SC #3 | 内置 GSD 源 | ✓ SATISFIED | builtin_repos()[1] = gsd-core (Npx mode, `@opengsd/gsd-core@latest`) |
| 清单 16 | Phase 5 SC #4 | GSD-* 合并展示 | ✓ SATISFIED | detectCategoryBadge("gsd-*") = "Get Shit Done", test 覆盖 |
| 清单 17 | Phase 5 SC #5 | 资源浏览过滤 cache/node_modules/.git | ✓ SATISFIED | scanner.rs:107-112 污染目录列表 + should_skip_dir; 3 个测试覆盖 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src-tauri/src/services/marketplace_service.rs` | 130 | Stale comment: "当前是 placeholder fallback" | ℹ️ Info | 注释陈旧, 实际 URL 已修复为真 URL (line 134-156); `builtin_repos_returns_real_urls` test (line 1166) 已验证。文档与代码不一致, 应更新注释。 |
| `src-tauri/src/services/marketplace_service.rs` | 833-835 | Pre-existing test failure: `slug_from_url_rejects_empty` (M2.16 引入) | ℹ️ Info | 在 M2.16 era (commit ecd547bd, 2026-06-21) 引入, 不在 M3.4 scope。`slug_from_url("https://github.com/")` 期望 `is_err()` 但实际 `is_ok()` —— M3.4 不应背负 M2.16 债务修复。 |

### Human Verification Required

无 — 所有 6 条 SC 都有自动化测试覆盖:
- install 三类: backend cargo tests + frontend vitest mock invoke
- GSD 合并: vitest 直接断言 badge 文本
- 资源过滤: scanner cargo tests + resource-browser vitest
- 真 URL: builtin_repos_returns_real_urls 验证

UI 行为 (点击按钮/红绿条/分类标签显示) 都在 jsdom 渲染测试里覆盖, 无需人工。

### Gaps Summary

无。Phase 5 全部 6 条 SC 都通过代码 + 测试验证。

---

_Verified: 2026-06-26T00:35:22Z_
_Verifier: Claude (gsd-verifier)_
