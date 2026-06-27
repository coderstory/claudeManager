---
gsd_decisions_version: 1.0
phase: 43
decided: 2026-06-27
decided_by: discuss-phase subagent (待用户复核)
based_on: ../v3.4-DECISIONS.md (5 BLOCKING 关闭) + ./43-RESEARCH.md Open Questions
---

# Phase 43 DECISIONS

> 关闭 Phase 43 剩余 Open Questions。5 BLOCKING 见 ../v3.4-DECISIONS.md (继承 D-CC-A: PluginContext 4 字段 + &mut init).

## 已关闭决策 (继承)

- **D-CC-A**: PluginContext = `app` + `paths` + `host` + `services(&mut)`; init 签名 `fn init(&mut self, ctx: &mut PluginContext)`

## Phase 43 剩余 OQ 关闭

### Q43-1: PluginAction::Custom 清理时机
- **决策**: 暴露 `MenuRegistry::unregister_actions(plugin_id)`, plugin shutdown 时调
- **理由**: 9 stub 常驻当前不释放 OK, 但框架自洽性要求清理; hot-reload 未来需要
- **影响**: menu_registry.rs 加 unregister_actions API; PluginHost::shutdown_all 调清理

### Q43-2: SwitchView emit 事件名
- **决策**: `"frontend://switch-view"` URI 风格
- **理由**: 预留未来其他 frontend 命令; Tauri emit 命名空间与 macOS/Linux deeplink scheme 一致
- **影响**: `app.emit("frontend://switch-view", view_id.clone())`; Phase 44 App.tsx listen

### Q43-3: tray accelerator "Cmd+Q" 跨平台
- **决策**: Phase 43 全部 None, Phase 47 评估
- **理由**: Tauri accelerator 跨平台行为不一致; macOS 用户习惯 Cmd+Q 在 App submenu; Windows 托盘右键 = 菜单弹出 accelerator 加速场景少
- **影响**: core-plugin tray 2 项 accelerator = None; 文档标注 Phase 47 评估

### Q43-4: AboutMetadata 多语言
- **决策**: 用 tauri.conf.json 现有 `bundle.copyright`, Phase 47 评估 i18n
- **理由**: AboutMetadata 只接 String, 4 语言需 i18n 框架 (项目当前 0 i18n); 用户群 95% 中文
- **影响**: core-plugin::init AboutMetadata: name = package_info().name, version = package_info().version, copyright = config.bundle.copyright

### Q43-5: core-plugin 命名
- **决策**: `"core"` (kebab-case 简单)
- **理由**: Plugin id 是项目私有 namespace, 与 tauri-plugin-* npm 包不冲突; PluginHost duplicate id 启动期 fail-fast
- **影响**: `plugins/stubs/core.rs` 命名; mod.rs 第一行注册

## 推迟到 Phase 47

- **tray accelerator 跨平台策略**: Phase 47 评估 macOS Cmd+Shift+0 / Windows Ctrl+Shift+0
- **AboutMetadata i18n**: Phase 47 评估 i18n 框架引入
- **PluginAction::Custom 动态清理**: Phase 43 暴露 API 但 stub 不调, Phase 47 整合期评估 hot-reload

## PLAN 阶段必须实现的接口约束

### 1. IPlugin trait 扩展 (Phase 43 增量)

```rust
pub trait IPlugin: Send + Sync {
    // ... Phase 42 fields ...
    fn tray_items(&self) -> Vec<PluginTrayItem> { vec![] }       // NEW
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> { vec![] }  // NEW (macOS only)
}
```

### 2. PluginContext 4 字段 (D-CC-A)

```rust
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub host: Option<&'a PluginHost>,              // Phase 43 加
    pub services: Option<&'a mut ServiceRegistry>,  // Phase 42 占位
}
```

### 3. PluginAction enum (4 变体)

```rust
#[derive(Clone)]
pub enum PluginAction {
    ShowMainWindow,                              // window.show() + set_focus() + unminimize()
    Quit,                                         // app.exit(0)
    SwitchView(String),                           // app.emit("frontend://switch-view", view_id)
    Custom(Arc<dyn Fn(&AppHandle) + Send + Sync>), // plugin 自由扩展
}
impl PluginAction {
    pub fn dispatch(&self, app: &AppHandle);
}
```

### 4. MenuRegistry 模块 API

```rust
// plugins/menu_registry.rs (NEW)
pub fn build_tray(host: &PluginHost, app: &AppHandle)
    -> tauri::Result<(Menu<tauri::Wry>, Arc<HashMap<String, PluginAction>>)>;
#[cfg(target_os = "macos")]
pub fn build_app_menu(host: &PluginHost, app: &AppHandle) -> tauri::Result<()>;
#[cfg(not(target_os = "macos"))]
pub fn build_app_menu(_host: &PluginHost, _app: &AppHandle) -> tauri::Result<()>;  // no-op
pub fn unregister_actions(actions: &mut HashMap<String, PluginAction>, plugin_id: &str);
```

### 5. core-plugin 责任

```rust
// plugins/stubs/core.rs (NEW)
pub struct CorePlugin;
impl IPlugin for CorePlugin {
    fn id(&self) -> &'static str { "core" }
    fn routes(&self) -> Vec<PluginRoute> { vec![] }
    fn tray_items(&self) -> Vec<PluginTrayItem> { vec![show_main_window, quit] }
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> { vec![/* App/Edit/View/Window 4 submenu, ~18 Predefined */] }
    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        // 1) build_tray (always)
        // 2) build_app_menu (cfg macOS)
    }
}
```

### 6. 删 `platform/{macos,windows}/app_menu.rs` (反向)

- IPlatformAppMenu trait + MacAppMenu/WindowsAppMenu impl + platform::runtime::app_menu() factory 全部删
- platform/traits.rs 删 `app_menu_build_dispatch` 测试
- platform/ 保留 7 个 OS 差异 trait (paths / single_instance / autostart / reveal / notifier / window_chrome / git_host)

### 7. lib.rs::setup 改造

```rust
// 删 lib.rs:308-329 (tray 手写)
// 删 lib.rs:400-417 (macOS AppMenu cfg block)
// 改 lib.rs::setup 调 host.init_all(&mut ctx) (init_all 内部 core-plugin::init 调 MenuRegistry)
```

**lib.rs 0 行 `MenuItem::with_id` / `on_menu_event` (强验收)**

### 8. Windows 平台双层 cfg 保险

- core-plugin::init 内 macOS AppMenu 调用 cfg 隔离
- build_app_menu 函数 cfg 隔离 non-mac 返回 Ok(())
- 两层 cfg 避免 Windows 误走 macOS 路径

## 强验收 (Phase 47 验证)

- lib.rs 0 行 MenuItem::with_id / on_menu_event (grep lint)
- platform/macos/app_menu.rs + platform/windows/app_menu.rs 不存在 (test -f)
- 9 业务 stub tray_items/app_menu_items 默认空 vec, 0 改动
- core-plugin 注册在 plugins/mod.rs 第一行
- macOS 真机验证 App 菜单 4 submenu (Phase 47 整合)
