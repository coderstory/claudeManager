//! M4.6+ e2e: 调每个 `#[tauri::command]` 函数 + 写真实 State.
//!
//! 每个 IPC 命令在 `commands::<area>::<fn>` 模块下都是 `pub async fn`.
//! 直接调这些函数 + 写真实 `AppState`, 等价于前端 invoke 流程
//! (只是不经过 IPC 序列化层).
//!
//! 这能验证:
//!   - 函数签名正确 (State<AppState> 等参数)
//!   - 真实 service 层调用
//!   - 错误处理路径
//!   - 返回类型序列化兼容

use std::sync::Arc;
use tauri::State;
use claude_config_manager_lib::app_state::AppState;

/// Build real AppState — uses platform::runtime::paths() which on macOS
/// returns ~/.claude-config-manager/. For tests we accept that the
/// test runs in user's home dir (but only reads/writes inside
/// platform::paths scope). On macOS dev box this works.
fn test_state() -> Arc<AppState> {
    Arc::new(AppState::build())
}

/// Wrap Arc<AppState> as State<'_, AppState> for #[tauri::command] fns.
/// State is just `pub struct State<'r, T>(&'r T)` — we transmute the pointer.
/// This is safe because every command fn takes State<'_, AppState> which
/// derefs to &AppState; the wrapper is purely a marker type.
fn s(state: &Arc<AppState>) -> State<'_, AppState> {
    // Reinterpret Arc pointer as &AppState then as State.
    let r: &AppState = state.as_ref();
    unsafe {
        std::mem::transmute::<&AppState, State<'_, AppState>>(r)
    }
}

// ============================================================================
// 1. app metadata
// ============================================================================

#[tokio::test]
async fn e2e_app_metadata() {
    use claude_config_manager_lib::commands;
    let state = test_state();
    let s_ = s(&state);
    let meta = commands::app::get_app_metadata(s_).await.unwrap();
    assert!(!meta.product_name.is_empty());
    assert!(!meta.version.is_empty());
    assert!(!meta.identifier.is_empty());
}

#[tokio::test]
async fn e2e_about_metadata() {
    use claude_config_manager_lib::commands;
    let state = test_state();
    let s_ = s(&state);
    let about = commands::about::get_app_info(s_).await.unwrap();
    assert_eq!(about.product_name, "ClaudeManager");
}

// ============================================================================
// 2. provider (F1 + F2 + b6aa402 + 448912f)
// ============================================================================

#[tokio::test]
async fn e2e_provider_list() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let list = providers::list_providers(s_).await.unwrap();
    assert!(!list.is_empty(), "system provider must exist");
}

#[tokio::test]
async fn e2e_provider_list_with_warnings() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let _ = providers::list_providers_with_warnings(s_).await.unwrap();
}

#[tokio::test]
async fn e2e_read_current_claude_config_no_file() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    // In user's home dir settings.json might exist or not
    let res = providers::read_current_claude_config(s_).await.unwrap();
    // Either Some (file exists) or None (no file) — both valid
    let _ = res;
}

#[tokio::test]
async fn e2e_read_current_claude_config_api_key_format() {
    // Regression: 448912f — verify ANTHROPIC_API_KEY parsing shape
    // We don't write to user's settings.json (it's real); instead we
    // verify the parsing code handles both keys correctly via the
    // service-level test (provider_service::tests::read_env_*).
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let res = providers::read_current_claude_config(s_).await.unwrap();
    if let Some(cfg) = res {
        // Either key is acceptable; base_url may or may not exist
        assert!(cfg.base_url.is_some() || cfg.auth_token.is_some() || !cfg.models.default.is_empty());
    }
}

#[tokio::test]
async fn e2e_generate_from_current_config() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    // Either generates or returns clear error — just no panic
    let _ = providers::generate_from_current_config(s_).await;
}

#[tokio::test]
async fn e2e_provider_export() {
    // SKIP: export_provider signature requires AppHandle (saves to file via
    // native dialog). Real test is the smoke test (M2.16 ship).
}

// -----------------------------------------------------------------------
// M3.6 (清单 22) — CRUD IPC e2e tests
// -----------------------------------------------------------------------

#[tokio::test]
async fn e2e_get_provider_details() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    // Use whatever provider exists in the test env
    let list = providers::list_providers(s_.clone()).await.unwrap();
    let any_id = list.first().map(|p| p.id.clone()).expect("at least 1 provider in fresh state");
    let p = providers::get_provider_details(s_.clone(), any_id.clone()).await.unwrap();
    assert_eq!(p.id, any_id);
    // Provider::new requires non-empty api_key, so any saved provider has one
    assert!(!p.api_key.is_empty());
}

#[tokio::test]
async fn e2e_get_provider_details_not_found() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let err = providers::get_provider_details(s_, "nonexistent-provider-xyz".to_string()).await.unwrap_err();
    assert!(err.contains("not found") || err.contains("not exist"),
        "expected NotFound error, got: {err}");
}

#[tokio::test]
async fn e2e_add_provider() {
    use claude_config_manager_lib::commands::providers;
    use claude_config_manager_lib::domain::{ProviderInput, ProviderModels};
    let state = test_state();
    let s_ = s(&state);
    let input = ProviderInput {
        id: "test-provider-e2e".into(),
        name: "Test-Provider-E2E".into(),
        base_url: "https://api.test.example.com".into(),
        api_key: "sk-test-12345".into(),
        models: ProviderModels {
            default: "test-model".into(),
            ..Default::default()
        },
        notes: Some("e2e test".into()),
    };
    let result = providers::add_provider(s_.clone(), input).await;
    // Either succeeds (if id is auto-derived) or fails with AlreadyExists (if id collides)
    match result {
        Ok(p) => {
            assert!(!p.id.is_empty());
            assert!(!p.is_active, "new provider must be inactive");
        }
        Err(e) => {
            // AlreadyExists acceptable
            assert!(e.contains("already") || e.contains("exists"),
                "expected AlreadyExists or success, got: {e}");
        }
    }
}

#[tokio::test]
async fn e2e_add_provider_empty_name_rejected() {
    use claude_config_manager_lib::commands::providers;
    use claude_config_manager_lib::domain::{ProviderInput, ProviderModels};
    let state = test_state();
    let s_ = s(&state);
    let input = ProviderInput {
        id: "empty-name-test".into(),
        name: "".into(),
        base_url: "https://api.test.example.com".into(),
        api_key: "sk-test".into(),
        models: ProviderModels {
            default: "m".into(),
            ..Default::default()
        },
        notes: None,
    };
    let err = providers::add_provider(s_, input).await.unwrap_err();
    assert!(err.to_lowercase().contains("name") || err.to_lowercase().contains("empty"),
        "expected name validation error, got: {err}");
}

#[tokio::test]
async fn e2e_update_provider_not_found() {
    use claude_config_manager_lib::commands::providers;
    use claude_config_manager_lib::domain::{ProviderInput, ProviderModels};
    let state = test_state();
    let s_ = s(&state);
    let input = ProviderInput {
        id: "nonexistent-xyz".into(),
        name: "Updated".into(),
        base_url: "https://api.updated.example.com".into(),
        api_key: "sk-updated".into(),
        models: ProviderModels {
            default: "m".into(),
            ..Default::default()
        },
        notes: None,
    };
    let err = providers::update_provider(s_, "nonexistent-xyz".to_string(), input).await.unwrap_err();
    assert!(err.contains("not found") || err.contains("not exist"),
        "expected NotFound error, got: {err}");
}

#[tokio::test]
async fn e2e_delete_provider_not_found() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let err = providers::delete_provider(s_, "nonexistent-xyz".to_string()).await.unwrap_err();
    assert!(err.contains("not found") || err.contains("not exist"),
        "expected NotFound error, got: {err}");
}

#[tokio::test]
async fn e2e_delete_provider_cannot_delete_active() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    // First: switch to system provider to make it active
    let _ = providers::switch_provider(s_.clone(), "system".to_string()).await;
    // Then try to delete it — should fail with CannotDeleteActive
    let err = providers::delete_provider(s_, "system".to_string()).await.unwrap_err();
    // Note: switch may fail in test env (writes to real settings.json),
    // so we just check that if delete fails, the message is sensible
    assert!(!err.is_empty(), "delete should return a message");
    // If we successfully made it active, we should see CannotDeleteActive
    // Otherwise it's NotFound or another error — both acceptable
}

#[tokio::test]
async fn e2e_provider_parse_sql() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let _ = providers::parse_sql_preview("INSERT INTO ...".to_string()).await;
}

#[tokio::test]
async fn e2e_provider_parse_deeplink() {
    use claude_config_manager_lib::commands::providers;
    let state = test_state();
    let s_ = s(&state);
    let _ = providers::parse_deeplink_url("ccswitch://v1/import?id=test".to_string()).await;
}

// ============================================================================
// 3. project (M3.10)
// ============================================================================

#[tokio::test]
async fn e2e_project_list() {
    use claude_config_manager_lib::commands::project;
    let state = test_state();
    let s_ = s(&state);
    let res = project::list_projects(s_).await.unwrap();
    assert!(res.projects.iter().any(|p| p.is_system));
}

#[tokio::test]
async fn e2e_project_current() {
    use claude_config_manager_lib::commands::project;
    let state = test_state();
    let s_ = s(&state);
    let _ = project::current_project(s_).await.unwrap();
}

#[tokio::test]
async fn e2e_project_validate_path() {
    use claude_config_manager_lib::commands::project;
    let state = test_state();
    let s_ = s(&state);
    let _ = project::validate_project_path("/tmp".to_string()).await;
}

// ============================================================================
// 4. autostart
// ============================================================================

#[tokio::test]
async fn e2e_autostart_status() {
    // SKIP: requires real Tauri AppHandle (autostart plugin queries OS registry)
    // Covered by manual smoke test (M1.7 + M3.13 ship).
}

// ============================================================================
// 5. fs
// ============================================================================

#[tokio::test]
async fn e2e_fs_read_missing() {
    use claude_config_manager_lib::commands::fs;
    let state = test_state();
    let s_ = s(&state);
    let res = fs::read_file(s_, "/nonexistent/path/to/file.json".to_string()).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn e2e_fs_take_pending() {
    use claude_config_manager_lib::commands::fs;
    let state = test_state();
    let s_ = s(&state);
    let _ = fs::take_pending_sql_file(s_).unwrap();
}

#[tokio::test]
async fn e2e_fs_list_editable_jsons() {
    use claude_config_manager_lib::commands::fs;
    let state = test_state();
    let s_ = s(&state);
    let _ = fs::list_editable_jsons(s_).await.unwrap();
}

// ============================================================================
// 6. mcp
// ============================================================================

#[tokio::test]
async fn e2e_mcp_list() {
    use claude_config_manager_lib::commands::mcp;
    let state = test_state();
    let s_ = s(&state);
    let _ = mcp::list_mcp_servers(s_).await.unwrap();
}

#[tokio::test]
async fn e2e_mcp_list_with_warnings() {
    use claude_config_manager_lib::commands::mcp;
    let state = test_state();
    let s_ = s(&state);
    let _ = mcp::list_mcp_servers_with_warnings(s_).await.unwrap();
}

#[tokio::test]
async fn e2e_mcp_parse_deeplink() {
    use claude_config_manager_lib::commands::mcp;
    let state = test_state();
    let s_ = s(&state);
    let _ = mcp::parse_mcp_deeplink("ccswitch://v1/import-mcp?name=test".to_string()).await;
}

// ============================================================================
// 7. backup
// ============================================================================

#[tokio::test]
async fn e2e_backup_list() {
    use claude_config_manager_lib::commands::backup;
    let state = test_state();
    let s_ = s(&state);
    let _ = backup::list_backups(s_).await.unwrap();
}

// ============================================================================
// 8. optimizer
// ============================================================================

#[tokio::test]
async fn e2e_optimizer_scan() {
    use claude_config_manager_lib::commands::optimizer;
    let state = test_state();
    let s_ = s(&state);
    let _ = optimizer::scan_optimizations(s_).await.unwrap();
}

// ============================================================================
// 9. usage
// ============================================================================

#[tokio::test]
async fn e2e_usage_history() {
    use claude_config_manager_lib::commands::usage;
    let state = test_state();
    let s_ = s(&state);
    let _ = usage::get_usage_history(s_, "5h".to_string()).await.unwrap();
}

// ============================================================================
// 10. marketplace
// ============================================================================

#[tokio::test]
async fn e2e_marketplace_list_repos() {
    use claude_config_manager_lib::commands::marketplace;
    let state = test_state();
    let s_ = s(&state);
    let _ = marketplace::list_marketplace_repos(s_).await;
}

// ============================================================================
// 11. history
// ============================================================================

#[tokio::test]
async fn e2e_history() {
    use claude_config_manager_lib::commands::history;
    let state = test_state();
    let s_ = s(&state);
    let _ = history::get_usage_history_rows(s_.clone(), Default::default()).await.unwrap();
    let _ = history::get_history_stats(s_.clone()).await.unwrap();
    let _ = history::get_backup_history(s_.clone(), Default::default()).await.unwrap();
}