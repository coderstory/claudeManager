---
phase: 06-m35-reveal-bug
verified: 2026-06-26T00:37:49Z
status: gaps_found
score: 2/3 must-haves verified
behavior_unverified: 0
behavior_unverified_items: []
overrides_applied: 0
gaps:
  - truth: "4 个 reveal 场景 e2e 测试覆盖"
    status: failed
    reason: "ROADMAP SC #3 明确要求 4 个 reveal 场景 e2e 测试覆盖;代码库中无 M3.5 专属 e2e spec 文件 (e.g. tests/e2e/m3-5-reveal-error.spec.ts)。仅有 M2.13 时代 tests/e2e/m2-13-resource-browser.spec.ts (1 个 reveal 按钮存在性断言),无 not_found / permission_denied / network_path / launcher_failed 任一场景的 e2e 覆盖。4 个场景的覆盖在 src/__tests__/pages/resource-browser.test.tsx 与 src/__tests__/components/ErrorBanner.test.tsx 是 vitest 单测,不是 e2e (tests/e2e/ 目录的 Playwright spec)。"
    artifacts:
      - path: "tests/e2e/m2-13-resource-browser.spec.ts"
        issue: "M2.13 era 单一按钮存在性断言,无 4 场景结构化错误覆盖;M3.5 未新增 e2e spec"
      - path: "src/__tests__/pages/resource-browser.test.tsx"
        issue: "vitest 单测覆盖 4 场景文案,非 e2e"
      - path: "src/__tests__/components/ErrorBanner.test.tsx"
        issue: "vitest 单测覆盖 4 场景文案,非 e2e"
    missing:
      - "新增 tests/e2e/m3-5-reveal-error.spec.ts 覆盖 4 场景: 合法路径 (ok) / 不存在 (not_found) / 无权限 (permission_denied) / 网络路径 (network_path) + launcher_failed 兜底"
      - "或更新 ROADMAP SC #3 把 \"e2e\" 放宽为 \"测试\"(单测已经覆盖)"
---

# Phase 6: M3.5 资源浏览修 bug (清单 15) Verification Report

**Phase Goal:** `IPlatformReveal::reveal_file` 错误处理增强 + `explorer.exe exit 1` 根因排查 + 前端错误本地化
**Verified:** 2026-06-26T00:37:49Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `reveal_file` 返回 `Result<(), RevealError>` 区分 4 类 (合法路径 / 不存在 / 无权限 / 网络路径) | VERIFIED | `src-tauri/src/platform/traits.rs:329` 定义 `fn reveal_file(&self, path: &Path) -> Result<(), RevealError>;` `:339-351` 4 变体 `NotFound` / `PermissionDenied` / `NetworkPath` / `LauncherFailed`;`windows/reveal.rs:31-69` + `macos/reveal.rs:27-67` 均实现 4 步前置检测(网络 → 存在 → spawn → status.success());commit `e040a48` 落地 |
| 2 | 前端 ErrorBanner 显示本地化提示 ("无法打开该资源" + 排查建议) | VERIFIED | `src/components/ErrorBanner.tsx:62-77` 定义 `RevealFailure` / `RevealErrorKind` 类型;`:85-114` `revealErrorText` 4 类中文文案(不存在/无法访问/不支持网络路径/启动失败)+ hint;`:124-143` `formatRevealError` 主入口;`src/pages/resource-browser/index.tsx:70-71,83-95,130,218,262-273,664-693` 全链路接入(状态字段 + isRevealFailure 探测 + ErrorBanner 渲染) |
| 3 | 4 个 reveal 场景 e2e 测试覆盖 | FAILED | 无 M3.5 专属 e2e spec 文件。`tests/e2e/` 目录仅有 M2.13 era `m2-13-resource-browser.spec.ts` 1 个 reveal 按钮存在性断言,无 not_found / permission_denied / network_path / launcher_failed 任一场景结构化错误 e2e 覆盖。4 场景覆盖存在于 `src/__tests__/pages/resource-browser.test.tsx` (vitest) 与 `src/__tests__/components/ErrorBanner.test.tsx` (vitest) — 是单测,非 Playwright e2e。 |

**Score:** 2/3 must-haves verified (0 present-but-behavior-unverified)

### Required Artifacts (from PLAN / SUMMARY claims)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/platform/traits.rs` | `RevealError` enum 4 variant + `reveal_file` trait method | VERIFIED | 4 变体 (`NotFound` / `PermissionDenied` / `NetworkPath` / `LauncherFailed`);`kind()` 返回 kebab-case routing key;`path()` 辅助方法;trait 方法名 `reveal` → `reveal_file`;mockall shim 同步;3 个新单测 (`reveal_file_dispatch` / `reveal_error_kind_is_stable_string` / `reveal_error_path_returns_inner`) |
| `src-tauri/src/platform/windows/reveal.rs` | 4 步前置检测 + 单测 | VERIFIED | `:31-69` 实现 4 步;`:88,102,112,138` 4 个单测(网络路径存在/不存在/UNC 格式/launcher 失败兜底) |
| `src-tauri/src/platform/macos/reveal.rs` | 4 步前置检测 (与 Windows 同构) + 单测 | VERIFIED | `:27-67` 实现;`:79,93,118` 单测(not_found / network_path / launcher 兜底) |
| `src-tauri/src/platform/mod.rs` | `pub use` 列表加 `RevealError` | VERIFIED | `:29` 导出 |
| `src-tauri/src/services/resource_service.rs` | `ResourceServiceError::Reveal` 结构化 + `RevealFailure` IPC 形态 | VERIFIED | `:45-50` `Reveal { kind, message, path }` 替代旧 `Reveal(String)`;`:59-76` `RevealFailure` + `from_reveal_error`;`:151-159` 转换路径;fakes 改新签名;新单测覆盖 |
| `src-tauri/src/commands/resource.rs` | `reveal_in_file_manager` 返回 `Result<(), RevealFailure>` | VERIFIED | `:31` `type RevealCmdResult = Result<(), RevealFailure>;`;`:107-124` 实现 (空 path 合成 `permission_denied` 兜底 + 结构化映射) |
| `src/components/ErrorBanner.tsx` | `RevealFailure` / `RevealErrorKind` 类型 + `formatRevealError` 辅助 | VERIFIED | `:62-77` 类型;`:85-114` 4 类中文文案;`:124-143` 公开 `formatRevealError`;未知 kind 兜底到 `launcher_failed` |
| `src/pages/resource-browser/index.tsx` | `state.revealFailure: RevealFailure \| null` + `ErrorBanner` 接入 | VERIFIED | `:83-95` state 字段;`:130` `isRevealFailure` 探测;`:262-273` 错误处理;`:664-693` UI 块 (`formatRevealError` + ErrorBanner + `(类型: <kind>)` 标识) |
| `docs/investigations/m3.5-reveal-bug.md` | 4 段根因 + 残留限制 + 验证清单 | VERIFIED | 139 行文件存在,内容已审 |
| `tmp/white-list-phase6-m35.md` | 12 改 + 3 新文件白名单 | VERIFIED (moved) | 文件已迁移到 `docs/ship-records/white-list-archive/white-list-phase6-m35.md`(M3.x ship 流程会把 `tmp/*.md` 归档) |
| `tmp/reviews/phase6-m35-self.md` | §6 自审 | VERIFIED (moved) | 110 行文件存在,可能也已归档到 `docs/ship-records/white-list-archive/`(commit `e040a48` 列入) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `IPlatformReveal::reveal_file` (trait) | `WindowsReveal::reveal_file` / `MacReveal::reveal_file` | trait impl | WIRED | 两平台实现均含 4 步前置检测 |
| `MacReveal::reveal_file` | `open -R <path>` shell command | `Command::new("open").arg("-R").arg(path).status()` | WIRED | `:51-58` spawn + status 捕获 |
| `WindowsReveal::reveal_file` | `explorer /select,<path>` shell command | (macho path, 同形构造) | WIRED | 4 步对称 |
| `ResourceService::reveal` | `RevealFailure::from_reveal_error` | 直接调用 | WIRED | `:157-159` map_err 转换 |
| `commands::resource::reveal_in_file_manager` | IPC `Result<(), RevealFailure>` | `RevealCmdResult` alias | WIRED | `:31,107-124` |
| `resource-browser/index.tsx` `handleReveal` | `formatRevealError(state.revealFailure)` | `ErrorBanner` 渲染 | WIRED | `:664-693` |
| `isRevealFailure` 探测 | 兼容旧 IPC (Error 字符串降级) | duck-typing on `err.kind`/`err.message`/`err.path` | WIRED | `:130` 类型守卫 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ErrorBanner.tsx` `formatRevealError` | `failure: RevealFailure` | 后端 IPC `RevealFailure { kind, message, path }` | YES — 后端 `RevealFailure` 是 `#[derive(Serialize)]` struct 序列化形态;前端按 `kind` 路由到 `revealErrorText` 真实中文文案,非空字符串 | FLOWING |
| `resource-browser/index.tsx` `state.revealFailure` | `RevealFailure \| null` | `handleReveal` catch 块从 IPC 调用反序列化 | YES — 4 场景单测都覆盖了 `kind` 路由到对应文案 | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Rust compile clean | `cargo check --lib` (in `src-tauri/`) | 0 error;1 pre-existing unused import warning in `usage_provider_ccswitch.rs:52` (unrelated to M3.5) | PASS |
| Frontend tests | `npx vitest run --reporter=basic` | 541/541 tests passed (42 files, 3.75s) — 含 M3.5 新增的 6 个 resource-browser + 8 个 ErrorBanner 单元测试 | PASS |
| Commit `e040a48` exists | `git log --oneline \| grep e040a48` | 找到:`feat(M3.5): reveal error structured (RevealError) + frontend localization` | PASS |
| M3.5 e2e spec exists | `ls tests/e2e/m3-5-*.spec.ts` | 找不到任何 m3-5*.spec.ts;`tests/e2e/m2-13-resource-browser.spec.ts` 仅 1 个 reveal 按钮存在性断言 | FAIL |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (无 phase-declared probe) | n/a | n/a | N/A — Phase 6 未声明 scripts/*/tests/probe-*.sh |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src-tauri/src/platform/traits.rs` | 10, 13, 112, 146, 150, 183, 255, 488 | 注释提到 "stub" / "unimplemented!()" | Info | 全部为 M2.x era macOS 抽象层 stub 注释 (single-instance lock, autostart, app menu, window chrome 等模块),非 M3.5 新增。Reveal 逻辑非 stub |
| (no TBD/FIXME/XXX markers) | — | — | — | 7 个 M3.5 改/新增文件零债务标记 |

### Human Verification Required

无强人工项。所有 M3.5 单测覆盖 4 场景文案路由,可机器验证。**但 4 场景 e2e 缺失** — 是 ROADMAP SC #3 的契约失败,已在 gaps 中标记。

### Gaps Summary

**SC #3 失败根因**:
- ROADMAP.md Phase 6 SC #3 写明 "4 个 reveal 场景 e2e 测试覆盖"
- 代码库无任何 M3.5 专属 Playwright e2e spec(`tests/e2e/m3-5-*.spec.ts` 不存在)
- 唯一相关 e2e 是 M2.13 era 的 `m2-13-resource-browser.spec.ts`,只断言 reveal 按钮存在性,不覆盖 4 类结构化错误
- 4 场景的实际覆盖是 vitest 单测(`src/__tests__/pages/resource-browser.test.tsx` 6 个 it + `src/__tests__/components/ErrorBanner.test.tsx` 8 个 it),不是 e2e
- SUMMARY.md 未承认此 gap,反而说 "前端 `npx vitest run` 398/398 通过",是单测通过而非 e2e 覆盖

**两类修复路径二选一**:
1. **新增 e2e**(推荐):在 `tests/e2e/m3-5-reveal-error.spec.ts` 写 4 场景 Playwright spec(用 mock 注入 4 类 `RevealFailure`,验证 ErrorBanner 文案)
2. **更新 ROADMAP SC #3**:把 "e2e 测试" 放宽为 "测试"(承认单测覆盖即可),并在本 VERIFICATION.md 记录决定

### Top 3 Findings

1. **后端结构化错误 + 跨层契约完整落地** — `RevealError` 4 变体 + `kind()` 稳定 routing key + `RevealFailure` IPC struct + Windows/macOS 同构实现 + 单元测试覆盖,工程质量高于清单 15 P1 bugfix 的常规水准
2. **前端文案本地化 + 兜底策略** — 4 类中文文案完整;未知 kind 不抛错而是降级到 `launcher_failed`;`isRevealFailure` duck-typing 兼容旧 IPC(后端若退化到 Error 字符串,前端仍能 UI 显示)
3. **e2e 缺失是真问题,不是 SUMMARY 措辞模糊** — ROADMAP SC #3 写 "e2e" 但实际只有 vitest 单测;M3.5 阶段 commit `e040a48` 没动 `tests/e2e/` 目录;需明确决定是补 e2e 还是改 ROADMAP

### Top 3 Blockers

1. **ROADMAP SC #3 "4 个 reveal 场景 e2e 测试覆盖" 失败** — 仅 vitest 单测,无 Playwright e2e spec;gaps_found
2. (无)其他 blocker 等级问题
3. (无)其他 blocker 等级问题

---

_Verified: 2026-06-26T00:37:49Z_
_Verifier: Claude (gsd-verifier)_
