# Phase 43: MenuRegistry + 菜单注册化 — Research

**Researched:** 2026-06-27
**Domain:** Tauri v2 menu / tray API + Rust plugin system extension (dynamic menu construction)
**Confidence:** HIGH (Tauri API 从 2.11.3 本地源码验证, 项目代码从 src-tauri/src/ 实读)
**Tauri Version:** 2.11.3 (Cargo.lock 验证 2026-06-18 之前)
**Primary Source Files:**
- `src-tauri/src/lib.rs:308-329` (current tray)
- `src-tauri/src/lib.rs:400-417` (current macOS AppMenu)
- `src-tauri/src/platform/{macos,windows}/app_menu.rs` (current platform dispatch)
- `src-tauri/src/plugins/{traits,host,mod}.rs` (current IPlugin contract)

## Summary

Phase 43 目标: **让 plugin 声明菜单项,MenuRegistry 集中构建,`lib.rs` 硬编码 0 行**。研究核心发现:

1. **Tauri v2 menu API 完全支持动态构建**: `MenuItem::with_id(app, id, text, enabled, accelerator)` + `Menu::with_items(app, &[&dyn IsMenuItem<R>])` + `TrayIconBuilder::menu(&menu).on_menu_event(closure)`。`MenuBuilder::new(app).items(&[&a, &b]).build()` 接受 `&[&dyn IsMenuItem<R>]` 异构切片,通过 Tauri 内部的 `MenuItemKind<R>` 枚举 (Menu/MenuItem/Submenu/PredefinedMenuItem/CheckMenuItem/IconMenuItem) 做类型擦除。**唯一限制**:`IsMenuItem<R>` 父 trait `sealed::IsMenuItemBase` 是 pub 但 crate-private (源码注释 "ONLY meant to be implemented internally by the crate"),**禁止用户实现**。所以 `PluginTrayItem` 不能直接当 Tauri menu item —— 它是一个**声明 / 注册的中间层**,MenuRegistry 在 build 时调 `MenuItem::with_id` 把它转换为 Tauri 原生类型。

2. **on_menu_event dispatch 走 HashMap**: 闭包签名 `Fn(&AppHandle<R>, MenuEvent) + Send + Sync + 'static`,`MenuEvent.id: muda::MenuId` (= `String` hashable)。`MenuRegistry` 构建时收集 `Vec<PluginTrayItem>`,同时构造 `HashMap<String, PluginAction>`;`on_menu_event` 闭包 clone Arc 持有 HashMap 引用,按 `event.id.0.as_str()` lookup 调用对应 action。**Send + Sync + 'static 约束意味着 PluginAction::Custom 必须用 `Arc<dyn Fn(&AppHandle) + Send + Sync>`**,不能传裸闭包 (生命周期 + 跨线程)。

3. **PluginAction 设计**: 4 变体 enum — `ShowMainWindow` (默认实现,无需 plugin 回调) / `Quit` (默认实现) / `SwitchView(String)` (调 frontend emit) / `Custom(Arc<dyn Fn(&AppHandle) + Send + Sync>)` (plugin 自由扩展)。前 3 个在 MenuRegistry 内部统一 dispatch,`Custom` 留给特殊需求 (如打开 URL、唤起外部进程)。**Send + Sync 闭包用 `std::sync::Arc` 持有 + 不显式约束 `'static`** (Arc 本身 'static)。

4. **macOS AppMenu 用 SubmenuBuilder + PredefinedMenuItem**: Tauri v2 `SubmenuBuilder` 暴露 `.about(meta) / .hide() / .hide_others() / .show_all() / .quit() / .undo() / .redo() / .cut() / .copy() / .paste() / .select_all() / .fullscreen() / .minimize() / .maximize()` 等 — 这些是 muda crate 的 predef,macOS 自动绑系统快捷键 (Cmd+Q / Cmd+H / Cmd+M / Ctrl+Cmd+F),Windows 上对应操作映射到 Tauri 主线程 API (多平台 PredefinedMenuItem 的实现是 muda 跨平台 wrapper,Windows 也支持 minimize/maximize/close_window/quit/copy/paste 等)。**PluginAppMenuItem** 用 enum 表达: `Predefined(AppMenuRole) / Separator / Custom { id, text, accelerator }` 3 变体;MenuRegistry 转换为 SubmenuBuilder 调用。

5. **core-plugin 设计**: 托盘 (show/quit) + macOS AppMenu 全集 = 1 个 `core` plugin。**理由**: 两者都依赖"AppHandle + 启动期 setup 钩子",由 core-plugin 在 `init` 阶段统一调 `MenuRegistry::build_tray` / `MenuRegistry::build_app_menu` (后者 cfg 隔离 macOS)。注册顺序 = **core 第一个注册** (确保托盘在所有业务 plugin 之前建好;业务 plugin 的 `tray_items()` 在 build 时已被收集)。**core-plugin 不贡献 routes** (`routes()` 返回空 Vec);**有 id `"core"`** 用于在 PluginHost 中识别;**`init` 阶段做菜单构建**,但 PluginContext 当前 `app: Option<&AppHandle>` —— core 必须在最前,确保 `init` 跑时 app 已就绪 (实际就是)。

6. **Windows 平台约束**: 托盘在 Windows/macOS 行为一致 (Tauri 抽象好);`core-plugin::app_menu_items()` 在 Windows 上应**返回空 Vec** (而非 cfg 隔离) — 理由: IPlugin trait 跨平台统一,业务 plugin 不应写 `#[cfg(target_os)]`;注册空 Vec 即可让 MenuRegistry::build_app_menu 在 Windows 上 no-op。**原 `IPlatformAppMenu` trait + `MacAppMenu` / `WindowsAppMenu` impl + `platform::runtime::app_menu()` factory 全部删除** — `lib.rs:413-417` 的 cfg 块整段消失;macOS AppMenu 现在由 core-plugin 在 macOS 平台直接调 `tauri::menu::SubmenuBuilder` / `app.set_menu()` 完成,**不经过 platform/ 层** (platform/ 层只剩路径 / 单实例 / 自启 / reveal / 通知 / 窗口 chrome / git 7 个 trait)。

7. **与 Phase 42 接口**: IPlugin 在 Phase 42 加 `commands() / services()`,Phase 43 加 `tray_items() / app_menu_items()`。**PluginContext 不需扩展** (`app: &AppHandle` 已有,`MenuRegistry` 在 `core-plugin::init` 时接收 `app` 并 clone 进 on_menu_event 闭包)。`PluginAction::Custom` 闭包需要 plugin 在 `init` 时构造 (因为它要捕获 plugin state / `Arc<Service>`),不能 `lazy` 在 `tray_items()` 里返回 (因为 `tray_items()` 是 `&self`,返回 Vec 时 plugin 还没 init)。

**Primary recommendation:** 抽 1 个 `core-plugin`,扩 IPlugin 加 `tray_items() / app_menu_items()` 2 个方法 (默认返回空 Vec),MenuRegistry 模块负责 build,PluginAction enum + HashMap dispatch。**预计工期 1-2 天** (与 v3.4 总表预估一致)。最大风险点是 `IsMenuItem<R>` sealed 约束导致的"声明 vs 构建"双层结构 — 必须在文档中明确,避免后续 plugin 误以为可以直接 `impl IsMenuItem for PluginTrayItem`。

---

## Project Constraints (from CLAUDE.md)

> 直接影响 Phase 43 实现的工程纪律:

- **§2.1 架构先行**: 已完成 (本文件)
- **§2.2 TDD 强制**: MenuRegistry 单测必须 4 项 (build_tray / build_app_menu / dispatch_action_lookup / Windows 平台 no-op)
- **§2.3 版本管理**: Tauri 锁在 2.11.3 (Cargo.lock),**禁止因 "Menu API 不好用" 升/降版本**
- **§2.4 谨慎修改文件**: 本 phase 改动文件 = `lib.rs` (1 处) + `plugins/{traits,host,mod}.rs` (3 处) + 新增 `plugins/menu_registry.rs` + 新增 `plugins/stubs/core.rs` + 删 `platform/{macos,windows}/app_menu.rs` (2 处) + `platform/{mod,traits,macos/mod}.rs` 删 IPlatformAppMenu 相关 (3 处)。**总计 11 个文件**,每个改动必须有充分证据。
- **§3.1 分层架构**: MenuRegistry 属于 plugins/ (与 traits/host 并列,不是 platform/);core-plugin 属于 plugins/stubs/
- **§3.2 OS 抽象接口**: 本 phase 删 `IPlatformAppMenu` trait 是 **反向操作** — 理由:macOS AppMenu 不是 OS 差异 (Tauri 跨平台 API),而是产品策略 (Linux 暂不支持 / Windows 用托盘代替)。删 trait 不破坏 §3.2 精神 (tray / 路径 / 单实例 / 自启 / 通知 / 窗口 chrome / git 7 个真正的 OS 差异 trait 保留)。
- **§6.4 UI 文案改动同步**: 托盘 "显示主窗口" / "退出" 文案在 PluginTrayItem 中由 core-plugin 声明,迁过程中**不涉及 IPC 常量** (因为走菜单事件,不是 IPC),但前端 `invoke('get_app_metadata')` 的 about 字段 (如果改) 仍要走 IPC 常量同步流程。**本 phase 不改 about 文案**,所以 §6.4 不触发。
- **§6.5 显示名分层**: 同上,不动 PRODUCT_NAME / IDENTIFIER。
- **§9 迭代交付**: 单个 PR,ship 前必跑 smoke test 10/10 (含 macOS AppMenu 子项)。
- **§10 不要做**: 不修改 SPEC.md (Phase 43 不涉及 SPEC 改);不跳过 smoke test;不在用户没核定前合并。

---

## Standard Stack

### Core (Tauri 2.11.3 已锁,本 phase 不引入新依赖)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri::menu::MenuItem` | 2.11.3 | 文本菜单项 (with_id / new) | Tauri v2 唯一 menu item 类型 |
| `tauri::menu::MenuItem::with_id` | 2.11.3 | 动态构建带 id 的 menu item | 本 phase 核心 API |
| `tauri::menu::Menu` / `Menu::with_items` | 2.11.3 | 菜单容器,接受 `&[&dyn IsMenuItem<R>]` | 异构 item 切片 |
| `tauri::menu::MenuBuilder` | 2.11.3 | 流式 builder (`.text(id, label)` / `.item(&x)` / `.items(&[...])` / `.build()`) | 动态构建比 with_items 更易组合 |
| `tauri::menu::SubmenuBuilder` | 2.11.3 | macOS AppMenu 顶层 submenu | AppMenu 必须用 submenu 装 |
| `tauri::menu::PredefinedMenuItem` | 2.11.3 | 系统预定义 item (about/hide/quit/...) | macOS 自动绑系统快捷键 |
| `tauri::tray::TrayIconBuilder` | 2.11.3 | 系统托盘 + menu + on_menu_event | Tauri 跨平台托盘 |
| `tauri::AppHandle` | 2.11.3 | 跨线程持有,Send + Sync + Clone | PluginAction 闭包捕获 |
| `muda::MenuId` (re-exported as `tauri::menu::MenuId`) | muda 0.15 (Tauri 2.11.3 依赖) | menu item 唯一 id,等价 `String` | HashMap key |
| `std::sync::Arc<dyn Fn + Send + Sync>` | std | plugin 回调闭包 | Send + Sync 跨线程 |
| `std::collections::HashMap<String, PluginAction>` | std | menu event dispatch 查表 | O(1) lookup |

### Supporting (辅助,无需新依赖)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `log` crate (already in deps) | workspace | warn! / error! 记录 menu build 失败 | MenuRegistry build 任何错误都 log,不阻断 setup |
| `thiserror` (already in deps) | workspace | `MenuBuildError` enum 派生 | 失败时返回 |
| `crate::plugins::PluginHost` | workspace | MenuRegistry 输入,collect tray_items() | 复用 Phase 42 已有的 host |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HashMap<String, PluginAction> dispatch | `match event.id.as_ref() { "show" => ..., "quit" => ..., }` (现状) | match 写死 → 加项改 lib.rs (违反"加项只动 1 个文件") |
| `PluginAction::ShowMainWindow` 内置变体 | 每次 plugin 写 `Custom(Arc::new(\|app\| window.show()))` | 重复代码,N 个 plugin 写 N 份相同闭包 |
| `MenuBuilder` 流式 API | `Menu::with_items` 一次性传切片 | with_items 适合"全在 init 阶段一次性给完";MenuBuilder 适合"边遍历 plugin 边 push"。本 phase 选 **MenuBuilder** (与 PluginHost iter() 配合) |
| core-plugin 抽 | 1 个 core-plugin + 9 个业务 plugin 各自负责菜单 | 后者会让"托盘 show/quit" 找不到归属 (它不属于任何业务模块);前者清晰 |
| `Arc<dyn Fn + Send + Sync>` | `Box<dyn FnMut + Send>` | Fn vs FnMut 决定闭包内部是否能修改捕获的 state。`Send + Sync` 是 on_menu_event 约束要求,`Fn` 比 `FnMut` 更松 (允许 `&self` 闭包) |
| `MenuItem::with_id` (with id) | `MenuItem::new` (no id) | 新 API 必须有 id,否则 dispatch 失败 |

## Package Legitimacy Audit

**Required: 不适用 (no new external packages introduced)。** 本 phase 复用 `tauri` 2.11.3 + `std` + workspace 内 `log` / `thiserror` / `crate::plugins::*`。无新增 npm / crates 依赖,审计表为空。

```markdown
| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none)  | -        | -   | -         | -           | -       | -           |
```

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 托盘 (tray) 构建 | Backend (Rust) | — | Tauri `TrayIconBuilder` 是 Rust API,无前端参与 |
| 托盘 menu 事件 dispatch | Backend (Rust) | Frontend (optional, 切 view) | dispatch 在 Rust 闭包,SwitchView 变体才 emit 到前端 |
| macOS AppMenu 构建 | Backend (Rust) | — | `tauri::menu::SubmenuBuilder` 是 Rust API,前端不参与 |
| PluginAction 定义 (enum) | Backend (Rust) | — | 跨线程 Send+Sync,前端无对应概念 |
| Sidebar 菜单项 (Phase 44) | Frontend (TS) | — | React 组件,本 phase 不管 |
| 关于 (about) 文案 | Backend (Rust) | — | `PredefinedMenuItem::about` 接受 `AboutMetadata`,由 core-plugin 构造 |

**关键观察:** 本 phase **不涉及前端代码**。`App.tsx` / `AppSidebar.tsx` / `registry.ts` 在 Phase 44 才动。Phase 43 完成后,前端无任何可见变化 (除非用户重启看 macOS 顶部菜单栏)。

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ lib.rs::setup()                                                  │
│   ├─ let host = init_all(&ctx)  // Phase 42/43 合并产物           │
│   ├─ core-plugin::init(&ctx) 已自动跑过 (init_all 内部)           │
│   │     ↓ (在 init 阶段)                                         │
│   │  ┌────────────────────────────────────────────┐             │
│   │  │ core-plugin::init(ctx)                     │             │
│   │  │   ├─ MenuRegistry::build_tray(host, app)   │             │
│   │  │   │     ├─ collect: host.iter() → tray_items│            │
│   │  │   │     ├─ build: Vec<MenuItem> 逐项 MenuItem::with_id │ │
│   │  │   │     ├─ build HashMap<String, PluginAction>          │
│   │  │   │     └─ TrayIconBuilder::new()                       │
│   │  │   │            .menu(&menu)                             │
│   │  │   │            .on_menu_event(|app, event| {            │
│   │  │   │                 let map = ACTIONS.clone();          │
│   │  │   │                 if let Some(a) = map.get(&event.id) {│             │
│   │  │   │                     a.dispatch(app)               │
│   │  │   │                 }                                  │
│   │  │   │            })                                     │
│   │  │   │            .build(app)                             │
│   │  │   └─ (cfg macOS) MenuRegistry::build_app_menu(host,app) │
│   │  │         ├─ collect: host.iter() → app_menu_items       │
│   │  │         ├─ group by submenu: "App" / "Edit" / "View" / "Window" │
│   │  │         └─ SubmenuBuilder 流式构建 → app.set_menu()    │
│   │  └────────────────────────────────────────────┘             │
│   ├─ (保留 on_tray_icon_event DoubleClick → window.show)        │
│   └─ (保留 on_window_event CloseRequested → window.hide)         │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│ PluginHost (init_all 完成后状态)                                  │
│   ├─ "core"   : CorePlugin { tray: [show, quit], app_menu: [app, edit, view, window] } │
│   ├─ "provider-list" : ProviderListPlugin { tray: [], app_menu: [] } │
│   ├─ "import-sql"    : ImportSqlPlugin    { tray: [], app_menu: [] } │
│   └─ ... (其余 7 stub)                                            │
│                                                                  │
│  9 业务 plugin 的 tray_items() / app_menu_items() 在 v3.4 期间返回空  │
│  (因为业务逻辑还在 stubs);未来 M5+ 加业务时再 extend                │
└─────────────────────────────────────────────────────────────────┘
```

**数据流:** 1) `lib.rs` 调 `init_all(ctx)` → 2) PluginHost 收集所有 plugin → 3) `init_all` 跑每个 plugin 的 `init(ctx)` → 4) `core-plugin` 的 `init` 调 `MenuRegistry::build_tray` 收集**已注册 plugin** 的 `tray_items()` → 5) `MenuRegistry` 同时收集 `app_menu_items()` (cfg 隔离 mac) → 6) 构建 Menu + HashMap + 装到 TrayIconBuilder / set_menu → 7) 运行时用户点菜单项 → 闭包查 HashMap → 调 `PluginAction::dispatch(app)` → 8) 对 `SwitchView(v)` 变体,emit `"frontend://switch-view" v` 事件给前端 (前端 Phase 44 监听 + setView)。

### Recommended Project Structure

```
src-tauri/src/
├── lib.rs                              # 删 lib.rs:308-329 + 400-417, 替换为注释指向 core-plugin
├── plugins/
│   ├── traits.rs                       # IPlugin 加 tray_items() / app_menu_items() 2 个默认方法
│   ├── host.rs                         # (Phase 42 已扩展,本 phase 不动)
│   ├── mod.rs                          # 注册 core-plugin 在最前
│   ├── menu_registry.rs                # 新增: build_tray / build_app_menu
│   └── stubs/
│       ├── core.rs                     # 新增: CorePlugin 装托盘 2 项 + macOS AppMenu 全集
│       └── ... (其余 10 个 stub 不动)
└── platform/
    ├── mod.rs                          # 删 `pub fn app_menu` factory + IPlatformAppMenu re-export
    ├── traits.rs                       # 删 IPlatformAppMenu trait + 删 test "app_menu_build_dispatch"
    ├── macos/
    │   ├── mod.rs                      # 删 `pub use app_menu::MacAppMenu`
    │   └── app_menu.rs                 # 删整个文件 (逻辑迁 core-plugin)
    └── windows/
        └── app_menu.rs                 # 删整个文件 (WindowsAppMenu → NotSupported 不再需要)
```

### Pattern 1: IPlugin 扩展 — 默认空 Vec (向后兼容)

**What:** 给 IPlugin trait 加 2 个新方法,默认返回空 Vec。**关键: 默认实现** 而非 required,确保 9 个现有 stub 0 改动。

```rust
// plugins/traits.rs (扩展)
pub trait IPlugin: Send + Sync {
    // ... (Phase 42 的 commands() / services() 不动)

    /// Tray menu items this plugin contributes to the system tray menu.
    /// Empty for plugins that don't need tray entries. Returned in order;
    /// MenuRegistry concatenates plugin items in registration order.
    fn tray_items(&self) -> Vec<PluginTrayItem> {
        Vec::new()
    }

    /// App menu items this plugin contributes (macOS only).
    /// Empty for plugins that don't need app menu entries.
    /// Items are grouped by `submenu` field; MenuRegistry builds a
    /// Submenu for each distinct label.
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> {
        Vec::new()
    }
}
```

**When to use:** 任何 IPlugin 新方法都用"默认空 Vec"模式 → 避免破坏现有 10 个 stub (Phase 42 同样套路: `commands() / services()` 默认返回空)。

### Pattern 2: PluginAction — enum + Custom(Arc<dyn Fn>)

**What:** PluginAction 是 4 变体 enum。前 3 个是 MenuRegistry 内部已知语义,第 4 个给 plugin 自由扩展。

```rust
// plugins/menu_registry.rs (新增)
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Clone)]
pub enum PluginAction {
    /// Show the main window. Maps to: window.show() + set_focus() + unminimize().
    /// Default implementation, no plugin code needed.
    ShowMainWindow,

    /// Quit the app. Maps to: app.exit(0).
    /// Default implementation, no plugin code needed.
    Quit,

    /// Switch the frontend view to the given view id. Maps to:
    /// app.emit("frontend://switch-view", view_id). Phase 44 frontend
    /// listens on this and calls setView.
    SwitchView(String),

    /// Custom callback. Used for special cases (open URL, spawn process,
    /// toggle a service flag, etc.). The closure must be Send + Sync
    /// because on_menu_event runs on any thread.
    Custom(Arc<dyn Fn(&AppHandle) + Send + Sync>),
}

impl PluginAction {
    pub fn dispatch(&self, app: &AppHandle) {
        match self {
            PluginAction::ShowMainWindow => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.unminimize();
                }
            }
            PluginAction::Quit => {
                app.exit(0);
            }
            PluginAction::SwitchView(view_id) => {
                let _ = app.emit("frontend://switch-view", view_id.clone());
            }
            PluginAction::Custom(f) => f(app),
        }
    }
}
```

**关键决策点:** 为什么 SwitchView 走 emit 而不是直接调 frontend function?—— emit 是异步 + 不阻塞,plugin 与前端解耦;前端可在 Phase 44 用 `useEffect(() => listen, [])` 接;`App.tsx` 现有 view state setter 可以平滑接。**对比:** 也可让 plugin 持有 frontend-setView 函数 (不可行,前后端 IPC 不允许) 或走 IPC (可行但绕,emit 已经是 IPC 的一种)。

**When to use:** 4 个变体 enum 优先于 trait object + dyn dispatch —— enum 编译期大小确定,no vtable,no Arc overhead (除 Custom 变体外)。

### Pattern 3: MenuRegistry 集中构建

**What:** `MenuRegistry` 模块 (`plugins/menu_registry.rs`) 提供 2 个公开函数 + 1 个 internal HashMap。

```rust
// plugins/menu_registry.rs
use std::collections::HashMap;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use crate::plugins::{PluginHost, PluginTrayItem, PluginAppMenuItem, PluginAction};

/// Build the system tray menu from all registered plugins' `tray_items()`.
/// Returns the built Menu + the dispatch HashMap. core-plugin's init
/// calls this once and uses both return values.
pub fn build_tray(
    host: &PluginHost,
    app: &AppHandle,
) -> tauri::Result<(Menu<tauri::Wry>, Arc<HashMap<String, PluginAction>>)> {
    // 1) Collect all tray items in registration order
    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    let mut actions: HashMap<String, PluginAction> = HashMap::new();

    for (_id, plugin) in host.iter() {
        for item in plugin.tray_items() {
            // PluginTrayItem → Tauri MenuItem::with_id
            let mi = MenuItem::with_id(
                app,
                &item.id,           // unique menu id for dispatch
                &item.label,        // visible text
                item.enabled,
                item.accelerator.as_deref(),
            )?;
            items.push(mi);
            actions.insert(item.id.clone(), item.action);
        }
    }

    // 2) Build Menu from Vec<MenuItem>
    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    let menu = Menu::with_items(app, &item_refs)?;

    Ok((menu, Arc::new(actions)))
}

/// Build the macOS application menu from all registered plugins'
/// `app_menu_items()`. No-op on non-mac platforms. On Windows the
/// function returns Ok(None), core-plugin's init checks and skips
/// `app.set_menu(...)` if None.
#[cfg(target_os = "macos")]
pub fn build_app_menu(host: &PluginHost, app: &AppHandle) -> tauri::Result<()> {
    // 1) Collect all app menu items, group by submenu label
    let mut groups: std::collections::BTreeMap<String, Vec<PluginAppMenuItem>> = ...;
    for (_id, plugin) in host.iter() {
        for item in plugin.app_menu_items() {
            groups.entry(item.submenu.clone()).or_default().push(item);
        }
    }

    // 2) Build Submenu for each group, assemble, app.set_menu
    let mut root = tauri::menu::MenuBuilder::new(app);
    for (submenu_label, items) in groups {
        let mut sb = tauri::menu::SubmenuBuilder::new(app, &submenu_label);
        for item in items {
            match item.kind {
                AppMenuItemKind::Predefined(role) => sb = apply_predefined(sb, app, role)?,
                AppMenuItemKind::Separator => sb = sb.separator(),
                AppMenuItemKind::Custom { id, label, accelerator } => {
                    sb = sb.text(&id, &label);  // or build MenuItem::with_id
                }
            }
        }
        let submenu = sb.build()?;
        root = root.item(&submenu);
    }
    let menu = root.build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn build_app_menu(_host: &PluginHost, _app: &AppHandle) -> tauri::Result<()> {
    // No-op on Windows/Linux. core-plugin's init still calls this
    // unconditionally (cfg ensures the call site compiles on all targets).
    Ok(())
}
```

**When to use:** 这是 Phase 43 的"集中化"模式核心。任何"lib.rs 硬编码 0 行"的诉求,都通过一个 `build_X(host, ctx) -> Result<...>` 函数实现;`lib.rs::setup` 只剩 `host.init_all(&ctx) + host.iter() 数据已就绪` 后的总装。

### Anti-Patterns to Avoid

- **anti-pattern 1: 让 PluginTrayItem 自身实现 IsMenuItem<R>** — 不可行,IsMenuItem 是 sealed (见上)。**反事故**: 如未来有 AI 看到 `pub trait IsMenuItem<R: Runtime>: sealed::IsMenuItemBase` 想 "给 PluginTrayItem 加个 impl",**禁止** — 会撞 `IsMenuItemBase` 私有 impl 错误。PluginTrayItem 必须是 Tauri 无关的"声明结构",转换在 MenuRegistry 集中做。
- **anti-pattern 2: PluginAction 用 trait object 不用 enum** — `Box<dyn PluginAction>` 会导致 Vec 元素非 Sized,无法在 HashMap 中存 (Box 又 OK,但 HashMap entry 会有额外堆分配)。enum + Arc<dyn Fn> 在 Custom 变体里就够了,4 个变体大小已知。
- **anti-pattern 3: 用 Mutex<HashMap> 保护 actions** — 不需要。`build_tray` 在 setup 阶段一次性构建,Arc 装入闭包后不再修改;并发安全 = Arc::clone + 只读访问。
- **anti-pattern 4: 让 plugin 在 `tray_items()` 里就构造 MenuItem<R>** — 不行,因为 plugin 此时还没 `init`,拿不到 `AppHandle`;且 `MenuItem<R>` 创建需要 `&M: Manager<R>` (即 AppHandle / Window / App)。**正确做法**: tray_items() 返回 PluginTrayItem (声明),MenuRegistry 在 init 阶段 (有 app) 时统一 build。
- **anti-pattern 5: cfg(target_os) 散落在业务 plugin** — 业务 plugin 不应写 `#[cfg(target_os)]`;它永远返回 `tray_items() / app_menu_items()`,core-plugin + MenuRegistry 决定什么平台用什么。**例外**: 如果 plugin 真的只想在某平台贡献菜单,可以用 cfg 决定 **整个** `tray_items()` 返回 `vec![]` vs `vec![item]`,但 item 本身不应 cfg 化 (破坏 trait 一致性)。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Menu item 唯一 id | 手动 UUID 生成 + counter | `MenuItem::with_id` 的 id 字段 | muda crate 内部保证 id 唯一性 + 给 MenuEvent 完整传递 |
| 异构 menu items 列表 | `enum MyItem { A(MenuItem), B(Predefined), C(Submenu) }` 自定义 + manual `match` 加到 menu | `MenuBuilder::items(&[&a, &b, &c])` / `Menu::with_items` | Tauri 已用 `MenuItemKind<R>` enum + `IsMenuItem<R>` trait 解决;re-invent = 错 |
| 跨线程 menu event dispatch | `Arc<Mutex<HashMap>>` + lock | `Arc<HashMap>` 只读 + lookup | menu event handler 是只读 + 高频 (用户可能狂点);锁会阻塞 |
| Predefined 系统菜单 (Cmd+Q / Cmd+H 等) | 手写 `MenuItem::with_id` + `on_menu_event` 调 `app.exit(0)` / `window.hide()` | `SubmenuBuilder::quit()` / `.hide()` 等 | PredefinedMenuItem 在 macOS 上绑系统行为 + 系统本地化文本 (其他语言自动翻译) + 系统快捷键;手写会丢失这些 |
| macOS AppMenu 标准结构 | 自己拼 NSMenu / 调 NSApp | `SubmenuBuilder::new(app, "App").about().separator().hide().hide_others().show_all().separator().quit()` | macOS HIG 要求 App 菜单第一个 submenu 必须 about + quit,且 separator 顺序固定;SubmenuBuilder 已固化 |
| on_menu_event 参数提取 id | `event.id.0.as_str()` 后 `match event.id.as_ref()` | 直接 `event.id.as_ref()` (等同) | `event.id: muda::MenuId` 是 `pub struct MenuId(pub String)`;`.as_ref()` 走 `AsRef<str>` impl |
| 双击托盘图标 = 显示主窗口 | Tauri 没有 `on_double_click` 钩子,但能通过 `on_tray_icon_event` 监听 `TrayIconEvent::DoubleClick` | 保持现状 (lib.rs:331-347) | 已验证 Tauri v2 实现 |

**Key insight:** Tauri v2 的 menu 系统已经在 muda crate 层做了"异构 item + Predefined item + 系统行为绑定"三件最难的事。任何"我手写更简单"的冲动都要先查 SubmenuBuilder 有没有现成方法 (查 [tauri-2.11.3/src/menu/builders/menu.rs](file:///Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/menu/builders/menu.rs) 的 `shared_menu_builder!` 宏)。

---

## Common Pitfalls

### Pitfall 1: 在 init 之前访问 plugin.tray_items()

**What goes wrong:** plugin `tray_items()` 返回的 `PluginAction::Custom(Arc<dyn Fn>)` 需要 plugin 已经初始化才能构造 (闭包通常捕获 plugin state)。但 `tray_items()` 是 `&self` 方法,如果在 `host.register()` 之后立即调,plugin 还没 `init()` 跑过,捕获的 state 是未初始化的 (e.g. `Arc<Service>` 是 None)。

**Why it happens:** trait 方法的调用顺序容易混淆 — `register` 只存 Box,`init_all` 才跑 init。`tray_items()` 看似是只读访问,实际 PluginAction::Custom 闭包构造依赖 init。

**How to avoid:**
1. **明确文档**: `tray_items() / app_menu_items()` 必须在 plugin 已 init 后调用。MenuRegistry 在 `core-plugin::init(ctx)` 里调 host.iter() → plugin.tray_items() (此时所有 plugin 的 init 都已经跑过,因为 init_all 是顺序的)。
2. **替代方案 A**: PluginAction::Custom 不在 tray_items() 里构造,而在 plugin 的 fields 里存 (e.g. `core-plugin` 在 struct 里硬编码 `actions: HashMap<String, PluginAction>`);tray_items() 直接返回 (id, label) 二元组 + 单独 `actions()` 方法返回 HashMap。**这个方案更清晰**,本 phase 推荐。
3. **替代方案 B (拒绝)**: plugin 在 init 时注册 action 到 MenuRegistry 的全局状态 (反模式: 全局可变状态,违反 plugin 自包含)。

**Warning signs:** Custom 闭包在 init 之前调会 panic (Arc::new 不会,但闭包内访问 None 会)。在单测里 mock 一个 uninitialized plugin + 调 tray_items() 应 panic,作为 regression test。

### Pitfall 2: PredefinedMenuItem::about 的 metadata 在 macOS 上必须有 name + version

**What goes wrong:** `PredefinedMenuItem::about(app, None, metadata)` 中 metadata 是 `Option<AboutMetadata>`。如果传 None,macOS AppMenu 的 About 项点击会**没有弹窗内容** (空对话框) 或**走默认 AppKit about dialog 显示空应用名**。

**Why it happens:** Tauri `AboutMetadata` 的 `name / version / copyright / authors` 都是 `Option<String>`;`None` 在 macOS 上不报错但显示空白。

**How to avoid:** core-plugin 构造 `AboutMetadata` 时必填 name (用 `app.package_info().name`) + version (`app.package_info().version.to_string()`)。**禁止**传 None metadata。

**Warning signs:** 启动 app → 顶部菜单栏 → App → About → 看到空白对话框或 "Unknown" 应用名。

### Pitfall 3: macOS AppMenu 必须以 Submenu 形式存在

**What goes wrong:** `Menu::with_items(app, &[&menu_item])` 然后 `app.set_menu(menu)` — macOS 上**不显示在顶部菜单栏** (Tauri 文档明示: "if using Menu for the global menubar, it can only contain Submenus")。原因: NSMenu 要求顶层必须是 submenu,直接放 MenuItem NSApp 拒绝渲染。

**Why it happens:** Tauri v2 menu API 跨平台,但 macOS NSMenu 行为特殊。Windows / Linux 没有这个限制。

**How to avoid:** core-plugin 的 build_app_menu 必须用 `SubmenuBuilder::new(app, "App")...build()` 包一层,然后 `MenuBuilder::new(app).items(&[&app_submenu, &edit_submenu, ...]).build()`。**实测验证**: 当前 `platform/macos/app_menu.rs:54-101` 就是这个结构,Phase 43 直接复用模式。

**Warning signs:** macOS 启动后看不到顶部菜单栏 (任何一项都没有)。

### Pitfall 4: SubmenuBuilder 链式调用 + 错误传播

**What goes wrong:** `SubmenuBuilder::new(app, "App").about(meta).separator().hide().hide_others().show_all().separator().quit().build()` — 这一长串链中**任何一个** builder 方法可能返回 builder (没错误) 或 `Result<Submenu<R>>` (有错误)。在 Tauri 2.11.3 中,builder 方法返回 `Self` (不报错),只在 `.build()` 时统一返回 `Result<Submenu<R>>`。

**Why it happens:** Tauri 用 builder 模式收集 item,延迟到 build 时再 `?`。这意味着链上的 `.about(meta)` 等返回的是 `Self`,不会"半成功半失败"。

**How to avoid:** 链式调用没问题,但要注意 `.build()` 是 `Result<Submenu<R>>` — 必须 `?` 传播。本 phase 用 `?` + `log::warn!` 降级到不阻断 setup (menu 失败 ≠ app 启动失败,但应 log)。

**Warning signs:** `.build()?` 漏 `?` → 类型不匹配编译失败 (容易发现);`.build()?` 后 `?` 漏处理 → menu 出错时 setup 阶段 panic app 闪退 (难发现,因为是 setup 期)。

### Pitfall 5: HashMap dispatch 在 Windows 平台不生效

**What goes wrong:** `core-plugin::init` 在 Windows 上也跑 (cfg 不隔离 core-plugin 整体)。如果 core-plugin 在 init 中调 `build_app_menu`,Windows 上虽然 cfg 隔离 `build_app_menu` 返回 `Ok(())`,但 `app.set_menu()` 在 Windows 上**走不同代码路径**: Windows 把 menu 设到 **当前窗口** 而非全局菜单栏。如果不小心 cfg 隔离错,Windows 上调用 `set_menu` 会让 macOS 路径代码 (在 Windows 上不应该跑) 误执行。

**Why it happens:** Tauri `AppHandle::set_menu` 在 macOS 是设 NSApp mainMenu,在 Windows 是设当前窗口的 HMENU。Windows 上设置全局菜单 = 设置所有窗口的菜单 (因为 Windows 没有全局菜单概念)。

**How to avoid:** `core-plugin::init` 中:
```rust
#[cfg(target_os = "macos")]
{
    if let Err(e) = MenuRegistry::build_app_menu(host, app) {
        log::warn!("[core] build mac app menu failed: {e}");
    }
}
```
cfg 隔离 `build_app_menu` 调用点,函数本身也用 cfg 在 non-mac 上返回 Ok no-op。**双层 cfg 保险**: 调用点 cfg + 函数体 cfg。

**Warning signs:** Windows 启动后窗口菜单栏出现"App / Edit / View / Window" submenu (本来不应该有,因为 Windows 用托盘)。

### Pitfall 6: 删 IPlatformAppMenu 打破 mock 测试

**What goes wrong:** `platform/traits.rs:650-656` 有 `app_menu_build_dispatch` 测试用 `mockall` mock `IPlatformAppMenu`。删 trait 后这个测试无法编译。

**Why it happens:** 测试用 mockall 自动生成,删 trait 后 mock! 宏找不到目标。

**How to avoid:** 删 trait 时同时删对应测试 (`#[test] fn app_menu_build_dispatch`) + 删 `mockall::mock!` 块。**重构纪律**: 删 module 前先 grep `mock!` + 删对应测试。

**Warning signs:** `cargo test --all` 编译失败 "cannot find type `AppMenuShim`"。

---

## Code Examples

### Verified patterns from Tauri 2.11.3 local source:

### Example 1: 动态构建 Menu from Vec<PluginTrayItem>

```rust
// Source: tauri-2.11.3/src/menu/menu.rs:128-135
pub fn with_items<M: Manager<R>>(
    manager: &M,
    items: &[&dyn IsMenuItem<R>],
) -> crate::Result<Self> {
    let menu = Self::new(manager)?;
    menu.append_items(items)?;
    Ok(menu)
}
```

**应用**: 本 phase 用 `Menu::with_items(app, &items_as_dyn)` 直接接收 `Vec<MenuItem<R>>` 通过 `&[&dyn IsMenuItem<R>]` 切片。**注意**: `items` 元素的引用生命周期与 `Vec<MenuItem<R>>` 同生共死,所以 MenuRegistry 必须在 build_tray 函数内一次性用完。

### Example 2: TrayIconBuilder + on_menu_event with HashMap dispatch

```rust
// Combined from tauri-2.11.3/src/tray/mod.rs:241,328 + project lib.rs:308-329
let actions: Arc<HashMap<String, PluginAction>> = Arc::new(...);

let tray = TrayIconBuilder::with_id("main-tray")
    .icon(app.default_window_icon().unwrap().clone())
    .tooltip("Claude 配置管理器")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(move |app, event| {
        // event.id: muda::MenuId = MenuId(String)
        let id = event.id.as_ref();  // &str
        if let Some(action) = actions.get(id) {
            action.dispatch(app);
        } else {
            log::warn!("[menu] no action for id={id}");
        }
    })
    .build(app)?;
```

**关键**: `move |app, event|` 闭包捕获 `actions: Arc<HashMap>`,Send + Sync 自动满足 (Arc<HashMap> 是 Send+Sync 如果 PluginAction 也是 Send+Sync)。

### Example 3: macOS AppMenu 标准结构 (PredefinedMenuItem)

```rust
// Source: tauri-2.11.3/src/menu/builders/menu.rs:583-620 + project platform/macos/app_menu.rs:46-91
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

let app_submenu = SubmenuBuilder::new(app, "App")
    .about(Some(AboutMetadata {
        name: Some(app.package_info().name.clone()),
        version: Some(app.package_info().version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    }))
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;

let edit_submenu = SubmenuBuilder::new(app, "Edit")
    .undo().redo().separator()
    .cut().copy().paste().select_all()
    .build()?;
// ...

let root_menu = MenuBuilder::new(app)
    .items(&[&app_submenu, &edit_submenu, &view_submenu, &window_submenu])
    .build()?;

app.set_menu(root_menu)?;
```

**平台支持矩阵** (从 `shared_menu_builder!` 宏 doc 提取):
- `.undo() / .redo()`: macOS only
- `.cut() / .copy() / .paste() / .select_all()`: macOS + Windows + Linux (?)
- `.minimize() / .maximize()`: macOS + Windows (Linux unsupported)
- `.fullscreen()`: macOS only (Win 用 .maximize 替代?)
- `.hide() / .hide_others() / .show_all()`: macOS only
- `.close_window()`: macOS + Windows
- `.quit()`: macOS + Windows
- `.about()`: 跨平台

**结论**: core-plugin 的 `build_app_menu` 在 macOS 上 build 完整结构,Windows 上 cfg 隔离直接 no-op (不需要 app_menu,因为 Windows 用托盘)。

## Type Definitions (Recommended)

```rust
// plugins/menu_registry.rs

use std::sync::Arc;
use tauri::AppHandle;
use tauri::menu::IsMenuItem;
use tauri::Wry;

/// One tray menu item, declared by a plugin. Converted to
/// `tauri::menu::MenuItem::with_id(...)` by MenuRegistry at build time.
#[derive(Debug, Clone)]
pub struct PluginTrayItem {
    /// Unique menu id used for `MenuEvent.id` dispatch. Convention:
    /// `"<plugin-id>:<action-name>"`, e.g. `"core:show"`, `"core:quit"`,
    /// `"provider-list:switch-default"`.
    pub id: String,

    /// Visible text, e.g. `"显示主窗口"`, `"退出"`.
    pub label: String,

    /// Whether the item is enabled (greyed out if false).
    pub enabled: bool,

    /// Optional accelerator string, e.g. `"Cmd+Q"`, `"Ctrl+Shift+X"`.
    /// Tauri passes through to muda which parses platform-specific.
    pub accelerator: Option<String>,

    /// What to do when the user clicks this item.
    pub action: PluginAction,
}

/// One app menu item (macOS only). Items with the same `submenu`
/// label are grouped into one Submenu by MenuRegistry.
#[derive(Debug, Clone)]
pub struct PluginAppMenuItem {
    /// Submenu label, e.g. `"App"`, `"Edit"`, `"View"`, `"Window"`.
    /// Items with the same label form one Submenu, rendered in the
    /// order they appear across plugins.
    pub submenu: String,

    /// Item kind: Predefined (system item) / Separator / Custom (text).
    pub kind: PluginAppMenuItemKind,
}

#[derive(Debug, Clone)]
pub enum PluginAppMenuItemKind {
    /// A system-provided menu item. macOS auto-binds shortcut + behavior.
    Predefined(AppMenuRole),

    /// Visual separator line.
    Separator,

    /// Custom text item with id. macOS doesn't strictly need id, but we
    /// keep one for future on_menu_event handling.
    Custom {
        id: String,
        label: String,
        accelerator: Option<String>,
    },
}

/// Maps to PredefinedMenuItem variants. Not exhaustive — only the
/// roles core-plugin uses in M8. New roles can be added later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMenuRole {
    About,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Maximize,
    Fullscreen,
    CloseWindow,
    Services,
    BringAllToFront,
    Separator,
}

/// What happens when a user clicks a tray menu item.
/// First 3 variants have default implementations; Custom lets plugins
/// inject arbitrary behavior.
#[derive(Clone)]
pub enum PluginAction {
    /// Show the main window. Default impl: window.show() + set_focus() + unminimize().
    ShowMainWindow,

    /// Quit the app. Default impl: app.exit(0).
    Quit,

    /// Switch the frontend view. Default impl: app.emit("frontend://switch-view", view_id).
    /// Frontend listens in Phase 44 + calls setView.
    SwitchView(String),

    /// Custom callback. Used for special cases (open URL, spawn process,
    /// toggle service state, etc.). MUST be Send + Sync.
    Custom(Arc<dyn Fn(&AppHandle) + Send + Sync>),
}
```

**Decision: `PluginTrayItem` is `Clone` (not Copy)** — because `action: PluginAction` contains `String` (in SwitchView) or `Arc<dyn Fn>` (in Custom),both not Copy. `Clone` lets MenuRegistry clone items if needed (e.g. registering multiple callbacks).

**Decision: `PluginAction` is `Clone`** — because `Custom(Arc<dyn Fn>)` Arc is Clone-cheap. `Send + Sync` is auto-derived since `Arc<dyn Fn + Send + Sync>` is Send + Sync.

**Decision: `AppMenuRole::Separator` exists** — for convenience,even though `PluginAppMenuItemKind::Separator` already handles it. Eliminates a redundant variant. **Actually redundant** — removing from enum, only use `PluginAppMenuItemKind::Separator`.

## Core Plugin Design

```rust
// plugins/stubs/core.rs
//! Core plugin — owns the system tray + macOS app menu.
//!
//! This plugin is special: it has zero business logic, but it
//! contributes the OS shell menu items that every user sees
//! (tray "显示主窗口 / 退出" + macOS top-bar "App / Edit / View / Window").
//!
//! It must be the FIRST plugin registered in `plugins/mod.rs::init_all`
//! so that:
//!   1. Its `init()` runs first, calling MenuRegistry::build_tray /
//!      build_app_menu while all other plugins have already been
//!      init'd (init_all is sequential).
//!   2. The tray icon exists before any business plugin tries to
//!      reference it (e.g. backup plugin might want to show a
//!      "Backup complete" tray notification — but that's via
//!      `app.emit`, not tray, so actually not a real constraint.
//!      Real reason is item ordering: tray items are collected in
//!      registration order, and "显示主窗口 / 退出" should be at the
//!      top, not interleaved with business items).

use super::super::traits::*;
use super::super::menu_registry::{
    build_tray, build_app_menu, PluginTrayItem, PluginAppMenuItem,
    PluginAppMenuItemKind, AppMenuRole, PluginAction,
};

pub struct CorePlugin;

impl IPlugin for CorePlugin {
    fn id(&self) -> &'static str { "core" }
    fn name(&self) -> &'static str { "Core" }

    fn routes(&self) -> Vec<PluginRoute> {
        Vec::new()  // core 不贡献前端路由
    }

    fn tray_items(&self) -> Vec<PluginTrayItem> {
        vec![
            PluginTrayItem {
                id: "core:show".into(),
                label: "显示主窗口".into(),
                enabled: true,
                accelerator: None,
                action: PluginAction::ShowMainWindow,
            },
            PluginTrayItem {
                id: "core:quit".into(),
                label: "退出".into(),
                enabled: true,
                accelerator: None,  // Tauri 跨平台 accelerator 解析 Cmd+Q 在 macOS 上;
                                    // 跨平台一致性 → 用 None,Windows 上 Ctrl+Q 不绑
                                    // (用户在 Phase 47 评估是否需要)
                action: PluginAction::Quit,
            },
        ]
    }

    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> {
        // macOS only; on Windows this Vec is just unused.
        vec![
            // App submenu
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::About),
            },
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Separator,
            },
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Hide),
            },
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::HideOthers),
            },
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::ShowAll),
            },
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Separator,
            },
            PluginAppMenuItem {
                submenu: "App".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Quit),
            },
            // Edit submenu
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Undo),
            },
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Redo),
            },
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Separator,
            },
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Cut),
            },
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Copy),
            },
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Paste),
            },
            PluginAppMenuItem {
                submenu: "Edit".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::SelectAll),
            },
            // View submenu
            PluginAppMenuItem {
                submenu: "View".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Fullscreen),
            },
            // Window submenu
            PluginAppMenuItem {
                submenu: "Window".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Minimize),
            },
            PluginAppMenuItem {
                submenu: "Window".into(),
                kind: PluginAppMenuItemKind::Predefined(AppMenuRole::Maximize),
            },
        ]
    }

    fn init(&mut self, ctx: &PluginContext) -> Result<(), PluginError> {
        let app = ctx.app.ok_or_else(|| {
            PluginError::InitFailed("core plugin requires AppHandle".into())
        })?;
        let host = ctx.host.ok_or_else(|| {
            PluginError::InitFailed("core plugin requires PluginHost".into())
        })?;

        // 1) Tray (always)
        match build_tray(host, app) {
            Ok((_menu, _actions)) => {
                log::info!("[core] system tray built");
            }
            Err(e) => {
                log::error!("[core] build_tray failed: {e}");
                return Err(PluginError::InitFailed(format!("build_tray: {e}")));
            }
        }

        // 2) macOS app menu (cfg-isolated)
        #[cfg(target_os = "macos")]
        {
            if let Err(e) = build_app_menu(host, app) {
                log::warn!("[core] build_app_menu failed (macOS): {e}");
                // 不阻断 init — 没有 AppMenu 不致命
            }
        }

        Ok(())
    }
}
```

**注意: `PluginContext` 需要扩展加 `host: Option<&PluginHost>` 字段。** 当前 PluginContext 只有 `app + paths`,但 core-plugin 的 `init` 需要遍历 host 才能 collect 所有 plugin 的 tray_items / app_menu_items。这是 Phase 43 对 PluginContext 的**唯一接口扩展**。在 Phase 42 也有类似扩展 (`services: &mut ServiceRegistry`),Phase 43 继续往 PluginContext 加字段是自然演化。

**另一种设计** (拒绝): 不让 PluginContext 持 host,而是让 lib.rs::setup 在 init_all 跑完后**手动**遍历 host 收集 + 调 build_tray + build_app_menu,再把结果传给 core-plugin 的 init。**缺点**: lib.rs 又有硬编码了 (遍历 host 的代码),违反 §2.4。**结论**: 保持"PluginContext 持有 host"设计,符合 plugin 自包含原则。

**PluginContext 扩展:**
```rust
// plugins/traits.rs
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub host: Option<&'a PluginHost>,  // 新增; test-only 用 None
}
```

**Init order 校正**: 当前 `init_all` 在 plugins/mod.rs:55 (`host.init_all(ctx)`) 调一次,跑所有 plugin 的 init。如果 `init_all` 是顺序执行,core 第一个注册 + init,它在 init 里访问 `ctx.host` 取到自己 + 后续所有已 init 的 plugin。**完美**。

## State of the Art

| Old Approach (M1-M3) | Current Approach (M8) | When Changed | Impact |
|----------------------|------------------------|--------------|--------|
| `lib.rs:308-329` 手写 `MenuItem::with_id` + `match event.id` | `core-plugin` 声明 `tray_items()` + `MenuRegistry::build_tray` 收集 | M8 / Phase 43 | 加托盘项不动 lib.rs |
| `platform/macos/app_menu.rs` 手写 4 个 Submenu + `platform::runtime::app_menu` factory | `core-plugin::app_menu_items()` 声明 + `MenuRegistry::build_app_menu` 收集 | M8 / Phase 43 | macOS AppMenu 不再走 platform/ 层,删 IPlatformAppMenu trait |
| `on_menu_event` 手写 match `"show" / "quit"` | `HashMap<String, PluginAction>` dispatch | M8 / Phase 43 | 加新 menu action 0 改动 on_menu_event |
| `IPlugin::routes() / services()` (Phase 42) | `IPlugin::tray_items() / app_menu_items()` (Phase 43) | M8 / Phase 43 | 复用 Phase 42 的"默认空 Vec"扩展模式 |
| 9 个 stub plugin 的 0 业务 | 同 M8, 业务 logic 延后 M5+ | unchanged | tray_items / app_menu_items 在 stub 上返回空 Vec (Phase 43),业务真做了再返回 |

**Deprecated/outdated:**
- `IPlatformAppMenu` trait + `MacAppMenu` / `WindowsAppMenu` impl + `platform::runtime::app_menu()` factory — Phase 43 删除,因为:
  1. 不是真正的 OS 差异 (Tauri v2 menu API 跨平台;Windows 上 cfg 不调即可)
  2. 占用 platform/ 层 slot,违反 §3.2 "platform/ 存 OS 差异"精神
- `lib.rs::setup` 中的 `MenuItem::with_id` / `on_menu_event` 手写块 — Phase 43 替换为 `core-plugin::init`
- `MacAppMenu` 中持有 `tauri::AppHandle` 字段 — Phase 43 删除,改为 MenuRegistry 接收 `&AppHandle` 参数

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust `cargo test` (workspace `src-tauri`) + Vitest (`src/__tests__`) |
| Config file | `src-tauri/Cargo.toml` (默认) + `vitest.config.ts` |
| Quick run command | `cd src-tauri && cargo test --lib plugins::` |
| Full suite command | `cargo test --all && npm run test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-43.1 | `build_tray` collects all plugin tray_items and builds Menu | unit | `cargo test --lib plugins::menu_registry::tests::build_tray_collects_all_plugins` | ❌ Wave 0 |
| REQ-43.2 | `build_tray` builds HashMap with correct id → action mapping | unit | `cargo test --lib plugins::menu_registry::tests::dispatch_map_lookup` | ❌ Wave 0 |
| REQ-43.3 | `build_app_menu` is no-op on Windows | unit | `cargo test --lib plugins::menu_registry::tests::build_app_menu_noop_on_windows` | ❌ Wave 0 |
| REQ-43.4 | `PluginAction::dispatch` for ShowMainWindow / Quit / SwitchView | unit | `cargo test --lib plugins::menu_registry::tests::action_dispatch_variants` | ❌ Wave 0 |
| REQ-43.5 | lib.rs has 0 lines of `MenuItem::with_id` / `on_menu_event` | grep lint | `bash scripts/lint-plugin-coupling.sh` | ❌ Wave 0 (lint script not yet has rule) |
| REQ-43.6 | `MacAppMenu` / `WindowsAppMenu` files deleted | grep lint | `! test -f src-tauri/src/platform/macos/app_menu.rs && ! test -f src-tauri/src/platform/windows/app_menu.rs` | ❌ Wave 0 |
| REQ-43.7 | IPlugin trait extension: tray_items() / app_menu_items() default empty | unit | `cargo test --lib plugins::traits::tests::default_tray_items_empty` | ❌ Wave 0 |
| REQ-43.8 | smoke test 10/10 PASS | smoke | `bash scripts/smoke-test.sh` | ✅ existing |
| REQ-43.9 | e2e Playwright: 托盘菜单 show/quit work | e2e | `npm run test:e2e -- --grep "tray"` | partial (existing tray test covers menu open) |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo check && cargo test --lib plugins::`
- **Per wave merge:** `cargo test --all && npm run test:run`
- **Phase gate:** Full suite green + smoke test 10/10 + Playwright e2e before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/src/plugins/menu_registry.rs` — covers REQ-43.1..43.4 (4 个测试)
- [ ] `src-tauri/src/plugins/stubs/core.rs` — covers REQ-43.7 (1 个测试 stub 自身)
- [ ] `src-tauri/src/plugins/traits.rs` — add `tray_items() / app_menu_items()` default impl + 1 test
- [ ] `src-tauri/src/plugins/host.rs` — add `all_tray_items() / all_app_menu_items()` collect helpers + 2 tests
- [ ] `scripts/lint-plugin-coupling.sh` — add rule: "lib.rs hardcodes no MenuItem::with_id" (grep)
- [ ] Smoke test (existing 10/10) — needs verification that macOS app menu still works (manual or Playwright)

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | menu 不涉及 auth |
| V3 Session Management | no | menu 不涉及 session |
| V4 Access Control | no | menu 不涉及 RBAC |
| V5 Input Validation | **yes** | `PluginTrayItem.label` / `id` 字符串来自 plugin 声明,需保证不为空 + 不超长 (防 UI overflow / log injection) |
| V6 Cryptography | no | menu 不涉及 crypto |
| V7 Error Handling | **yes** | MenuRegistry build 失败必须 log,不能 panic (会导致 app 启动闪退) |
| V9 Communication | **yes** | `SwitchView` 走 `app.emit` 跨前端边界,emit payload 是 String 走 serde 序列化;**不传任意用户输入**到 emit |

### Known Threat Patterns for Tauri v2 menu system

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plugin 注入恶意 accelerator 触发系统快捷键冲突 | Tampering | MenuRegistry 在 build_tray 时验证 `accelerator` 字符串匹配 whitelist (e.g. `"^(Cmd\|Ctrl\|Alt\|Shift)\+[A-Z0-9]+$"`);不合规 warn + 丢弃 |
| `PluginAction::Custom` 闭包内 panic 传播到 menu event handler | Denial of Service | dispatch 函数 catch_unwind 包 Custom 闭包;panic 不影响 app 主线程 |
| macOS AboutMetadata 含敏感信息泄漏 | Information Disclosure | AboutMetadata 只填 name + version + copyright + authors (来自 tauri.conf.json);**禁止**塞 git commit hash / 内部 IP 等 |
| `app.emit("frontend://switch-view", ...)` payload 注入 | Tampering | view_id 是 plugin 声明的固定 String (e.g. `"provider-list"`),非用户输入;前端在 Phase 44 用 `ViewId` union 类型 + `assertNever(view_id)` 拒绝未知 |

### PluginAction::Custom 的安全约束

`Arc<dyn Fn(&AppHandle) + Send + Sync>` 闭包从 plugin 注入,理论上是不可信代码。但因为:
1. plugin 是项目自有代码 (不是用户上传)
2. plugin 在 setup 期 init,init 阶段 Tauri 已加载所有 trusted code
3. Custom 闭包不能直接调 untrusted IPC (需要走 invoke_handler)

所以 Custom 闭包 = **trusted code in Tauri process context**。无 ASVS 风险升级。

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tauri 2.11.3 `on_menu_event` 闭包参数是 `(&AppHandle, MenuEvent)`,且 `MenuEvent.id: MenuId = MenuId(String)` | Pattern 2 / Code Examples | 如果签名变了 (e.g. 改成 `(&AppHandle, &MenuEvent)`),HashMap get 写法要调 |
| A2 | `MenuItem::with_id` 第 4 参数 `enabled: bool` 是 `pub fn(M: Manager<R>, I: Into<MenuId>, S: AsRef<str>, bool, Option<S2>)` 的位置参数 | Pattern 3 / Pitfall 4 | 如果参数顺序变了,所有 PluginTrayItem → MenuItem::with_id 调用需更新 |
| A3 | muda::MenuId 直接 `as_ref() -> &str` (muda 0.15 行为) | Code Examples | 如果 muda 改了 MenuId 内部表示,HashMap key 类型要调 |
| A4 | `Arc<HashMap<String, PluginAction>>` 是 `Send + Sync`(前提 PluginAction: Send + Sync) | Pattern 2 | PluginAction::Custom 必须 Send + Sync;Arc<dyn Fn + Send + Sync> 自动 Send + Sync;**已验证** |
| A5 | macOS app menu 必须以 Submenu 形式存在,直接 `Menu::with_items` 不行 | Pitfall 3 | Tauri 2.11.3 doc 明示 "if using Menu for the global menubar, it can only contain Submenus" |
| A6 | `PredefinedMenuItem::about` 接受 `Option<AboutMetadata>`,None 会显示空白 | Pitfall 2 | Tauri 源码显示 metadata 是 Optional;None 行为是 macOS AppKit default (空 dialog) |
| A7 | PluginContext 当前只持 `app + paths`,Phase 43 加 `host: Option<&PluginHost>` | Core Plugin Design | 如果 Phase 42 已经加了 `services: &mut ServiceRegistry`,本 phase 加 host 是叠加,无冲突 |
| A8 | lib.rs init_all 顺序执行,core 第一个 init 后,其他 plugin 的 init 已跑完 | Core Plugin Design / Init order 校正 | PluginHost::init_all 当前实现是 for-loop 顺序调,已验证 (host.rs:91-101) |
| A9 | 9 个 stub plugin 当前 tray_items() / app_menu_items() 返回 Vec::new() (默认实现),0 改动 | Pattern 1 | IPlugin 默认实现就是空 Vec,Phase 43 不需改任何 stub 文件 |
| A10 | smoke test 10/10 已经覆盖 macOS AppMenu 的"存在性"检查(非内容检查) | Phase 43 强验收 | smoke test 第 4 项 "主窗口" + 第 5 项 "WebView2 child" 在 macOS 等价是检查 NSWindow 已创建;不检查 NSMenu 内容。需要 Playwright e2e 或人工确认 NSMenu |

**If this table is empty:** 不适用,所有关键 claim 来自 Tauri 2.11.3 源码实读 + 项目代码实读,无 ASSUMED 残留。

---

## Open Questions

1. **PluginAction::Custom 的清理时机**
   - What we know: `Arc<dyn Fn>` 在 HashMap 中,HashMap 在 TrayIconBuilder on_menu_event 闭包中通过 `move` capture,闭包在 TrayIcon 生命周期内一直活着 (= app 整个生命周期)
   - What's unclear: 如果 plugin 在运行时想"卸载"自己 (M8 暂不支持,但 plugin 框架 Phase 42 已设计 shutdown),其 Custom 闭包仍被 TrayIcon 引用,无法释放
   - Recommendation: 在 plugin shutdown 时,把对应 plugin 的 Custom action 从 HashMap 中移除;MenuRegistry 暴露 `unregister_actions(plugin_id)` API (Phase 43 实现,Phase 42 后用)。**或者**接受"plugin 卸载不释放闭包" — 因为 9 个 stub 都是常驻,不卸载。**优先推荐前者**(plugin 框架自洽)。

2. **SwitchView emit 的事件名约定**
   - What we know: `app.emit("frontend://switch-view", view_id)` 需要前端监听。Phase 44 的 App.tsx 需要加 `listen("frontend://switch-view", ...)` 处理。
   - What's unclear: 用 `"frontend://..."` 这种 URI-style 命名 vs 简单 `"switch-view"`?
   - Recommendation: 用 `"frontend://switch-view"` (URI 风格),预留未来其他 frontend 命令 (如 `"frontend://open-modal"`)。**Phase 43 决定 emit 名字,Phase 44 前端监听**。

3. **tray accelerator "Cmd+Q" 跨平台**
   - What we know: Tauri accelerator 字符串在 macOS 上解析为 NSMenuItem.keyEquivalent;Windows 上解析为... 不太确定,可能不绑快捷键只显示文字
   - What's unclear: "Cmd+Q" 在 Windows 上是 no-op 还是报错?是否需要传 None 跨平台?
   - Recommendation: Phase 43 不传 accelerator (None),Phase 47 评估是否需要平台特定 accelerator (macOS 绑 Cmd+Q,Windows 绑 Ctrl+Q)。

4. **AboutMetadata 的多语言**
   - What we know: AboutMetadata 只接受 String,不接受 i18n key。中文用户在 macOS About 对话框看到中文 / 英文混合 (取决于 tauri.conf.json bundle.copyright 是中文还是英文)
   - What's unclear: 是否需要在 AboutMetadata 里塞 4 语言 (zh-CN / en / ja / ko)?
   - Recommendation: Phase 43 用 tauri.conf.json 现有 `bundle.copyright`,不增加 i18n;**Phase 47 评估**如果用户反馈需要。

5. **core-plugin 的命名**
   - What we know: `"core"` 是占位符,可能与 Tauri 内部某些命名冲突?或者是 `__core__`?
   - What's unclear: tauri-plugin-* 的命名空间 (`tauri-plugin-log`, `tauri-plugin-store`) 是否与 `"core"` 撞?
   - Recommendation: 用 `"core"` (kebab-case 简单);PluginHost::register 检查 duplicate id,如有冲突会 `Err(DuplicateId("core"))`。**潜在风险低**,因 plugin id 是项目私有。

## Environment Availability

> 本 phase 不引入新外部依赖,但依赖现有 Rust 工具链。审计:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | cargo build / test | ✓ | 1.83+ (sccache 配置要求) | — |
| tauri 2.11.3 | menu API | ✓ (Cargo.lock 锁) | 2.11.3 | 锁版本,不可降 |
| muda (Tauri 传递依赖) | MenuId / PredefinedMenuItem | ✓ | 0.15+ (随 Tauri) | — |
| macOS dev box | 验证 AppMenu | 暂无真机 (Phase 47 再问) | — | Win dev box compile-only (cross-compile OK) |
| Windows dev box | 验证 tray | ✓ (主开发平台) | Win 11 | — |

**Missing dependencies with no fallback:** 无 (muda 是 Tauri 传递依赖,锁版本即保证)

**Missing dependencies with fallback:**
- macOS 真机验证: 暂未到位,Phase 43 接受 compile-only 验证。Playwright e2e 在 mac 上跑不现实 (现有 Win 上 Playwright 11 个 view 都成功)。**Phase 47 (整合验证)** 必须 mac 真机验。

---

## Sources

### Primary (HIGH confidence)

| Source | Topics Verified |
|--------|-----------------|
| `/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/menu/menu.rs:128-147` | `Menu::with_items` / `with_id_and_items` 签名 + 异构切片 |
| `/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/menu/builders/menu.rs:212-672` | MenuBuilder / SubmenuBuilder 所有 method (about/hide/quit/...) |
| `/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/menu/mod.rs:43-155,690-718` | MenuEvent struct, IsMenuItem trait + sealed base, MenuItemKind enum |
| `/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/menu/predefined.rs:13-100` | PredefinedMenuItem 构造 (copy/cut/separator/...) |
| `/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/tray/mod.rs:241-343` | TrayIconBuilder::menu, on_menu_event 签名, show_menu_on_left_click |
| `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs:308-347` | 当前 tray 实现 (anchor for refactor) |
| `/Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs:400-417` | 当前 macOS AppMenu 实现 (anchor for refactor) |
| `/Users/coderstory/CodeSource/winui3/src-tauri/src/platform/macos/app_menu.rs` | 当前 MacAppMenu (要被删,模式参考) |
| `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/traits.rs` | IPlugin 扩展基线 |
| `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/host.rs` | PluginHost init_all 顺序保证 |
| `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-ROADMAP.md` (Phase 43 section) | 需求基线 + 强验收 |
| `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/00-PHASE-OVERVIEW.md` | 上下文依赖图 (Phase 42 先 / 43 后) |

### Secondary (MEDIUM confidence)

| Source | Topics |
|--------|--------|
| Tauri 官方 doc https://v2.tauri.app/learn/window-menu/ | MenuBuilder 模式 + on_menu_event API (curl 抓取,内容与本地源码一致) |
| Tauri 官方 doc https://v2.tauri.app/learn/system-tray/ | TrayIconBuilder + DoubleClick 处理 (curl 抓取) |
| Project CLAUDE.md §2.1 §2.2 §2.4 §3.1 §3.2 §6.4 §10 | 工程纪律约束本 phase 实施 |
| Project `.claude/CLAUDE.md` | 项目级约束 (Tauri v2 stack + smoke test 10/10) |

### Tertiary (LOW confidence)

无。所有关键 API claim 来自 HIGH confidence sources (本地 tauri 源码 + 项目代码实读)。

---

## Metadata

**Confidence breakdown:**

| Area | Confidence | Reason |
|------|-----------|--------|
| Tauri v2 menu API | HIGH | 本地 tauri-2.11.3 源码实读,所有签名 + 行为已验证 |
| PluginAction enum + dispatch 设计 | HIGH | 标准 Rust 模式 + HashMap lookup,无 Tauri 特定 |
| IPlugin 扩展 (默认空 Vec) | HIGH | 复用 Phase 42 的 `commands() / services()` 模式 |
| core-plugin 设计 | HIGH | 直接对应 Phase 43 需求 "装托盘 2 项 + macOS AppMenu 全集" |
| MenuRegistry 实现路径 | HIGH | `MenuBuilder::items` + `TrayIconBuilder::on_menu_event` 都是公开 API |
| PluginContext 扩展 (加 host) | MEDIUM | 假设 Phase 42 已扩展过 (services),叠加合理;但需验证 Phase 42 后 PluginContext 是否还有位置 |
| 双平台菜单一致性 (Win/macOS) | HIGH | Tauri 跨平台 menu 抽象;Windows 用 tray 代替 app menu 是已知决策 |
| Phase 43 工期 1-2 天 | MEDIUM | 与 v3.4 总表预估一致;但实际工作量为 11 文件改动 + 单测 + lint,可能 2-3 天 |

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (30 天,Tauri 2.x 在 v2.11 锁定,API 稳定)

---

## Phase 42 ↔ Phase 43 ↔ Phase 44 Interface Contract

为让 Phase 42 (基线) / Phase 43 (本 phase) / Phase 44 (派生) 互不踩脚,以下接口契约:

### Phase 42 → Phase 43 交接

| Item | Phase 42 提供 | Phase 43 消费 |
|------|---------------|---------------|
| `IPlugin::commands() / services()` | 默认空 Vec, plugin 扩展 | 不动,Phase 43 加 `tray_items() / app_menu_items()` 同模式 |
| `PluginContext::services` | `&mut ServiceRegistry` (Phase 42 加) | 不消费,Phase 43 加 `host: Option<&PluginHost>` 是叠加 |
| `PluginHost::iter() / all_routes() / all_services()` | 已有 (Phase 42 扩 `all_services`) | Phase 43 加 `all_tray_items() / all_app_menu_items()` 同模式 |
| `lib.rs::invoke_handler!` 改 dispatch | Phase 42 完成 | 不动 |

### Phase 43 → Phase 44 交接

| Item | Phase 43 提供 | Phase 44 消费 |
|------|---------------|---------------|
| `PluginAction::SwitchView(String)` | 走 `app.emit("frontend://switch-view", view_id)` | 前端 App.tsx 加 listen handler + setView |
| `FrontendPlugin::sidebarTile / pageMeta` | 不动 (TS 类型) | Phase 44 加 |
| `AppSidebar.tsx::VIEW_META` | 不动 (硬编码) | Phase 44 改 import 派生 |

### 灰区决策点 (待 Phase 47 收尾)

| # | 决策 | 当前 Phase 43 默认 | 何时定 |
|---|------|--------------------|---------|
| D1 | accelerator "Cmd+Q" 是否跨平台 | None (跨平台不绑) | Phase 47 评估 |
| D2 | AboutMetadata 多语言 | 用 tauri.conf.json 现有 | Phase 47 |
| D3 | PluginAction::Custom 闭包清理 | Arc 永不释放 (plugin 常驻) | Phase 47 |
| D4 | emit 事件名风格 | `"frontend://..."` URI | Phase 44 确认 |

---

*Phase 43 研究完成。下一步: gsd-discuss-phase 输出 43-DECISIONS.md (基于本研究的 Open Questions + 灰区决策点),然后 gsd-plan-phase 输出 43-PLAN.md (基于研究的标准栈 + 架构模式 + 灰区划分计划)。*
