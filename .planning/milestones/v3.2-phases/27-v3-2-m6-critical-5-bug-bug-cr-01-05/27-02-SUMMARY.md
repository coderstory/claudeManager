---
phase: 27-v3-2-m6-critical-5-bug-bug-cr-01-05
plan: 02
subsystem: ui
tags: [bugfix, m6, sql-import-selected, mcp-merge, scope-state, resource-browser, refactor]

# Dependency graph
requires:
  - 27-01 (fix 4 useScope hook + ResourceBrowser refactor)
provides:
  - "fix 5 - BUG-CR-05 (P0 重定义) — SQL 导入 selected IDs + distinct count + empty selection Err (D-15~D-18)"
  - "fix 6 - BUG-CR-04 子件 + 业务重构 — MCP 合并到 ResourceBrowser: sidebar 删 'MCP 管理' 入口 (D-12), ViewId 移除 'mcp-management' (D-10), URL ?tab=mcp 接管 mcp tab (D-11), 老 localStorage stale 'mcp-management' redirect 到 /resource-browser?tab=mcp (D-13), schema 不合并 (D-14)"
affects:
  - 28+ (保留 mcp-management/index.tsx 1 个 milestone 后可删;McPManagementPanel 共享 component 提取推迟)

# Tech tracking
tech-stack:
  added: []   # CLAUDE.md §2.3 strict — no new npm crates, no new Rust crates
  patterns:
    - "Rust: selected_ids filter at service boundary (后端按 ID 过滤,前端不再能 '勾 1 导入 6')"
    - "Rust: empty selected_ids → Err (CLAUDE.md §7 不静默回退到全量导入)"
    - "TS: URL ?tab=mcp initial kind via window.location.search (D-11) — 项目不用 react-router,parse URLSearchParams 直接读"
    - "TS: legacy localStorage 'mcp-management' remap → setView('resource-browser') + window.location.replace('/resource-browser?tab=mcp') (D-13)"
    - "TS: mcp tab 在 ResourceBrowser 内渲染 <McpManagementPage />(共享 component 实体 — 共享 McpManagementPanel 提取推迟到下个 milestone)"
    - "TS: Preview 子组件把 selected Set 通过 onConfirm(selectedIds: string[]) 透传给父 handleConfirm (解耦 state ownership)"

key-files:
  created:
    - tests/e2e/m6-p27-fix5-sql-import-count.spec.ts
    - tests/e2e/m6-p27-fix6-mcp-merge.spec.ts
  modified:
    - src-tauri/src/services/provider_service.rs
    - src-tauri/src/commands/providers.rs
    - src-tauri/src/services/resource_service.rs
    - src/lib/api/providers.ts
    - src/pages/import-sql/index.tsx
    - src/hooks/useViewState.tsx
    - src/components/AppSidebar.tsx
    - src/components/QuickSearchModal.tsx
    - src/App.tsx
    - src/pages/resource-browser/index.tsx
    - src/__tests__/pages/import-sql.test.tsx
    - src/__tests__/components/AppSidebar.test.tsx
    - src/__tests__/components/QuickSearchModal.test.tsx
    - src/__tests__/hooks/useViewState.test.ts
    - src/__tests__/hooks/useViewState.test.tsx
    - src/__tests__/integration/App.test.tsx
    - src/__tests__/pages/resource-browser.test.tsx

key-decisions:
  - "fix 5: ProviderService::import_providers_from_sql_with_selected_ids 新签名 — selected_ids: &[String] + active_root 保持向后兼容(empty Vec 必 Err,D-18 + CLAUDE.md §7)"
  - "fix 5: Preview 子组件把 selected Set 透传给父 handleConfirm(selectedIds: string[]),Preview 内仍持 selected state(不在父重复 useState 镜像)"
  - "fix 6: 共享 McpManagementPanel 提取推迟 — 本 plan 直接复用 McpManagementPage 实体作为共享 component;功能等价但 page 本身仍存在(1 个 milestone 后删除)"
  - "fix 6: URL ?tab=mcp 走 window.location.search parse (项目不用 react-router;见 useViewState.tsx header 注释)"
  - "fix 6: 侧边栏 sidebar-item-mcp-management testid 彻底消失,而不是 alias 到 sidebar-item-resource-browser(避免 e2e 误命中老入口)"
  - "fix 6: resource-browser mcp tab 走 McpManagementPage(沿用 27-01 fix 4 useScope + key remount,scope 切换也重 mount)"

requirements-completed:
  - BUG-CR-05
  - BUG-CR-04 (子件 — MCP 合并重构)

# Coverage metadata — drives DETERMINISTIC UAT routing in verify-work
coverage:
  - id: D5-fix5
    description: "SQL 导入 selected_ids (D-15~D-18): 勾 N 个导入 N 个;selected_ids 为空时 Err;distinct 计数正确;UNIQUE(provider_name, source_path) 由 fs::exists 检查"
    requirement: BUG-CR-05
    verification:
      - kind: unit
        ref: "cd src-tauri && cargo test --lib services::provider_service (62/62 PASS including 4 new fix5_*)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/import-sql.test.tsx (28/28 PASS including 3 new fix 5 case)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/m6-p27-fix5-sql-import-count.spec.ts (Windows-only Playwright, file verified by inspection on macOS)"
        status: unknown
    human_judgment: false

  - id: D6-fix6
    description: "MCP 合并到 ResourceBrowser (D-10~D-14): /mcp-management 路由删除 (D-10);ViewId union 移除;ALL_VIEWS 12 → 11;sidebar 删 'MCP 管理' 入口 (D-12);URL ?tab=mcp 接管 mcp tab (D-11);老 localStorage 'mcp-management' remap 到 /resource-browser?tab=mcp (D-13);schema 不合并 — ResourceService.list_mcp 委托 McpService 单一数据源 (D-14)"
    requirement: BUG-CR-04
    verification:
      - kind: unit
        ref: "cd src-tauri && cargo test --lib services::resource_service (11 new+existing PASS including 2 new list_mcp_*)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/components/AppSidebar.test.tsx (6/6 PASS — sidebar-item-mcp-management 不渲染)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/resource-browser.test.tsx (47/47 PASS — mcp tab 渲染 McpManagementPage, 2 旧 mcp.json ResourceItem 测试改写为 fix 6 smoke)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/m6-p27-fix6-mcp-merge.spec.ts (Windows-only Playwright, file verified by inspection on macOS)"
        status: unknown
    human_judgment: false

duration: ~14 min (parallel: pre-loaded useScope + ResourceBrowser fix 4 refactor; fix 5 ~5 min, fix 6 ~9 min)
tasks: 2
---

# Phase 27 Plan 02: v3.2 M6 Critical 5 Bug — Fix 5 + Fix 6 Summary

Delivered BUG-CR-05 (SQL selected-IDs import count) and the BUG-CR-04 MCP merge refactor — closing the v3.2 M6 critical 5 bug set started in plan 27-01.

## Commits

- `7175da2` test(27-5): add failing tests for SQL import selectedIds (BUG-CR-05)
- `a48863d` fix(27-5): sql import selected IDs + distinct count + empty Err
- `9dbb5d9` test(27-6): add failing tests for MCP merge to ResourceBrowser
- `a7f754c` fix(27-6): mcp merge to resource-browser + sidebar cleanup + legacy redirect

## Test Summary

- Rust: 6 new test cases pass (provider_service: 4 fix5_*, resource_service: 2 list_mcp_*)
- TS: ~10 modified/new test cases pass (import-sql: 3 fix 5, AppSidebar: 2 fix 6, useViewState: 3 fix 6 + 1 stale remap, QuickSearchModal: re-target, App.test: 2 fix 6, resource-browser: 2 fix 6 rewrite)
- e2e: 2 new spec files added (Windows Playwright — not run on this macOS dev box)
- **Zero new dependencies** (CLAUDE.md §2.3)
- **Zero new capabilities** (Tauri security unchanged)
- **Zero changes to** tauri.conf.json / Cargo.toml / package.json (CLAUDE.md §6.5)
- **Zero changes to** mcp_servers SQLite schema (D-14 — schema not merged)

## Deviations from Plan

- **Shared McpManagementPanel extraction deferred.** Plan §task 2 called for extracting `src/components/McpManagementPanel.tsx` as a shared component reused by the old `/mcp-management` route and the new ResourceBrowser mcp tab. Instead, fix 6 directly reuses the existing `McpManagementPage` entity (which is also a React component): the page imports cleanly, keeps the useScope + key remount pattern from 27-01 fix 4, and shares functionality with the old route. A future milestone can extract the panel without changing the merge surface.
- **CLAUDE.md §6.5 names left unchanged.** No changes to tauri.conf.json productName / Cargo.toml name / package.json name (display vs system ID layer preserved).
- **D-30 backlog unchanged.** No work on F2 switch atomic / F13 backup / sqlite read settings / F18 finding expiration (deferred to v3.2.1).
- **D-29 sequential not parallel.** 27-02 ran as 1 subagent in 1 slot (not 4-slot parallel) because fix 6 needed ResourceBrowser + App.tsx co-edits, and fix 5 + fix 6 file overlap is limited but context-heavy. The plan was authored for 1 sequential subagent (D-29 "第 2 批 1 subagent").
- **Total deviations: 1 (McPManagementPanel deferred).** No code quality impact.

## Known Stubs (per 27-01 SUMMARY convention)

- `src/components/McpManagementPanel.tsx` — not created; `McpManagementPage` entity serves as the shared component. Documented in `src/pages/resource-browser/index.tsx` import comment. Future milestone: extract panel.
- `src/pages/mcp-management/index.tsx` — page body kept for 1 milestone per D-13; can be deleted once all users have localStorage cleared (no automatic trigger — manual cleanup). `ccm.lastView='mcp-management'` reads default to 'home' now, so old data is harmless.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: surface_change | src-tauri/src/commands/providers.rs | `import_providers_from_sql` IPC arg shape changed (added `selected_ids: Vec<String>`). Forward compat: old callers with 1 arg will fail to deserialize. Mitigated by single-frontend-caller + synchronous release. |
| threat_flag: route_removal | src/App.tsx | `view === 'mcp-management'` ternary deleted. Old localStorage value 'mcp-management' auto-remaps to /resource-browser?tab=mcp via D-13 useEffect. |
| threat_flag: schema_unchanged | (none) | D-14 honored — no new SQLite tables, no new fields, no migration. Single data source for MCP = `mcp_servers` table (McpService). |

## Next

Ready for Phase 28 (business bugs #5 plugins data source / #9 JSON tree default expand) and beyond. v3.2 M6 critical 5 bug set (BUG-CR-01..05) complete.

CLAUDE.md §10 invariants upheld: no new dependencies, no version bumps, no capabilities changes, no silent error swallowing (empty selectedIds → explicit Err; D-13 stale remap → explicit useEffect, not silent migration).
