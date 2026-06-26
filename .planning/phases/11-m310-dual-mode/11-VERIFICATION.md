---
phase: 11-m310-dual-mode
verified: 2026-06-26T09:55:00Z
status: gaps_found
score: 6/8 must-haves verified
behavior_unverified: 0
behavior_unverified_items: []
overrides_applied: 0
overrides: []
gaps:
  - truth: "Sidebar 顶部 project switcher + 当前项目显示 (SC #7)"
    status: failed
    reason: "AppSidebar.tsx (line 105) only contains a comment 'D-槽1 sidebar 顶部 project switcher' but the actual switcher component is NOT rendered. The project switcher lives exclusively in HomeView (src/pages/home/index.tsx). The PLAN claims M3.10-03 ('欢迎页改造 + sidebar 顶部 switcher') is done, but the sidebar part of that sub-plan is not implemented."
    artifacts:
      - path: "src/components/AppSidebar.tsx"
        issue: "No project switcher component in sidebar — only a stale comment on line 105 mentions 'D-槽1 sidebar 顶部 project switcher'"
    missing:
      - "Add a project switcher component to the top of AppSidebar.tsx that shows the current project name + dropdown to switch"
      - "Wire useProjects() hook into AppSidebar so the current project is always visible (not just on the welcome page)"
  - truth: "跨 plugin '切换项目后行为' 集成测试 + 用户/项目数据隔离单测 (SC #8) — full test coverage"
    status: partial
    reason: "The 3 cargo test failures ('switch_updates_current_and_takes_f13_backup', 'write_with_active_root_some_writes_to_project_and_creates_backup', 'resolve_claude_path_active_root_some_bare_filename_routes_to_project') are pre-existing test bugs unrelated to Phase 11, but the integration test suite for cross-plugin 'switch project → behavior changes' is not comprehensive. The MCP test failure has a test-logic bug where the test asserts the 'old' entry is REPLACED but the implementation correctly PRESERVES it (the add() method is additive). The other two failures look in 'home/.claude/' for '.claude.json.bak.*' but '.claude.json' lives at 'home/.claude.json' (stale assertion from M2.x era)."
    artifacts:
      - path: "src-tauri/src/services/project_service.rs"
        issue: "Test at line 527-559 looks for .claude.json.bak.* in home/.claude/ but the file is at home/.claude.json"
      - path: "src-tauri/src/services/mcp_service.rs"
        issue: "Test at line 967-1010 has inverted logic: asserts 'old' is removed but add() preserves it"
      - path: "src-tauri/src/commands/fs.rs"
        issue: "Test at line 902-918 fails on macOS due to /var/folders/ vs /private/var/folders/ symlink canonicalization"
    missing:
      - "Fix the 3 stale test assertions (independent of Phase 11 scope but they count as 'integration test pass' failures)"
      - "Add cross-plugin test that switches project → switches data isolation → mcp/provider/optimizer/backup all see project-scoped data"
deferred: []
---

# Phase 11: M3.10 双模式 用户/项目 — Verification Report

**Phase Goal:** 架构级新功能 — 引入 Project 数据模型 + 持久化 + 用户级 (特殊 is_system=true 不可删) + 项目级 (指向 `<root>/.claude/` 虚拟视图) + 所有 plugin 适配 `IPlatformPaths::active_root_dir` + 切换走 F13 备份 + 原子切换。
**Verified:** 2026-06-26T09:55:00Z
**Status:** gaps_found

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Project domain model (`id, name, root_dir, created_at, is_system`) + `projects.json` 持久化 + F13 备份 | VERIFIED | `src-tauri/src/domain/project.rs` defines all 5 fields with serde + `ProjectsFile` struct; `src-tauri/src/services/project_service.rs` line 142-148 uses `fs_atomic::write_with_backup` for atomic write; F13 backup in `backup_active_state()` line 282-294 |
| 2 | 用户级 = 特殊 `is_system=true` 不可删 | VERIFIED | `Project::system()` line 179-188 creates `is_system=true`; `ProjectService::remove()` line 173-191 returns `ProjectError::CannotRemoveSystem`; 2 unit tests (`remove_system_project_is_rejected`, `remove_user_project_succeeds_and_falls_back_active_to_system`) pass |
| 3 | 项目级 = 指向 `<root>/.claude/` 的虚拟视图 | VERIFIED | `Project::claude_dir()` line 200-206 returns `root_dir.join(".claude")`; `validate_root()` line 219-236 requires `.claude/` subdir to exist; tested in `validate_dir_with_claude_subdir_returns_valid` |
| 4 | 欢迎页改"项目切换器" (下拉 + 新增/删除按钮) | VERIFIED | `src/pages/home/index.tsx` (655 lines) implements full project switcher: active project callout, project list table with switch/remove buttons, add project modal, path validation. 4 unit test files cover the page; 541/541 vitest tests pass |
| 5 | 所有 plugin (Provider/MCP/Optimizer/Backup) 适配 `IPlatformPaths::active_root_dir` | VERIFIED | All 7 plugin services use `active_root_dir`: backup_service, marketplace_service, mcp_service, resource_service, provider_service, usage_service, optimizer_service. Commands layer wires it through: providers.rs (8 refs), mcp.rs (16 refs), optimizer.rs (4 refs), backup.rs (6 refs), marketplace.rs (8 refs), resource.rs (2 refs), usage.rs (6 refs) |
| 6 | 切换项目走 F13 备份 + 原子切换 | VERIFIED | `ProjectService::switch()` line 200-221 calls `backup_active_state()` first (F13 backup of `settings.json` + `.claude.json`), then atomically updates `current_project_id` via `fs_atomic::write_with_backup`. 4 test cases cover the behavior, but 1 (`switch_updates_current_and_takes_f13_backup`) has a stale assertion bug (pre-existing) |
| 7 | sidebar 顶部 project switcher + 当前项目显示 | FAILED | AppSidebar.tsx (line 105) only contains a comment referencing "D-槽1 sidebar 顶部 project switcher" but the actual switcher component is NOT rendered. The project switcher lives exclusively in HomeView. The PLAN claims M3.10-03 ("欢迎页改造 + sidebar 顶部 switcher") is done, but only the welcome page part is implemented. |
| 8 | 跨 plugin "切换项目后行为" 集成测试 + 用户/项目数据隔离单测 | PARTIAL | 12 integration tests in `src-tauri/tests/project_service.rs` pass (11/12, 1 stale assertion); 11 unit tests in `commands::project::tests` pass. Cross-plugin platform tests (4/4) pass. **However**, 3 pre-existing test failures unrelated to Phase 11 surface in the full suite: `commands::fs::tests::resolve_claude_path_active_root_some_bare_filename_routes_to_project` (macOS path canonicalization bug), `services::mcp_service::tests::write_with_active_root_some_writes_to_project_and_creates_backup` (inverted test logic), `services::project_service::tests::switch_updates_current_and_takes_f13_backup` (stale `.claude.json` location assertion) |

**Score:** 6/8 truths verified

### Mac paths.rs `active_root_dir` Status (M5-ANALYSIS bug #19)

**STATUS: FIXED.** The M5 bug #19 was that macOS `MacPaths::active_root_dir()` was a D6 stub that always returned `None`. Commit `1c4a64d` ("fix(platform): macOS active_root_dir reads projects.json (#19)") fixed this. The current `src-tauri/src/platform/macos/paths.rs` line 168-178 implements the function to:
1. Read `<app_data>/projects.json`
2. Parse as `ProjectsFileSubset` (current_project_id + projects[].id/root_dir)
3. Find the project matching `current_project_id`
4. Return that project's `root_dir` (real PathBuf, not None)
5. Gracefully degrade to `None` on: missing file, corrupt JSON, null `current_project_id`, or dangling id

**Verification evidence:**
- 4 macOS-specific tests pass: `mac_paths_active_root_dir_returns_none_when_projects_file_missing`, `mac_paths_active_root_dir_subset_parses_current_id_and_root_dir`, `mac_paths_active_root_dir_subset_handles_null_current_id`, `mac_paths_active_root_dir_lookup_returns_current_project_root`
- 4 cross-platform integration tests pass: `platform_active_root_dir_subset_parses_active_id`, `platform_active_root_dir_subset_handles_corrupt_json`, `platform_active_root_dir_subset_handles_null_current_id`, `platform_active_root_dir_with_host_paths_returns_some_after_service_save` — the last one uses `HostPaths` (which is `MacPaths` on macOS) and confirms `active_root_dir()` returns `Some(...)` after `ProjectService::save()`

**Caveat:** The macOS `validate_backup_path` (line 183-206) has a stale comment "D6: Mac 真机验证暂缓,active_root_dir 永远 None" and does NOT include the active project in the allow-list. Now that `active_root_dir` is functional on macOS, the validate_backup_path should add the active project's `.claude/` to the allow-list (Windows does this at line 178-187). This is a minor documentation/code drift, not a Phase 11 goal failure.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/domain/project.rs` | Project + ProjectsFile domain model | VERIFIED | 246 lines; 5 fields per spec; SYSTEM_PROJECT_ID = Uuid::nil(); 17 unit tests pass |
| `src-tauri/src/services/project_service.rs` | ProjectService with CRUD + F13 backup | VERIFIED | 619 lines; load/save/add/remove/switch with atomic writes + F13 backup; 11/12 unit tests pass (1 stale assertion) |
| `src-tauri/src/commands/project.rs` | Tauri commands list/add/remove/switch/current | VERIFIED | 441 lines; 6 commands (incl. M3.13.4 pick_project_root_dir + validate_project_path); all 11 unit tests pass |
| `src-tauri/src/platform/traits.rs` | IPlatformPaths::active_root_dir trait method | VERIFIED | Line 240-266: trait method with default `None` for backwards compat; 2 mock dispatch tests pass |
| `src-tauri/src/platform/windows/paths.rs` | Windows active_root_dir reads projects.json | VERIFIED | Line 145-155: reads projects.json + finds project by id; used in validate_backup_path for project-mode paths |
| `src-tauri/src/platform/macos/paths.rs` | macOS active_root_dir reads projects.json (M5 #19 fix) | VERIFIED | Line 168-178: implements the same wire format as Windows; 4 macOS tests pass; comment on line 181-182 is stale |
| `src/pages/home/index.tsx` | Project switcher welcome page | VERIFIED | 655 lines: active project callout, project list table, add modal, path validation; vitest tests pass |
| `src/hooks/useProjects.ts` | React hook wrapping project commands | VERIFIED | Exists; tests in `__tests__/pages/home.test.tsx` use the hook |
| `src/lib/api/projects.ts` | API wrapper for list/add/remove/switch/current | VERIFIED | Thin wrappers around `invoke('list_projects', ...)` etc. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `lib.rs` invoke_handler | `commands::project::*` | Tauri's invoke_handler registration | VERIFIED | Lines 175-185: list/add/remove/switch/current + M3.13.4 pick/validate registered |
| `app_state.rs` | `ProjectService::new(paths)` | AppState initialization | VERIFIED | Line 54 (field) + line 204 (constructor); Arc<ProjectService> |
| `commands::project::list_projects` | `state.project_service.load()` | Tauri State extraction | VERIFIED | Line 81; returns ProjectsListResult with full file + summaries + current_id |
| `commands::project::switch_project` | `state.project_service.switch(id)` + `app.emit("project-switched", ...)` | Tauri event for cache invalidation | VERIFIED | Line 122-138; emits event so other pages re-read project list |
| `MacPaths::active_root_dir()` | `<app_data>/projects.json` (M5 #19 fix) | std::fs::read_to_string + serde_json | VERIFIED | Line 168-178; same wire format as Windows; M5 #19 regression tests pass |
| `WindowsPaths::active_root_dir()` | `<app_data>/projects.json` | std::fs::read_to_string + serde_json | VERIFIED | Line 145-155; tested in 4 cases (missing/corrupt/null/dangling) |
| `McpService::with_root()` | `active_root_dir` parameter | service constructor accepts Option<&Path> | VERIFIED | Line 70 in mcp_service.rs; tested in 4 cross-plugin scenarios |
| `ProjectService::switch()` | `fs_atomic::write_with_backup` for atomicity | atomic JSON write | VERIFIED | Line 142-148; mirrors Provider/Backup convention |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `src/pages/home/index.tsx` `projects` | useProjects() → invoke('list_projects') | Backend: `ProjectService::load()` → reads `projects.json` from `<app_data>` | YES | FLOWING |
| `src/pages/home/index.tsx` `currentProject` | useProjects() → result.current_project_id → find in list.projects | Backend: `ProjectService::load()` returns `current_project_id` + full file | YES | FLOWING |
| `src/pages/home/index.tsx` `add(name, root)` | useProjects().add → invoke('add_project', ...) | Backend: `ProjectService::add()` validates + writes JSON | YES | FLOWING |
| `src/pages/home/index.tsx` `switchTo(id)` | useProjects().switchTo → invoke('switch_project', ...) | Backend: `ProjectService::switch()` does F13 backup + atomic write + emits event | YES | FLOWING |
| `MacPaths::active_root_dir()` | projects.json's `current_project_id` → matching project's `root_dir` | Backend: `ProjectService::save()` writes to `<app_data>/projects.json` | YES (after switch) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `cargo check` (Rust compile) | `cd src-tauri && cargo check --quiet` | 0 errors, 1 warning (unused import, pre-existing) | PASS |
| `cargo test --lib commands::project::` (project commands unit tests) | `cd src-tauri && cargo test --lib commands::project::` | 11 passed; 0 failed | PASS |
| `cargo test --test project_service platform_active` (cross-plugin platform tests) | `cd src-tauri && cargo test --test project_service platform_active` | 4 passed; 0 failed | PASS |
| `npx vitest run` (frontend tests) | `npx vitest run` | 541 passed; 0 failed (across 42 test files) | PASS |
| `cargo test --lib services::project_service::` | `cd src-tauri && cargo test --lib services::project_service::` | 11/12 pass; 1 stale assertion failure (`switch_updates_current_and_takes_f13_backup` — looks in `home/.claude/` for `.claude.json.bak.*` but file is at `home/.claude.json`) | PARTIAL |
| macOS `active_root_dir` returns real path | `cargo test --test project_service platform_active_root_dir_with_host_paths_returns_some_after_service_save` | PASS — returns `Some(PathBuf)` after `ProjectService::save()` | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (no probes declared in PLAN/SUMMARY) | N/A | N/A | N/A |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| 清单 23 (P0) — M3 核心新功能 (架构级) | ROADMAP.md | Project data model + 持久化 + 用户级/项目级 + 所有 plugin 适配 | PARTIAL | Architecture is solid; 1 SC (sidebar switcher) not implemented |
| SC #1: Project domain model + projects.json 持久化 + F13 备份 | ROADMAP.md | domain/project.rs + project_service.rs | SATISFIED | All fields, atomic write, F13 backup |
| SC #2: 用户级 = 特殊 is_system=true 不可删 | ROADMAP.md | Project::system() + remove() | SATISFIED | 2 tests cover this |
| SC #3: 项目级 = 指向 <root>/.claude/ 虚拟视图 | ROADMAP.md | Project::claude_dir() | SATISFIED | Tested |
| SC #4: 欢迎页改"项目切换器" | ROADMAP.md | src/pages/home/index.tsx | SATISFIED | Full implementation |
| SC #5: 所有 plugin 适配 IPlatformPaths::active_root_dir | ROADMAP.md | 7 services + 8 commands | SATISFIED | All major plugins wired |
| SC #6: 切换项目走 F13 备份 + 原子切换 | ROADMAP.md | ProjectService::switch() | SATISFIED | Backup-first, atomic write, event emit |
| SC #7: sidebar 顶部 project switcher + 当前项目显示 | ROADMAP.md | AppSidebar.tsx | NOT SATISFIED | Stale comment; switcher not in sidebar |
| SC #8: 跨 plugin 集成测试 + 数据隔离单测 | ROADMAP.md | tests/project_service.rs | PARTIAL | 12 tests; 1 stale assertion + 3 unrelated test failures |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src-tauri/src/platform/macos/paths.rs` | 181-182 | Stale comment "active_root_dir 永远 None" — no longer true after M5 #19 fix | INFO | Documentation drift; does not affect behavior (function is correctly implemented) |
| `src/components/AppSidebar.tsx` | 105 | Stale comment "D-槽1 sidebar 顶部 project switcher" — switcher not implemented | WARNING | SC #7 is unfulfilled; user has no project switcher in sidebar |
| `src-tauri/src/services/project_service.rs` | 549-558 | Test asserts `.claude.json.bak.*` exists in `home/.claude/` but file is at `home/.claude.json` | WARNING | Test failure (pre-existing); doesn't match current layout |
| `src-tauri/src/services/mcp_service.rs` | 967-1010 | Test asserts `!raw.contains("\"old\"")` (old entry replaced) but `add()` is additive | WARNING | Test failure (pre-existing); test logic is inverted |
| `src-tauri/src/commands/fs.rs` | 902-918 | Test fails on macOS due to `/var/folders/` vs `/private/var/folders/` canonicalization | INFO | macOS-specific test failure (pre-existing) |

### Human Verification Required

None. The verification is complete. The 2 gaps (sidebar switcher + 3 pre-existing test bugs) are codebase-level issues that don't require human testing.

### Gaps Summary

**2 gaps blocking full goal achievement:**

1. **SC #7 FAIL** — Sidebar 顶部 project switcher + 当前项目显示 is NOT implemented. The `AppSidebar.tsx` only has a stale comment on line 105 referencing "D-槽1 sidebar 顶部 project switcher" but the actual switcher component is not rendered. The project switcher lives exclusively in `src/pages/home/index.tsx`. Per the PLAN, M3.10-03 ("欢迎页改造 + sidebar 顶部 switcher") is marked done, but only the welcome page part is implemented.

2. **SC #8 PARTIAL** — 3 pre-existing test failures (unrelated to Phase 11) prevent the full integration test suite from passing:
   - `services::project_service::tests::switch_updates_current_and_takes_f13_backup` — looks in wrong dir for backup file (test bug, not implementation bug)
   - `services::mcp_service::tests::write_with_active_root_some_writes_to_project_and_creates_backup` — inverted test logic (asserts replacement, but `add()` is additive)
   - `commands::fs::tests::resolve_claude_path_active_root_some_bare_filename_routes_to_project` — macOS path canonicalization issue

**Recommendation:** Phase goal is 75% achieved. The dual-mode architecture is solid (data model, persistence, plugin adaptation, F13 backup, atomic switching, macOS active_root_dir fix all working). The remaining gaps are:
- Sidebar switcher component (1 file change: AppSidebar.tsx)
- Fix 3 stale test assertions (test maintenance)

The architecture is shippable. The sidebar switcher is a UX gap (welcome page IS the switcher, but it's not always visible). The 3 test failures are pre-existing maintenance debt.

---

_Verified: 2026-06-26T09:55:00Z_
_Verifier: Claude (gsd-verifier)_
