//! Tauri commands for F18 — 配置优化 (M2.9).
//!
//! Mirrors the M2.5 / M2.7 command-layer pattern:
//!
//! - Each `#[tauri::command]` is a thin wrapper around an
//!   [`OptimizerService`] method.
//! - State is extracted with `State<'_, AppState>` (NOT `Arc<AppState>`
//!   — see the M2.2.3 fix note in `lib.rs`).
//! - All errors flatten to `String` for the IPC boundary; the message
//!   is user-readable so the UI can render it directly (SPEC §6.5
//!   "不允许静默吞错").
//!
//! ## Frontend contract
//!
//! - `scan_optimizations` → `Vec<OptimizationFinding>`. JSON shape:
//!   snake_case fields (see `domain::optimization`), severity is
//!   lowercase ("info" / "warning" / "error").
//! - `apply_optimizations({ findingIds })` → `Vec<ApplyResult>`.
//!   findingIds order is preserved; each result has `applied`
//!   (bool), `backupPath` (camelCased? — note: serde's
//!   `rename_all = "snake_case"` keeps it as `backup_path` on the
//!   wire; the TS mirror in `src/types/app.ts` converts).

use tauri::State;

use crate::app_state::AppState;
use crate::domain::{ApplyResult, OptimizationFinding};

/// `Result<T, String>` — Tauri IPC's preferred error type. `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F18 — scan all configured files and return every issue every
/// rule found. Results are sorted by severity (Error → Warning → Info).
///
/// Always reads fresh — no cache. Findings carry uuid `id`s that
/// only stay valid until the next scan.
#[tauri::command]
pub async fn scan_optimizations(
    state: State<'_, AppState>,
) -> CmdResult<Vec<OptimizationFinding>> {
    state
        .optimizer_service
        .scan()
        .map_err(|e| format!("配置扫描失败: {e}"))
}

/// F18 — apply the rules behind the requested findings, in order.
///
/// `findingIds` should come from a recent `scan_optimizations`
/// response. Stale ids return `ApplyResult { applied: false,
/// error: "finding 已过期..." }` rather than failing the whole call.
///
/// Each auto-apply rule writes via `fs_atomic::write_with_backup`
/// (CLAUDE.md §7) and returns the (predicted) `.bak.<ts>` path so
/// the UI can show "已自动备份"。
#[tauri::command]
pub async fn apply_optimizations(
    state: State<'_, AppState>,
    finding_ids: Vec<String>,
) -> CmdResult<Vec<ApplyResult>> {
    state
        .optimizer_service
        .apply_findings(finding_ids)
        .map_err(|e| format!("应用优化失败: {e}"))
}
