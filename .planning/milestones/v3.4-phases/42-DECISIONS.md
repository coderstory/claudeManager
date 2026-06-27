---
gsd_decisions_version: 1.0
phase: 42
decided: 2026-06-27
decided_by: discuss-phase subagent (待用户复核)
based_on: ../v3.4-DECISIONS.md (5 BLOCKING 关闭, 209 行, commit 372471b) + ./42-RESEARCH.md Open Questions
---

# Phase 42 DECISIONS

> 关闭 Phase 42 剩余 Open Questions。5 BLOCKING 决策见 ../v3.4-DECISIONS.md (继承 D-42-A: inventory 走 §2.3 例外; SHIP-A: provider_switch 合并到 provider_list).

## 已关闭决策 (继承)

- **D-42-A**: `inventory = "=0.3.24"` §2.3 例外 (dtolnay, Rust 生态标杆)
- **SHIP-A**: provider_switch 后端 stub 删, 命令合并到 provider_list

## Phase 42 剩余 OQ 关闭

### Q42-1: `commands/fs.rs` 6 命令归属
- **决策**: 独立 `file_ops` plugin (新 stub)
- **理由**: 6 命令跨 F2/F6/F13/F18/F19, 集中便于维护; 新增 F 只需 import 无需新建 plugin
- **影响**: `plugins/stubs/file_ops/{commands.rs, mod.rs}` 新建 + 6 命令迁移

### Q42-2: `commands/history.rs` 8 命令归属
- **决策**: 独立 `history_view` plugin (新 stub)
- **理由**: history 独立 schema (SQLite) + query pattern, 与 backup "写时插入" 分离; Phase 45 拓扑序单独 init
- **影响**: `plugins/stubs/history_view/` 新建; Phase 45 depends_on = `["history-service"]`

### Q42-3: `commands/providers.rs` 16 命令拆分
- **决策**: 2 个 plugin (合并 SHIP-A)
  - `provider_list` — F1 list + F3 import + F4 deeplink + M2.16 generate + M3.7 CRUD, ~13 命令
  - `import_sql` — F3 .sql 导入专属, 3-5 命令
- **理由**: SHIP-A 已合并 provider_switch; 拆 3 plugin (provider_list + provider_switch + import_sql) 过度, 拆 1 plugin 失去 Phase 44 propsBuilder 差异
- **影响**: provider_switch stub 删, 命令名不变 (Tauri 全局 namespace), 物理位置合并

### Q42-4: `IPlugin::commands()` 运行期调用
- **决策**: Phase 42 仅 debug/测试用, 运行时 dispatch 走 `inventory::iter`
- **理由**: inventory link-time 聚合 + 启动期 O(1) 遍历, 0 dyn dispatch; Phase 45 拓扑序用 `depends_on()` 显式声明
- **影响**: `IPlugin::commands()` 默认空 vec; `DispatchTable::from_inventory()` 走 inventory 不走 host

### Q42-5: 新增 plugin 命名
- **决策**: `history_view` / `project_mode` / `file_ops` / `updater` 均不与现有 10 业务 stub id 冲突
- **理由**: PluginHost::register duplicate id 启动期 fail-fast
- **影响**: 12 业务 plugin (10 老 + 4 新 - 2 合并 provider_switch + 1 拆 import_sql) = 13 业务 stub

## 推迟到 Phase 47

- provider_switch 删后的 UI 入口: Phase 44 在 provider_list page 内部集成 switch 按钮, Phase 47 视觉回归

## PLAN 阶段必须实现的接口约束

### 1. ServiceRegistry API (Phase 42 产出, Phase 45 消费)

```rust
pub struct ServiceRegistry {
    map: HashMap<TypeId, Box<dyn Any + Send + Sync>>,
}
impl ServiceRegistry {
    pub fn new() -> Self;
    /// Phase 42 占位; Phase 45 改 register_arc<T>(svc: Arc<T>)
    pub fn register<T: 'static + Send + Sync>(&mut self, svc: T);
    /// Phase 45 必改: get<T>() -> Option<Arc<T>>
    pub fn get<T: 'static>(&self) -> Option<&T>;
}
```

**Phase 45-01 PLAN 第一步必须 read 此文件验证 API**; 不一致走 §2.5 协商加 5 行 API.

### 2. CommandSpec + inventory::submit! (dispatch.rs NEW)

```rust
pub struct CommandSpec<R: Runtime = tauri::Wry> {
    pub name: &'static str,
    pub plugin_id: &'static str,
    pub dispatch: fn(Invoke<R>) -> bool,  // fn pointer, NOT 闭包
}
pub struct DispatchTable<R: Runtime = tauri::Wry> {
    by_name: HashMap<&'static str, CommandSpec<R>>,
}
impl<R: Runtime> DispatchTable<R> {
    pub fn from_inventory() -> Self;  // first-wins on duplicate
    pub fn dispatch(&self, invoke: Invoke<R>) -> bool;
}
pub fn make_invoke_handler<R: Runtime>(table: DispatchTable<R>)
    -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static;
```

### 3. PluginContext 扩展 (Phase 42 +)

```rust
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub services: Option<&'a mut ServiceRegistry>,  // NEW; 0/None 兼容 Phase 43/45
}
```

### 4. IPlugin trait 扩展 (Phase 42 增量, 默认空 vec)

```rust
pub trait IPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn routes(&self) -> Vec<PluginRoute> { vec![] }
    fn commands(&self) -> Vec<CommandSpec> { vec![] }       // NEW
    fn services(&self) -> Vec<PluginServiceDef> { vec![] }  // 默认空
    fn init(&mut self, ctx: &PluginContext) -> Result<(), PluginError>;
    fn shutdown(&mut self) -> Result<(), PluginError>;
}
```

**关键不变量**: 新方法 default impl, 不破坏已 ship plugin.

### 5. lib.rs::setup 改造 (BEFORE/AFTER)

```rust
// BEFORE
.invoke_handler(tauri::generate_handler![80 commands...])
// AFTER
.invoke_handler(crate::plugins::dispatch::make_invoke_handler(
    crate::plugins::dispatch::DispatchTable::from_inventory(),
))
```

**禁止**: `generate_handler!` 嵌套 `inventory::iter()` (compile error, Pitfall 1)

### 6. commands 物理迁移映射 (14 文件 → 13 stub)

| commands/ 源 | plugins/stubs/ 目标 | 命令数 |
|---|---|---|
| providers.rs (16) | provider_list (13) + import_sql (3) | 16 |
| mcp.rs (8) | mcp_management | 8 |
| backup.rs (9) | backup_restore | 9 |
| history.rs (8) | history_view (NEW) | 8 |
| project.rs (7) | project_mode (NEW) | 7 |
| marketplace.rs (6) | marketplace | 6 |
| fs.rs (6) | file_ops (NEW) | 6 |
| optimizer.rs (5) | optimizer | 5 |
| usage.rs (4) | usage_query | 4 |
| updater.rs (3) | updater (NEW) | 3 |
| resource.rs (3) | resource_browser | 3 |
| autostart/app/about (4) | core (Phase 43 合并) | 4 |
| **合计** | **13 stub** (12 业务 + 1 core) | **80** |

### 7. 保留 AppState 9 个 Arc<Service> 字段 (Phase 42 不动)

Phase 42 只做 commands 物理迁移 + IPC dispatch; AppState::build 保持现状; Phase 45 才缩 AppState.

### 8. 前端 0 改动

23 处 `invoke("xxx", ...)` 不变; Tauri 命令名 `list_providers` 等不变; 不引 plugin_id 前缀.

## 强验收 (Phase 47 验证)

- 13 stub 全部迁移, smoke test 10/10 PASS
- 80 个 `inventory::submit!` 注册 + DispatchTable 收集 80 项
- `cargo test plugins::dispatch::tests::dispatch_routes_correctly` PASS
- 删 1 个 plugin 命令 → lib.rs / commands/ 0 改动
- "加 1 plugin 改 1 文件" 强验收
