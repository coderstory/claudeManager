// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

pub mod app_state;
pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod platform;
pub mod plugins;
pub mod services;

use crate::app_state::AppState;

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
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::autostart::get_autostart_status,
            commands::autostart::set_autostart_enabled,
            commands::providers::list_providers,
            commands::providers::list_providers_with_warnings,
            commands::providers::switch_provider,
            commands::providers::parse_sql_preview,
            commands::providers::import_providers_from_sql,
            commands::providers::parse_deeplink_url,
            commands::providers::import_single_provider,
            commands::fs::read_file,
            commands::fs::write_file_atomic,
            commands::mcp::list_mcp_servers,
            commands::mcp::list_mcp_servers_with_warnings,
            commands::mcp::toggle_mcp_server,
            commands::mcp::add_mcp_server,
            commands::mcp::update_mcp_server,
            commands::mcp::remove_mcp_server,
            commands::mcp::parse_mcp_deeplink,
        ])
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

            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Claude 配置管理器")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Minimize-to-tray: intercept close
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
