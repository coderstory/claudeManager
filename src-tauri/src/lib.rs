// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use std::path::PathBuf;

pub mod app_state;
pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod platform;
pub mod plugins;
pub mod services;

use crate::app_state::AppState;

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
            // M2.16 — F14 导出单 provider（Rust 侧弹保存框 + 原子写盘）
            commands::providers::export_provider,
            commands::fs::read_file,
            commands::fs::write_file_atomic,
            // F20 — 读取任意路径 .sql 文件(文件关联双击导入用)
            commands::fs::read_sql_file,
            commands::mcp::list_mcp_servers,
            commands::mcp::list_mcp_servers_with_warnings,
            commands::mcp::toggle_mcp_server,
            commands::mcp::add_mcp_server,
            commands::mcp::update_mcp_server,
            commands::mcp::remove_mcp_server,
            commands::mcp::parse_mcp_deeplink,
            commands::backup::list_backups,
            commands::backup::read_backup_content,
            commands::backup::diff_backups,
            commands::backup::restore_backup,
            commands::backup::backup_now,
            commands::usage::get_current_usage,
            commands::usage::refresh_usage,
            commands::app::get_app_metadata,
            commands::optimizer::scan_optimizations,
            commands::optimizer::apply_optimizations,
            // M2.16 — F23 优化建议导出 markdown（Rust 侧生成 + 弹保存框 + 原子写盘）
            commands::optimizer::export_optimization_report,
            // M2.13 — F16 资源浏览
            commands::resource::list_resources,
            commands::resource::reveal_in_file_manager,
            // M2.16 — F22 资源详情(manifest 描述 + 文件列表)
            commands::resource::get_resource_detail,
            // M2.16 — F17 在线安装（资源市场 + git URL → clone → 扫描 → 安装）
            commands::marketplace::list_marketplace_repos,
            commands::marketplace::clone_and_scan,
            commands::marketplace::install_from_marketplace,
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

            // F20 — 冷启动 .sql 文件关联转发。
            //
            // 双击 .sql 启动应用时(进程未在跑),single-instance callback
            // 不会触发(那是给第二实例用的),所以这里也扫一次 argv。
            // 如果有 .sql 路径,emit 'import-sql-file' 给前端,前端收到后
            // 跳 import-sql 页 + 自动加载该文件。
            let cold_argv: Vec<String> = std::env::args().collect();
            if let Some(sql_path) = extract_sql_file_path(&cold_argv) {
                let _ = app.emit("import-sql-file", sql_path);
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

                // M2.16 — 原生窗口 backdrop（Win11 Mica / macOS vibrancy）。
                //
                // Tauri JS setEffects(Effect.Mica)（src/design-system/applyEffects.ts）
                // 在 decorations:false 无边框窗口上不稳定：tao#72 记录了 DWM 合成
                // 路径与无边框窗口的冲突，setEffects 走 tao 的 window effects API，
                // 对无边框 HWND 不应用 Mica backdrop。用户报告三套主题真机全白底。
                //
                // window-vibrancy::apply_mica 直接对 HWND 调
                // DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE = Mica)，绕过 tao
                // 装饰状态判断，对无边框窗口也生效。这是 Tauri 团队官方维护的底层
                // backdrop 库（https://github.com/tauri-apps/window-vibrancy）。
                //
                // 失败不阻断启动（Win10 / 旧 build 22000- 不支持 Mica → 返回 Err，
                // 此时退回 CSS backdrop-filter fallback）。
                //
                // macOS 侧 apply_vibrancy + NSVisualEffectMaterial::Sidebar 对应
                // 原 applyEffects.ts 的 Effect.Sidebar。macOSPrivateApi:true +
                // tauri macos-private-api feature 已在 tauri.conf.json / Cargo.toml
                // 启用（macOS vibrancy + transparent:true 必需）。
                #[cfg(target_os = "windows")]
                {
                    if let Err(e) = window_vibrancy::apply_mica(&window, None) {
                        eprintln!("[M2.16] apply_mica failed (Mica will not show): {e}");
                    }
                }
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                    if let Err(e) = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    ) {
                        eprintln!("[M2.16] apply_vibrancy failed (vibrancy will not show): {e}");
                    }
                }
            }

            // M2.16 — macOS 标准应用菜单（App / Edit / View / Window）。
            //
            // macOS 应用规范要求顶部菜单栏有标准应用菜单（About / Hide /
            // Quit Cmd+Q 等），否则用户体验残缺（P2 审查项）。通过
            // `IPlatformAppMenu` 抽象走 Tauri v2 menu API——macOS 上自动
            // 渲染为 NSMenu，Windows 上 `runtime::app_menu` 返回
            // NotSupported 不走此分支（cfg 保证）。
            //
            // 菜单项全用 PredefinedMenuItem，macOS 自动绑定标准快捷键与
            // 系统行为（Cmd+Q 退出 / Cmd+H 隐藏 / Cmd+M 最小化 / WKWebView
            // 编辑操作），无需 on_menu_event handler。
            #[cfg(target_os = "macos")]
            {
                let menu = platform::runtime::app_menu(app.app_handle());
                if let Err(e) = menu.build_app_menu() {
                    eprintln!("[M2.16] install mac app menu failed: {e}");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
