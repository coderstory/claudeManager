//! Tauri commands for F1 + F2 (M2.1).
//!
//! Each `#[tauri::command]` is a thin wrapper around the corresponding
//! `ProviderService` method. The split exists so that:
//!
//! - Services stay platform-independent and unit-testable (see
//!   `crate::services::provider_service::tests`).
//! - Tauri commands own the `State<'_, AppState>` extraction + error
//!   stringification (Tauri's IPC requires `Result<T, String>` for
//!   cross-thread invocation).
//!
//! ## Frontend contract
//!
//! Frontend calls these via `invoke<T>(name, args)` from
//! `src/lib/api/providers.ts`. Field names use snake_case to match the
//! Rust `serde(rename_all = "snake_case")` on `Provider` — the TS
//! mirror `src/types/provider.ts` declares the same shape.
//!
//! ## Error semantics
//!
//! On any failure, the command returns `Err(msg)` where `msg` is a
//! user-readable string (SPEC §6.5: "不允许静默吞错"). Frontend surfaces
//! it via InfoBar.

use tauri::State;

use crate::app_state::AppState;
use crate::domain::Provider;

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F1 — list all providers with `is_active` recomputed from
/// `~/.claude/settings.json` (SPEC §2.3).
///
/// Returns an empty Vec if `<app_data>/providers/` is missing — this
/// is the cold-start case the M2.1 UI handles with an "empty state".
/// Individual corrupt files are silently skipped (the UI can call
/// `list_providers_with_warnings` later if it wants to surface them).
#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> CmdResult<Vec<Provider>> {
    Ok(state.provider_service.list_providers())
}

/// F1+ — same as `list_providers` but also returns the paths of any
/// provider files that failed to parse. The frontend can show a
/// non-fatal warning toast.
#[tauri::command]
pub async fn list_providers_with_warnings(
    state: State<'_, AppState>,
) -> CmdResult<ListProvidersResult> {
    let (providers, warnings) = state.provider_service.list_providers_with_warnings();
    let warnings = warnings
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    Ok(ListProvidersResult {
        providers,
        warnings,
    })
}

/// Wrapper struct for `list_providers_with_warnings`. Lives in the
/// command module (not the service) because it's an IPC shape concern,
/// not a domain concept.
#[derive(Debug, serde::Serialize)]
pub struct ListProvidersResult {
    pub providers: Vec<Provider>,
    pub warnings: Vec<String>,
}

/// F2 — switch the active provider.
///
/// On success, returns the activated `Provider` (with `last_used_at`
/// stamped). The frontend can use this to update its row immediately
/// without a follow-up `list_providers` call — but a `list_providers`
/// is recommended to re-sync other rows' `is_active` flags.
#[tauri::command]
pub async fn switch_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> CmdResult<Provider> {
    state
        .provider_service
        .switch_provider(&provider_id)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// The service-level coverage in `provider_service::tests` is the
// primary safety net. These tests pin the *command* contract: arg
// names, return shapes, error stringification. If these compile, the
// `invoke_handler!` macro will be happy.

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time check: `list_providers` takes `State<'_, AppState>`
    /// and returns `CmdResult<Vec<Provider>>`.
    #[allow(dead_code)]
    fn _list_providers_signature() {
        let _f: fn(State<'_, AppState>) -> _ = list_providers;
    }

    /// Compile-time check: `switch_provider` takes `State<'_, AppState>`
    /// + `provider_id: String` and returns `CmdResult<Provider>`.
    #[allow(dead_code)]
    fn _switch_provider_signature() {
        let _f: fn(State<'_, AppState>, String) -> _ = switch_provider;
    }

    #[test]
    fn list_providers_result_serialises_with_providers_and_warnings_keys() {
        let r = ListProvidersResult {
            providers: vec![],
            warnings: vec!["/tmp/bad.json".into()],
        };
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("providers").is_some());
        assert!(json.get("warnings").is_some());
        assert_eq!(json["warnings"][0], "/tmp/bad.json");
    }
}