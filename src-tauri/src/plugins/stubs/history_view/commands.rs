//! F21 / Phase 21 — 历史查询 (plugin commands).
//!
//! Phase 42 physical migration: 6 `#[tauri::command]` fns from
//! `src-tauri/src/commands/history.rs` → this module's 6 `dispatch_*`
//! shims + 6 `inventory::submit!` registrations.

use tauri::ipc::Invoke;
use tauri::Manager;

use crate::app_state::AppState;
use crate::get_service;
use crate::plugins::dispatch::CommandSpec;
use crate::services::history_service::HistoryService;

// ---------------------------------------------------------------------------
// dispatch_get_usage_history_rows
// ---------------------------------------------------------------------------

/// F21 — read `usage_history` rows.
pub fn dispatch_get_usage_history_rows(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<Vec<crate::services::history_service::UsageHistoryRow>, String> =
            match serde_json::from_value::<crate::services::history_service::UsageHistoryFilter>(
                json_args,
            ) {
                Ok(filter) => get_service!(s, HistoryService)
                    .query_usage(&filter)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("get_usage_history_rows: invalid filter: {e}")),
            };
        invoke
            .resolver
            .respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_get_daily_stats_history
// ---------------------------------------------------------------------------

/// F21 — read daily-aggregated usage stats.
pub fn dispatch_get_daily_stats_history(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<Vec<crate::services::history_service::DailyStatRow>, String> =
            match serde_json::from_value::<crate::services::history_service::DailyStatsFilter>(
                json_args,
            ) {
                Ok(filter) => get_service!(s, HistoryService)
                    .query_daily_stats(&filter)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("get_daily_stats_history: invalid filter: {e}")),
            };
        invoke
            .resolver
            .respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_get_backup_history
// ---------------------------------------------------------------------------

/// F21 — read `backup_history` rows.
pub fn dispatch_get_backup_history(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<Vec<crate::services::history_service::BackupHistoryRow>, String> =
            match serde_json::from_value::<crate::services::history_service::BackupHistoryFilter>(
                json_args,
            ) {
                Ok(filter) => get_service!(s, HistoryService)
                    .query_backup(&filter)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("get_backup_history: invalid filter: {e}")),
            };
        invoke
            .resolver
            .respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_get_history_stats
// ---------------------------------------------------------------------------

/// F21 — aggregate counters + db size.
pub fn dispatch_get_history_stats(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<crate::services::history_service::HistoryStats, String> =
            get_service!(s, HistoryService)
                .stats()
                .map_err(|e| e.to_string());
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_export_history
// ---------------------------------------------------------------------------

/// F21 — export both history tables to a JSON or CSV file.
pub fn dispatch_export_history(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let format_str = json_args
            .get("format")
            .and_then(|v| v.as_str())
            .unwrap_or("json");
        let target_path = json_args
            .get("target_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<crate::commands::history::ExportReport, String> =
            crate::commands::history::export_history_impl(
                get_service!(s, HistoryService).as_ref(),
                crate::commands::history::ExportFormat::from_str(format_str)
                    .unwrap_or(crate::commands::history::ExportFormat::Json),
                std::path::Path::new(&target_path),
            );
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_purge_history
// ---------------------------------------------------------------------------

/// F21 — delete rows older than `older_than_days`.
pub fn dispatch_purge_history(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let older_than_days: u32 = json_args
            .get("older_than_days")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<crate::services::history_service::PurgeReport, String> =
            get_service!(s, HistoryService)
                .purge(older_than_days)
                .map_err(|e| e.to_string());
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "get_usage_history_rows",
    plugin_id: "history-view",
    dispatch: dispatch_get_usage_history_rows,
});

inventory::submit!(CommandSpec {
    name: "get_daily_stats_history",
    plugin_id: "history-view",
    dispatch: dispatch_get_daily_stats_history,
});

inventory::submit!(CommandSpec {
    name: "get_backup_history",
    plugin_id: "history-view",
    dispatch: dispatch_get_backup_history,
});

inventory::submit!(CommandSpec {
    name: "get_history_stats",
    plugin_id: "history-view",
    dispatch: dispatch_get_history_stats,
});

inventory::submit!(CommandSpec {
    name: "export_history",
    plugin_id: "history-view",
    dispatch: dispatch_export_history,
});

inventory::submit!(CommandSpec {
    name: "purge_history",
    plugin_id: "history-view",
    dispatch: dispatch_purge_history,
});