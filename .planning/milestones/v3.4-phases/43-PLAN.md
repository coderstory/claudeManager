# Phase 43 PLAN — MenuRegistry + tray/AppMenu 注册化

**Phase:** 43
**Goal:** 把 tray (lib.rs:308-329) 与 macOS AppMenu (lib.rs:380-386 + platform/{macos,windows}/app_menu.rs) **完全收编**到 plugin 系统:扩 IPlugin 加 `tray_items() / app_menu_items()` 默认空 vec;新增 `core` plugin 接管两套菜单的声明;新增 `MenuRegistry` 模块集中构建 + dispatch;删 `IPlatformAppMenu` trait + `MacAppMenu/WindowsAppMenu`;`lib.rs::setup` 改造为 0 行 `MenuItem::with_id / on_menu_event` + 调 `host.init_all(&mut ctx)`,使"加 1 项托盘菜单动 1 个文件" 强验收达成。

---

## 0. 来源与依据 (input provenance)

- **输入 1** `.planning/milestones/v3.4-DECISIONS.md` — 5 BLOCKING 已关闭 (D-42-A inventory, SHIP-A provider_switch, D-44-A mcp stub 删, D-45-A ServiceRegistry Arc, **D-CC-A PluginContext 冻结 4 字段 + `&mut` init 签名**)
- **输入 2** `.planning/milestones/v3.4-phases/00-PHASE-OVERVIEW.md` — Phase 43 = MenuRegistry 中心化 (overview §3 Phase 43)
- **输入 3** `.planning/milestones/v3.4-phases/43-RESEARCH.md` — Phase 43 研究产物 (Tauri 2.11.3 menu API 源码验证,PluginAction 4 变体,PluginTrayItem / PluginAppMenuItem 声明结构,6 个 pitfall)
- **输入 4** `.planning/milestones/v3.4-phases/43-DECISIONS.md` — Phase 43 discuss 5 OQ 关闭 (Q43-1 unregister_actions, Q43-2 emit "frontend://switch-view", Q43-3 accelerator None, Q43-4 AboutMetadata bundle.copyright, Q43-5 "core" id) + 推迟到 Phase 47
- **输入 5** `.planning/milestones/v3.4-phases/42-DECISIONS.md` — Phase 42 接口契约 (ServiceRegistry API 占位 + IPlugin `commands/services()` 默认空 Vec 模式)
- **项目实测 (基线日 2026-06-27)**:
  - `src-tauri/src/lib.rs:308-329` 现有 tray 手写 (MenuItem::with_id × 2 + on_menu_event match)
  - `src-tauri/src/lib.rs:380-386` 现有 macOS AppMenu cfg 块 (调 `platform::runtime::app_menu(...).build_app_menu()`)
  - `src-tauri/src/platform/{macos,windows}/app_menu.rs` 现有 2 文件 (IPlatformAppMenu impl)
  - `src-tauri/src/platform/traits.rs:351-353` IPlatformAppMenu trait + 419-422 mock + 603-610 测试
  - `src-tauri/src/platform/{macos,windows}/mod.rs:15,23` 各自 mod 声明 + re-export
  - `src-tauri/src/platform/mod.rs:32,127-137` 平台 mod re-export + `runtime::app_menu` factory
  - `src-tauri/src/plugins/{traits,host,mod}.rs` 现有 IPlugin 2 字段 PluginContext + 11 stub (provider_switch 合并后)
  - **Phase 42 实施进度假设**: D-CC-A 已冻结 4 字段 PluginContext (`app + paths + services(&mut) + host(Option<&>)`)。**如 Phase 42 未实施 D-CC-A**,Task 1 必须先扩展 PluginContext 到 4 字段再消费 host 字段 (与 42-DECISIONS §3 兼容路径一致)

---

## 1. Goal (强验收 = phase 完成标准)

> **核心强验收 (43-DECISIONS §强验收 + 43-RESEARCH §Validation REQ-43.1..43.9)**:
>
> | ID | 强验收 | 验证命令 |
> |---|---|---|
> | G-1 | **lib.rs 0 行 `MenuItem::with_id` / `on_menu_event`** (grep lint) | `! grep -nE 'MenuItem::with_id\|on_menu_event' src-tauri/src/lib.rs` |
> | G-2 | **`platform/macos/app_menu.rs` + `platform/windows/app_menu.rs` 文件不存在** | `! test -f src-tauri/src/platform/macos/app_menu.rs && ! test -f src-tauri/src/platform/windows/app_menu.rs` |
> | G-3 | **`IPlatformAppMenu` trait + `MacAppMenu` / `WindowsAppMenu` impl + `platform::runtime::app_menu()` factory 全部删除** | `! grep -rn 'IPlatformAppMenu\|MacAppMenu\|WindowsAppMenu\|app_menu_build_dispatch' src-tauri/src/` |
> | G-4 | **9 业务 stub `tray_items() / app_menu_items()` 默认空 vec,0 改动** | `git diff --stat src-tauri/src/plugins/stubs/*.rs` 仅 `core.rs` 新增 |
> | G-5 | **`core` plugin 注册在 plugins/mod.rs 第一行,id = "core"** | `head -1 src-tauri/src/plugins/mod.rs` 后 core register 是首项 |
> | G-6 | **`cargo test plugins::menu_registry::tests::*` 4 项 PASS** | `cd src-tauri && cargo test --lib plugins::menu_registry` |
> | G-7 | **`cargo test plugins::traits::tests::default_tray_items_empty` PASS** | `cd src-tauri && cargo test --lib plugins::traits` |
> | G-8 | **`cargo test --lib --all` PASS** (Phase 42 / 43 stub 全绿,无 IPlatformAppMenu 引用遗留) | `cd src-tauri && cargo test --lib` |
> | G-9 | **`scripts/smoke-test.sh` 10/10 PASS** (CLAUDE.md §13.1 全项) | `./scripts/smoke-test.sh build/...exe` |
> | G-10 | **macOS 真机验证 App 菜单 4 submenu 可见** (Phase 47 整合期验证,本 phase 仅 compile-only) | Phase 47 跑 |

**反向验收 ("不应该再出现")**:
- lib.rs 不应再含 `use tauri::menu::{Menu, MenuItem};` + `use tauri::tray::TrayIconBuilder;`
- `platform/mod.rs` 不应再 re-export `IPlatformAppMenu`
- `app_menu` 这个字符串在 src-tauri/src/ 出现次数 = 0 (case-sensitive grep)
- `core-plugin` 的 `tray_items()` 必须返回 ≥ 1 项 (否则 G-1 通过但功能丢失)

---

## 2. 工作量与估时

| 项目 | 估值 | 来源 |
|---|---|---|
| 新增依赖 | 0 (复用 tauri 2.11.3 + std + workspace log/thiserror) | 43-RESEARCH §Standard Stack + 43-DECISIONS §PLAN |
| 新增文件 | ~4 (`plugins/menu_registry.rs`, `plugins/stubs/core.rs`, `scripts/lint-plugin-coupling.sh` NEW, README 注释) | 43-DECISIONS §4 + §强验收 + 43-RESEARCH §Recommended Project Structure |
| 删除文件 | 2 (`platform/macos/app_menu.rs`, `platform/windows/app_menu.rs`) | 43-DECISIONS §6 |
| 修改文件 | ~8 (`lib.rs` 1 处, `plugins/traits.rs` 加默认 impl, `plugins/host.rs` 加 collect helper, `plugins/mod.rs` 注册 core 第一行, `platform/traits.rs` 删 IPlatformAppMenu + mock + test, `platform/mod.rs` 删 re-export + factory, `platform/{macos,windows}/mod.rs` 各删 1 行 re-export) | 43-DECISIONS §1..§7 + 43-RESEARCH §Anti-Patterns |
| 新增测试 | ~7 (menu_registry 4 + traits 默认 impl 1 + host collect 2) | 43-RESEARCH §Validation REQ-43.1..43.7 |
| 工作量估时 | **2-3 天** (0.5 天接口 + 1 天 menu_registry + 0.5 天 core plugin + 0.5 天反向删除 + 0.5 天测试/lint/smoke) | sccache 已启用,macOS 真机验证 D6 暂缓待 M4 |

---

## 3. 任务拆分 (Tasks)

按 TDD 红绿重构流 (CLAUDE.md §2.2) + 依赖顺序,共 **7 个 task,3 个 wave**:

```
Wave 0 (接口 + 类型): Task 1 (PluginContext + IPlugin 默认 impl + PluginHost collect) → Task 2 (PluginAction enum + PluginTrayItem/PluginAppMenuItem/AppMenuRole 类型 + unregister_actions)
Wave 1 (核心机制):     Task 3 (MenuRegistry::build_tray + TrayIconBuilder 装配 + HashMap dispatch) → Task 4 (MenuRegistry::build_app_menu cfg 隔离 macOS) → Task 5 (core-plugin 声明 + init 调用 MenuRegistry)
Wave 2 (反向删除 + 强验收): Task 6 (删 IPlatformAppMenu 全部 + 改 lib.rs::setup) → Task 7 (lint 脚本 + smoke test + 反向验收 grep)
```

> **wave 间依赖**: Task 2 (类型) → Task 3 (MenuRegistry 用类型) → Task 5 (core-plugin 用 PluginAction) → Task 6 (lib.rs 调 core-plugin 接管)
>
> **同 wave 内冲突**: Task 1, 2 都改 `plugins/traits.rs` 周边 (Task 1 加字段 + 默认 impl, Task 2 走 re-export) → **Task 2 必须在 Task 1 完成后** (同一 plan 内部连续修改,无 wave 间并行冲突)。Task 3, 4 共享 `plugins/menu_registry.rs` → 连续修改。

---

### Task 1: PluginContext 加 `host: Option<&PluginHost>` + IPlugin 加默认空 vec 方法 + PluginHost collect helpers (Wave 0)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/traits.rs` (PluginContext 加 host 字段 + 改 `PluginContext::new` 签名 + IPlugin 加 `tray_items() / app_menu_items()` 默认 impl)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/host.rs` (新增 `all_tray_items() / all_app_menu_items()` collect helpers + 2 测试)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs:247-249` (`PluginContext::new` 调用点顺序调整 — 见 PITFALL-43-1)

**TDD 红绿重构流**:
1. **Red**: `plugins/traits.rs::tests` 加 `default_tray_items_empty` 测试 — 用 RecordingPlugin 验证 `plugin.tray_items()` 默认返 `Vec::new()`
2. **Red**: 同 stub 加 `default_app_menu_items_empty` 测试
3. **Red**: `plugins/host.rs::tests` 加 `all_tray_items_collects_from_all_plugins` 测试 — 注册 2 stub 各返 1 个 PluginTrayItem,验证 `host.all_tray_items().len() == 2`
4. **Red**: `all_app_menu_items_collects_from_all_plugins` 同模式
5. **Green**: 在 traits.rs 加 `fn tray_items(&self) -> Vec<PluginTrayItem> { Vec::new() }` 默认 impl (PluginTrayItem 类型先在 menu_registry.rs 顶部定义,见 Task 2 — 但 traits.rs 通过 `crate::plugins::menu_registry::PluginTrayItem` 路径引用,避免循环依赖)
6. **Green**: 加 `fn app_menu_items(&self) -> Vec<PluginAppMenuItem> { Vec::new() }` 默认 impl
7. **Green**: PluginContext 加 `pub host: Option<&'a PluginHost>` 字段 + 更新 `PluginContext::new` 签名接 host 参数 + 更新 `for_tests` 返 host = None
8. **Green**: PluginHost 加 `all_tray_items() -> Vec<PluginTrayItem>` + `all_app_menu_items() -> Vec<PluginAppMenuItem>`
9. **Refactor**: lib.rs:247 调用点改造 — 顺序问题见 PITFALL-43-1

**实现要点** (字节级匹配 D-CC-A + 43-DECISIONS §1..§2):

```rust
// plugins/traits.rs
use crate::plugins::menu_registry::{PluginTrayItem, PluginAppMenuItem};

pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub host: Option<&'a PluginHost>,            // NEW (Phase 43, D-CC-A 第 4 字段)
    // 注意: Phase 42 已扩的 services: Option<&'a mut ServiceRegistry> 不动 (若 Phase 42 已 ship)
}

impl<'a> PluginContext<'a> {
    pub fn new(
        app: &'a AppHandle,
        paths: &'a dyn IPlatformPaths,
        host: &'a PluginHost,                    // NEW (Phase 43 必填; Phase 42 services 可选)
    ) -> Self {
        Self { app: Some(app), paths, host: Some(host) }
    }

    #[cfg(test)]
    pub fn for_tests(paths: &'a dyn IPlatformPaths) -> Self {
        Self { app: None, paths, host: None }
    }
}

pub trait IPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn routes(&self) -> Vec<PluginRoute> { Vec::new() }
    fn services(&self) -> Vec<Box<dyn PluginService>> { Vec::new() }

    /// Phase 43 — system tray menu items this plugin contributes.
    /// Empty for plugins that don't need tray entries. MenuRegistry
    /// concatenates plugin items in registration order.
    fn tray_items(&self) -> Vec<PluginTrayItem> { Vec::new() }

    /// Phase 43 — macOS application menu items this plugin contributes.
    /// Empty on Windows. MenuRegistry groups items by `submenu` field.
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> { Vec::new() }

    fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> { Ok(()) }
    fn shutdown(&mut self) -> Result<(), PluginError> { Ok(()) }
}
```

**PluginHost collect helpers** (`plugins/host.rs`):

```rust
impl PluginHost {
    pub fn all_tray_items(&self) -> Vec<PluginTrayItem> {
        self.plugins.values().flat_map(|p| p.tray_items()).collect()
    }
    pub fn all_app_menu_items(&self) -> Vec<PluginAppMenuItem> {
        self.plugins.values().flat_map(|p| p.app_menu_items()).collect()
    }
}
```

**PITFALL-43-1 (PluginContext 顺序问题)**: 当前 `init_all(&plugin_ctx) -> PluginHost` 签名是 ctx 在前,host 在后。Task 1 把 host 字段塞进 PluginContext,导致循环:init_all 需要 ctx,ctx 需要 host。**解决方案** — 拆 `init_all` 为两段:
```rust
// lib.rs:246-250 改造 (示例)
let paths_impl = platform::runtime::paths();
let mut host = PluginHost::new();
register_all(&mut host)?;                                          // 仅注册 (不动 init)
let plugin_ctx = PluginContext::new(app, &*paths, &host);
host.init_all(&plugin_ctx)?;                                        // 跑 init (此时 host 已可借用)
app.manage(Mutex::new(host));
```
**前提**: Phase 42 提供的 `init_all(ctx)` 必须可拆为 `register_all(&mut host)` + `init_all(ctx)` 两 API。如果 Phase 42 已 ship `init_all(ctx) -> Result<PluginHost>` 不可拆,executor 在 Task 1 第一步 read `plugins/mod.rs` 确认实际签名;**若已 ship 的 init_all 不可拆**,改写为 helper `pub fn build_host_with_default_plugins() -> PluginHost` (只 register) + 公开 `host.init_all(ctx)` 已存在方法。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::traits::tests::default_tray_items_empty
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::traits::tests::default_app_menu_items_empty
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::host::tests::all_tray_items_collects_from_all_plugins
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::host::tests::all_app_menu_items_collects_from_all_plugins
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check 2>&1 | grep -c 'error\['  # 应为 0
```

**依赖**: 上游 Phase 42 (PluginHost 存在, `init_all` 签名已知);若 Phase 42 未实施 D-CC-A 的 services 字段扩 PluginContext,Task 1 必须同时扩 (D-CC-A 一并付清避免 BC 损失)
**估时**: 0.5 天 (4 测试 + 字段扩展 + collect helpers + lib.rs 调用点顺序调整)
**风险**: 中 — D-CC-A 与 Phase 42 实际实施可能有差异,executor 开始前必 read `plugins/traits.rs` 确认现状字段数;若 Phase 42 未扩 services 字段,Task 1 同时扩 services+host 两个字段

---

### Task 2: PluginAction enum 4 变体 + PluginTrayItem/PluginAppMenuItem/AppMenuRole 类型 + unregister_actions API (Wave 0)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/menu_registry.rs` (完整模块: 顶部 4 类型定义 + PluginAction enum + dispatch impl + unregister_actions 函数 + build_tray/build_app_menu 函数占位)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs` (`pub mod menu_registry;` + re-export 关键类型)

**TDD 红绿重构流**:
1. **Red**: `menu_registry.rs::tests::action_dispatch_variants` 测试 — 4 变体各 Clone 一次 + 验证 Clone 派生 (不直接 dispatch,因 AppHandle mock 难,见 "测试 mock 难点")
2. **Red**: `menu_registry.rs::tests::unregister_actions_removes_only_target_plugin` 测试 — 构造 HashMap 含 `("a:show", PluginAction::Quit)` + `("b:show", PluginAction::Quit)`,调 `unregister_actions(&mut map, "a")`,验证 `map.contains_key("a:show") == false` 但 `"b:show"` 保留
3. **Red**: `menu_registry.rs::tests::unregister_actions_empty_input_no_panic` 测试 — 空 map + 不存在的 plugin_id 不应 panic
4. **Green**: 实现 4 变体 enum + `dispatch` impl + `unregister_actions` 函数 + 4 类型定义
5. **Refactor**: extract `ShowMainWindow` 的 window logic 到 helper 函数 (`fn show_main_window(app: &AppHandle)`),为 Task 5 core-plugin init 与 Task 6 lib.rs DoubleClick 处理复用

**实现要点**:

```rust
// plugins/menu_registry.rs (Task 2 完成这一部分; Task 3/4 加 build 函数)
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

// ---- 类型定义 ----

#[derive(Debug, Clone)]
pub struct PluginTrayItem {
    pub id: String,                          // 唯一 menu id,约定 "<plugin-id>:<action>"
    pub label: String,                       // 可见文本
    pub enabled: bool,
    pub accelerator: Option<String>,         // Phase 43 全 None (Q43-3)
    pub action: PluginAction,
}

#[derive(Debug, Clone)]
pub struct PluginAppMenuItem {
    pub submenu: String,                     // "App" / "Edit" / "View" / "Window"
    pub kind: PluginAppMenuItemKind,
}

#[derive(Debug, Clone)]
pub enum PluginAppMenuItemKind {
    Predefined(AppMenuRole),
    Separator,
    Custom { id: String, label: String, accelerator: Option<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMenuRole {
    About, Hide, HideOthers, ShowAll, Quit,
    Undo, Redo, Cut, Copy, Paste, SelectAll,
    Minimize, Maximize, Fullscreen, CloseWindow,
}

// ---- PluginAction ----

#[derive(Clone)]
pub enum PluginAction {
    /// Show the main window (window.show() + set_focus() + unminimize()).
    ShowMainWindow,
    /// Quit the app (app.exit(0)).
    Quit,
    /// Switch the frontend view (app.emit("frontend://switch-view", view_id)).
    SwitchView(String),
    /// Custom callback. Closure MUST be Send + Sync because on_menu_event
    /// runs on any thread.
    Custom(Arc<dyn Fn(&AppHandle) + Send + Sync>),
}

impl PluginAction {
    pub fn dispatch(&self, app: &AppHandle) {
        match self {
            PluginAction::ShowMainWindow => show_main_window(app),
            PluginAction::Quit => app.exit(0),
            PluginAction::SwitchView(view_id) => {
                let _ = app.emit("frontend://switch-view", view_id.clone());
            }
            PluginAction::Custom(f) => f(app),
        }
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}

// ---- unregister_actions ----

/// Remove all actions contributed by `plugin_id` from the dispatch map.
/// Convention: action ids use `<plugin_id>:<action-name>` prefix.
pub fn unregister_actions(actions: &mut HashMap<String, PluginAction>, plugin_id: &str) {
    let prefix = format!("{plugin_id}:");
    actions.retain(|k, _| !k.starts_with(&prefix));
}
```

**emit 事件名约定**: `"frontend://switch-view"` (Q43-2 关闭)。Phase 44 前端 App.tsx listen 此事件。

**Custom 闭包 Send + Sync**: `Arc<dyn Fn(&AppHandle) + Send + Sync>` 自动派生 Send + Sync (A4 验证)。

**测试 mock 难点**: `tauri::test::mock_app` 需要 tauri feature,可能未启用。**替代方案**:
- `action_dispatch_variants` 仅验证 4 变体可 Clone + Debug,不直接 dispatch (因 AppHandle mock 难)
- `unregister_actions_*` 是纯 HashMap 操作,无需 AppHandle
- 真实 dispatch 行为 (window.show / app.emit / app.exit) 端到端验证靠 smoke test 10/10 (G-9) + Phase 47 macOS 真机验证

**plugins/mod.rs re-export**:
```rust
pub mod menu_registry;
pub use menu_registry::{
    PluginTrayItem, PluginAppMenuItem, PluginAppMenuItemKind, AppMenuRole,
    PluginAction,
};
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry::tests::action_dispatch_variants
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry::tests::unregister_actions_removes_only_target_plugin
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry::tests::unregister_actions_empty_input_no_panic
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry
```

**依赖**: Task 1 (PluginContext 加 host 字段完成,但 menu_registry.rs 是新模块独立存在,Task 2 不依赖 Task 1 的代码 — 但需要 menu_registry.rs 先于 traits.rs 的 use 语句编译,因此执行顺序:Task 1 → Task 2)
**估时**: 0.25 天 (1 模块顶部 + 3 测试)
**风险**: 低 — 类型定义 + HashMap 操作,无 Tauri 特定

---

### Task 3: MenuRegistry::build_tray + TrayIconBuilder 装配 + on_menu_event HashMap dispatch (Wave 1)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/menu_registry.rs` (扩 build_tray + install_tray 函数 + 2 测试)

**TDD 红绿重构流**:
1. **Red**: `menu_registry.rs::tests::build_tray_collects_all_plugins` 测试 — 用 RecordingPlugin 注册 2 stub,各自 override `tray_items()` 返 1 个 PluginTrayItem (id="a:show" + id="b:show"),验证 `host.all_tray_items().len() == 2`
2. **Red**: `menu_registry.rs::tests::dispatch_map_lookup_correct` 测试 — 手动构造 HashMap 含 `("core:show", PluginAction::ShowMainWindow)` + `("core:quit", PluginAction::Quit)`,验证 `map.get("core:show") == Some(&ShowMainWindow)` + `map.get("unknown") == None`
3. **Green**: 实现 `build_tray(host, app) -> tauri::Result<(Menu<Wry>, Arc<HashMap<String, PluginAction>>)>` — 调 `host.all_tray_items()` + 遍历每项调 `MenuItem::with_id` + 收集 actions HashMap + 用 `Menu::with_items` 装配
4. **Green**: 实现 `install_tray(app, menu, actions, icon, tooltip) -> tauri::Result<()>` — `TrayIconBuilder::with_id("main-tray").icon().tooltip().menu().on_menu_event(move |app, event| hashmap.get(event.id).dispatch(app)).build()`
5. **Refactor**: 把 `MenuItem::with_id` 调用提取到 helper,避免主函数过深

**实现要点**:

```rust
// plugins/menu_registry.rs (Task 3 完成这一部分; 顶部 use 加 tauri::menu / tauri::tray)
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use crate::plugins::PluginHost;

/// Build the system tray menu from all registered plugins' `tray_items()`.
/// Returns (Menu, dispatch HashMap) — both consumed by core-plugin's
/// `init` to wire the tray + the on_menu_event closure.
pub fn build_tray(
    host: &PluginHost,
    app: &AppHandle,
) -> tauri::Result<(Menu<tauri::Wry>, Arc<HashMap<String, PluginAction>>)> {
    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    let mut actions: HashMap<String, PluginAction> = HashMap::new();

    for (_id, plugin) in host.iter() {
        for item in plugin.tray_items() {
            let mi = MenuItem::with_id(
                app, &item.id, &item.label,
                item.enabled, item.accelerator.as_deref(),
            )?;
            items.push(mi);
            actions.insert(item.id.clone(), item.action);
        }
    }

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    let menu = Menu::with_items(app, &item_refs)?;
    Ok((menu, Arc::new(actions)))
}

/// Build the TrayIcon + wire on_menu_event dispatch. core-plugin's init
/// calls this after build_tray succeeds.
pub fn install_tray(
    app: &AppHandle,
    menu: &Menu<tauri::Wry>,
    actions: Arc<HashMap<String, PluginAction>>,
    icon: tauri::image::Image<'static>,
    tooltip: &str,
) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip(tooltip)
        .menu(menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id.as_ref();
            if let Some(action) = actions.get(id) {
                action.dispatch(app);
            } else {
                log::warn!("[menu] no action for id={id}");
            }
        })
        .build(app)?;
    Ok(())
}
```

**PITFALL-43-2 (异构切片生命周期)**: `Menu::with_items` 接收 `&[&dyn IsMenuItem<R>]`,Vec<MenuItem<R>> 转引用后切片生命周期与 Vec 绑定。**解决**: 在 build_tray 函数内一次性用完,返回 `(Menu, Arc<HashMap>)` 后 Menu 不再依赖 Vec — Menu 内部已 append 完毕。

**PITFALL-43-3 (Send + Sync 自动派生)**: `Arc<HashMap<String, PluginAction>>` 跨线程安全的前提是 PluginAction: Send + Sync。`ShowMainWindow` / `Quit` / `SwitchView(String)` 自动 Send + Sync;`Custom(Arc<dyn Fn + Send + Sync>)` 因 Arc 持有 Send + Sync 闭包,自动 Send + Sync (A4)。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry::tests::build_tray_collects_all_plugins
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry::tests::dispatch_map_lookup_correct
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check 2>&1 | grep -c 'error\['  # 应为 0
```

**依赖**: Task 2 (PluginTrayItem + PluginAction 类型已定义)
**估时**: 0.5 天 (1 函数 + 1 install_tray helper + 2 测试)
**风险**: 中 — Tauri `Menu::with_items` 签名 + `IsMenuItem` cast 需精确 (43-RESEARCH §Pitfall 4)

---

### Task 4: MenuRegistry::build_app_menu cfg 隔离 macOS (Wave 1)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/menu_registry.rs` (扩 build_app_menu 函数 + 双 cfg 分支)

**TDD 红绿重构流**:
1. **Red**: `menu_registry.rs::tests::build_app_menu_noop_on_windows` 测试 — (cfg(test) + 非 mac 分支) 验证 Windows 编译期 build_app_menu 函数存在且返 Ok(())
2. **Green**: 实现 `build_app_menu` 双 cfg 分支 — `#[cfg(target_os = "macos")]` 收集 app_menu_items + BTreeMap 分组 + SubmenuBuilder 装配 + `app.set_menu()`;`#[cfg(not(target_os = "macos"))]` 返 Ok(())
3. **Refactor**: extract `fn build_submenu_from_items(app, sb, items)` + `fn apply_predefined_role(sb, app, role)` helper

**实现要点**:

```rust
// plugins/menu_registry.rs (Task 4 完成这一部分)
use tauri::menu::{AboutMetadata, MenuBuilder, Submenu};
use std::collections::BTreeMap;

#[cfg(target_os = "macos")]
pub fn build_app_menu(host: &PluginHost, app: &AppHandle) -> tauri::Result<()> {
    let mut groups: BTreeMap<String, Vec<PluginAppMenuItem>> = BTreeMap::new();
    for (_id, plugin) in host.iter() {
        for item in plugin.app_menu_items() {
            groups.entry(item.submenu.clone()).or_default().push(item);
        }
    }

    let mut root = MenuBuilder::new(app);
    for (submenu_label, items) in groups {
        let sb = SubmenuBuilder::new(app, &submenu_label);
        let submenu = build_submenu_from_items(app, sb, items)?;
        root = root.item(&submenu);
    }

    let menu = root.build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_submenu_from_items(
    app: &AppHandle,
    mut sb: tauri::menu::SubmenuBuilder<tauri::Wry, AppHandle>,
    items: Vec<PluginAppMenuItem>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    for item in items {
        match item.kind {
            PluginAppMenuItemKind::Predefined(role) => {
                sb = apply_predefined_role(sb, app, role)?;
            }
            PluginAppMenuItemKind::Separator => { sb = sb.separator(); }
            PluginAppMenuItemKind::Custom { id, label, accelerator } => {
                let mi = MenuItem::with_id(app, &id, &label, true, accelerator.as_deref())?;
                sb = sb.item(&mi);
            }
        }
    }
    sb.build().map_err(Into::into)
}

#[cfg(target_os = "macos")]
fn apply_predefined_role(
    sb: tauri::menu::SubmenuBuilder<tauri::Wry, AppHandle>,
    app: &AppHandle,
    role: AppMenuRole,
) -> tauri::Result<tauri::menu::SubmenuBuilder<tauri::Wry, AppHandle>> {
    Ok(match role {
        AppMenuRole::About => sb.about(Some(AboutMetadata {
            name: Some(app.package_info().name.clone()),
            version: Some(app.package_info().version.to_string()),
            copyright: app.config().bundle.copyright.clone(),
            authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
            ..Default::default()
        })),
        AppMenuRole::Hide => sb.hide(),
        AppMenuRole::HideOthers => sb.hide_others(),
        AppMenuRole::ShowAll => sb.show_all(),
        AppMenuRole::Quit => sb.quit(),
        AppMenuRole::Undo => sb.undo(),
        AppMenuRole::Redo => sb.redo(),
        AppMenuRole::Cut => sb.cut(),
        AppMenuRole::Copy => sb.copy(),
        AppMenuRole::Paste => sb.paste(),
        AppMenuRole::SelectAll => sb.select_all(),
        AppMenuRole::Minimize => sb.minimize(),
        AppMenuRole::Maximize => sb.maximize(),
        AppMenuRole::Fullscreen => sb.fullscreen(),
        AppMenuRole::CloseWindow => sb.close_window(),
    })
}

#[cfg(not(target_os = "macos"))]
pub fn build_app_menu(_host: &PluginHost, _app: &AppHandle) -> tauri::Result<()> {
    // No-op on Windows / Linux. core-plugin's init calls this unconditionally;
    // cfg ensures this branch compiles on non-mac targets.
    Ok(())
}
```

**PITFALL-43-4 (双层 cfg 保险)**: core-plugin::init 内 macOS AppMenu 调用 cfg 隔离 + build_app_menu 函数本身 cfg 隔离 non-mac 返回 Ok(()),两层 cfg 避免 Windows 误走 macOS 路径 (43-RESEARCH §Pitfall 5)。

**PITFALL-43-5 (AboutMetadata 必填)**: macOS 上 PredefinedMenuItem::about 的 metadata 必填 name + version + copyright (43-RESEARCH §Pitfall 2)。来源 `app.package_info()` + `app.config().bundle.copyright` (tauri.conf.json)。

**PITFALL-43-6 (macOS AppMenu 必须以 Submenu 形式存在)**: 直接 `Menu::with_items(app, &[&menu_item])` 在 macOS 上不显示 (43-RESEARCH §Pitfall 3)。本 Task 用 SubmenuBuilder 装配每个 group 后用 MenuBuilder 顶层装配。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check --target x86_64-pc-windows-msvc 2>&1 | grep -c 'error\['  # 应为 0
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check --target x86_64-apple-darwin 2>&1 | grep -c 'error\['  # 应为 0
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::menu_registry
```

**依赖**: Task 2 (PluginAppMenuItem + AppMenuRole + PluginAppMenuItemKind 类型已定义)
**估时**: 0.5 天 (1 函数 + 2 helper + 1 测试 + macOS 跨编译验证)
**风险**: 高 — SubmenuBuilder 链式 API + Tauri 跨平台 menu API 在 Windows/macOS 行为差异需精确控制 cfg

---

### Task 5: core-plugin 声明 tray 2 项 + macOS AppMenu 4 submenu + init 调用 MenuRegistry (Wave 1)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/core.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/mod.rs` (`pub mod core; pub use core::CorePlugin;`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs` (`register_all` 第一行注册 CorePlugin)

**TDD 红绿重构流**:
1. **Red**: `stubs/core.rs::tests::core_plugin_id_is_core` 测试 — `CorePlugin.id() == "core"`
2. **Red**: `stubs/core.rs::tests::core_plugin_tray_items_count_is_two` 测试 — `CorePlugin.tray_items().len() == 2`
3. **Red**: `stubs/core.rs::tests::core_plugin_app_menu_items_count_submenu_groups` 测试 — `CorePlugin.app_menu_items().len() == 18` (App 7 + Edit 7 + View 1 + Window 2 + Separator 1)
4. **Green**: 实现 CorePlugin struct + IPlugin impl + tray_items (show + quit) + app_menu_items (4 submenu × 18 items) + init 调 build_tray + build_app_menu cfg
5. **Refactor**: extract `fn predef(submenu, role)` + `fn sep(submenu)` helper

**实现要点**: 见 43-RESEARCH §Core Plugin Design (CorePlugin struct + tray 2 项 + app_menu_items 18 项 + init 调 build_tray + install_tray + build_app_menu cfg 隔离)。`init` 签名假设 D-CC-A 已 ship `&mut PluginContext`。

**plugins/mod.rs 第一行注册** (G-5 强验收):

```rust
pub fn register_all(_ctx: &PluginContext) -> Result<PluginHost, PluginError> {
    let mut host = PluginHost::new();
    host.register(Box::new(stubs::CorePlugin))?;  // 第一行
    host.register(Box::new(stubs::ProviderListPlugin))?;
    // ... 9 业务 stub
    Ok(host)
}
```

**PITFALL-43-7 (PluginContext 在 init 时的可用性)**: core-plugin 的 init 调 `ctx.host` 取到 PluginHost 引用 — 此时 host 包含所有 plugin 且 init_order 按 register 顺序。**关键**: core-plugin 不能在自己的 tray_items() / app_menu_items() 中调 ctx (因为这两个方法是 &self,无 ctx 参数)。

**PITFALL-43-8 (9 业务 stub 0 改动)**: 业务 stub tray_items() / app_menu_items() 默认返 Vec::new(),MenuRegistry 收集时只看到 core-plugin 的 2 项 tray + 18 项 app menu — **Phase 43 不动 9 业务 stub** (G-4 强验收)。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::stubs::core::tests::core_plugin_id_is_core
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::stubs::core::tests::core_plugin_tray_items_count_is_two
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib plugins::stubs::core::tests::core_plugin_app_menu_items_count_submenu_groups
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check 2>&1 | grep -c 'error\['  # 应为 0
grep -n 'CorePlugin' /Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs | head -2  # 验证 CorePlugin 是第一行 register
```

**依赖**: Task 3 (build_tray + install_tray), Task 4 (build_app_menu)
**估时**: 0.5 天 (1 stub + 3 测试 + mod.rs 注册顺序)
**风险**: 低 — CorePlugin 是声明型代码

---

### Task 6: 删 IPlatformAppMenu + MacAppMenu + WindowsAppMenu + runtime::app_menu factory + 改 lib.rs::setup (Wave 2)

**文件**:
- 删除: `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/macos/app_menu.rs`
- 删除: `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/windows/app_menu.rs`
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/mod.rs` (删 `pub use IPlatformAppMenu` + 删 `runtime::app_menu` factory 函数 127-137 行)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/macos/mod.rs` (删 `pub mod app_menu;` + `pub use app_menu::MacAppMenu;`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/windows/mod.rs` (删 `pub mod app_menu;` + `pub use app_menu::WindowsAppMenu;`)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/traits.rs` (删 IPlatformAppMenu trait 351-353 + AppMenuShim mock 417-422 + app_menu_build_dispatch 测试 602-610 + 注释行 159-160)
- 修改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs` (308-329 tray 手写块替换 + 380-386 macOS AppMenu cfg 块删除 + 4-8 imports 同步删 + 246-250 setup 调用点改造)

**TDD 红绿重构流** (反向删除无单测,依赖编译期验证 + 强验收 grep):
1. **Red (Grep baseline)**: 改造前记录 `grep -nE 'MenuItem::with_id|on_menu_event' src-tauri/src/lib.rs` 命中数 (≥ 5 处)
2. **Green**: 改 lib.rs 替换 308-329 为单注释指向 core-plugin;删 380-386 macOS AppMenu cfg 块;删 imports 4-8 中 menu/tray 符号;246-250 拆 register_all + init_all 两段
3. **Refactor**: 删 platform/macos/app_menu.rs + platform/windows/app_menu.rs + platform/mod.rs `runtime::app_menu` 工厂 + platform/traits.rs IPlatformAppMenu trait + mock + test + platform/{macos,windows}/mod.rs re-export + traits.rs:159-160 注释

**lib.rs 改造示例** (替换 308-329):
```rust
// AFTER: 单注释指向 core-plugin
// M8 (Phase 43) — system tray + on_menu_event + macOS AppMenu
// 全由 core-plugin 的 init() 接管 (调 MenuRegistry::build_tray /
// build_app_menu / install_tray)。core 是 plugins/mod.rs 第一行
// 注册,在 host.init_all() 内部跑,本 setup 块不再硬编码。
```

**lib.rs imports 改造示例** (替换 4-8):
```rust
// AFTER:
use tauri::{Emitter, Manager, RunEvent};
// menu / tray 符号迁到 core-plugin
```

**lib.rs setup 改造示例** (替换 246-250):
```rust
let paths_impl = platform::runtime::paths();
let mut host = register_all(/* unused ctx */)?;
let plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl, &host);
host.init_all(&plugin_ctx)
    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
app.manage(Mutex::new(host));
```

**PITFALL-43-9 (lib.rs imports 漏改)**: 删除 308-329 + 380-386 后,`Menu / MenuItem / TrayIconBuilder` import 不再被 lib.rs 使用 — `cargo check` 会 warn "unused import"。**必须**同步删 `use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder}` 这几行。

**PITFALL-43-10 (platform/traits.rs 注释清理)**: traits.rs:159 注释 `Operation is not applicable on this platform (e.g. install_app_menu on Windows)` 引用 IPlatformAppMenu — 删 trait 时**同时**改注释为通用描述或删整行 (43-RESEARCH §Pitfall 6)。

**验证命令**:
```bash
! grep -nE 'MenuItem::with_id|on_menu_event' /Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs
! test -f /Users/coderstory/CodeSource/winui3/src-tauri/src/platform/macos/app_menu.rs
! test -f /Users/coderstory/CodeSource/winui3/src-tauri/src/platform/windows/app_menu.rs
! grep -rn 'IPlatformAppMenu\|MacAppMenu\|WindowsAppMenu\|app_menu_build_dispatch' /Users/coderstory/CodeSource/winui3/src-tauri/src/
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check 2>&1 | grep -c 'error\['  # 应为 0
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check --target x86_64-pc-windows-msvc 2>&1 | grep -c 'error\['  # Windows 编译通过
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check --target x86_64-apple-darwin 2>&1 | grep -c 'error\['  # macOS 编译通过
```

**依赖**: Task 1 (PluginContext 4 字段), Task 5 (core-plugin 已注册 + 可在 init 接管)
**估时**: 0.5 天 (2 文件删 + 5 文件改 + 1 imports 同步)
**风险**: 高 — 反向删除操作极易遗漏 (lib.rs imports / traits.rs 注释 / macos+windows mod.rs re-export);**executor 在每步删除后跑 `cargo check` 增量验证**

---

### Task 7: lint 脚本 + smoke test + 反向验收 grep (Wave 2)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/scripts/lint-plugin-coupling.sh` (NEW, lint 脚本防回归)

**TDD 红绿重构流** (强验收脚本,无单测):
1. **Red (Grep baseline)**: Task 6 完成后,`grep -nE 'MenuItem::with_id|on_menu_event' src-tauri/src/lib.rs` 应为 0 命中
2. **Green**: 写 `scripts/lint-plugin-coupling.sh` 含 4 项规则 (lib.rs 无 MenuItem::with_id / 平台 app_menu.rs 不存在 / IPlatformAppMenu 残留 0 / CorePlugin 是 plugins/mod.rs 第一行 register)
3. **Refactor**: 加 help + 错误提示 + 退出码

**实现要点** (lint 脚本):

```bash
#!/usr/bin/env bash
# scripts/lint-plugin-coupling.sh — Phase 43 MenuRegistry 强验收
# 跑法: bash scripts/lint-plugin-coupling.sh
# 退出码: 0 = 通过 / 1 = 违反任一规则

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/src-tauri/src"
FAIL=0

# 规则 1: lib.rs 0 行 MenuItem::with_id / on_menu_event
if grep -nE 'MenuItem::with_id|on_menu_event' "$SRC/lib.rs"; then
    echo "[FAIL] lib.rs 仍含 MenuItem::with_id / on_menu_event"; FAIL=1
fi

# 规则 2: platform/{macos,windows}/app_menu.rs 不存在
for p in macos windows; do
    if test -f "$SRC/platform/$p/app_menu.rs"; then
        echo "[FAIL] platform/$p/app_menu.rs 仍存在"; FAIL=1
    fi
done

# 规则 3: src-tauri/src/ 不应含 IPlatformAppMenu / MacAppMenu / WindowsAppMenu / app_menu_build_dispatch
if grep -rn 'IPlatformAppMenu\|MacAppMenu\|WindowsAppMenu\|app_menu_build_dispatch' "$SRC/"; then
    echo "[FAIL] IPlatformAppMenu / MacAppMenu / WindowsAppMenu / app_menu_build_dispatch 残留"; FAIL=1
fi

# 规则 4: core 必须 plugins/mod.rs 第一行 register
FIRST_REGISTER=$(grep -n 'host.register' "$SRC/plugins/mod.rs" | head -1)
if ! echo "$FIRST_REGISTER" | grep -q 'CorePlugin'; then
    echo "[FAIL] plugins/mod.rs 第一行 register 不是 CorePlugin: $FIRST_REGISTER"; FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "[PASS] Phase 43 MenuRegistry 强验收 4/4 通过"
fi
exit $FAIL
```

**验证命令**:
```bash
chmod +x /Users/coderstory/CodeSource/winui3/scripts/lint-plugin-coupling.sh
bash /Users/coderstory/CodeSource/winui3/scripts/lint-plugin-coupling.sh  # 应输出 [PASS]
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo test --lib
cd /Users/coderstory/CodeSource/winui3 && bash scripts/smoke-test.sh "$(find src-tauri/target -name 'claude-config-manager*.exe' -type f 2>/dev/null | head -1)"
cd /Users/coderstory/CodeSource/winui3 && git diff --stat src/  # 应为空 (前端无变更)
```

**依赖**: Task 6 (反向删除完成)
**估时**: 0.25 天 (1 lint 脚本 + 强验收全跑)
**风险**: 低

---

## 4. 风险登记与缓解方案

| Risk ID | 风险描述 | 严重度 | 缓解方案 |
|---|---|---|---|
| **R-43-1** | **Phase 42 实施进度不确定**: D-CC-A 已冻结 4 字段 PluginContext,但 Phase 42 实际 ship 可能仅 2 字段(app + paths) | 高 | **Mitigate**: Task 1 第一步 `cat src-tauri/src/plugins/traits.rs | grep -A 5 'pub struct PluginContext'` 确认字段数;若仅 2 字段,Task 1 同时扩 services + host (D-CC-A 一并付清避免 BC 损失) |
| **R-43-2** | **PluginContext host 字段顺序问题**: init_all(ctx) → host 签名 ctx 在前 host 在后,塞 host 进 ctx 会循环 | 高 | **Mitigate**: PITFALL-43-1 — 拆 `init_all` 为 `register_all(&mut host) + host.init_all(ctx)` 两段;lib.rs 顺序调用 |
| **R-43-3** | **macOS AppMenu cfg 双层保险漏一层**: build_app_menu 函数 cfg 隔离了,但 core-plugin 调用点未 cfg → Windows 误走 macOS SubmenuBuilder 路径 | 高 | **Mitigate**: PITFALL-43-4 — Task 4 函数 cfg (第 1 层) + Task 5 core-plugin 调用点 cfg (第 2 层);Task 4/5 双测试覆盖 |
| **R-43-4** | **PluginAction::Custom dyn Fn Send + Sync 边界**: 闭包捕获 plugin state 若 state 不 Send + Sync 编译失败 | 中 | **Mitigate**: 43-RESEARCH §A4 验证 Arc<dyn Fn + Send + Sync> 自动派生;9 业务 stub 当前 0 Custom,Phase 43 不触发;后续 M5+ 加 Custom 时 state 必须 Send + Sync |
| **R-43-5** | **9 业务 stub 默认空 vec 不被调用顺序影响**: core 第一注册 + init 第一跑,但 host.iter() 顺序遍历不依赖 init_order → MenuRegistry 收集只看 iter 顺序 | 中 | **Mitigate**: 43-RESEARCH §A8 验证 init_all 顺序执行;MenuRegistry 用 host.iter() 不依赖 init_order,业务 stub 后续 override 不影响 core 已构建的 menu (因为 build_tray 在 init 阶段一次性跑完) |
| **R-43-6** | **Linux 不在范围但要 no-op**: build_app_menu 在 Linux 上 `#[cfg(not(target_os = "macos"))]` 返 Ok(()) — 但项目实际只支持 Win + macOS,Linux build 不会触发 | 低 | **Mitigate**: cfg 双层保险已覆盖;Linux build 即使 cfg 失败 (极少),Task 7 lint 脚本不检查 Linux,Phase 47 评估 Linux 支持时再补 |
| **R-43-7** | **M31 vibrancy 撤回后 IPlatformWindowChrome 不存在 → PluginAction::ShowMainWindow 实现走新方式**: 不再有任何 platform 特定的 vibrancy 调用路径 | 中 | **Mitigate**: PluginAction::ShowMainWindow 实现走 `app.get_webview_window("main").show() + set_focus() + unminimize()` (tauri v2 原生 API,不经 IPlatformWindowChrome);与 103ed4c / 65735f1 / ab42bfc 撤回完全正交,无冲突 |
| **R-43-8** | **macOS 真机验证 D6 暂缓待 M4 启动前再问**: G-10 强验收 (macOS 真机 4 submenu 可见) 仅 compile-only | 中 | **Mitigate**: Task 4 `cargo check --target x86_64-apple-darwin` 编译验证;macOS 真机验证推迟到 Phase 47 (整合期);**本 phase 不阻断** |
| **R-43-9** | **反向删除操作极易遗漏**: lib.rs imports / traits.rs 注释 / macos+windows mod.rs re-export 任一遗漏会触发 "unused import" / "cannot find type" 错误 | 高 | **Mitigate**: Task 6 PITFALL-43-9/10 + executor 每步删除后跑 `cargo check` 增量验证;Task 7 lint 脚本 grep 规则 1+3 覆盖残留检测 |
| **R-43-10** | **新增 lint 脚本未集成 CI**: scripts/lint-plugin-coupling.sh 当前不被 build-and-ship.sh 调用 | 低 | **Mitigate**: Phase 43 完成时手动跑 + 在 PR 描述列强验收证据;CI 集成待 Phase 47 评估 |

---

## 5. 不在 Phase 43 范围 (严禁混入)

- ❌ Phase 44 (前端 App.tsx listen "frontend://switch-view" + 派生 FrontendPlugin) — 推迟到下一 phase
- ❌ Phase 45 (ServiceRegistry Arc 路径 API + 9 service plugin init) — 假定 Phase 42 已 ship 4 字段 PluginContext 但 services 字段在 Phase 45 真正使用
- ❌ Phase 46 (删 mcp-management stub) — D-44-A 已明确 Phase 46 负责
- ❌ Phase 47 (tray accelerator 跨平台 / AboutMetadata i18n / 视觉回归 / macOS 真机验证 / Linux 评估) — 推迟
- ❌ 改 SPEC.md / 改 tauri.conf.json / 改 capabilities/ — 不在范围
- ❌ 改 9 业务 stub (`provider_list.rs` 等) — G-4 强验收 0 改动
- ❌ 改 frontend (src/) — G-4 强验收 0 改动 (前端 emit listen 在 Phase 44)
- ❌ 改 plugins/dispatch.rs / service_registry.rs (Phase 42 产出) — 不在范围
- ❌ IPlatformWindowChrome 恢复 / vibrancy 重新引入 — M31 撤回决定不变

---

## 6. 完成标准 (Phase 47 验证)

| ID | 强验收 | 验证命令 | 来源 |
|---|---|---|---|
| G-1 | lib.rs 0 行 MenuItem::with_id / on_menu_event | `! grep -nE 'MenuItem::with_id\|on_menu_event' src-tauri/src/lib.rs` | 43-DECISIONS §强验收 |
| G-2 | platform/{macos,windows}/app_menu.rs 不存在 | `! test -f src-tauri/src/platform/{macos,windows}/app_menu.rs` | 43-DECISIONS §强验收 |
| G-3 | IPlatformAppMenu / MacAppMenu / WindowsAppMenu / app_menu_build_dispatch 全部删除 | `! grep -rn '...'` | 43-DECISIONS §强验收 |
| G-4 | 9 业务 stub 0 改动 | `git diff --stat src-tauri/src/plugins/stubs/*.rs` 仅 core.rs 新增 | 43-DECISIONS §强验收 |
| G-5 | core 第一行 register plugins/mod.rs | `head -1 src-tauri/src/plugins/mod.rs` 后 CorePlugin 首项 | 43-DECISIONS §强验收 |
| G-6 | menu_registry 4 测试 PASS | `cargo test --lib plugins::menu_registry` | 43-RESEARCH §Validation |
| G-7 | traits 默认 impl 测试 PASS | `cargo test --lib plugins::traits::tests::default_tray_items_empty` | 43-RESEARCH §Validation |
| G-8 | 全套 cargo test --lib PASS | `cd src-tauri && cargo test --lib` | CLAUDE.md §5.1 |
| G-9 | smoke test 10/10 PASS | `bash scripts/smoke-test.sh build/...exe` | CLAUDE.md §13.1 |
| G-10 | macOS 真机 4 submenu 可见 | Phase 47 真机验证 | 43-DECISIONS §强验收 (推迟) |
| G-11 | lib.rs 0 行 `use tauri::menu:: / tray::` (反向) | `! grep -nE 'use tauri::(menu|tray)' src-tauri/src/lib.rs` | 反向验收 |
| G-12 | app_menu 字符串在 src-tauri/src/ 出现次数 = 0 | `grep -rn 'app_menu' src-tauri/src/ | wc -l == 0` | 反向验收 |

---

## 7. 提交节奏 (commit cadence, CLAUDE.md §2.4)

| Commit | 任务 | 提交信息模板 |
|---|---|---|
| 1 | Task 1 | `refactor(plugins): add host field to PluginContext + IPlugin tray/app_menu_items default (Phase 43 W0)` |
| 2 | Task 2 | `feat(plugins): add menu_registry with PluginAction 4 variants (Phase 43 W0)` |
| 3 | Task 3 | `feat(plugins): MenuRegistry::build_tray + install_tray with HashMap dispatch (Phase 43 W1)` |
| 4 | Task 4 | `feat(plugins): MenuRegistry::build_app_menu with cfg macOS isolation (Phase 43 W1)` |
| 5 | Task 5 | `feat(plugins): core plugin owns tray + macOS AppMenu (Phase 43 W1)` |
| 6 | Task 6 | `refactor(platform): remove IPlatformAppMenu + delegate menus to core-plugin (Phase 43 W2)` |
| 7 | Task 7 | `chore(scripts): add lint-plugin-coupling.sh for Phase 43 verification (Phase 43 W2)` |

每个 commit 前必跑: `cd src-tauri && cargo check && cargo test --lib plugins::` 验证该 commit 通过。

---

## 8. 输出路径

- **PLAN**: `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/43-PLAN.md` (本文件)
- **执行产物**:
  - `src-tauri/src/plugins/menu_registry.rs` (NEW)
  - `src-tauri/src/plugins/stubs/core.rs` (NEW)
  - `scripts/lint-plugin-coupling.sh` (NEW)
  - `src-tauri/src/plugins/{traits,host,mod}.rs` (改)
  - `src-tauri/src/lib.rs` (改)
  - `src-tauri/src/platform/{mod,traits,macos,windows}/` (改 + 2 文件删)
- **SUMMARY**: `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/43-SUMMARY.md` (executor 完成后写)

---

*Phase 43 PLAN 完成。下一步: executor 跑 7 个 task,每个 commit 必跑 `cargo check && cargo test --lib plugins::`,ship 前跑 Task 7 全套强验收 + smoke test 10/10。*