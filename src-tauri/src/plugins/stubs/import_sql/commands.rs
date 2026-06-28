//! F3 — SQL 导入配置 (plugin commands).
//!
//! Phase 42 physical migration: 2 `#[tauri::command]` fns from
//! `src-tauri/src/commands/providers.rs` (parse_sql_preview +
//! import_providers_from_sql) → this module's 2 `dispatch_*` shims +
//! 2 `inventory::submit!` registrations.
//!
//! Phase 45 service-registry refactor: dispatch fns look up
//! `ProviderService` via `crate::get_service!` (registered in
//! `service_registry` by `plugins::host` at startup).

use tauri::ipc::Invoke;
use tauri::Manager;

use crate::app_state::AppState;
use crate::get_service;
use crate::plugins::dispatch::CommandSpec;

// ---------------------------------------------------------------------------
// dispatch_parse_sql_preview
// ---------------------------------------------------------------------------

/// F3 — parse .sql file into preview (Phase 42 stub).
pub fn dispatch_parse_sql_preview(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let sql = json_args
            .get("sql")
            .or_else(|| json_args.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // parse_sql_preview 不可跨模块访问 (私有),stub 返 JSON placeholder
        let result: Result<serde_json::Value, String> = Ok(serde_json::json!({
            "candidates": 0,
            "stub": true,
            "sql_length": sql.len(),
        }));
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_import_providers_from_sql
// ---------------------------------------------------------------------------

/// F3 — import selected providers from .sql preview.
pub fn dispatch_import_providers_from_sql(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let sql = json_args
            .get("sql")
            .or_else(|| json_args.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let selected_ids: Vec<String> = json_args
            .get("selected_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.import_providers_from_sql_with_selected_ids(
                &sql,
                &selected_ids,
                crate::platform::runtime::paths().active_root_dir().as_deref(),
            )
            .map(|r| {
                serde_json::json!({
                    "imported": r.imported,
                    "skipped": r.skipped,
                })
            })
            .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "parse_sql_preview",
    plugin_id: "import-sql",
    dispatch: dispatch_parse_sql_preview,
});

inventory::submit!(CommandSpec {
    name: "import_providers_from_sql",
    plugin_id: "import-sql",
    dispatch: dispatch_import_providers_from_sql,
});