//! F1 — Provider 列表 (plugin commands).
//!
//! Phase 42 physical migration: 14 `#[tauri::command]` fns from
//! `src-tauri/src/commands/providers.rs` → this module's 14
//! `dispatch_*` shims + 14 `inventory::submit!` registrations. Per
//! SHIP-A, the `switch_provider` command is colocated here.
//!
//! 注: 私有 DTO (ParsedDeeplink / ExportedProvider / ListProvidersResult)
//! 不可跨模块访问,且非 IpcResponse (Serialize),所以本 stub 返
//! serde_json::Value 占位。完整 schema 由 commands::providers 保留。
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
// dispatch_list_providers
// ---------------------------------------------------------------------------

/// F1 — list providers.
pub fn dispatch_list_providers(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let active_root = crate::platform::runtime::paths().active_root_dir();
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            let (providers, _warnings) = svc
                .list_providers_with_active_root(active_root.as_deref())
                .map_err(|e| e.to_string())?;
            serde_json::to_value(&providers).map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_list_providers_with_warnings
// ---------------------------------------------------------------------------

/// F1+ — list providers + parse warnings (JSON placeholder).
pub fn dispatch_list_providers_with_warnings(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let active_root = crate::platform::runtime::paths().active_root_dir();
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.list_providers_with_active_root(active_root.as_deref())
                .map(|(ps, ws)| serde_json::json!({"providers": ps, "warnings": ws}))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_switch_provider
// ---------------------------------------------------------------------------

/// F2 — switch active provider (merged from old provider_switch stub per SHIP-A).
pub fn dispatch_switch_provider(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id = json_args
            .get("id")
            .or_else(|| json_args.get("provider_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.switch_provider(&id)
                .map(|p| serde_json::to_value(&p).unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_parse_deeplink_url
// ---------------------------------------------------------------------------

/// F4 — parse deep link URL (Phase 42 stub: returns JSON wrapper).
pub fn dispatch_parse_deeplink_url(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let url = json_args
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let result: Result<serde_json::Value, String> = Ok(serde_json::json!({
            "raw_url": url,
            "stub": true,
        }));
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_import_single_provider
// ---------------------------------------------------------------------------

/// F4 — import a single provider.
pub fn dispatch_import_single_provider(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let provider: crate::domain::Provider = match serde_json::from_value(json_args) {
            Ok(p) => p,
            Err(e) => {
                let r: Result<(), String> = Err(format!(
                    "import_single_provider: invalid payload: {e}"
                ));
                invoke.resolver.respond(r.map_err(Into::into));
                return;
            }
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<(), String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.import_single_provider(provider).map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_get_provider_details
// ---------------------------------------------------------------------------

/// F1 — read provider details.
pub fn dispatch_get_provider_details(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id = json_args
            .get("id")
            .or_else(|| json_args.get("provider_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.get_provider(&id)
                .map(|p| serde_json::to_value(&p).unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_add_provider / update_provider / delete_provider
// ---------------------------------------------------------------------------

/// F1 — add a new provider.
pub fn dispatch_add_provider(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let input: crate::domain::ProviderInput = match serde_json::from_value(json_args) {
            Ok(i) => i,
            Err(e) => {
                let r: Result<serde_json::Value, String> =
                    Err(format!("add_provider: invalid payload: {e}"));
                invoke.resolver.respond(r.map_err(Into::into));
                return;
            }
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.add_provider(input)
                .map(|p| serde_json::to_value(&p).unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

/// F1 — update an existing provider.
pub fn dispatch_update_provider(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id = json_args
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let input: crate::domain::ProviderInput = match serde_json::from_value(json_args) {
            Ok(i) => i,
            Err(e) => {
                let r: Result<serde_json::Value, String> =
                    Err(format!("update_provider: invalid payload: {e}"));
                invoke.resolver.respond(r.map_err(Into::into));
                return;
            }
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.update_provider(&id, input)
                .map(|p| serde_json::to_value(&p).unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

/// F1 — delete a provider.
pub fn dispatch_delete_provider(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id = json_args
            .get("id")
            .or_else(|| json_args.get("provider_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<(), String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.delete_provider(&id).map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_generate_from_current_config
// ---------------------------------------------------------------------------

/// F1 — generate a provider from current `~/.claude/settings.json`.
pub fn dispatch_generate_from_current_config(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<serde_json::Value, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::provider_service::ProviderService);
            svc.generate_from_current_config()
                .map(|_gp| serde_json::json!({"generated": true, "stub": true}))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_export_provider (Phase 42 stub: delegates to commands::providers)
// ---------------------------------------------------------------------------

/// F1 — export a provider to a JSON file (stub).
pub fn dispatch_export_provider(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id = json_args
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let result: Result<serde_json::Value, String> = Ok(serde_json::json!({
            "id": id,
            "stub": "export_provider needs dialog refactor (Phase 47)",
        }));
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_read_current_claude_config
// ---------------------------------------------------------------------------

/// F1 — read the user's current `~/.claude/settings.json`.
pub fn dispatch_read_current_claude_config(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let user_dir = s.inner().paths.claude_dir();
        let result: Result<serde_json::Value, String> = (|| async {
            let dir = user_dir.ok_or_else(|| "claude_dir not set".to_string())?;
            let settings = dir.join("settings.json");
            if !settings.exists() {
                return Ok(serde_json::Value::Null);
            }
            let content = std::fs::read_to_string(&settings)
                .map_err(|e| format!("read settings.json: {e}"))?;
            serde_json::from_str(&content).map_err(|e| format!("parse settings.json: {e}"))
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
    name: "list_providers",
    plugin_id: "provider-list",
    dispatch: dispatch_list_providers,
});

inventory::submit!(CommandSpec {
    name: "list_providers_with_warnings",
    plugin_id: "provider-list",
    dispatch: dispatch_list_providers_with_warnings,
});

inventory::submit!(CommandSpec {
    name: "switch_provider",
    plugin_id: "provider-list",
    dispatch: dispatch_switch_provider,
});

inventory::submit!(CommandSpec {
    name: "parse_deeplink_url",
    plugin_id: "provider-list",
    dispatch: dispatch_parse_deeplink_url,
});

inventory::submit!(CommandSpec {
    name: "import_single_provider",
    plugin_id: "provider-list",
    dispatch: dispatch_import_single_provider,
});

inventory::submit!(CommandSpec {
    name: "get_provider_details",
    plugin_id: "provider-list",
    dispatch: dispatch_get_provider_details,
});

inventory::submit!(CommandSpec {
    name: "add_provider",
    plugin_id: "provider-list",
    dispatch: dispatch_add_provider,
});

inventory::submit!(CommandSpec {
    name: "update_provider",
    plugin_id: "provider-list",
    dispatch: dispatch_update_provider,
});

inventory::submit!(CommandSpec {
    name: "delete_provider",
    plugin_id: "provider-list",
    dispatch: dispatch_delete_provider,
});

inventory::submit!(CommandSpec {
    name: "generate_from_current_config",
    plugin_id: "provider-list",
    dispatch: dispatch_generate_from_current_config,
});

inventory::submit!(CommandSpec {
    name: "export_provider",
    plugin_id: "provider-list",
    dispatch: dispatch_export_provider,
});

inventory::submit!(CommandSpec {
    name: "read_current_claude_config",
    plugin_id: "provider-list",
    dispatch: dispatch_read_current_claude_config,
});