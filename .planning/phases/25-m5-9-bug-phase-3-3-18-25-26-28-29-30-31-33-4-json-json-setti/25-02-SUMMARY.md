---
phase: 25
plan: 02
type: summary
status: complete
---

# 25-02: T2 fix #18 — 删单文件部署 4 处同步 — SUMMARY

**Status:** ✅ PASS (commit `0eb7f08`, 29 files changed, +269 / -576)

## 4 处同步 (CLAUDE.md §6.4)

| 类型 | 文件 | 操作 |
|---|---|---|
| 删页 | `src/pages/single-file-deploy/index.tsx` | 删整页 |
| 删 sidebar menu | `src/components/AppSidebar.tsx` | 删 'single-file-deploy' VIEW_META + Rocket icon import |
| 删 IPC command | `src-tauri/src/plugins/stubs/single_file_deploy.rs` | 删整文件 |
| 删 capability | (F8 借用 fs:default, 无自有 grant) | N/A |

## 额外清理 (25 相关文件)

- Plugin registry: `src/plugins/registry.ts` (10→9 plugins)
- Plugin stub: `src/plugins/stubs/single-file-deploy.tsx` + mod.ts
- Router: `src/App.tsx` (删 import + PAGE_META + Route)
- View state: `src/hooks/useViewState.tsx` (ViewId union 13→12)
- Search modal: `src/components/QuickSearchModal.tsx` (PLUGIN_LABELS 12→11)
- Rust plugin host: `src-tauri/src/plugins/mod.rs` (11→10) + stubs/mod.rs
- Rust test: `src-tauri/tests/plugin_host_wiring.rs` (11→10 plugins)
- Rust docstring: `src-tauri/src/commands/{about,app}.rs` (改 "F8" → "About page")
- 测试: 3 删 + 5 改 (REAL_PAGE_VIEWS, ALL_VIEWS, ALL_PLUGINS, QuickSearchModal 长度)
- Design system: `utilities.css` (删 [data-app-cmd-toggle] block) + `tokens.css` (11→10 详情页注释)
- Doc comments: `AboutCard.tsx`, `InfoSection.tsx`, `about/index.tsx`, `main.tsx` 改 "F8 已有模式" → "F8 时代确立的模式"

## 新 vitest

`src/__tests__/integration/no-single-file-deploy-refs.test.ts` (2 tests):
- 扫描全部 `.ts/.tsx/.rs/.json` 文件
- 断言 `single-file-deploy` 字符串不在任何文件出现
- 额外断言 6 个 F8 文件物理上不存在 (belt-and-suspenders)
- 自身 self-skip (SELF_PATH 常量比对)

## Acceptance 验证

- `grep -rn 'single-file-deploy' src/ src-tauri/src/ src-tauri/capabilities/ src-tauri/tests/ tests/e2e/ | grep -v 'no-single-file-deploy-refs'` = **0 行** ✓
- `npx vitest run` = **550/550 passed** ✓
- `cargo check --tests` = ok ✓ (2 预存 warning, 与本 commit 无关)
- commit message 含 #18
