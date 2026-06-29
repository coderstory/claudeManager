# Phase 42 PLAN — Plugin 系统持有 commands + services

**Phase:** 42
**Goal:** 把 80 个 `#[tauri::command]` 从 `commands/` 物理迁移到 13 个 plugin stub,走 `inventory::submit!` + `DispatchTable` 自定义 invoke_handler 派发,使"加 1 plugin 改 1 文件"强验收达成,同时冻结 PluginContext 4 字段 + ServiceRegistry Arc 路径 API 为 Phase 43/45 公共契约。

---

## 0. 来源与依据 (input provenance)

- **输入 1** `.planning/milestones/v3.4-DECISIONS.md` — 5 BLOCKING 已关闭 (D-42-A inventory §2.3 白名单, SHIP-A provider_switch 合并 provider_list, D-45-A ServiceRegistry Arc 路径, D-CC-A PluginContext 4 字段 + init &mut 签名)
- **输入 2** `.planning/milestones/v3.4-phases/00-VERIFY-FIRST-DRIFT-REPORT.md` — 实测基线:80 commands / 23 invoke / 10 stub plugin / 11 service
- **输入 3** `.planning/milestones/v3.4-phases/42-RESEARCH.md` — Phase 42 研究产物 (Tauri 2.11.3 源码验证, inventory 0.3.24 选型, 6 个 pitfall)
- **输入 4** `.planning/milestones/v3.4-phases/42-DECISIONS.md` — Phase 42 discuss 5 OQ 关闭 (Q42-1 file_ops, Q42-2 history_view, Q42-3 provider 拆 2, Q42-4 IPlugin::commands debug only, Q42-5 新 stub id 命名)
- **项目实测 (基线日 2026-06-27)**:
  - `src-tauri/src/commands/*.rs` 14 文件 80 命令 (drift 报告 §0.1)
  - `src-tauri/src/plugins/{traits,host,mod}.rs` 现有 2 字段 PluginContext + 10 stub
  - `src-tauri/src/lib.rs:106-199` 硬编码 80 命令 enumerate (与 grep 80 一致)

---

## 1. Goal (强验收 = phase 完成标准)

> **核心强验收 (42-DECISIONS §强验收 + overview §3 Phase 42)**:
> 1. **13 stub 全部迁移**: `commands/*.rs` (14 文件 80 命令) → `plugins/stubs/<id>/commands.rs` (13 stub, `provider_switch` 合并 `provider_list` per SHIP-A)
> 2. **`inventory::submit!` 注册 80 次 + DispatchTable 收集 80 项** (重测订正:与 lib.rs 80 enumerate 一致)
> 3. **`cargo test plugins::dispatch::tests::dispatch_routes_correctly` PASS** (新单测)
> 4. **删 1 plugin 命令 → lib.rs / commands/ 0 改动** (强验收验证: 砍掉 provider_switch stub + commands/providers.rs 部分命令, lib.rs 不变)
> 5. **smoke test 10/10 PASS** (CLAUDE.md §13.1 全项)
> 6. **前端 0 改动** — 23 处 `invoke("xxx", ...)` 不变, Tauri 命令名 (e.g. `list_providers`) 不变
> 7. **PluginContext 4 字段冻结 + IPlugin::init 接 `&mut PluginContext`** (D-CC-A, 一次性付清避免 Phase 45 BC 损失)
> 8. **ServiceRegistry Arc 路径接口契约锁定** (D-45-A, Phase 45-01 PLAN 第一步必读此文件验证)

---

## 2. 工作量与估时

| 项目 | 估值 | 来源 |
|---|---|---|
| 新增依赖 | 1 (inventory = "=0.3.24") | D-42-A |
| 新增文件 | ~10 (dispatch.rs, service_registry.rs, plugins/stubs/{file_ops,history_view,project_mode,updater} 4 个新 stub × {mod.rs,commands.rs}) | 42-DECISIONS Q42-1/2/3/5 |
| 删除文件 | ~3 (commands/providers.rs 全删, commands/{fs,mcp,backup,history,project,marketplace,optimizer,usage,updater,resource,autostart,app,about}.rs 内容迁完后续删, provider_switch stub 删) | 漂移报告 §0.1 |
| 修改文件 | ~18 (lib.rs:106-199 + lib.rs:247, plugins/{traits,host,mod}.rs, plugins/stubs/{mod,provider_list,provider_switch,import_sql,mcp_management,usage_query,resource_browser,marketplace,optimizer,backup_restore}.rs, Cargo.toml) | D-CC-A + SHIP-A + 主改造 |
| 新增测试 | ~12 (dispatch 5 + host collect 1 + integration 1 + 每个 stub commands smoke 5) | 42-RESEARCH §Validation |
| 工作量估时 | **6-8 天** (1 天发现 + 1 天核心机制 + 1 天命令迁移 + 1 天 stub 升级 + 0.5 天测试 + 1 天 smoke + 0.5 天收尾) | sccache 已启用 |

---

## 3. 任务拆分 (Tasks)

按 TDD 红绿重构流 (CLAUDE.md §2.2) + 依赖顺序,共 6 个 task,2 个 wave:

```
Wave 0 (基础机制): Task 1 (inventory + ServiceRegistry) → Task 2 (PluginContext 4 字段) → Task 3 (DispatchTable)
Wave 1 (主工作量): Task 4 (provider_switch 删 + providers 拆) → Task 5 (13 stub 全迁移 + lib.rs 改造) → Task 6 (smoke test + 强验收)
```

---

### Task 1: 新增 inventory 依赖 + ServiceRegistry Arc 骨架 (Wave 0)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/Cargo.toml` (加 `inventory = "=0.3.24"` 严格等号锁版本,D-42-A 例外白名单)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/service_registry.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs` (加 `pub mod service_registry; pub mod dispatch;` + re-export `ServiceRegistry`)

**TDD 红绿重构流**:
1. **Red**: 写 `service_registry.rs::tests::register_arc_then_get`
2. **Red**: 写 `service_registry.rs::tests::register_arc_overwrites` (Phase 45 init 顺序依赖)
3. **Red**: 写 `service_registry.rs::tests::get_missing_returns_none`
4. **Green**: 实现 `ServiceRegistry` 用 `RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>`
5. **Refactor**: 加 `contains<T>` + `count()`

**实现要点** (字节级匹配 D-45-A):

```rust
// plugins/service_registry.rs
use std::any::{Any, TypeId};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

pub struct ServiceRegistry {
    map: RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
}

impl ServiceRegistry {
    pub fn new() -> Self { Self { map: RefCell::new(HashMap::new()) } }
    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>) {
        self.map.borrow_mut().insert(TypeId::of::<T>(), svc);
    }
    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>> {
        self.map.borrow().get(&TypeId::of::<T>())
            .and_then(|a| a.clone().downcast::<T>().ok())
    }
    pub fn contains<T: 'static>(&self) -> bool { self.map.borrow().contains_key(&TypeId::of::<T>()) }
    pub fn count(&self) -> usize { self.map.borrow().len() }
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::service_registry::tests -- --nocapture
grep -A1 '^name = "inventory"' /Users/coderstory/CodeSource/winui3/src-tauri/Cargo.lock
```

**Done 标准**:
- Cargo.lock 写入 `inventory 0.3.24` (D-42-A 例外白名单锁定)
- 3 个 service_registry 单测全过
- `ServiceRegistry::register_arc` + `get` 签名字节级匹配 D-45-A

**估时**: 0.5 天

---

### Task 2: PluginContext 冻结 4 字段 + IPlugin::init 接 `&mut` (Wave 0)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/traits.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/host.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs:247-250`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs:54`
- 修改: 10 个 stub `init` 签名全部从 `&PluginContext` → `&mut PluginContext`

**TDD 红绿重构流**:
1. **Red**: 跑现有 `host.rs::tests::init_all_runs_in_registration_order` → 应编译失败
2. **Green**: 改 traits.rs PluginContext 加字段, init 签名改 `&mut`, host.rs init_all 改 `&mut`, 更新 dummy_ctx
3. **Refactor**: 加 `PluginContext::for_tests_with_services` 给 Phase 45 用

**实现要点** (D-CC-A 冻结字节级):

```rust
// traits.rs
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub services: Option<&'a ServiceRegistry>,
    pub host: Option<&'a PluginHost>,
}

impl<'a> PluginContext<'a> {
    pub fn new(app: &'a AppHandle, paths: &'a dyn IPlatformPaths, services: &'a ServiceRegistry, host: &'a PluginHost) -> Self {
        Self { app: Some(app), paths, services: Some(services), host: Some(host) }
    }
    #[cfg(test)]
    pub fn for_tests(paths: &'a dyn IPlatformPaths) -> Self {
        Self { app: None, paths, services: None, host: None }
    }
}

pub trait IPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn routes(&self) -> Vec<PluginRoute> { vec![] }
    fn services(&self) -> Vec<Box<dyn PluginService>> { vec![] }
    /// Phase 42 NEW
    fn commands(&self) -> Vec<CommandSpec> { vec![] }
    fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError> { Ok(()) }
    fn shutdown(&mut self) -> Result<(), PluginError> { Ok(()) }
}
```

```rust
// host.rs:91
pub fn init_all(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
    let order: Vec<&'static str> = self.init_order.clone();
    for id in order {
        if let Some(plugin) = self.plugins.get_mut(id) {
            plugin.init(ctx)?;
        }
    }
    Ok(())
}
```

**lib.rs setup 改造**:

```rust
// lib.rs:247 (AFTER) — D-CC-A
let paths_impl = platform::runtime::paths();
let service_registry = ServiceRegistry::new();
let mut host = init_all(&service_registry, app.app_handle(), &*paths_impl)?;
let mut plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl, &service_registry, &host);
host.init_all(&mut plugin_ctx)?;
app.manage(Mutex::new(host));
// Phase 45 才 app.manage(service_registry); Phase 42 commands 仍走 State<AppState>
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::host::tests -- --nocapture
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
```

**Done 标准**:
- 4 字段 PluginContext 编译通过
- IPlugin::init 接 `&mut`, 10 stub 全部改完编译通过
- lib.rs setup 阶段构造 4 字段 ctx
- 现有 9 个 host 测试全 PASS

**估时**: 0.5 天

---

### Task 3: DispatchTable + make_invoke_handler (Wave 0)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/dispatch.rs`

**TDD 红绿重构流**:
1. **Red**: `dispatch.rs::tests::dispatch_routes_correctly`
2. **Red**: `dispatch.rs::tests::unknown_command_returns_false`
3. **Red**: `dispatch.rs::tests::duplicate_name_first_wins`
4. **Red**: `dispatch.rs::tests::from_inventory_collects_all_submitted`
5. **Red**: `dispatch.rs::tests::make_invoke_handler_satisfies_tauri_signature` (编译期静态断言)
6. **Green**: 实现 CommandSpec + DispatchTable + make_invoke_handler
7. **Refactor**: 加 `len()` + `contains()`

**实现要点** (Pitfall 2 + Tauri 源码验证):

```rust
// plugins/dispatch.rs
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Invoke;
use tauri::Runtime;

pub struct CommandSpec<R: Runtime = tauri::Wry> {
    pub name: &'static str,
    pub plugin_id: &'static str,
    pub dispatch: fn(Invoke<R>) -> bool,
}

pub struct DispatchTable<R: Runtime = tauri::Wry> {
    by_name: HashMap<&'static str, CommandSpec<R>>,
}

impl<R: Runtime> DispatchTable<R> {
    pub fn from_inventory() -> Self {
        let mut by_name = HashMap::with_capacity(80);
        for spec in inventory::iter::<CommandSpec<R>> {
            if let std::collections::hash_map::Entry::Vacant(e) = by_name.entry(spec.name) {
                e.insert(CommandSpec { name: spec.name, plugin_id: spec.plugin_id, dispatch: spec.dispatch });
            } else {
                log::warn!("[Phase 42] duplicate command name '{}' — first wins (plugin_id={})", spec.name, spec.plugin_id);
            }
        }
        log::info!("[Phase 42] DispatchTable built: {} commands", by_name.len());
        Self { by_name }
    }

    pub fn dispatch(&self, invoke: Invoke<R>) -> bool {
        let cmd = invoke.message.command();
        match self.by_name.get(cmd) {
            Some(spec) => (spec.dispatch)(invoke),
            None => false,
        }
    }

    pub fn len(&self) -> usize { self.by_name.len() }
}

pub fn make_invoke_handler<R: Runtime>(table: DispatchTable<R>)
    -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
{
    let table = Arc::new(table);
    move |invoke: Invoke<R>| table.dispatch(invoke)
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::dispatch::tests -- --nocapture
```

**Done 标准**:
- 5 个 dispatch 单测全过
- 编译期静态断言 `make_invoke_handler` 签名匹配 Tauri `invoke_handler<F>`
- inventory::iter 启动期遍历 < 1ms

**估时**: 1 天

---

### Task 4: 删除 provider_switch stub + 拆 providers.rs (Wave 1)

**文件**:
- 删除: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/provider_switch.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/mod.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs:41`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/provider_list.rs`
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/provider_list/commands.rs`
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/import_sql/commands.rs`
- 删除: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/providers.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/fs.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/mod.rs`

**TDD 红绿重构流**:
1. **Red**: 跑 `cargo build --release` → lib.rs:106 `commands::providers::list_providers` 引用应编译失败
2. **Red**: `provider_list/commands.rs::tests::list_providers_fn_pointer_callable` (静态类型断言)
3. **Green**: 迁 16 命令函数体 + 16 个 submit!
4. **Refactor**: provider_list stub `routes()` 返回 `/` + `/switch` (per SHIP-A)

**实现要点** (Pitfall 3: Tauri 命令名保持原样):

```rust
// plugins/stubs/provider_list.rs (升级)
use super::super::traits::*;
use super::super::dispatch::CommandSpec;

pub mod commands;

pub struct ProviderListPlugin;

impl IPlugin for ProviderListPlugin {
    fn id(&self) -> &'static str { "provider-list" }
    fn name(&self) -> &'static str { "Provider 列表" }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![
            PluginRoute { path: "/".into(), plugin_id: "provider-list", display_name: "Provider 列表".into() },
            // SHIP-A: F2 合并到 F1
            PluginRoute { path: "/switch".into(), plugin_id: "provider-list", display_name: "Provider 切换".into() },
        ]
    }
    fn commands(&self) -> Vec<CommandSpec> {
        // Q42-4: 仅 debug/测试用, 运行期 dispatch 走 inventory::iter
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == self.id())
            .map(|c| CommandSpec { name: c.name, plugin_id: c.plugin_id, dispatch: c.dispatch })
            .collect()
    }
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins::stubs::provider_list -- --nocapture
grep -c "inventory::submit!" /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/provider_list/commands.rs
grep -c "inventory::submit!" /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/import_sql/commands.rs
ls /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/ | grep provider_switch || echo "OK: provider_switch stub removed"
```

**Done 标准**:
- provider_switch stub 文件 0 残留
- provider_list plugin 持 13 命令 + 2 routes
- import_sql plugin 持 3-5 命令
- inventory::submit! 计数: provider_list 13 + import_sql 3-5 ≈ 16-18
- `commands::providers::xxx` 在 lib.rs 0 残留

**估时**: 1 天

---

### Task 5: 13 stub 全迁移 + lib.rs 改造 (Wave 1, 主工作量)

**5a. 7 老 stub 升级** (commands 子模块 + inventory::submit!):
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/{mcp_management,usage_query,resource_browser,marketplace,optimizer,backup_restore,json_editor}.rs` (每个加 `pub mod commands;` + stub 加 commands() 方法)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/{mcp_management,usage_query,resource_browser,marketplace,optimizer,backup_restore}/commands.rs` (各 N 命令函数 + N submit!)

**5b. 4 新 stub 新建** (Q42-1/2/3/5 决策):
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/file_ops.rs` + `file_ops/commands.rs` (Q42-1: 跨 F2/F6/F13/F18/F19 文件操作, 6 命令)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/history_view.rs` + `history_view/commands.rs` (Q42-2: history 独立 schema, 8 命令)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/project_mode.rs` + `project_mode/commands.rs` (7 命令, M3.10 清单 23)
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/updater.rs` + `updater/commands.rs` (3 命令, M4.3 pubkey/endpoint/check)

**5c. 13 个 stub 全部注册到 host** (Q42-5 命名决策):
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/mod.rs` (加 4 个新 stub pub mod + pub use, 删 provider_switch)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs:36-51` (重写 register 调用, 12 业务 + 1 core = 13 stub)

**5d. lib.rs invoke_handler 改造** (核心 1 处替换):
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs:106-199` (80 命令 enumerate → `tauri::Builder::default().invoke_handler(plugins::dispatch::make_invoke_handler(plugins::dispatch::DispatchTable::from_inventory()))`)

**5e. commands/ 模块清理**:
- 删除: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/{fs,mcp,backup,history,project,marketplace,optimizer,usage,updater,resource,autostart,app,about}.rs` (内容全部迁完后整文件删)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/commands/mod.rs` (留空 mod 或全删该目录 — 需保留 `pub mod commands;` 在 lib.rs:13 防其他模块引用,可改成 `// commands/ migrated to plugins/stubs/<id>/commands.rs (Phase 42)` 空注释 mod)

**TDD 红绿重构流**:
1. **Red**: 跑 `cargo build --release` → 应编译失败 (commands 模块已删但 lib.rs 仍有引用) — 实际上 Task 4 已先把 providers.rs 删,本任务接续
2. **Red**: 写每个新 stub 的 smoke 单测: `plugins::stubs::mcp_management::tests::inventory_registers_expected_count` — 验证 `inventory::iter::<CommandSpec>().filter(|c| c.plugin_id == "mcp-management").count() == 8`
3. **Green**: 逐 stub 迁命令函数体 + 加 submit!, 每完成一个 stub 跑一次 `cargo build` 验证增量编译 (sccache warm cache, 单 stub 增量 < 5s)
4. **Green**: lib.rs:106-199 替换为 dispatch 闭包
5. **Refactor**: 清理 commands/mod.rs 注释, 加 Phase 42 迁移完成标记

**核心 lib.rs 改造** (Pitfall 1 严禁):
```rust
// lib.rs:106 (BEFORE)
.invoke_handler(tauri::generate_handler![commands::autostart::get_autostart_status, ... 80 项 ...])

// lib.rs:106 (AFTER)
.invoke_handler(
    crate::plugins::dispatch::make_invoke_handler(
        crate::plugins::dispatch::DispatchTable::from_inventory()
    )
)
```

**严禁**: `tauri::generate_handler![plugins::stubs::a::commands::list_a(), plugins::stubs::b::commands::list_b()]` 这种"宏嵌套" (compile error, Pitfall 1)。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build --release
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test plugins:: -- --nocapture
ls /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/ | wc -l  # 期望 12 stub .rs + mod.rs = 13
grep -rE "inventory::submit!" /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/ | wc -l  # 期望 80
ls /Users/coderstory/CodeSource/winui3/src-tauri/src/commands/  # 期望仅剩 mod.rs (空或带注释)
```

**Done 标准**:
- 13 stub 全部 migrate 完毕 (12 业务 + 1 core)
- commands/ 目录基本清空 (mod.rs 保留作历史注释)
- 80 个 `inventory::submit!` 全在 plugins/stubs/ 下
- lib.rs:106-199 invoke_handler 改造完成
- `cargo test plugins::` 全 PASS

**估时**: 2 天 (8 个 stub × 0.25 天/含命令函数体搬移)

---

### Task 6: smoke test 验证 + 强验收确认 (Wave 1 收尾)

**文件**:
- 修改 (如需): `/Users/coderstory/CodeSource/winui3/scripts/build-and-ship.sh` (smoke test 第 11 项验证 "新 command 加 1 plugin 0 改 lib.rs", 通过 grep 验证 lib.rs:106 不再含 `commands::` 前缀)
- 修改 (如需): `/Users/coderstory/CodeSource/winui3/.planning/phases/42-*/42-*-SUMMARY.md` (收尾文档, 引用 Drift Report 数字重测)

**TDD 验证流**:
1. **Build**: `tauri build --no-bundle` 走通 (前置条件: Task 5 cargo build --release 已绿)
2. **Smoke**: 跑 `scripts/build-and-ship.sh` smoke test 10 项全 PASS (CLAUDE.md §13.1)
3. **Frontend 0 改动验证**: `git diff src/` 应为空 (除 .planning/ 和 SPEC.md), 否则回溯找哪个 invoke 名字错位
4. **强验收 "加 1 plugin 改 1 文件"**: 写一个临时 test plugin `plugins/stubs/_test_strong.rs` 加 1 个 `inventory::submit!`, 跑 cargo build, **仅该文件 + Cargo.toml lock (如新依赖) 变化, lib.rs 0 改动**, 验证后删 test plugin
5. **Phase 45 接口契约对齐**: `diff <(grep "pub fn" plugins/service_registry.rs) <(echo -e "pub fn new()\npub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>)\npub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>")` 应为空 (字节级匹配 D-45-A)

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && ./scripts/build-and-ship.sh --smoke-only 2>&1 | tail -20
cd /Users/coderstory/CodeSource/winui3 && git diff --stat src/  # 应仅 plugins/ 变化
cd /Users/coderstory/CodeSource/winui3 && git diff --stat src-tauri/src/lib.rs  # 应仅 setup() 段变化
cd /Users/coderstory/CodeSource/winui3 && grep -rE "commands::" src-tauri/src/lib.rs | wc -l  # 应 0
```

**Done 标准** (Phase 47 视觉回归前):
- smoke test 10/10 PASS (含新增 "DispatchTable 收集 80 项" 验证项)
- git diff src/ 为空 (前端 0 改动)
- git diff src-tauri/src/lib.rs 仅 setup() 4 字段 ctx 段变化 (不增不改 invoke_handler 的命令列表)
- `grep "commands::" src-tauri/src/lib.rs` 0 命中 (lib.rs 不再直接引用 commands/)
- D-42-A / D-CC-A / D-45-A / SHIP-A 全部兑现

**估时**: 0.5 天

---

## 4. 风险与缓解 (≥3 高风险点)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| **R1** | **inventory 跨 crate 边界**: inventory::submit! 依赖编译器生成 `__inventory_<type>` 自定义 section (ELF/PE/Mach-O),跨 .o 文件聚合。如果 `RUSTFLAGS` 设置不当 (e.g. `-C link-arg=-s` 删 dead-code) 可能丢失 section | **致命**: commands 全部 "command not found",前端全黑 | 1. 验证: 跑 `cargo build --release` + `nm src-tauri/target/release/claude-config-manager \| grep inventory` 应有 `__inventory_*` 符号<br>2. 备选: 用 `inventory = "=0.3.24"` 内置的 `inventory::collect!` 宏 (启动期显式 collect, 不依赖链接器 section)<br>3. CI 增强: smoke test 加 "DispatchTable len == 80" 验证 |
| **R2** | **`generate_handler!` 与 `inventory::iter` 嵌套 compile error** (Pitfall 1): 有人可能写出 `tauri::generate_handler![plugins::stubs::a::commands::list_a()]` 这种"宏嵌套" — `generate_handler!` 是 proc_macro, 不能运行期拼接 (tauri-macros 2.6.3/src/command/handler.rs:144-185 源码验证) | **致命**: 全命令失效 | 1. PR review checklist: lib.rs invoke_handler 必须是 `make_invoke_handler(...)`, 不允许任何 `generate_handler!` 残留<br>2. lint: `grep -n "generate_handler" src-tauri/src/lib.rs` 应 0 命中<br>3. 写 integration test `tests/dispatch_invoke.rs` 跑 Tauri runtime 验证 dispatch 路径 |
| **R3** | **前端 23 处 invoke 名字错位**: 迁移命令函数时, 改了 Tauri 命令名 (e.g. `list_providers` → `provider_list::list_providers` 加前缀),前端 invoke 调用全失效,UI 全黑 | **致命**: smoke test 不检测 UI 文本, build 过但 UI 实际全错位 (CLAUDE.md §6.4 反事故: 5 文案同步灾难) | 1. Pitfall 3 严禁清单: commands/*.rs → plugins/stubs/<id>/commands.rs 迁完后, 函数名不变, 命令名 (CommandSpec.name) 不变<br>2. 自动 grep gate: `grep -E "CommandSpec { name:" src-tauri/src/plugins/stubs/ -h \| awk -F'"' '{print $2}' \| sort > /tmp/expected.txt && grep -rE "invoke\(\"" src/lib/api/ -h \| awk -F'"' '{print $2}' \| sort > /tmp/actual.txt && diff /tmp/expected.txt /tmp/actual.txt` 应为空<br>3. 强验收 "前端 0 改动": `git diff src/` 应为空 |
| **R4** | **Phase 45 接口契约漂移**: Phase 42 写出 `register<T>(T)` 而非 `register_arc<T>(Arc<T>)`, Phase 45 必须用 Arc 路径 (9 service 拓扑互注入), Phase 42 ship 后改 API 破坏 BC | **高**: Phase 45 必须协商改 API, 增加 Phase 45 工作量 | 1. **D-45-A 已锁**: register_arc<T>(Arc<T>) + get<T>() -> Option<Arc<T>> 字节级固定<br>2. Phase 45-01 PLAN 第一步必须 read 42-PLAN.md §"决策锁定点" 段 + `diff plugins/service_registry.rs` 字节验证<br>3. 不一致走 CLAUDE.md §2.5 协商加 5 行 API (Phase 42 ServiceRegistry +5 行兼容层) |
| **R5** | **commands 模块仍有 helper 函数引用**: 迁 16 命令函数时, 函数体内部引用 `crate::commands::xxx::helper` (e.g. `commands::fs::validate_field`),迁完主函数后 helper 未迁 → 编译失败 | **中**: 单 stub 编译失败 | 1. 迁主函数前先 grep 函数体内 `use crate::commands::xxx` 引用<br>2. helper 函数跟主函数一起迁 (1 文件拆 2 文件)<br>3. 每迁完一个 stub 跑 cargo check 增量验证 |

---

## 5. 决策锁定点 (Phase 45 必读必验证)

**Phase 45-01 PLAN 第一步必读本节 + 字节 diff 验证, 不一致走 CLAUDE.md §2.5 协商加 5 行 API**:

### 5.1 ServiceRegistry 接口 (D-45-A 字节级固定)

```rust
// /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/service_registry.rs
pub struct ServiceRegistry { /* RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>> */ }
impl ServiceRegistry {
    pub fn new() -> Self;
    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>);
    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>;
    pub fn contains<T: 'static>(&self) -> bool;
    pub fn count(&self) -> usize;
}
```

### 5.2 PluginContext 字段 (D-CC-A 冻结 4 字段)

```rust
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub services: Option<&'a ServiceRegistry>,
    pub host: Option<&'a PluginHost>,  // Phase 43 引入, Phase 42 留 None
}
```

### 5.3 IPlugin::init 签名 (D-CC-A)

```rust
fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError>;
```

### 5.4 Phase 45 验证命令 (1 行 diff 验证)

```bash
# Phase 45-01 PLAN 第一步:
diff <(grep -E "pub fn (new|register_arc|get|contains|count)" /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/service_registry.rs | sort) \
     <(echo -e "    pub fn contains<T>(&self) -> bool { ... }\n    pub fn count(&self) -> usize { ... }\n    pub fn get<T>(&self) -> Option<Arc<T>>\n    pub fn new() -> Self\n    pub fn register_arc<T>(&self, svc: Arc<T>)")
```

---

## 6. 不在 Phase 42 范围 (严禁混入)

> 即使"觉得顺路"也不做,留后续 phase:

- ❌ **PluginContext::services_mut() 实施** — Phase 45 才需要, Phase 42 仅冻结字段集 (`services: Option<&'a ServiceRegistry>` 已是 `&` 共享借用)
- ❌ **AppState 9 个 Arc<Service> 字段缩** — Phase 45 才需要 (ServiceRegistry 接管), Phase 42 AppState 保持现状
- ❌ **commands/*.rs 完全删目录** — 留 mod.rs 作历史注释,防 git log 难追溯
- ❌ **前端任何改动** — 23 处 invoke 0 改; App.tsx 0 改; registry.ts 0 改
- ❌ **mcp_management stub 删** — Phase 46 工作 (D-44-A 已决策)
- ❌ **Phase 43 任何工作** (tray_items() / app_menu_items()) — 留 Phase 43 PLAN
- ❌ **Phase 44 任何工作** (ALL_VIEWS 派生) — 留 Phase 44 PLAN
- ❌ **Phase 45 任何工作** (services register_arc 调用 / 拓扑序 / init_with_deps) — 留 Phase 45 PLAN
- ❌ **SPEC.md 改动** — CLAUDE.md §10 严禁

---

## 7. 验证矩阵 (overall phase checks)

| 验证 | 命令 | 期望 |
|---|---|---|
| ServiceRegistry 单测 | `cd src-tauri && cargo test plugins::service_registry::tests -- --nocapture` | 3 passed |
| DispatchTable 单测 | `cd src-tauri && cargo test plugins::dispatch::tests -- --nocapture` | 5 passed |
| PluginHost 单测 | `cd src-tauri && cargo test plugins::host::tests -- --nocapture` | 9 passed (兼容 &mut) |
| 所有 plugin 单测 | `cd src-tauri && cargo test plugins:: -- --nocapture` | 全 PASS |
| 编译 release | `cd src-tauri && cargo build --release --features tauri/custom-protocol` | exit 0 |
| Tauri build | `cd src-tauri && tauri build --no-bundle` | exit 0 |
| Smoke test | `./scripts/build-and-ship.sh --smoke-only` | 10/10 PASS |
| Frontend 0 改动 | `git diff --stat src/` | 空 (除 .planning/) |
| lib.rs invoke_handler 改造 | `grep -E "generate_handler" src-tauri/src/lib.rs` | 0 命中 |
| lib.rs 不再直接引 commands | `grep -E "commands::" src-tauri/src/lib.rs` | 0 命中 |
| 13 stub 计数 | `ls src-tauri/src/plugins/stubs/*.rs \| wc -l` | 12 (excl. mod.rs) |
| 80 submit! 计数 | `grep -rE "inventory::submit!" src-tauri/src/plugins/stubs/ \| wc -l` | 80 |
| provider_switch stub 删 | `ls src-tauri/src/plugins/stubs/provider_switch* 2>/dev/null` | 0 命中 |
| ServiceRegistry Arc API 锁定 | `diff <(grep "pub fn" plugins/service_registry.rs) <(D-45-A 标准签名)` | 空 (字节级一致) |
| Phase 45 接口契约 | `cat plugins/service_registry.rs \| grep -E "register_arc\|get<T>"` | 见 D-45-A 字节级 |

---

## 8. success_criteria (phase 完成定义)

- [ ] Wave 0 (Task 1-3) 全部单测 PASS, DispatchTable + ServiceRegistry + PluginContext 4 字段基线就位
- [ ] Wave 1 (Task 4-5) 80 命令全迁移, 13 stub 全升级, lib.rs invoke_handler 改造完成
- [ ] Task 6 smoke test 10/10 PASS, 前端 0 改动, 强验收 "加 1 plugin 改 1 文件" 验证通过
- [ ] D-42-A / D-CC-A / D-45-A / SHIP-A 4 项决策全部兑现 (字节级 diff 验证)
- [ ] Phase 45 接口契约锁定 (ServiceRegistry Arc 路径, PluginContext 4 字段, init &mut 签名)
- [ ] commands/ 目录清空 (仅留 mod.rs 注释)
- [ ] git commit: `feat(v3.4 phase-42): migrate 80 commands to 13 plugin stubs via inventory::submit!`
- [ ] 单 PR ship, smoke test 10/10 + 前端 0 改动

---

## 9. 输出

完成后产出 `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/42-PLAN.md` (本文件)。

执行阶段产出 `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/42-SUMMARY.md` (由 execute-phase subagent 写,引用 Drift Report §0 实测数字 + 本 PLAN §0 来源)。

---

*PLAN 结束。Phase 45-01 PLAN 第一步必读 §5 决策锁定点 + 字节 diff 验证 D-45-A。*