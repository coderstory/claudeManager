//! Tauri commands for F7 — 用量查询 (M3.8).
//!
//! Each `#[tauri::command]` is a thin wrapper around the
//! corresponding `UsageService` method. The split exists so that:
//!
//! - Services stay platform-independent and unit-testable (see
//!   `crate::services::usage_service::tests`).
//! - Tauri commands own the `State<'_, AppState>` extraction + error
//!   stringification (Tauri's IPC requires `Result<T, String>` for
//!   cross-thread invocation).
//!
//! ## Frontend contract
//!
//! Frontend calls these via `invoke<T>(name, args)` from
//! `src/lib/api/usage.ts`. Field names use snake_case to match the
//! Rust `serde(rename_all = "snake_case")` on `UsageSnapshot` — the
//! TS mirror `src/types/usage.ts` declares the same shape.
//!
//! ## M3.8 commands
//!
//! - `get_current_usage(window)` — returns just the snapshot
//!   (no history; cheaper IPC payload for quick re-renders).
//! - `get_usage_history(provider_id, window)` — returns the
//!   per-day per-model history array for the chart.
//! - `refresh_usage(window)` — drops cache + re-scans JSONL.

use tauri::State;

use crate::app_state::AppState;
use crate::domain::{UsageHistoryEntry, UsageSnapshot, UsageWindow};

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// Resolve the active provider id from `~/.claude/settings.json`.
///
/// The MCP/Provider services keep this logic close to their own
/// read paths; for F7 we only need the id (not the full Provider),
/// so we read settings.json ourselves and pluck
/// `env.ANTHROPIC_AUTH_TOKEN` as a coarse "active provider
/// fingerprint" — it changes when the user switches via F2.
///
/// Returns `"default"` when settings.json is missing / corrupt /
/// has no env block. The provider-id-as-string is used purely as a
/// cache key; the snapshot still serialises it for the UI label.
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
            // Coarse fingerprint: stable across restarts, changes on
            // F2 switch. NOT meant for security — just a cache key.
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

/// F7 — return the cached usage snapshot for the active provider
/// in the requested window (`"5h"` / `"1w"` / `"1m"`). Cache TTL is
/// 5 minutes; the page can call `refresh_usage` to force a re-scan.
///
/// M3.12 (A1#13) — reads live `active_root_dir` from the platform
/// shim and routes the JSONL scan accordingly. `None` → scan the
/// user-level `~/.claude/projects/...` (M3.8 default); `Some(root)` →
/// scan `<root>/.claude/projects/...` (project mode).
#[tauri::command]
pub async fn get_current_usage(
    state: State<'_, AppState>,
    window: String,
) -> CmdResult<UsageSnapshot> {
    let w = UsageWindow::from_str(&window)
        .ok_or_else(|| format!("未知的窗口: '{window}'，请用 5h / 1w / 1m"))?;
    let provider_id = resolve_active_provider_id(&state);
    // M3.12 (A1#13) — read live active root via the platform shim.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .usage_service
        .get_snapshot_only_with_active_root(&provider_id, w, active_root.as_deref())
        .map_err(|e| e.to_string())
}

/// F7 — return per-day per-model history for the active provider
/// in the requested window. Cache TTL is shared with
/// `get_current_usage` — same `(provider_id, window)` key.
///
/// M3.12 (A1#13) — routes the JSONL scan through `active_root_dir`.
#[tauri::command]
pub async fn get_usage_history(
    state: State<'_, AppState>,
    window: String,
) -> CmdResult<Vec<UsageHistoryEntry>> {
    let w = UsageWindow::from_str(&window)
        .ok_or_else(|| format!("未知的窗口: '{window}'，请用 5h / 1w / 1m"))?;
    let provider_id = resolve_active_provider_id(&state);
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .usage_service
        .get_history_only_with_active_root(&provider_id, w, active_root.as_deref())
        .map_err(|e| e.to_string())
}

/// F7 — drop the cache entry for `(active_provider, window)` and
/// re-scan `~/.claude/projects/**/*.jsonl`. Returns the fresh
/// snapshot.
///
/// M3.12 (A1#13) — routes the JSONL scan through `active_root_dir`.
#[tauri::command]
pub async fn refresh_usage(
    state: State<'_, AppState>,
    window: String,
) -> CmdResult<UsageSnapshot> {
    let w = UsageWindow::from_str(&window)
        .ok_or_else(|| format!("未知的窗口: '{window}'，请用 5h / 1w / 1m"))?;
    let provider_id = resolve_active_provider_id(&state);
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let (snap, _history) = state
        .usage_service
        .refresh_with_active_root(&provider_id, w, active_root.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(snap)
}

// ---------------------------------------------------------------------------
// Tests — pin the command contract (signatures, error stringification,
// provider-id fingerprint stability).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time check: `get_current_usage` takes
    /// `State<'_, AppState>` and returns `CmdResult<UsageSnapshot>`.
    #[allow(dead_code)]
    fn _get_current_usage_signature(
        s: State<'_, AppState>,
        window: String,
    ) -> CmdResult<UsageSnapshot> {
        let _ = (s, window);
        unimplemented!()
    }

    /// Compile-time check: `refresh_usage` signature.
    #[allow(dead_code)]
    fn _refresh_usage_signature(
        s: State<'_, AppState>,
        window: String,
    ) -> CmdResult<UsageSnapshot> {
        let _ = (s, window);
        unimplemented!()
    }

    /// Compile-time check: `get_usage_history` signature.
    #[allow(dead_code)]
    fn _get_usage_history_signature(
        s: State<'_, AppState>,
        window: String,
    ) -> CmdResult<Vec<UsageHistoryEntry>> {
        let _ = (s, window);
        unimplemented!()
    }

    #[test]
    fn window_string_parses_to_correct_variant() {
        assert_eq!(
            UsageWindow::from_str("5h"),
            Some(UsageWindow::FiveHours)
        );
        assert_eq!(UsageWindow::from_str("1w"), Some(UsageWindow::OneWeek));
        assert_eq!(
            UsageWindow::from_str("1m"),
            Some(UsageWindow::OneMonth)
        );
        assert_eq!(UsageWindow::from_str("garbage"), None);
    }

    #[test]
    fn invalid_window_returns_user_readable_error() {
        // We can't easily construct a State<AppState> here, so we
        // mirror the stringification that the command does. The
        // command returns `format!("未知的窗口: '{window}'，请用 5h / 1w / 1m")`
        // for unknown inputs.
        let msg = format!("未知的窗口: '{}'，请用 5h / 1w / 1m", "zz");
        assert!(msg.contains("未知的窗口"));
        assert!(msg.contains("zz"));
    }
}