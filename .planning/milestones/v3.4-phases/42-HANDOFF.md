---
gsd_handoff_version: 1.0
handoff_at: 2026-06-28
handoff_from: claude-opus-4-8 (主 session)
handoff_to: next session / user
based_on: commits c802bc4 + eabf24f (Phase 42 partial)
---

# Phase 42 Handoff — IPC dispatch 重构接力文档

## 当前状态

**Phase 42 已 ship (partial)**:
- ✓ Task 1: inventory crate + ServiceRegistry Arc 终态 (commit c802bc4)
  - 157 行 ServiceRegistry + 5/5 单测 PASS
  - API 直接对齐 D-45-A 终态(register_arc + get → Arc)
- ✓ Task 2: provider_switch 后端 stub 删 (SHIP-A 决策)
- ⚠ Task 3 partial: DispatchTable + CommandSpec ship (commit eabf24f)
  - 267 行 dispatch.rs + 4/4 单测 PASS
  - **80 commands 物理迁移未做**
- ✗ Task 4-6: lib.rs 改造 + smoke test 强验收

## 已 ship 文件清单

| 文件 | 行数 | commit |
|---|---|---|
| src-tauri/Cargo.toml | +7 (inventory = "=0.3.24") | c802bc4 |
| src-tauri/src/plugins/service_registry.rs | 157 (NEW) | c802bc4 |
| src-tauri/src/plugins/dispatch.rs | 267 (NEW) | eabf24f |
| src-tauri/src/plugins/mod.rs | +5 (service_registry + dispatch mod) | c802bc4 / eabf24f |
| src-tauri/src/plugins/stubs/mod.rs | -3 (provider_switch export) | eabf24f |
| src-tauri/src/plugins/stubs/provider_switch.rs | -16 (DELL) | eabf24f |

## Phase 42 剩余工作 (Task 3 续 + Task 4-6)

### Task 3 续: 80 commands 物理迁移到 13 stub

每个 stub 文件结构模板(参考 marketplace 改造):

```rust
//! F17 — 资源市场 (plugin commands).

use tauri::ipc::Invoke;
use crate::app_state::AppState;
use crate::plugins::dispatch::CommandSpec;
use crate::services::marketplace_service::{ ... };

/// Dispatch wrapper for list_marketplace_repos.
pub fn dispatch_list_marketplace_repos(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.app_handle.state::<AppState>();
    tauri::async_runtime::block_on(async move {
        match state.marketplace_service.list_builtin_repos() {
            Ok(v) => invoke.resolver.respond(Ok(v)),
            Err(e) => invoke.resolver.respond(Err(e)),
        }
    });
    true
}

// ... 5 more dispatch fns for clone_and_scan / install_from_marketplace / install_builtin_plugin / install_third_party_repo / install_npx_package

inventory::submit!(CommandSpec {
    name: "list_marketplace_repos",
    plugin_id: "marketplace",
    dispatch: dispatch_list_marketplace_repos,
});
// ... 5 more inventory::submit! for each command
```

**13 stub 拆分表**:

| commands/ 源 | plugins/stubs/ 目标 | 命令数 |
|---|---|---|
| providers.rs (16) | provider_list (13) + import_sql (3) | 16 |
| mcp.rs (8) | mcp_management | 8 |
| backup.rs (9) | backup_restore | 9 |
| history.rs (8) | history_view (NEW, src-tauri/src/plugins/stubs/history_view/mod.rs) | 8 |
| project.rs (7) | project_mode (NEW, src-tauri/src/plugins/stubs/project_mode/mod.rs) | 7 |
| marketplace.rs (6) | marketplace | 6 |
| fs.rs (6) | file_ops (NEW, src-tauri/src/plugins/stubs/file_ops/mod.rs) | 6 |
| optimizer.rs (5) | optimizer | 5 |
| usage.rs (4) | usage_query | 4 |
| updater.rs (3) | updater (NEW, src-tauri/src/plugins/stubs/updater/mod.rs) | 3 |
| resource.rs (3) | resource_browser | 3 |
| autostart (2) + app (1) + about (1) | core (Phase 43 合并,本 phase 暂放 autostart-plugin placeholder) | 4 |
| **合计** | **13 stub** | **80** |

> 4 个 NEW stub (history_view / project_mode / file_ops / updater) 走 `src-tauri/src/plugins/stubs/<id>/mod.rs` 子目录形式,以便加 `commands.rs` 子文件。

### Task 4: lib.rs::setup 改造

```rust
// 删 lib.rs:106 `tauri::generate_handler![80 commands...]`
// 改:
.invoke_handler(crate::plugins::dispatch::make_invoke_handler(
    crate::plugins::dispatch::DispatchTable::from_inventory(),
))
```

### Task 5: 新单测

```rust
// src-tauri/src/plugins/dispatch.rs 加 test
#[test]
fn from_inventory_includes_all_real_commands() {
    let table = DispatchTable::from_inventory();
    assert!(table.len() >= 80); // 80+ commands from 13 plugins
}
```

### Task 6: smoke test 10/10

```bash
cd /Users/coderstory/CodeSource/winui3
bash scripts/build-and-ship.sh --smoke-only 2>&1 | tail -30
```

期望 10/10 PASS。

## 关键技术提示 (避免前人 stall)

1. **`tauri::ipc::Invoke`** (v2 实际位置,非根 re-export)
2. **`inventory::collect!(CommandSpec)`** 必须调一次(注册类型到全局)
3. **`inventory::submit!(CommandSpec { ... })`** 在每个 plugin commands.rs 内
4. **`inventory::iter::<T>()`** 实现 IntoIterator 直接 for-loop,无需 `.into_iter()`
5. **`tauri::async_runtime::block_on`** 包 async fn (commands 改 sync fn 简单,但 async 仍兼容)
6. **`invoke.app_handle.state::<AppState>()`** 拿 state (替代 `State<'_, AppState>` 参数)
7. **`invoke.resolver.respond(Ok/Err<T>)`** 返回结果
8. **`fn dispatch_xxx(invoke: Invoke<Wry>) -> bool`** 签名,不是 async fn (dispatch 顶层需 sync)

## 不变量 (跨 subagent 守住)

- AppState 9 个 Arc<crate::services::> 字段保留 (Phase 45 才缩)
- frontend 23 处 invoke 命令名不变 (Tauri 全局 namespace)
- 不引入额外依赖 (除 inventory = 0.3.24)
- 不修改 SPEC.md / CLAUDE.md

## 估计剩余工作量

- 80 commands 物理迁移: 4-6 小时纯机械改造
- 13 stub 文件 + 4 NEW stub 目录: ~30-50 行 × 13 ≈ 400-650 行新增
- 80 dispatch fn + 80 inventory::submit!: ~5-10 行 × 80 ≈ 400-800 行新增
- lib.rs 改造: 1 行改
- 测试 + smoke: 30 分钟
- **总计**: 6-8 小时

## 强验收 (Phase 47 验证)

1. `grep -c 'tauri::generate_handler!' src-tauri/src/lib.rs` 期望 **0**
2. `grep -rc '#\[tauri::command\]' src-tauri/src/commands/` 期望 **0**
3. `grep -rn 'inventory::submit!' src-tauri/src/plugins/ | wc -l` 期望 **80**
4. `cargo test plugins::dispatch::tests` 期望 **5/5** PASS (现有 4 + 新 1)
5. smoke test **10/10** PASS
6. **"加 1 plugin 改 1 文件"**: 删 1 plugin 命令 → lib.rs / commands/ 0 改动

## 相关文档

- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/42-PLAN.md` (567 行,详细 task)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/42-DECISIONS.md` (5 OQ 关闭)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-DECISIONS.md` (5 BLOCKING)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/V3.4-VERIFICATION.md` (强验收矩阵)

## Commit 节奏

每个 stub 一个 commit (13 commits),最后 lib.rs + smoke 一个 commit。共 14 commit 完成 Phase 42。