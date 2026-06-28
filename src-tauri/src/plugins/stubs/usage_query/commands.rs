//! F7 — 用量查询 (plugin commands).
//!
//! Migrated from `crate::commands::usage` as part of Phase 42 IPC
//! dispatch refactor (see `.planning/milestones/v3.4-phases/42-HANDOFF.md`).
//! The original `#[tauri::command]` async wrappers are now sync `dispatch_*`
//! fns that bridge `Invoke<tauri::Wry>` to the underlying service calls.
//!
//! ## Architecture
//!
//! ```text
//!  frontend `invoke("get_current_usage", { window })`
//!      ↓
//!  lib.rs::setup invokes DispatchTable::dispatch
//!      ↓
//!  DispatchTable looks up "get_current_usage" → dispatch_get_current_usage
//!      ↓
//!  tauri::async_runtime::block_on → UsageService::get_snapshot_only_with_active_root
//! ```
//!
//! ## Sync dispatch over async services
//!
//! The original commands were `async fn`. To register them in the
//! `inventory::submit!(CommandSpec { dispatch, .. })` table (which requires
//! `fn(Invoke<Wry>) -> bool`, a sync signature), we wrap the inner
//! `await` in `tauri::async_runtime::block_on`. This is safe here:
//! each command is invoked from a Tauri worker thread, never the
//! runtime thread; `block_on` from a worker thread is the canonical
//! pattern documented in Tauri's IPC guide.
//!
//! ## State extraction
//!
//! `Invoke` exposes only `message` / `resolver` / `acl` (not `app_handle`).
//! The Webview is reachable via `invoke.message.webview()` and implements
//! the `Manager` trait, so `webview().state::<AppState>()` returns
//! `State<'_, AppState>` — the same shape the original `async fn`
//! commands got from Tauri's `state: State<'_, AppState>` parameter.
//!
//! ## Error stringification
//!
//! `InvokeResolver::respond` takes `Result<T, InvokeError>` where
//! `T: IpcResponse`. `InvokeError` has a blanket `From<T: Serialize>`
//! impl, so `Result<T, String>` → `Result<T, InvokeError>` via the
//! `?` operator / `.into()`. We construct the success and error
//! branches up front to keep the type inference straightforward.

use tauri::ipc::{Invoke, InvokeBody};
use tauri::Manager;

use crate::app_state::AppState;
use crate::domain::{UsageHistoryEntry, UsageSnapshot, UsageWindow};
use crate::plugins::dispatch::CommandSpec;

/// Pull the JSON args off an `InvokeMessage` payload.
///
/// `InvokeBody::Json(v)` is the only variant desktop targets emit
/// (raw bytes is a mobile-only path; see tauri-2.11.3
/// `src/ipc/mod.rs::InvokeBody` doc-comment). We panic on the
/// Raw variant with a clear message — that's a Tauri API contract
/// violation, not a runtime condition.
fn json_args(invoke: &Invoke<tauri::Wry>) -> serde_json::Value {
    match invoke.message.payload() {
        InvokeBody::Json(v) => v.clone(),
        InvokeBody::Raw(_) => panic!(
            "usage_query dispatch received raw InvokeBody — Tauri desktop only \
             sends JSON, this is an API misuse"
        ),
    }
}

// ---------------------------------------------------------------------------
// Active-provider fingerprint (lifted verbatim from commands/usage.rs).
// ---------------------------------------------------------------------------
//
// Coarse fingerprint based on `env.ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`.
// Stable across restarts, changes when the user switches providers via F2.
// Used purely as a cache key by UsageService.

fn resolve_active_provider_id(state: &AppState) -> String {
    let path = &state.paths.settings_json;
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return "default".to_string(),
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return "default".to_string(),
    };
    let token = v
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_AUTH_TOKEN"))
        .and_then(|t| t.as_str());
    let base = v
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
        .and_then(|t| t.as_str());
    match (token, base) {
        (Some(t), Some(b)) => {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut h = DefaultHasher::new();
            t.hash(&mut h);
            b.hash(&mut h);
            format!("active-{:x}", h.finish())
        }
        _ => "default".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Window arg helper
// ---------------------------------------------------------------------------
//
// The args land on the `InvokeMessage` as an `InvokeBody::Json(value)`.
// We accept either an object (`{"window":"5h"}`) — the canonical shape
// the frontend emits via `invoke("name", { window: "5h" })` — or a bare
// string (`invoke("name", "5h")`) for forward-compatibility with older
// callers.

fn window_from_args(args: &serde_json::Value) -> Result<UsageWindow, String> {
    if let Some(s) = args.get("window").and_then(|v| v.as_str()) {
        return UsageWindow::from_str(s)
            .ok_or_else(|| format!("未知的窗口: '{s}'，请用 5h / 1w / 1m"));
    }
    if let Some(s) = args.as_str() {
        return UsageWindow::from_str(s)
            .ok_or_else(|| format!("未知的窗口: '{s}'，请用 5h / 1w / 1m"));
    }
    Err("缺少 window 参数".to_string())
}

// ---------------------------------------------------------------------------
// dispatch_get_current_usage
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `get_current_usage(window)`.
///
/// F7 — returns the cached usage snapshot for the active provider in the
/// requested window (`"5h"` / `"1w"` / `"1m"`). Cache TTL is 5 minutes;
/// the page can call `refresh_usage` to force a re-scan.
pub fn dispatch_get_current_usage(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<UsageSnapshot, String> = tauri::async_runtime::block_on(async move {
        let w = window_from_args(&args)?;
        let provider_id = resolve_active_provider_id(&state);
        // M3.12 (A1#13) — read live active root via the platform shim.
        let active_root = crate::platform::runtime::paths().active_root_dir();
        state
            .usage_service
            .get_snapshot_only_with_active_root(&provider_id, w, active_root.as_deref())
            .map_err(|e| e.to_string())
    });
    let response: Result<UsageSnapshot, tauri::ipc::InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_get_usage_history
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `get_usage_history(window)`.
///
/// F7 — returns per-day per-model history for the active provider in the
/// requested window. Cache TTL is shared with `get_current_usage` (same
/// `(provider_id, window)` key).
pub fn dispatch_get_usage_history(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<Vec<UsageHistoryEntry>, String> =
        tauri::async_runtime::block_on(async move {
            let w = window_from_args(&args)?;
            let provider_id = resolve_active_provider_id(&state);
            let active_root = crate::platform::runtime::paths().active_root_dir();
            state
                .usage_service
                .get_history_only_with_active_root(&provider_id, w, active_root.as_deref())
                .map_err(|e| e.to_string())
        });
    let response: Result<Vec<UsageHistoryEntry>, tauri::ipc::InvokeError> =
        result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_refresh_usage
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `refresh_usage(window)`.
///
/// F7 — drop the cache entry for `(active_provider, window)` and re-scan
/// `~/.claude/projects/**/*.jsonl`. Returns the fresh snapshot, augmented
/// with `inserted_rows` so the frontend can show "已写入 N 条"
/// (CLAUDE.md §7 / Phase 27 D-09).
pub fn dispatch_refresh_usage(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<UsageSnapshot, String> = tauri::async_runtime::block_on(async move {
        let w = window_from_args(&args)?;
        let provider_id = resolve_active_provider_id(&state);
        let active_root = crate::platform::runtime::paths().active_root_dir();
        let (mut snap, _history) = state
            .usage_service
            .refresh_with_active_root(&provider_id, w, active_root.as_deref())
            .map_err(|e| e.to_string())?;
        // Phase 27 Fix 2 (BUG-CR-02 / D-09) — verify the SQLite
        // write side by counting rows in `usage_history` that
        // landed within the last 30 days. If `history_service`
        // is missing (shouldn't happen), fall back to 0.
        let inserted = state
            .history_service
            .count_recent_usage_rows(30 * 86_400)
            .unwrap_or(0);
        snap.inserted_rows = inserted;
        Ok(snap)
    });
    let response: Result<UsageSnapshot, tauri::ipc::InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! — register all 3 commands into the global dispatch table.
// ---------------------------------------------------------------------------
//
// `name` is the string the frontend uses in `invoke("name", ...)` and
// MUST match the original `#[tauri::command]` fn name exactly — Tauri
// uses it as the global IPC namespace (never namespaced by `plugin_id`).

inventory::submit!(CommandSpec {
    name: "get_current_usage",
    plugin_id: "usage-query",
    dispatch: dispatch_get_current_usage,
});

inventory::submit!(CommandSpec {
    name: "get_usage_history",
    plugin_id: "usage-query",
    dispatch: dispatch_get_usage_history,
});

inventory::submit!(CommandSpec {
    name: "refresh_usage",
    plugin_id: "usage-query",
    dispatch: dispatch_refresh_usage,
});