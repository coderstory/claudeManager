// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent,
};
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
use crate::plugins::{init_all, PluginContext, PluginHost};

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
            // 2026-06-24 — Provider 列表"从当前配置生成"按钮 (b6aa402)
            commands::providers::read_current_claude_config,
            commands::providers::generate_from_current_config,
            commands::fs::read_file,
            commands::fs::write_file_atomic,
            // F20 — 读取任意路径 .sql 文件(文件关联双击导入用)
            commands::fs::read_sql_file,
            // M2.16 — F20 冷启动 .sql 路径取走(setup 阶段 webview 未挂,
            // emit 会丢,改用 state 缓存 + 前端 mount 后主动拉取)。
            commands::fs::take_pending_sql_file,
            // M3.11 (A4#12) — F5 JSON 编辑器文件目录树(白名单扫描
            // ~/.claude/ + active project 的 .claude/)。
            commands::fs::list_editable_jsons,
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
            commands::backup::backup_incremental,
            // M4.6.13 — delete single backup (trash + rm, allow-list checked)
            commands::backup::delete_backup,
            commands::usage::get_current_usage,
            commands::usage::refresh_usage,
            // M3.8 — usage history (per-day per-model) for chart
            commands::usage::get_usage_history,
            commands::app::get_app_metadata,
            // M3.7 — 清单 18: 关于页 command(about.rs 复用 app::AppMetadata)。
            commands::about::get_app_info,
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
            // M3.4 — 三类 install 语义统一（清单 11/12/13/14）
            commands::marketplace::install_builtin_plugin,
            commands::marketplace::install_third_party_repo,
            commands::marketplace::install_npx_package,
            // M3.10 (清单 23) — 双模式 (用户/项目) 项目管理 commands
            commands::project::list_projects,
            commands::project::add_project,
            commands::project::remove_project,
            commands::project::switch_project,
            commands::project::current_project,
            // M3.13.4 — 新建项目 picker + 路径合法性校验（后端全权弹
            // dialog + 校验,前端不直接调 tauri-plugin-dialog 的 JS wrapper,
            // 见 commands::project 的注释）
            commands::project::pick_project_root_dir,
            commands::project::validate_project_path,
            // M4.3 — updater commands (pubkey + endpoint config + check stub).
            commands::updater::get_updater_pubkey,
            commands::updater::get_updater_endpoints,
            commands::updater::check_update,
            // M4.6 / Phase 21 — history page commands (Plan B).
            commands::history::get_usage_history_rows,
            commands::history::get_backup_history,
            commands::history::get_history_stats,
            commands::history::export_history,
            commands::history::purge_history,
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

            // M2.17 — wire the 12 plugin stubs into the running app.
            //
            // M1.3 created `plugins::init_all` (registers the 12 stubs and
            // runs their `init`) but never wired it from `lib.rs::run`. As
            // a result the PluginHost existed only on paper: it was never
            // constructed at runtime, the `init` hooks never fired, and
            // `shutdown_all` was never reachable. M2.x business logic
            // (F1~F24) lives in `services/` + `commands/`, not in plugin
            // `init` hooks, so this is purely the "let the architecture
            // match the spec" step — no business behaviour changes.
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
            let paths_impl = platform::runtime::paths();
            let plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl);
            let host = init_all(&plugin_ctx)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
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

            // M3.2 polish — left-double-click on tray icon restores
            // the main window. We hook the icon's click handler via
            // a TrayIconEvent listener (Tauri v2 doesn't expose
            // `on_double_click` as a builder method; instead we
            // listen for `DoubleClick` events on the tray).
            let tray_handle = app.tray_by_id("main-tray");
            if let Some(t) = tray_handle {
                t.on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                });
            }

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
                // 真根因（M2.16 深度诊断实测确认）：
                //   Tauri v2 `transparent: true` 只让 tao 窗口层透明，**不自动**
                //   设 WebView2 的 DefaultBackgroundColor 为透明。WebView2 默认
                //   不透明白底（#FFFFFF），盖住窗口层 Mica backdrop → 三套主题
                //   真机全白底。
                //
                //   原生 DWM 查询证据（dwm-mica-query.ps1）：
                //     - DWMWA_SYSTEMBACKDROP_TYPE = 2 (Mica) ← Mica 属性确实设上了
                //     - DwmIsCompositionEnabled = True
                //     - 子窗口链: WRY_WEBVIEW → Chrome_WidgetWin_1(noredirbitmap=True)
                //       → Intermediate D3D Window(layered+True) ← WebView2 D3D surface
                //   像素采样证据（dwm-pixel-sample.ps1）：窗口内容区大面积 #FFFFFF，
                //     而窗口外桌面壁纸 #F7F8F8 —— 窗口内纯白，没透出壁纸。
                //
                // 修复（Tauri v2 官方 API，文档 docs.rs/tauri/2.11.3）：
                //   WebviewWindow::set_background_color(Some(Color { a: 0 }))。
                //   Windows 平台特定："if the alpha channel is not 0, it will be
                //   ignored" —— alpha=0 是唯一让 webview 透明的方式。
                //   webview 透明后，窗口层 Mica backdrop 才能透过 webview 显示。
                //
                // M4.6 — 架构统一：窗口层 backdrop 通过 IPlatformWindowChrome trait
                // 派发（不再直接调 window-vibrancy）。macOS 侧通过 MacWindowChrome
                // 工厂传入 WebviewWindow 句柄，Windows 侧通过 WindowsWindowChrome
                // 内部分辨 HWND。
                //
                // 日志：用 log::error! 而非 eprintln!。release exe 用
                // windows_subsystem="windows" 无 stderr，eprintln 静默失败；
                // tauri-plugin-log 捕获 log facade，写入日志文件可查。
                //
                // M2.16 — macOS 侧 apply_vibrancy + NSVisualEffectMaterial::Sidebar
                // 对应原 applyEffects.ts 的 Effect.Sidebar。macOSPrivateApi:true +
                // tauri macos-private-api feature 已在 tauri.conf.json / Cargo.toml
                // 启用（macOS vibrancy + transparent:true 必需）。
                // H5: 同步调用可能因为 NSWindow/HWND 未完全 realized 而失败
                // (macOS 真机未验证,Win11 已验证)。改为 spawn 出去 +
                // 加 200ms 缓冲,让 webview 完全初始化后再 apply。失败
                // 不阻断启动,跟同步路径行为一致。
                let window_for_effect = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(200));

                    // 第一步：设 WebView2 背景透明（让 Mica 透出来）。
                    // 这一步是关键修复 —— 不调它，webview 白底盖住一切。
                    // Color(r, g, b, a) 是 tuple struct；a=0 在 Windows 8+ 是唯一
                    // 透明方式（alpha!=0 被强制 255，见 Tauri 文档）。
                    use tauri::webview::Color;
                    if let Err(e) = window_for_effect.set_background_color(Some(Color(0, 0, 0, 0))) {
                        log::error!("[M2.16] set_background_color(a=0) failed (webview will stay opaque, Mica won't show through): {e}");
                    }

                    // 第二步：窗口层 backdrop — 通过 IPlatformWindowChrome trait
                    // 统一派发（M4.6 架构统一，消除 §3.2 违规）。
                    //
                    // M2.16 决定性验证（纯红壁纸 + CDP captureScreenshot + CopyFromScreen
                    // 像素采样）结论：apply_mica / apply_acrylic 在 Tauri v2
                    // transparent:true + decorations:false 下无视觉效果。
                    // 方案 C（诚实 CSS 模拟）：tokens.css glass-clear/glass-tinted
                    // 用 backdrop-filter 模拟磨砂瓷白，不依赖 OS Mica 透壁纸。
                    // macOS vibrancy 路径在真机上独立有效。
                    //
                    // 此处通过 trait dispatch 触发——Windows 侧由 DWM 属性处理，
                    // macOS 侧调用 apply_vibrancy（在 MacWindowChrome 内部）。
                    // 调用失败不阻断启动，跟旧路径行为一致。
                    {
                        let opts = crate::platform::WindowChromeOptions {
                            vibrancy: true,
                            mica: true,
                            title_bar_style: crate::platform::TitleBarStyle::Transparent,
                        };
                        let chrome = crate::platform::runtime::window_chrome(&window_for_effect);
                        if let Err(e) = chrome.apply(&opts) {
                            log::warn!("[M4.6] window_chrome.apply failed: {e}");
                        }
                    }
                });
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
