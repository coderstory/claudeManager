// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager, RunEvent};
use std::path::PathBuf;
use std::sync::Mutex;

pub mod app_state;
pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod platform;
pub mod plugins;
pub mod services;

use crate::app_state::AppState;
use crate::plugins::{init_all_topological, PluginHost};

/// F20 — 从启动 argv 中提取 `.sql` 文件绝对路径。
///
/// 双击 .sql 文件时,OS 会以 `[exe, "/path/to/file.sql"]` 形式启动应用
/// (Windows / macOS 行为一致)。single-instance callback 和 setup 冷启动
/// 都需要这段逻辑,所以抽成纯函数便于复用 + 单测。
///
/// 规则:
///   - 跳过 argv[0](exe 自身路径)
///   - 取第一个扩展名为 `.sql`(大小写不敏感)的项
///   - 必须是绝对路径(双击启动 OS 传绝对路径;相对路径忽略,防误触发)
///   - 不含 `..` 组件(防目录穿越)
///
/// 返回 `Some(path)` 或 `None`(argv 里没有合法 .sql)。
fn extract_sql_file_path(argv: &[String]) -> Option<String> {
    for arg in argv.iter().skip(1) {
        let path = PathBuf::from(arg);
        // 必须是绝对路径(双击启动 OS 传绝对路径)
        if !path.is_absolute() {
            continue;
        }
        // 拒绝含 `..` 的路径(安全策略)
        if path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            continue;
        }
        // 扩展名必须是 .sql(大小写不敏感)
        if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("sql"))
            .unwrap_or(false)
        {
            return Some(arg.clone());
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        // M1.6 — Tauri 官方 plugin 注册（顺序按白名单表）
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // F20 单实例锁：第二实例启动时聚焦已有主窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            // M2.3 — F4 deeplink 单实例 argv 转发:扫 argv 找
            // ccswitch:// 开头的项,emit 'deep-link://new-url' 事件
            // (与 deep-link plugin 的 on_open_url 一致),让前端复用
            // 同一份 deeplink 处理逻辑。
            for arg in argv.iter().skip(1) {
                if arg.starts_with("ccswitch://") {
                    let _ = app.emit("deep-link://new-url", vec![arg.clone()]);
                }
            }
            // F20 — .sql 文件关联单实例转发:第二实例(双击 .sql 触发)
            // 把 .sql 绝对路径 emit 给已运行实例的前端,前端收到后跳
            // import-sql 页 + 自动加载该文件。
            if let Some(sql_path) = extract_sql_file_path(&argv) {
                let _ = app.emit("import-sql-file", sql_path);
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_process::init())
        // Phase 42 — IPC dispatch now flows through the plugin system's
        // inventory::submit! + DispatchTable. The 80 `#[tauri::command]`
        // entries in `commands/*.rs` are still compiled (stubs call them
        // and they remain for tests), but the live frontend invoke
        // route goes through each plugin's `dispatch_*` shim registered
        // by `inventory::submit!(CommandSpec { ... })`.
        .invoke_handler(
            plugins::dispatch::make_invoke_handler(
                plugins::dispatch::DispatchTable::from_inventory(),
            ),
        )
        .setup(|app| {
            // Initialise the platform abstraction layer (picks Windows or
            // macOS impls based on target_os). Must run before any
            // service / plugin that reads `IPlatformPaths` / autostart / etc.
            platform::init_for_runtime();

            // Build shared app state (resolved paths + services) and
            // register it with Tauri's state manager. All commands
            // pull from this — see commands::providers.
            //
            // M2.2.3 fix: do NOT wrap `state` in `Arc::new(...)` —
            // the 4 F1/F2/F3 commands extract `State<'_, AppState>`,
            // and Tauri indexes managed state by `std::any::TypeId`.
            // Wrapping in `Arc<AppState>` would store TypeId
            // `Arc<AppState>` but the commands look up TypeId
            // `AppState`, so every IPC call would fail with
            // "state not managed for field '0' on command ...".
            // The bug shipped in M2.1 + M2.2; this commit fixes it.
            let state = AppState::build();
            app.manage(state);

            // M2.17 — wire the plugin stubs into the running app.
            //
            // Phase 45 — service plugins (history / backup / provider
            // / usage / mcp / optimizer / resource / marketplace /
            // project) participate in topological init via
            // `depends_on()`. The 9 service plugins run first so the
            // `Arc<ServiceRegistry>` is fully populated before any
            // business plugin's `init` (which may pull a service).
            //
            // Why `Mutex<PluginHost>` (vs. plain `PluginHost`):
            // - Tauri's `State<T>` derefs to `&T`; we cannot `&mut` a
            //   managed value from the run-event callback. `Mutex` gives
            //   us `&mut` interior mutability for `shutdown_all`.
            // - The host is constructed once in `setup` and only
            //   mutated on app exit — no contention in practice.
            //
            // `PluginContext` holds `&AppHandle` for plugins that need to
            // register Tauri commands / events during `init`. None of the
            // M2.17 stubs use it (they're no-op), but the type is wired
            // correctly for future plugins.
            // `platform::runtime::paths()` returns an owned `Box<dyn
            // IPlatformPaths>`; bind it to a let so the borrow inside
            // `PluginContext::new` outlives the call.
            //
            // Phase 45 startup order (D-45-DECISIONS §6, 45-PLAN.md
            // §5.5):
            //
            // 1. `AppState::build()` constructs an empty
            //    `Arc<ServiceRegistry>` (refcount=1).
            // 2. Register 9 service plugins + 13 business plugins on
            //    the host (no init yet — just id bookkeeping).
            // 3. Build the `PluginContext` with a `&mut ServiceRegistry`
            //    tied to `state.service_registry`. Since refcount=1,
            //    `&mut` is uncontested.
            // 4. `init_all_topological` walks the dependency DAG,
            //    resolves init order, and runs each plugin's `init`.
            //    Service plugins `register_arc` themselves; business
            //    plugins may `get_service!(ctx.services, SvcType)` if
            //    they need a service at init time (none today).
            // 5. AFTER init completes, `app.manage(state)` bumps
            //    refcount to 2 (Tauri also holds). From this point
            //    commands can pull `State<'_, AppState>` and look
            //    services up via `crate::get_service!`.
            let paths_impl = platform::runtime::paths();
            let mut state = AppState::build();
            let host = init_all_topological(app.app_handle(), &*paths_impl, &mut state)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            app.manage(state);
            app.manage(Mutex::new(host));

            // M2.3 — F4 deeplink plugin 事件桥接
            //
            // 监听 tauri-plugin-deep-link 的 on_open_url 事件(OS 把
            // ccswitch://... 推给 app 时触发,主要场景 = 用户点链接时
            // 进程已经在跑 / 浏览器唤起 / macOS AppleEvent),把 URL
            // 列表转成 Vec<String> 后 emit 'deep-link://new-url',
            // 跟 single_instance handler 的 argv 转发走同一条事件。
            // 前端只听一个事件名,无需区分来源。
            use tauri_plugin_deep_link::DeepLinkExt;
            let handle_for_dl = app.app_handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event.urls().into_iter().map(|u| u.to_string()).collect();
                if !urls.is_empty() {
                    let _ = handle_for_dl.emit("deep-link://new-url", urls);
                }
            });

            // M2.3 — handle_cli_arguments:冷启动时如果 argv 里就有
            // ccswitch://...,plugin 把它存到内部 state,on_open_url
            // 不会自动 fire。这里手动 forward 到 frontend。
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if !urls.is_empty() {
                    let strs: Vec<String> = urls.into_iter().map(|u| u.to_string()).collect();
                    let _ = app.emit("deep-link://new-url", strs);
                }
            }
            // 兜底:有些平台/打包下 plugin 不自动 handle,再扫一次
            // argv。跟 single_instance 的 fallback 一样,只对
            // ccswitch:// 开头感兴趣。
            for arg in std::env::args().skip(1) {
                if arg.starts_with("ccswitch://") {
                    let _ = app.emit("deep-link://new-url", vec![arg]);
                }
            }

            // M2.16 — F20 冷启动 .sql 文件关联转发。
            //
            // 双击 .sql 启动应用时(进程未在跑),single-instance callback
            // 不会触发(那是给第二实例用的),所以这里也扫一次 argv。
            //
            // 历史版本在这里直接 emit 'import-sql-file',但 setup 阶段
            // webview 还没挂载、前端 listener 还没注册,broadcast 不缓存
            // 给晚注册的 listener —— 双击 .sql 冷启动时事件丢失,前端
            // 永远收不到。修复:把路径缓存到 AppState.pending_sql_file,
            // 前端 App.tsx mount 后调 `take_pending_sql_file` 主动拉。
            // (single_instance callback 已经在进程跑起来后才触发,emit
            // 仍然有效 —— 那里保留 emit 行为不变。)
            let cold_argv: Vec<String> = std::env::args().collect();
            if let Some(sql_path) = extract_sql_file_path(&cold_argv) {
                if let Some(state) = app.try_state::<crate::app_state::AppState>() {
                    if let Ok(mut guard) = state.pending_sql_file.lock() {
                        *guard = Some(sql_path);
                    }
                }
            }

            // M8 (Phase 43) — system tray + macOS AppMenu 全由 `core` plugin
            // 的 init() 接管 (调 MenuRegistry::build_tray /
            // build_app_menu / install_tray)。core 在 plugins::init_all
            // 里第一行注册并第一个跑 init,本 setup 块不再硬编码
            // MenuItem::with_id / SubmenuBuilder / on_menu_event。
            // TrayIcon 的 DoubleClick 事件也由 core plugin 处理。
            //
            // 旧手写块 (lib.rs:225-303, 含 tray + macOS AppMenu) 已
            // 在本 phase 删除;详见 .planning/milestones/v3.4-phases/
            // 43-PLAN.md §3 Task 6。

            // Minimize-to-tray: intercept close
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });

                // (M2.16-M4.8 vibrancy / Mica / HudWindow 调用块已删 —
                //  4 轮失败后用户决定"纯 CSS 模拟"方案, 启动期不再调任何
                //  OS 原生 backdrop API。M2.16 era 200ms spawn 块 + M4.6
                //  IPlatformWindowChrome dispatch + M4.7 main-thread
                //  variant + M4.8 platform trait 调用全部清空。
                //  主题 glass 效果由 tokens.css / base.css CSS token
                //  + 组件 backdrop-filter 保留 (M2.16 视觉保留, 调用
                //  路径移除)。)
            }

            // macOS AppMenu 安装已迁移到 core plugin (Phase 43)。
            // 见 plugins::stubs::core + plugins::menu_registry::build_app_menu。

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // M2.17 — call `shutdown_all` on the PluginHost when the
            // app is exiting. Stubs are no-op today, but the wiring
            // path is now real: future plugins that allocate in
            // `init` can release in `shutdown`.
            //
            // `RunEvent::Exit` fires after `ExitRequested` (when not
            // prevented). Tauri's `State` API exposes only `&T`, so we
            // hold the host behind `Mutex` and lock here. A poisoned
            // mutex (a panic inside `shutdown_all`) is intentionally
            // ignored — the process is exiting anyway, the next step
            // is OS cleanup.
            if matches!(event, RunEvent::Exit) {
                if let Some(state) = app_handle.try_state::<Mutex<PluginHost>>() {
                    if let Ok(mut host) = state.lock() {
                        if let Err(e) = host.shutdown_all() {
                            log::error!("[M2.17] PluginHost shutdown_all failed: {e}");
                        }
                    }
                }
            }
        });
}

// ---------------------------------------------------------------------------
// F20 单元测试 — extract_sql_file_path 纯函数
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_sql_from_absolute_path() {
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "C:\\Users\\test\\dump.sql".to_string(),
        ];
        assert_eq!(
            extract_sql_file_path(&argv),
            Some("C:\\Users\\test\\dump.sql".to_string())
        );
    }

    #[test]
    fn extracts_sql_from_posix_absolute_path() {
        let argv = vec![
            "claude-config-manager".to_string(),
            "/home/test/dump.sql".to_string(),
        ];
        assert_eq!(
            extract_sql_file_path(&argv),
            Some("/home/test/dump.sql".to_string())
        );
    }

    #[test]
    fn returns_none_when_no_sql_in_argv() {
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "C:\\Users\\test\\config.json".to_string(),
        ];
        assert_eq!(extract_sql_file_path(&argv), None);
    }

    #[test]
    fn returns_none_for_relative_sql_path() {
        // 相对路径忽略(双击启动 OS 传绝对路径,防误触发)
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "dump.sql".to_string(),
        ];
        assert_eq!(extract_sql_file_path(&argv), None);
    }

    #[test]
    fn returns_none_for_parent_dir_traversal() {
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "C:\\Users\\test\\..\\..\\etc\\passwd.sql".to_string(),
        ];
        assert_eq!(extract_sql_file_path(&argv), None);
    }

    #[test]
    fn case_insensitive_sql_extension() {
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "C:\\Users\\test\\DUMP.SQL".to_string(),
        ];
        assert_eq!(
            extract_sql_file_path(&argv),
            Some("C:\\Users\\test\\DUMP.SQL".to_string())
        );
    }

    #[test]
    fn skips_non_sql_args_finds_sql() {
        // argv 里混了 ccswitch:// deeplink + --minimized flag + .sql,
        // 应跳过非 .sql 项,返回 .sql 路径。
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "--minimized".to_string(),
            "ccswitch://v1/import?resource=provider".to_string(),
            "C:\\Users\\test\\providers.sql".to_string(),
        ];
        assert_eq!(
            extract_sql_file_path(&argv),
            Some("C:\\Users\\test\\providers.sql".to_string())
        );
    }

    #[test]
    fn returns_first_sql_when_multiple() {
        // 多个 .sql 时取第一个(与 SPEC F20 "双击单个 .sql" 场景一致,
        // 多个 .sql 极少见,取第一个足够)。
        let argv = vec![
            "claude-config-manager.exe".to_string(),
            "C:\\a.sql".to_string(),
            "C:\\b.sql".to_string(),
        ];
        assert_eq!(extract_sql_file_path(&argv), Some("C:\\a.sql".to_string()));
    }

    #[test]
    fn empty_argv_returns_none() {
        let argv: Vec<String> = vec!["claude-config-manager.exe".to_string()];
        assert_eq!(extract_sql_file_path(&argv), None);
    }
}
