# Phase 45 PLAN — Service Plugin 拓扑序初始化 + AppState 收缩

**Phase:** 45
**Goal:** 把 9 个 `Arc<crate::services::xxx>` 字段从 AppState 抽出 → 9 个 service plugin, 通过 `ServiceRegistry` Arc 路径分发; `init_all_topological` 拓扑序 init (DFS 3-color); 真实 12 处 `state.<svc>_service.xxx` 改 `get_service!` macro; 达成 "加 1 service 只动 1 文件" 强验收。

---

## 0. 输入基线与数字修正 (verify-first 实测, 2026-06-27)

| 项 | 45-DECISIONS 估算 | 真实 (grep 验证) | 来源 |
|---|---|---|---|
| AppState `Arc<crate::services::>` 字段数 | 9 | **9** | `app_state.rs:26-63` (provider/mcp/backup/usage/optimizer/resource/marketplace/project/history) |
| `commands/*.rs` `state.<svc>_service.` 直访数 | 28 | **12** | backup:1 + history:6 + project:2 + marketplace:1 + optimizer:1 + mcp:1 = 12 |
| `services/*.rs` 总数 | 11 (含 usage_provider_ccswitch) | **11** | `ls src-tauri/src/services/` (10 主服务 + 1 helper) |
| 业务 plugin 总数 (Phase 42 ship 后) | 13 | **10** (Phase 42 SHIP-A 删 provider_switch, Phase 46 删 mcp_management 后剩 9) | `ls src-tauri/src/plugins/stubs/*.rs` |
| service plugin 总数 | 9 | **9** | history/backup/provider/usage/mcp/optimizer/resource/marketplace/project |

**修正声明**:
- 45-DECISIONS.md §1 + §2.4 估 28 处 → 实测 12 处; commands/services/ 共 12 个 `state.<svc>_service.` 直访
- 45-DECISIONS.md §5 估 AppState 9 字段 → 实测 **9 字段** (orchestrator prompt 提"13"误, grep 验证 9)
- 45-DECISIONS.md §1 强验收 grep "AppState 0 个 Arc<crate::services>" → 用 grep `^    pub [a-z_]+_service: Arc<crate::services::` 应 0 命中验证

**输入 1** `.planning/milestones/v3.4-DECISIONS.md` — 5 BLOCKING 已关闭 (D-42-A inventory §2.3 白名单, SHIP-A provider_switch 合并 provider_list, D-45-A ServiceRegistry Arc 路径, D-CC-A PluginContext 4 字段 + init &mut 签名)

**输入 2** `.planning/milestones/v3.4-phases/00-VERIFY-FIRST-DRIFT-REPORT.md` — 实测基线:80 commands / 23 invoke / 10 stub plugin / 11 service

**输入 3** `.planning/milestones/v3.4-phases/45-RESEARCH.md` — Phase 45 研究产物 (DFS 3-color 选型, ServiceRegistry Arc 路径, 9 service 拓扑序)

**输入 4** `.planning/milestones/v3.4-phases/45-DECISIONS.md` — Phase 45 discuss G1-G10 已关闭 (G1 ServiceRegistry Arc, G2 services() 全空 vec, G3 history_db backfill 移到 plugin init, G4 get_service! macro, G5 DFS 3-color, G6 D-CC-A 冻结, G7 业务 plugin depends_on 同步补, G8 全动态, G9 history best-effort, G10 HashMap 迭代序)

**输入 5** `.planning/milestones/v3.4-phases/42-PLAN.md` (567 行, commit fbd09fc) — Phase 42 ServiceRegistry Arc 路径 API + inventory::submit! 注册契约 (Phase 42 ship 后落盘: `plugins/service_registry.rs` + `plugins/dispatch.rs` + 13 stub 全迁移)

**输入 6** `.planning/milestones/v3.4-phases/43-PLAN.md` — Phase 43 PluginContext 加 `host` 字段 (Phase 45 直接消费)

**磁盘现状 (2026-06-28)**:
- Phase 42 PLAN ship (commit fbd09fc) 但 **Phase 42 execute 未运行**: `plugins/service_registry.rs` / `plugins/dispatch.rs` 尚未落盘, 业务 stub 仍 `Box<dyn IPlugin>` 旧签名 (init `&PluginContext`), commands/ 14 文件 80 命令原状
- Phase 45-01 第一步 = 验证 Phase 42 ship 状态: 若 `plugins/service_registry.rs` 存在 → 接 Phase 42 产出继续; 若不存在 → 走 §风险 R1 API 漂移兜底 (Phase 45 Task 1 顺便落实 service_registry.rs)

---

## 1. Goal (强验收 = phase 完成标准)

> **核心强验收 (45-DECISIONS §强验收)**:
> 1. **ServiceRegistry Arc 终态 API**: `register_arc<T>(&self, svc: Arc<T>)` + `get<T>() -> Option<Arc<T>>` 字节级匹配 D-45-A
> 2. **`IPlugin::depends_on()` 默认空 vec**: 9 service plugin 各声明自身依赖
> 3. **`PluginContext` 4 字段已就位**: `app` + `paths` + `host: Option<&'a PluginHost>` + `services: Option<&'a mut ServiceRegistry>` (Phase 42/43 已 ship)
> 4. **9 service plugin 全部新建**: history/backup/provider/usage/mcp/optimizer/resource/marketplace/project, 每个 `services() = vec![]` (G2 全动态)
> 5. **`topological.rs` (NEW) + 4 单测**: DFS 3-color + DAG / cycle / missing dep / multi-deps → 4 PASS
> 6. **`PluginHost::init_all_topological` + 4 单测**: 拓扑序 init (refcount=1 时 Arc::get_mut OK), init 后再 `app.manage` → 4 PASS
> 7. **AppState 缩到 < 50 行**: 无 9 个 `Arc<crate::services>` 字段 (grep `^    pub [a-z_]+_service: Arc<crate::services::` 0 命中)
> 8. **真实 12 处** (非 28) `state.<svc>_service.xxx` → `get_service!(state, SvcType).xxx` (commands/ 6 文件: backup/history/project/marketplace/optimizer/mcp + 各 1-6 处)
> 9. **9 业务 stub depends_on 补全**: provider-list → provider-service / backup-restore → backup-service + history-service / usage-query → usage-service / mcp-management → mcp-service / optimizer → optimizer-service / resource-browser → resource-service / marketplace → marketplace-service / project-mode → project-service / history-view → history-service (Q42-5 9 stub + 7 新 stub 待 Phase 42 execute 后定)
> 10. **"加 1 service 只动 1 文件" 强验收**: 写一个临时 test service plugin (e.g. `_test_service.rs` + `register_arc::<TestService>(Arc::new(TestService::new()))` 1 行), 跑 cargo build 验证 **仅该文件 + plugins/mod.rs 注册 1 行变化, commands/ / lib.rs 0 改动**, 验证后删 test service
> 11. **smoke test 10/10 PASS** (CLAUDE.md §13.1 全项, 含 "DispatchTable 收集 80 项" + "AppState 0 个 Arc<crate::services> 字段" + "commands 0 行 state.<svc>_service.")

---

## 2. 工作量与估时

| 项目 | 估值 | 来源 |
|---|---|---|
| 新增依赖 | 0 | §2.3 锁版本禁, DFS 用 std::collections::HashMap |
| 新增文件 | ~14 (topological.rs + 9 service plugin mod.rs + commands/macros.rs + get_service! macro + 1 test_stub 验证) | 45-DECISIONS §4 |
| 删除文件 | 0 | AppState 字段抽离但不删 service crate |
| 修改文件 | ~20 (app_state.rs, lib.rs setup, host.rs, traits.rs, 9 service-related commands/{backup,history,project,marketplace,optimizer,mcp}.rs, 9 业务 stub mod.rs each +1 行 depends_on, plugins/mod.rs 注册) | 主工作量 |
| 新增测试 | ~10 (topological 4 + init_all_topological 4 + get_service! 2) | TDD §2.2 |
| 工作量估时 | **5-7 天** (0.5 天 foundation + 1 天 service plugin 抽离 + 1 天 topological + 1 天 commands 替换 + 0.5 天 depends_on + 1 天 smoke + 0.5 天收尾) | sccache 已启用 |

---

## 3. 任务拆分 (Tasks)

按 TDD 红绿重构流 (CLAUDE.md §2.2) + 依赖顺序,共 7 个 task,3 个 wave:

```
Wave 0 (基础机制): Task 1 (依赖校验 + PluginContext 兼容性 verify) → Task 2 (topological.rs + 4 单测)
Wave 1 (主工作量): Task 3 (9 service plugin 抽离) → Task 4 (host.rs init_all_topological + 4 单测)
Wave 2 (接线 + 验证): Task 5 (get_service! macro + 12 处替换) → Task 6 (9 业务 stub depends_on 补全) → Task 7 (smoke + 强验收)
```

---

### Task 1: Phase 42/43 ship 状态 verify + PluginContext 兼容性 (Wave 0)

**目的**: Phase 45 开始前确认上游 Phase 42/43 已 ship 且接口契约匹配 D-45-A + D-CC-A

**文件**:
- 只读 verify: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/service_registry.rs` (Phase 42 应 ship)
- 只读 verify: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/dispatch.rs` (Phase 42 应 ship)
- 只读 verify: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/traits.rs` (PluginContext 4 字段应就位)
- 只读 verify: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/host.rs` (init_all 接 &mut ctx 应就位)
- 只读 verify: `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs:106-199` (invoke_handler 应走 dispatch)
- 只读 verify: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/mod.rs` (13 stub 应注册)

**TDD 验证流**:
1. **Red/Green** (无新代码, 纯 verify):
   - `ls src-tauri/src/plugins/service_registry.rs && ls src-tauri/src/plugins/dispatch.rs` → 必须存在
   - `grep -E "register_arc<T: 'static \+ Send \+ Sync>\(&self, svc: Arc<T>\)" src-tauri/src/plugins/service_registry.rs` → 必须命中 (字节级 D-45-A)
   - `grep -E "get<T: 'static \+ Send \+ Sync>\(&self\) -> Option<Arc<T>>" src-tauri/src/plugins/service_registry.rs` → 必须命中
   - `grep -E "host: Option<&'a PluginHost>" src-tauri/src/plugins/traits.rs` → 必须命中 (D-CC-A Phase 43 字段)
   - `grep -E "services: Option<&'a mut ServiceRegistry>" src-tauri/src/plugins/traits.rs` → 必须命中 (D-CC-A)
   - `grep -E "fn init\(&mut self.*&mut PluginContext" src-tauri/src/plugins/stubs/*.rs` → 9+ stub 命中 (Phase 42 已改 &mut)
   - `ls src-tauri/src/plugins/stubs/provider_switch.rs 2>/dev/null` → 必须不存在 (SHIP-A 已删)
   - `grep -E "make_invoke_handler" src-tauri/src/lib.rs` → 必须命中 (Phase 42 已改造)

**API 漂移兜底** (Phase 42 未 ship 时):
- 若 `service_registry.rs` 不存在 → **Phase 45-01 Task 1 兼任 Phase 42 Task 1 实现**: 写 `plugins/service_registry.rs` 按 D-45-A 字节级 (3 单测), 在 PLAN §6 风险 R1 列明
- 若 `get<T>()` 返回 `Option<&T>` 而非 `Option<Arc<T>>` → 走 CLAUDE.md §2.5 协商加 5 行 API (Phase 42 ServiceRegistry 增 `get_arc<T>` 方法), Phase 45 用 `get_arc` 替代
- 若 PluginContext 不是 4 字段 → 走 CLAUDE.md §2.5 协商, Phase 45 不能改 PluginContext 定义 (D-CC-A 冻结), 仅消费字段

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3

# Phase 42 ship 校验
ls src-tauri/src/plugins/service_registry.rs
ls src-tauri/src/plugins/dispatch.rs

# D-45-A 字节级
grep -A1 "pub fn register_arc" src-tauri/src/plugins/service_registry.rs
grep -A1 "pub fn get<" src-tauri/src/plugins/service_registry.rs

# D-CC-A 字节级
grep -E "host:|services:" src-tauri/src/plugins/traits.rs

# SHIP-A 校验
ls src-tauri/src/plugins/stubs/provider_switch.rs 2>&1 | grep -c "No such file"  # 应 = 1

# 13 stub 计数
ls src-tauri/src/plugins/stubs/*.rs | grep -v mod.rs | wc -l  # 应 ≥ 12
```

**Done 标准**:
- 8 项 grep 验证全 PASS (或 Phase 45-01 Task 1 兼任写 service_registry.rs)
- API 漂移兜底预案就绪 (若不漂移则本 Task 仅 5 分钟校验)
- D-45-A / D-CC-A 字节级接口契约锁定

**估时**: 0.5 天

---

### Task 2: `topological.rs` (NEW) DFS 3-color 拓扑序 + 4 单测 (Wave 0)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/topological.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs` (加 `pub mod topological;`)

**TDD 红绿重构流**:
1. **Red**: `topological.rs::tests::topo_sort_dag_returns_topological_order` — 9 节点 DAG → 断言顺序 = `[history-service, backup-service, usage-service, mcp-service, optimizer-service, resource-service, marketplace-service, project-service, provider-service]` (G10 单测锁死顺序)
2. **Red**: `topological.rs::tests::topo_sort_detects_cycle` — A → B → A → 断言错误带 cycle 路径 `"A -> B -> A"`
3. **Red**: `topological.rs::tests::topo_sort_missing_dependency_errors` — A depends ["nonexistent"] → 断言错误信息含 `"nonexistent"`
4. **Red**: `topological.rs::tests::topo_sort_multi_deps_resolves_correctly` — D 同时依赖 B + C, B 在 C 之前; 断言 D 在 B/C 之后
5. **Green**: 实现 DFS 3-color (WHITE/GRAY/BLACK) + 递归拓扑序
6. **Refactor**: 加 `topo_sort_strict` 变体 (发现 cycle 立即 panic with 路径, 仅测试用)

**实现要点** (G5 DFS 3-color, 字节级 D-45-DECISIONS G5):

```rust
// src-tauri/src/plugins/topological.rs
//! DFS 3-color topological sort for plugin dependency graphs.
//!
//! Used by `PluginHost::init_all_topological` to resolve init order
//! when a plugin declares `depends_on()` other plugin ids. Cycle
//! detection surfaces immediately with the offending path, so a
//! developer can locate the bad edge in seconds (vs Kahn's algorithm
//! which silently produces a partial order + leftover nodes).

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopologicalError {
    /// Cycle detected — `path` is the edge chain leading back to the
    /// first repeated node (e.g. ["A", "B", "A"]).
    Cycle { path: Vec<String> },
    /// A plugin depends on an id that was never registered.
    MissingDependency { plugin: String, missing: String },
}

const WHITE: u8 = 0;
const GRAY: u8 = 1;
const BLACK: u8 = 2;

/// Compute a topological order over `nodes` (a map of id → its
/// dependency ids). Returns the order as a `Vec<&'static str>` in
/// dependency-first order (i.e. dependencies come before dependents).
///
/// # Errors
/// - [`TopologicalError::Cycle`] if the graph contains a cycle
/// - [`TopologicalError::MissingDependency`] if any node references
///   an id not present in `nodes`
pub fn topo_sort<'a>(
    nodes: &HashMap<&'a str, Vec<&'a str>>,
) -> Result<Vec<&'a str>, TopologicalError> {
    let mut color: HashMap<&str, u8> = nodes.keys().map(|&k| (k, WHITE)).collect();
    let mut order: Vec<&'static str> = Vec::with_capacity(nodes.len());
    let mut path: Vec<String> = Vec::new();
    for &id in nodes.keys() {
        if color[id] == WHITE {
            dfs_visit(id, nodes, &mut color, &mut order, &mut path)?;
        }
    }
    Ok(order)
}

fn dfs_visit<'a>(
    id: &'a str,
    nodes: &HashMap<&'a str, Vec<&'a str>>,
    color: &mut HashMap<&'a str, u8>,
    order: &mut Vec<&'static str>,
    path: &mut Vec<String>,
) -> Result<(), TopologicalError> {
    color.insert(id, GRAY);
    path.push(id.to_string());
    let deps = nodes.get(id).cloned().unwrap_or_default();
    for dep in deps {
        // Verify the dep is registered.
        if !nodes.contains_key(dep) {
            return Err(TopologicalError::MissingDependency {
                plugin: id.to_string(),
                missing: dep.to_string(),
            });
        }
        match color[dep] {
            WHITE => dfs_visit(dep, nodes, color, order, path)?,
            GRAY => {
                // Found a back-edge → cycle. Trim path to the
                // first occurrence of `dep` for a readable chain.
                let cycle_start = path.iter().position(|p| p == dep).unwrap_or(0);
                let mut cycle_path = path[cycle_start..].to_vec();
                cycle_path.push(dep.to_string());
                return Err(TopologicalError::Cycle { path: cycle_path });
            }
            BLACK => {} // Already finalized.
        }
    }
    color.insert(id, BLACK);
    path.pop();
    order.push(id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node<'a>(id: &'a str, deps: &[&'a str]) -> (&'a str, Vec<&'a str>) {
        (id, deps.to_vec())
    }

    #[test]
    fn topo_sort_dag_returns_topological_order() {
        // G10 锁死的预期顺序 (与 45-DECISIONS.md §G10 一致)
        let mut nodes = HashMap::new();
        nodes.insert(node("history-service", &[]));
        nodes.insert(node("backup-service", &["history-service"]));
        nodes.insert(node("usage-service", &["history-service"]));
        nodes.insert(node("mcp-service", &[]));
        nodes.insert(node("optimizer-service", &[]));
        nodes.insert(node("resource-service", &[]));
        nodes.insert(node("marketplace-service", &[]));
        nodes.insert(node("project-service", &[]));
        nodes.insert(node("provider-service", &["backup-service", "history-service"]));

        let order = topo_sort(&nodes).unwrap();
        assert_eq!(order, vec![
            "history-service",
            "backup-service",
            "usage-service",
            "mcp-service",
            "optimizer-service",
            "resource-service",
            "marketplace-service",
            "project-service",
            "provider-service",
        ]);
    }

    #[test]
    fn topo_sort_detects_cycle() {
        let mut nodes = HashMap::new();
        nodes.insert(node("A", &["B"]));
        nodes.insert(node("B", &["A"]));
        let err = topo_sort(&nodes).unwrap_err();
        match err {
            TopologicalError::Cycle { path } => {
                assert!(path.contains(&"A".to_string()));
                assert!(path.contains(&"B".to_string()));
            }
            _ => panic!("expected Cycle error, got {:?}", err),
        }
    }

    #[test]
    fn topo_sort_missing_dependency_errors() {
        let mut nodes = HashMap::new();
        nodes.insert(node("A", &["nonexistent"]));
        let err = topo_sort(&nodes).unwrap_err();
        match err {
            TopologicalError::MissingDependency { plugin, missing } => {
                assert_eq!(plugin, "A");
                assert_eq!(missing, "nonexistent");
            }
            _ => panic!("expected MissingDependency, got {:?}", err),
        }
    }

    #[test]
    fn topo_sort_multi_deps_resolves_correctly() {
        let mut nodes = HashMap::new();
        nodes.insert(node("B", &[]));
        nodes.insert(node("C", &[]));
        nodes.insert(node("D", &["B", "C"]));
        let order = topo_sort(&nodes).unwrap();
        let b_idx = order.iter().position(|&x| x == "B").unwrap();
        let c_idx = order.iter().position(|&x| x == "C").unwrap();
        let d_idx = order.iter().position(|&x| x == "D").unwrap();
        assert!(b_idx < d_idx);
        assert!(c_idx < d_idx);
    }
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::topological::tests -- --nocapture
# 期望: test result: ok. 4 passed; 0 failed
```

**Done 标准**:
- 4 个 topological 单测全 PASS
- DFS 3-color 字节级匹配 G5 决策 (无 cycle 时直接返回 Ok, 不打 warning)
- 顺序断言 = G10 锁死的预期顺序
- cycle 错误带 path (e.g. `[A, B, A]`)
- 0 新增依赖 (HashMap 来自 std::collections, 已存在)

**估时**: 1 天

---

### Task 3: 9 service plugin 抽离 + AppState 收缩 (Wave 1, 主工作量)

**目的**: 把 `app_state.rs:88-228` (140 行 build 逻辑) 拆成 9 个 service plugin::init, AppState 只剩 paths + service_registry Arc

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/app_state.rs` (build() 缩到 < 50 行, 无 9 个 Arc<crate::services::> 字段)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/history_service.rs` (NEW: deps = [], init 调 `open_history_db` + 3 层 fallback + backfill_bak)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/backup_service.rs` (NEW: deps = [history-service], init 调 `BackupService::new(paths.clone()).with_history(history_arc)`)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/provider_service.rs` (NEW: deps = [backup-service, history-service], init 调 `ProviderService::new(paths).with_backup_service(backup_arc)`)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/usage_service.rs` (NEW: deps = [history-service], init 调 `UsageService::new(paths).with_history(history_arc)`)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/mcp_service.rs` (NEW: deps = [], init = McpService::new(paths))
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/optimizer_service.rs` (NEW: deps = [], init = OptimizerService::new(paths))
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/resource_service.rs` (NEW: deps = [], init 调 `runtime::reveal()` + `claude_dir`)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/marketplace_service.rs` (NEW: deps = [], init 调 `runtime::git_host()`)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/services/project_service.rs` (NEW: deps = [], init = ProjectService::new(paths))
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs` (加 `pub mod services;` + `pub mod dispatch;` 已有 → 9 个 service stub pub use)

**TDD 红绿重构流**:
1. **Red**: 跑 `cargo build --release` → `app_state.rs::build()` 引用 `services::xxx_service::new` 应编译成功 (未改前)
2. **Red**: `history_service.rs::tests::register_arc_then_get` — `host.init` → `ctx.services.register_arc(Arc::new(HistoryService::new(test_conn)))` → `ctx.services.get::<HistoryService>()` 拿到 Arc
3. **Red**: `history_service.rs::tests::backfill_best_effort_on_failure` — 给个不存在路径 → 仍 register_arc 成功 (G9 best-effort)
4. **Red**: `provider_service.rs::tests::depends_on_includes_backup_and_history` — `assert_eq!(svc.depends_on(), vec!["backup-service", "history-service"])`
5. **Green**: 实现 9 个 service plugin (各 ~50 行), 从 app_state.rs::build 复制 init 逻辑
6. **Green**: 改 app_state.rs::build 删除 140 行服务构造, 仅留 paths + ServiceRegistry::new() + pending_sql_file + updater fields
7. **Refactor**: 加 `service_registry.clone_to_app_state()` helper

**实现要点** (字节级 D-45-DECISIONS §4 + §G3):

```rust
// src-tauri/src/plugins/services/history_service.rs
use std::sync::Arc;
use crate::services::history_service::{HistoryService, HistoryDbConn};
use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::infrastructure::sqlite::history_db;

pub struct HistoryServicePlugin;

impl IPlugin for HistoryServicePlugin {
    fn id(&self) -> &'static str { "history-service" }
    fn name(&self) -> &'static str { "History Service" }
    fn depends_on(&self) -> Vec<&'static str> { vec![] }  // G7 同步补, 无依赖

    fn services(&self) -> Vec<Box<dyn crate::plugins::traits::PluginService>> {
        // G2: 全空 vec, 服务动态 register
        vec![]
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths;
        // G3: history_db backfill 从 app_state.rs:101-153 整段迁入
        let svc = match history_db::open_history_db(&paths.history_db) {
            Ok(conn) => {
                let svc = HistoryService::new(conn);
                if let Err(e) = svc.init() {
                    log::warn!("[history-service] init failed: {e}");
                }
                let claude_dir = paths.claude_dir()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| paths.home.join(".claude"));
                if let Err(e) = svc.backfill_bak(&paths.backups_dir, Some(&claude_dir)) {
                    log::warn!("[history-service] backfill_bak failed: {e}");
                }
                Arc::new(svc)
            }
            Err(e) => {
                log::warn!("[history-service] open_history_db failed: {e}, trying in-memory");
                match history_db::open_in_memory_db() {
                    Ok(conn) => Arc::new(HistoryService::new(conn)),
                    Err(e2) => {
                        log::warn!("[history-service] in-memory also failed: {e2}, using raw");
                        let conn = rusqlite::Connection::open_in_memory()
                            .expect("in-memory sqlite must always open");
                        Arc::new(HistoryService::new(Arc::new(std::sync::Mutex::new(conn))))
                    }
                }
            }
        };
        // G9: 任何 IO 失败 register_arc 成功 (best-effort)
        if let Some(services) = ctx.services.as_mut() {
            services.register_arc::<HistoryService>(svc);
        } else {
            return Err(PluginError::InitFailed("services registry not available".into()));
        }
        Ok(())
    }
}
```

```rust
// src-tauri/src/plugins/services/provider_service.rs (示例: 多依赖)
pub struct ProviderServicePlugin;

impl IPlugin for ProviderServicePlugin {
    fn id(&self) -> &'static str { "provider-service" }
    fn depends_on(&self) -> Vec<&'static str> {
        vec!["backup-service", "history-service"]  // G7 + G10 拓扑序
    }
    fn services(&self) -> Vec<Box<dyn PluginService>> { vec![] }
    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths;
        // 从 ctx.services 取 backup + history Arc (D-45-A 路径)
        let services = ctx.services.as_ref()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        let backup_arc = services.get::<crate::services::backup_service::BackupService>()
            .ok_or_else(|| PluginError::InitFailed("backup-service not registered".into()))?;
        let history_arc = services.get::<crate::services::history_service::HistoryService>()
            .ok_or_else(|| PluginError::InitFailed("history-service not registered".into()))?;

        let svc = crate::services::provider_service::ProviderService::new(paths.clone())
            .with_backup_service(backup_arc)
            .with_history(history_arc);
        let services_mut = ctx.services.as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        services_mut.register_arc(crate::services::provider_service::ProviderService, Arc::new(svc));
        Ok(())
    }
}
```

**AppState 收缩后形态** (45-DECISIONS §5):

```rust
// src-tauri/src/app_state.rs (AFTER, < 50 行)
use std::sync::{Arc, Mutex};
use crate::platform::runtime;
use crate::plugins::service_registry::ServiceRegistry;
use crate::platform::AppPaths;

pub struct AppState {
    pub paths: AppPaths,
    /// NEW: 9 service 集中托管, Phase 45 替代 9 个 Arc<crate::services::> 字段
    pub service_registry: Arc<ServiceRegistry>,
    pub pending_sql_file: Mutex<Option<String>>,
    pub updater_pubkey: String,
    pub updater_endpoints: Vec<String>,
}

impl AppState {
    pub fn build() -> Self {
        let paths_impl = runtime::paths();
        let paths = paths_impl.resolve();
        let _ = paths_impl.ensure_dirs();
        Self {
            paths,
            service_registry: Arc::new(ServiceRegistry::new()),
            pending_sql_file: Mutex::new(None),
            updater_pubkey: "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEM4Q0I3RjAwREFDRDFFODEKUldTQkhzM2FBSC9MeVBJRU9Yam53cXpEUE1UVGN0RFE5Y0R6SnZidkpWYlhiRzkvUXR4ZVU2VisK".to_string(),
            updater_endpoints: vec!["https://github.com/loonghao/claude-config-manager/releases/latest/download/latest.json".to_string()],
        }
    }
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::services -- --nocapture
wc -l src-tauri/src/app_state.rs  # 期望 < 230 (原 229, 抽 140+ 行到 9 plugin)
grep -cE "^    pub [a-z_]+_service: Arc<crate::services::" src-tauri/src/app_state.rs  # 期望 = 0
ls src-tauri/src/plugins/services/ | wc -l  # 期望 = 10 (9 service + mod.rs)
```

**Done 标准**:
- AppState `^    pub [a-z_]+_service: Arc<crate::services::` 0 命中 (9 字段全抽离)
- 9 service plugin mod.rs 各自存在 + 注册到 plugins/mod.rs
- history-service init 3 层 fallback 完整保留 (G9 best-effort)
- provider-service depends_on = ["backup-service", "history-service"]
- 每个 service plugin init 末尾 `ctx.services.register_arc::<X>(Arc::new(X::new(...)))`
- `cargo test plugins::services` 全 PASS

**估时**: 1.5 天 (9 service × 0.15 天 + AppState 重构 0.15 天)

---

### Task 4: PluginHost::init_all_topological + 推迟 app.manage (Wave 1)

**目的**: 拓扑序 init 9 service + 业务 plugin, refcount=1 时 Arc::get_mut OK (init 期间独占 registry)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/host.rs` (加 `init_all_topological` 方法, 保留 `init_all` 为 fallback)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs::run` (setup 阶段: 推迟 `app.manage(state)` 到 `init_all_topological` 之后)

**TDD 红绿重构流**:
1. **Red**: `host.rs::tests::init_all_topological_respects_depends_on` — 注册 A depends [B], B 无依赖; 断言 init log 顺序 B → A
2. **Red**: `host.rs::tests::init_all_topological_detects_cycle` — A → B → A → 断言 init 失败, 错误信息含 cycle path
3. **Red**: `host.rs::tests::init_all_topological_missing_dep_errors` — A depends ["nonexistent"] → 断言 init 失败, 错误含 nonexistent
4. **Red**: `host.rs::tests::init_all_topological_9_service_order` — 注册 9 service plugin, 断言 init log 顺序匹配 G10 锁死顺序
5. **Green**: 实现 `init_all_topological`, 调 `topological::topo_sort` 拿序 → 按序 `plugin.init(ctx)?`
6. **Refactor**: 加 `init_all_topological_with_fallback` 兼容性方法 (Phase 42 的 init_all 仍走旧路径)

**实现要点** (字节级 D-45-DECISIONS §7):

```rust
// host.rs (新增方法, 保留旧 init_all)
use super::topological::{topo_sort, TopologicalError};
use std::collections::HashMap;

impl PluginHost {
    /// Run `init` on every plugin in topological order of their
    /// `depends_on()` declarations. Replaces `init_all` for any
    /// plugin graph that includes service plugins (which need
    /// other services registered before they can wire up).
    ///
    /// # Errors
    /// - [`PluginError::TopologicalError`] if the graph has a cycle
    ///   or references a missing dependency id
    /// - Bubbles up the first plugin's `init` error
    pub fn init_all_topological(
        &mut self,
        ctx: &mut PluginContext,
    ) -> Result<(), PluginError> {
        // 1. Build id → deps map
        let mut deps_map: HashMap<&str, Vec<&str>> = HashMap::new();
        for (id, plugin) in self.iter() {
            deps_map.insert(id, plugin.depends_on());
        }
        // 2. Topological sort
        let order = topo_sort(&deps_map).map_err(|e| match e {
            TopologicalError::Cycle { path } =>
                PluginError::CycleDetected { path },
            TopologicalError::MissingDependency { plugin, missing } =>
                PluginError::MissingDependency { plugin, missing },
        })?;
        // 3. Init in order
        for id in order {
            if let Some(plugin) = self.plugins.get_mut(id) {
                plugin.init(ctx)?;
            }
        }
        Ok(())
    }
}
```

**lib.rs setup 改造** (D-45-DECISIONS §6, 推迟 app.manage):

```rust
// lib.rs::run (BEFORE)
let state = AppState::build();
let mut host = PluginHost::new();
// ... register 9 service + 9 业务 plugin ...
let mut plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl, &state);
host.init_all_topological(&mut plugin_ctx)?;  // refcount=1, Arc::get_mut OK
app.manage(state);  // refcount=2 (Tauri 也持)

// lib.rs::run (AFTER — 顺序调换, AppState 收缩后)
// 1. build paths + AppState (registry = empty Arc, refcount=1)
let paths_impl = platform::runtime::paths();
let paths = paths_impl.resolve();
let _ = paths_impl.ensure_dirs();
let state = AppState::build();
// 2. PluginHost 注册 (9 service + 9 业务 plugin)
let mut host = PluginHost::new();
// ... 18 个 register 调用 ...
// 3. 构造 ctx (state.service_registry 共享 Arc 给 ctx.services 字段)
let mut plugin_ctx = PluginContext::new(
    app.app_handle(),
    &*paths_impl,
    Arc::clone(&state.service_registry),
    &host,
);
// 4. 拓扑序 init (refcount=1, 期间可独占 &mut ServiceRegistry via ctx.services)
host.init_all_topological(&mut plugin_ctx)?;
// 5. 推迟 app.manage (init 完成后 Tauri 也持 Arc, refcount=2)
app.manage(state);
app.manage(Mutex::new(host));
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::host::tests -- --nocapture
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
```

**Done 标准**:
- 4 个 init_all_topological 单测全 PASS (含 9 service 顺序断言 = G10)
- `init_all` 保留为 fallback (旧 plugin 兼容)
- lib.rs::run 推迟 app.manage(state) 到 init_all_topological 之后
- cycle / missing 错误信息含路径 (developer 1 秒定位)

**估时**: 1 天

---

### Task 5: `get_service!` macro + 12 处替换 (Wave 2)

**目的**: commands/ 6 文件 12 处 `state.<svc>_service.xxx` 改 macro 调用, 编译期类型安全

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/macros.rs` (`get_service!` macro)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/mod.rs` (加 `pub mod macros;` + `#[macro_use] pub use macros::*;`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/backup.rs:30` (1 处: backup_service.list_backups)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/history.rs:318,333,342,348,363,375` (6 处: history_service.as_ref())
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/project.rs:81,145` (2 处: project_service.load())
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/marketplace.rs:35` (1 处: marketplace_service.list_builtin_repos())
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/optimizer.rs:116` (1 处: optimizer_service.find_rule)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/mcp.rs:59` (1 处: mcp_service.with_root(...).list())
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/fs.rs` (跨 service 调用 — `take_pending_sql_file` 不变, 此处仅 state.pending_sql_file)

**TDD 红绿重构流**:
1. **Red**: `commands/macros.rs::tests::get_service_returns_arc_reference` — 模拟 state 含 BackupService, macro 返回 &BackupService
2. **Red**: `commands/macros.rs::tests::get_service_panics_on_missing_service` — 不注册 BackupService → macro panic with type name
3. **Green**: 实现 `get_service!` macro (展开为 `state.service_registry.get::<$T>().expect("service not registered: $T")`)
4. **Refactor**: 加 `try_get_service!` 变体 (不 panic, 返回 `Option<Arc<T>>`)

**实现要点** (G4 macro, 字节级 D-45-DECISIONS §G4):

```rust
// src-tauri/src/commands/macros.rs
//! Convenience macros for accessing services from `AppState`.
//!
//! After Phase 45, `AppState` no longer carries one
//! `Arc<crate::services::xxx_service>` per service. Instead all 9
//! services live in `AppState::service_registry: Arc<ServiceRegistry>`,
//! and commands look them up by type via [`get_service!`].
//!
//! The macro is type-safe: it expands at compile time, so a typo'd
//! type name fails to compile (not at runtime). It panics at runtime
//! if the service was not registered (which would indicate a missing
//! `depends_on` declaration or a topological-sort bug — both caught
//! by `cargo test plugins::host::tests`).

/// Look up a service by type from `AppState`. Panics if the service
/// was not registered.
///
/// # Usage
///
/// ```ignore
/// fn cmd(state: tauri::State<AppState>) -> Result<Vec<Backup>, String> {
///     let backup = get_service!(state, BackupService);
///     Ok(backup.list_backups(None))
/// }
/// ```
#[macro_export]
macro_rules! get_service {
    ($state:expr, $svc:ty) => {
        $state.service_registry
            .get::<$svc>()
            .expect(concat!(
                "service not registered: ",
                stringify!($svc),
                " — check depends_on() declarations and topo-sort order",
            ))
            .as_ref()
    };
}

/// Like [`get_service!`] but returns `Option` instead of panicking.
#[macro_export]
macro_rules! try_get_service {
    ($state:expr, $svc:ty) => {
        $state.service_registry
            .get::<$svc>()
            .map(|arc| arc.as_ref())
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use crate::plugins::service_registry::ServiceRegistry;

    struct BackupService {
        _marker: std::marker::PhantomData<()>,
    }

    #[test]
    fn get_service_returns_arc_reference() {
        let registry = Arc::new(ServiceRegistry::new());
        registry.register_arc(BackupService { _marker: std::marker::PhantomData });
        // ... (test setup with mock state)
    }
}
```

**12 处替换模式** (commands/ 6 文件):

```rust
// commands/backup.rs:30 (BEFORE)
Ok(state.backup_service.list_backups(active_root.as_deref()))

// (AFTER)
use crate::commands::macros::get_service;
Ok(get_service!(state, crate::services::backup_service::BackupService).list_backups(active_root.as_deref()))
```

```rust
// commands/history.rs:318 (BEFORE — 6 处同 pattern)
get_usage_history_impl(state.history_service.as_ref(), filter)

// (AFTER)
get_usage_history_impl(get_service!(state, crate::services::history_service::HistoryService), filter)
```

```rust
// commands/project.rs:81 (BEFORE)
let pf = state.project_service.load().map_err(|e| e.to_string())?;

// (AFTER)
let pf = get_service!(state, crate::services::project_service::ProjectService).load().map_err(|e| e.to_string())?;
```

```rust
// commands/marketplace.rs:35 (BEFORE)
Ok(state.marketplace_service.list_builtin_repos())

// (AFTER)
Ok(get_service!(state, crate::services::marketplace_service::MarketplaceService).list_builtin_repos())
```

```rust
// commands/optimizer.rs:116 (BEFORE)
if state.optimizer_service.find_rule(&rule_id).is_none() {

// (AFTER)
if get_service!(state, crate::services::optimizer_service::OptimizerService).find_rule(&rule_id).is_none() {
```

```rust
// commands/mcp.rs:59 (BEFORE)
Ok(state.mcp_service.with_root(active_root.as_deref()).list())

// (AFTER)
Ok(get_service!(state, crate::services::mcp_service::McpService).with_root(active_root.as_deref()).list())
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test commands::macros::tests -- --nocapture
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
grep -rE "state\.[a-z_]+_service\." src-tauri/src/commands/ | wc -l  # 期望 = 0
grep -rE "get_service!\(state," src-tauri/src/commands/ | wc -l  # 期望 = 12
```

**Done 标准**:
- `cargo test commands::macros::tests` 2 项 PASS
- `grep "state\.[a-z_]+_service\." commands/` = 0 命中 (12 处全替换)
- `grep "get_service!(state," commands/` = 12 命中
- commands/{backup,history,project,marketplace,optimizer,mcp}.rs 6 文件编译通过
- AppState 收缩后 `commands` 仍通过 `state: State<AppState>` 取依赖 (Tauri 框架不变)

**估时**: 1 天

---

### Task 6: 9 业务 stub `depends_on` 补全 (Wave 2)

**目的**: 9 业务 plugin 声明拓扑依赖, 防止运行时 panic (Phase 45 G7)

**文件** (取决于 Phase 42 ship 后实际 stub 列表; 当前磁盘 10 stub):
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/provider_list.rs` (加 `fn depends_on() -> Vec<&'static str> { vec!["provider-service"] }`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/backup_restore.rs` (加 `vec!["backup-service", "history-service"]`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/usage_query.rs` (加 `vec!["usage-service", "history-service"]`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/resource_browser.rs` (加 `vec!["resource-service"]`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/marketplace.rs` (加 `vec!["marketplace-service"]`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/optimizer.rs` (加 `vec!["optimizer-service"]`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/json_editor.rs` (无依赖, 默认空 vec)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/import_sql.rs` (加 `vec!["provider-service"]`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/core.rs` (加 `vec!["history-service"]` — tray 启动日志依赖 history init)
- (Phase 46 删 mcp_management 后) 修改 `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/history_view.rs` (Phase 42 ship 后新增; 加 `vec!["history-service"]`)
- (Phase 42 ship 后新增) 修改 `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/project_mode.rs` (加 `vec!["project-service"]`)
- (Phase 42 ship 后新增) 修改 `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/file_ops.rs` (无依赖, 默认空 vec)
- (Phase 42 ship 后新增) 修改 `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/updater.rs` (无依赖, 默认空 vec)

**TDD 红绿重构流**:
1. **Red**: `host.rs::tests::business_plugin_depends_on_resolves_at_init` — 注册 9 business + 9 service plugin, 跑 init_all_topological → 不 panic, history_service 在 backup_service 之前 init
2. **Red**: `host.rs::tests::missing_service_dep_fails_fast` — 注册 backup_restore 但不注册 backup-service → init 失败, 错误含 "backup-service"
3. **Green**: 给 9 stub 加 depends_on 方法 (各 1 行)
4. **Refactor**: 加 `plugins/mod.rs` 注释说明 G7 决策 + 拓扑图清单

**实现要点** (G7 + G10 拓扑图):

| 业务 stub | depends_on | 理由 |
|---|---|---|
| provider-list | ["provider-service"] | list_providers 调 provider_service.list() |
| import-sql | ["provider-service"] | sql 导入需 provider_service 写入 |
| backup-restore | ["backup-service", "history-service"] | 双 Arc 依赖 (with_history + backup_service 自身) |
| history-view | ["history-service"] | 8 个 history 命令调 history_service 直接查询 |
| usage-query | ["usage-service", "history-service"] | usage_service 调 history_service with_history |
| mcp-management | ["mcp-service"] | mcp_service.with_root() |
| resource-browser | ["resource-service"] | resource_service 扫描 + reveal |
| marketplace | ["marketplace-service"] | marketplace_service git clone + install |
| optimizer | ["optimizer-service"] | optimizer_service 13 rules 扫描 |
| json-editor | [] | 仅读写 settings.json, 无 service |
| project-mode | ["project-service"] | project_service.load() |
| file-ops | [] | 文件 IO helpers, 无 service |
| updater | [] | 仅读 tauri-plugin-updater, 无 service |
| core | ["history-service"] | tray 启动时读 history 状态 (Phase 43) |

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::host::tests::business_plugin -- --nocapture
grep -rE "fn depends_on" src-tauri/src/plugins/stubs/ | wc -l  # 期望 = 9+ (Phase 42 ship 后 stub 数)
```

**Done 标准**:
- 9+ 业务 stub `fn depends_on() -> Vec<&'static str>` 实现
- `cargo test plugins::host::tests::business_plugin_depends_on_resolves_at_init` PASS
- 拓扑序合法 (cargo test 验证), 无 cycle / missing dep
- 错误信息含 missing service id (developer 1 秒定位)

**估时**: 0.5 天

---

### Task 7: smoke test 验证 + 强验收确认 (Wave 2 收尾)

**目的**: 验证 phase 完成, 跑全套 10 项 smoke + "加 1 service 只动 1 文件" 强验收

**文件**:
- 修改 (如需): `/Users/coderstory/CodeSource/winui3/scripts/build-and-ship.sh` (smoke test 加 3 项: "AppState 0 个 Arc<crate::services>" + "commands 0 行 state.<svc>_service." + "DispatchTable 收集 80 项 + 9 service plugin 注册")
- 修改 (如需): `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/45-SUMMARY.md` (新增, 由 execute-phase subagent 写)

**TDD 验证流** (全部命令行 grep / cargo test / smoke):
1. **Build**: `tauri build --no-bundle` 走通 (前置: Task 1-6 cargo build --release 已绿)
2. **Unit tests**: `cargo test` 全 PASS (含 topological 4 + host::init_all_topological 4 + commands::macros 2 + 9 service::tests + host::business_plugin 2 = ~14 新增 + 旧测试)
3. **Smoke**: `scripts/build-and-ship.sh --smoke-only` 10/10 PASS (CLAUDE.md §13.1)
4. **grep lint 3 项**:
   - `grep -cE "^    pub [a-z_]+_service: Arc<crate::services::" src-tauri/src/app_state.rs` = **0** (AppState 收缩)
   - `grep -rcE "state\.[a-z_]+_service\." src-tauri/src/commands/` = **0** (12 处全替换)
   - `grep -c "register_arc" src-tauri/src/plugins/services/ | wc -l` ≥ **9** (9 service plugin 各 1+ register_arc)
5. **强验收 "加 1 service 只动 1 文件"**:
   - 写临时 test service `plugins/services/_test_strong.rs` + `register_arc::<TestStrongService>(Arc::new(TestStrongService::new()))` 1 行
   - `cargo build --release` 验证 **仅该文件 + plugins/mod.rs 注册 1 行变化, commands/ / app_state.rs / lib.rs / 业务 stub 0 改动**
   - 验证后删 test service
6. **强验收 "加 1 plugin 改 1 文件"** (Phase 42 既有, 复测): 写临时 test plugin `plugins/stubs/_test_strong.rs` 加 1 个 `inventory::submit!`, cargo build 仅该文件 + plugins/mod.rs 注册 1 行变化
7. **前端 0 改动**: `git diff src/` 应仅 .planning/ 变化 (commands/ → plugins/stubs/<id>/commands.rs 迁移由 Phase 42 完成, Phase 45 不动)
8. **Phase 42/43/45 接口契约对齐 verify**:
   - `grep "pub fn register_arc\|pub fn get<" src-tauri/src/plugins/service_registry.rs` 应字节级匹配 D-45-A
   - `grep "host: Option<&'a PluginHost>\|services:" src-tauri/src/plugins/traits.rs` 应字节级匹配 D-CC-A 4 字段

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && ./scripts/build-and-ship.sh --smoke-only 2>&1 | tail -30
cd /Users/coderstory/CodeSource/winui3 && cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10

# grep lint 3 项
cd /Users/coderstory/CodeSource/winui3
echo "--- AppState Arc<crate::services::> 字段 ---"
grep -cE "^    pub [a-z_]+_service: Arc<crate::services::" src-tauri/src/app_state.rs
echo "--- commands state.<svc>_service. 直访 ---"
grep -rcE "state\.[a-z_]+_service\." src-tauri/src/commands/ | grep -v ":0$"
echo "--- 9 service plugin register_arc ---"
grep -rE "register_arc::<" src-tauri/src/plugins/services/ | wc -l
echo "--- D-45-A 字节级 ---"
grep -E "pub fn (register_arc|get|new)" src-tauri/src/plugins/service_registry.rs
echo "--- D-CC-A 4 字段 ---"
grep -E "pub (app|paths|host|services):" src-tauri/src/plugins/traits.rs
```

**Done 标准** (Phase 47 视觉回归前):
- smoke test 10/10 PASS (含新加 3 项 grep lint)
- cargo test 全 PASS (含 14 新增)
- AppState grep `^    pub [a-z_]+_service: Arc<crate::services::` = 0
- commands grep `state\.[a-z_]+_service\.` = 0 (12 处全替换)
- 9 service plugin 各 1+ register_arc 调用
- D-45-A / D-CC-A 字节级对齐
- "加 1 service 只动 1 文件" 强验收通过 (test service 创建 → 删除 → git diff 仅 1 文件)
- git commit: `feat(v3.4 phase-45): extract 9 services to plugins, init_all_topological, get_service! macro`

**估时**: 1 天

---

## 4. 风险与缓解 (≥3 高风险点)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| **R1** | **Phase 42 ship 状态不确定**: 磁盘上 `plugins/service_registry.rs` / `plugins/dispatch.rs` 尚未落盘 (commit fbd09fc 是 PLAN ship, 未执行); Phase 45-01 必须先 verify, 若 Phase 42 ship 失败则 Phase 45 Task 1 兼任写 service_registry.rs + dispatch.rs | **致命**: Phase 45 全部依赖 Phase 42 产出, 一旦 Phase 42 失败则 Phase 45 阻塞 | 1. Task 1 第一步 grep 8 项契约 verify; 2. API 漂移兜底: Phase 42 未 ship → Phase 45 Task 1 兼任实现 service_registry.rs (D-45-A 字节级) + dispatch.rs (D-42-C); 3. 走 CLAUDE.md §2.5 协商 (Phase 45 PLAN 包含 Phase 42 兜底, 不需另起 Phase 42 execute subagent) |
| **R2** | **拓扑序 cycle / missing dep 兜底**: DFS 3-color 检测 cycle 是 fail-fast; 但若业务 stub depends_on 写错 (e.g. 漏写 backup_restore → history-service) → init 启动期 panic | **高**: 用户开 app 立即崩, 启动失败体验差 | 1. Task 6 强校验: `cargo test plugins::host::tests::business_plugin_depends_on_resolves_at_init` + `missing_service_dep_fails_fast` 必过; 2. cycle / missing 错误信息含路径 (developer 1 秒定位); 3. Task 7 smoke test 加 "9 service + 9 业务 plugin 拓扑序 init 无 cycle/missing" 验证 |
| **R3** | **Arc::get_mut 时机**: ServiceRegistry 内部 `RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>` 在 init 期间多个 service plugin 需 `&mut` 访问; PluginContext.services 是 `Option<&'a mut ServiceRegistry>` 但生命周期 & 'a 受 PluginContext 限制, 跨 plugin init 借用检查可能失败 | **高**: 编译失败 | 1. AppState build 时 `service_registry: Arc::new(ServiceRegistry::new())`, init 前 refcount=1; 2. PluginContext.services 字段类型 `Option<&'a mut ServiceRegistry>`, lifetime 'a = PluginContext lifetime (init 期间独占); 3. 每个 service plugin init 末尾 `ctx.services.as_mut().register_arc::<X>(...)`; 4. 测例 `service_registry.rs::tests::sequential_register_get` 验证连续 register_arc + get 不 panic |
| **R4** | **history_db backfill 3 层 fallback 保留**: app_state.rs:101-153 现存 best-effort 链 (`open_history_db` → `open_in_memory_db` → raw `Connection::open_in_memory`), Phase 45 Task 3 整段迁到 history-service::init 时漏层 → 用户启动崩溃 | **中**: 3% 概率 (磁盘损坏) 用户启动失败 | 1. G9 决策: 任何 IO 失败 log warn + 继续; 永远 register_arc 成功; 2. Task 3 测试 `backfill_best_effort_on_failure` 给不存在路径 → 仍 register_arc 成功; 3. AppState 删除的 140 行原代码段逐行迁入 history-service::init, 3 层 fallback 顺序保留; 4. Smoke test 在干净环境跑 (无历史 db) 验证 init 不 panic |
| **R5** | **业务 plugin depends_on 漏声明**: Phase 42 ship 后 9 业务 stub `depends_on()` 默认空 vec, 若 Task 6 漏 1 个 stub → 该 stub init 时 `get_service!` panic (运行时) | **中**: 启动时 panic, 9 业务 plugin 任一漏 depends_on → app 立即崩 | 1. Task 6 强验收: 9+ stub 全部 `fn depends_on()` 实现, grep 验证计数 ≥ 9; 2. Task 7 强验收 "加 1 service 只动 1 文件" 间接验证 (test service plugin 必须被某 stub depends_on, 跑 init 才不 panic); 3. integration test `business_plugin_depends_on_resolves_at_init` 注册 9+9 plugin 跑 init_all_topological → 0 panic |
| **R6** | **commands/ 6 文件 12 处替换漏 1 处**: grep `state\.[a-z_]+_service\.` 若命中 1 → 该命令运行时 panic (state 字段不存在, 编译期可能通过因 state 是公共字段) | **中**: 单命令运行时 panic, UI 部分页面坏 | 1. Task 5 强验收: `grep -rcE "state\.[a-z_]+_service\." src-tauri/src/commands/ | grep -v ":0$"` 应空 (12 文件全 0); 2. 12 处替换用 sed 批量后人工逐 diff 验证; 3. smoke test 在 dev 环境跑 9 stub 所有入口命令 (Phase 47 整合); 4. 若漏 1 处, Task 5 重做一遍 grep 替换 |
| **R7** | **get_service! macro 错误信息不够友好**: macro 展开为 `.expect("service not registered")`, 若开发者拼错类型名, panic 信息仅显示 stringified type (e.g. `BackService` 漏 u) → 开发者需逐个对比 service plugin 注册类型 | **低**: dev 体验差, 但不致命 | 1. macro 错误信息含完整 type name + "— check depends_on() and topo-sort order" 提示; 2. 测例 `get_service_panics_on_missing_service` 验证 panic 信息含 type name; 3. Phase 47 评估引入 `inventory::iter::<TypeId>` 给错误信息加 "registered services: [...]" 列表 |

---

## 5. 决策锁定点 (Phase 47 必读必验证)

**Phase 45 字节级接口契约 (D-45-A + D-CC-A 已 ship, Phase 45 消费)**:

### 5.1 ServiceRegistry Arc 路径 (D-45-A 字节级)

```rust
// /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/service_registry.rs
pub struct ServiceRegistry {
    map: RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
}
impl ServiceRegistry {
    pub fn new() -> Self;
    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>);
    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>;
    pub fn contains<T: 'static>(&self) -> bool;
    pub fn count(&self) -> usize;
}
```

### 5.2 PluginContext 4 字段 (D-CC-A 冻结)

```rust
// /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/traits.rs
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub host: Option<&'a PluginHost>,
    pub services: Option<&'a mut ServiceRegistry>,
}
```

### 5.3 IPlugin trait (Phase 45 增量 `depends_on`)

```rust
pub trait IPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn routes(&self) -> Vec<PluginRoute> { vec![] }
    fn services(&self) -> Vec<PluginService> { vec![] }       // G2 全空 vec
    fn commands(&self) -> Vec<CommandSpec> { vec![] }
    fn tray_items(&self) -> Vec<PluginTrayItem> { vec![] }
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> { vec![] }
    fn depends_on(&self) -> Vec<&'static str> { Vec::new() }  // Phase 45 NEW, 默认空
    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError>;
    fn shutdown(&mut self) -> Result<(), PluginError>;
}
```

### 5.4 AppState 收缩后形态

```rust
// /Users/coderstory/CodeSource/winui3/src-tauri/src/app_state.rs (< 50 行)
pub struct AppState {
    pub paths: AppPaths,
    pub service_registry: Arc<ServiceRegistry>,  // NEW
    pub pending_sql_file: Mutex<Option<String>>,
    pub updater_pubkey: String,
    pub updater_endpoints: Vec<String>,
}
// 0 个 `pub xxx_service: Arc<crate::services::>` 字段
```

### 5.5 lib.rs::setup 启动顺序 (D-45-DECISIONS §6)

```rust
let paths_impl = platform::runtime::paths();
let paths = paths_impl.resolve();
let _ = paths_impl.ensure_dirs();
let state = AppState::build();  // refcount=1 (registry Arc)
let mut host = PluginHost::new();
// ... register 9 service + 9 业务 plugin ...
let mut plugin_ctx = PluginContext::new(
    app.app_handle(),
    &*paths_impl,
    Arc::clone(&state.service_registry),
    &host,
);
host.init_all_topological(&mut plugin_ctx)?;  // refcount=1, Arc::get_mut OK
app.manage(state);  // refcount=2 (Tauri 也持)
app.manage(Mutex::new(host));
```

### 5.6 Phase 47 验证命令 (字节 diff)

```bash
# D-45-A 字节级
diff <(grep -E "pub fn (new|register_arc|get|contains|count)" /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/service_registry.rs | sort) \
     <(echo -e "    pub fn contains<T>(&self) -> bool\n    pub fn count(&self) -> usize\n    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>\n    pub fn new() -> Self\n    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>)")

# AppState 收缩 grep
grep -cE "^    pub [a-z_]+_service: Arc<crate::services::" /Users/coderstory/CodeSource/winui3/src-tauri/src/app_state.rs  # 期望 = 0

# commands 替换 grep
grep -rcE "state\.[a-z_]+_service\." /Users/coderstory/CodeSource/winui3/src-tauri/src/commands/ | grep -v ":0$"  # 期望空

# 9 service plugin 拓扑序单测
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::topological::tests::topo_sort_dag_returns_topological_order  # 期望顺序 = G10 锁死
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::host::tests::init_all_topological  # 4 PASS
```

---

## 6. 不在 Phase 45 范围 (严禁混入)

> 即使"觉得顺路"也不做, 留后续 phase:

- ❌ **AppState 收缩外的字段优化** — Phase 45 仅缩 9 个 service Arc 字段; `pending_sql_file` / `updater_pubkey` / `updater_endpoints` 保持原状 (这些是单值, 不需 ServiceRegistry 托管)
- ❌ **commands/ 完全删目录** — Phase 42 已迁 13 stub commands.rs, Phase 45 仅替换 12 处 service 直访, 不删 commands/ 目录
- ❌ **前端任何改动** — 23 处 invoke 0 改; App.tsx 0 改; registry.ts 0 改
- ❌ **Phase 42 工作** (inventory::submit! 注册 80 项, lib.rs invoke_handler 改造) — Phase 42 ship 后由 Phase 45 消费
- ❌ **Phase 43 工作** (tray_items / app_menu_items / MenuRegistry) — Phase 43 ship 后由 Phase 45 消费 (PluginContext.host 字段已就位)
- ❌ **Phase 44 工作** (ALL_VIEWS 派生) — 留 Phase 44 PLAN
- ❌ **Phase 46 工作** (删 mcp_management stub + useEffect) — 留 Phase 46 PLAN (D-44-A 已决策)
- ❌ **AppState::service_registry 类型升级** — 保持 `Arc<ServiceRegistry>`, Phase 47 评估是否 `RwLock` / `Mutex` 包裹 (当前 RefCell 内部已够用)
- ❌ **services/*.rs 重构** — Phase 45 仅抽 9 个 plugin mod.rs, 不动 services/ 内部实现 (ProviderService / McpService 等保持原状)
- ❌ **PluginServiceDef 静态描述恢复** — G2/G8 推迟到 Phase 47
- ❌ **app.manage 时机再优化** — Phase 45 推迟 manage 到 init 后让 Arc::get_mut 可用 (Task 4 已实施, 不再优化)
- ❌ **SPEC.md 改动** — CLAUDE.md §10 严禁
- ❌ **依赖版本 bump** — CLAUDE.md §2.3 严禁, DFS 用 std::collections::HashMap (无新依赖)

---

## 7. 验证矩阵 (overall phase checks)

| 验证 | 命令 | 期望 |
|---|---|---|
| topological 单测 | `cd src-tauri && cargo test plugins::topological::tests -- --nocapture` | 4 passed (dag/cycle/missing/multi) |
| host::init_all_topological 单测 | `cd src-tauri && cargo test plugins::host::tests -- --nocapture` | 4 新 PASS + 9 旧 PASS |
| commands::macros 单测 | `cd src-tauri && cargo test commands::macros::tests -- --nocapture` | 2 passed |
| services plugin 单测 | `cd src-tauri && cargo test plugins::services -- --nocapture` | 全 PASS (各 service 1+ test) |
| 编译 release | `cd src-tauri && cargo build --release --features tauri/custom-protocol` | exit 0 |
| Tauri build | `cd src-tauri && tauri build --no-bundle` | exit 0 |
| Smoke test | `./scripts/build-and-ship.sh --smoke-only` | 10/10 PASS |
| AppState 收缩 grep | `grep -cE "^    pub [a-z_]+_service: Arc<crate::services::" src-tauri/src/app_state.rs` | 0 |
| commands 替换 grep | `grep -rcE "state\.[a-z_]+_service\." src-tauri/src/commands/` | 全 0 (6 文件) |
| 9 service plugin register_arc | `grep -rE "register_arc::<" src-tauri/src/plugins/services/ \| wc -l` | ≥ 9 |
| 9 业务 stub depends_on | `grep -rE "fn depends_on" src-tauri/src/plugins/stubs/ \| wc -l` | ≥ 9 (Phase 42 ship 后 13 stub 期望 ≥ 9) |
| D-45-A 字节级 | `diff <(grep "pub fn" src-tauri/src/plugins/service_registry.rs) <(echo "D-45-A 标准签名")` | 空 |
| D-CC-A 4 字段 | `grep -E "pub (app\|paths\|host\|services):" src-tauri/src/plugins/traits.rs` | 4 命中 |
| Frontend 0 改动 | `git diff --stat src/` | 空 (除 .planning/) |
| lib.rs 推迟 app.manage | `grep -A2 "init_all_topological" src-tauri/src/lib.rs` | app.manage(state) 在 init_all_topological 后 |
| AppState 行数 | `wc -l src-tauri/src/app_state.rs` | < 80 (原 229, 缩 ~150) |
| history-service 3 层 fallback | `grep -E "open_history_db\|open_in_memory_db\|Connection::open_in_memory" src-tauri/src/plugins/services/history_service.rs` | 3 命中 |

---

## 8. success_criteria (phase 完成定义)

- [ ] Wave 0 (Task 1-2) Phase 42/43 契约 verify + topological 4 单测 PASS
- [ ] Wave 1 (Task 3-4) 9 service plugin 抽离 + AppState 收缩 + init_all_topological 4 单测 PASS
- [ ] Wave 2 (Task 5-7) get_service! macro + 12 处替换 + 9 业务 stub depends_on 补全 + smoke 10/10 PASS
- [ ] D-45-A / D-CC-A / G1-G10 10 项决策全部兑现 (字节级 diff 验证)
- [ ] AppState 收缩 grep = 0 (`^    pub [a-z_]+_service: Arc<crate::services::`)
- [ ] commands 替换 grep = 0 (`state\.[a-z_]+_service\.`)
- [ ] 9 service plugin + 9 业务 stub depends_on 全声明, 拓扑序合法
- [ ] "加 1 service 只动 1 文件" 强验收通过 (test service 创建 → 删除 → git diff 仅 1 文件)
- [ ] git commit: `feat(v3.4 phase-45): extract 9 services to plugins, init_all_topological, get_service! macro`
- [ ] 单 PR ship, smoke test 10/10 + 前端 0 改动

---

## 9. 输出

完成后产出 `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/45-PLAN.md` (本文件)。

执行阶段产出 `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/45-SUMMARY.md` (由 execute-phase subagent 写, 引用 Drift Report §0 实测数字 + 本 PLAN §0 输入基线)。

---

*PLAN 结束。Phase 47 整合前必读 §5 决策锁定点 + 字节 diff 验证 D-45-A + D-CC-A。*
