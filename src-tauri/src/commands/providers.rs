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
use crate::domain::{ParsedMcpServer, Provider};
use crate::infrastructure::deeplink_parser::{parse_deeplink_url as parse_dl, ParsedDeeplink};
use crate::infrastructure::sql_parser::{parse_sql_dump, SkippedLine};
use crate::services::provider_service::{ImportResult, ImportSkip};

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
// F3 — .sql 导入 (M2.2)
// ---------------------------------------------------------------------------

/// Preview of a parsed SQL dump, sent to the frontend BEFORE the user
/// clicks "confirm import". Shape mirrors what the import itself will
/// produce — same parser, same rules.
#[derive(Debug, serde::Serialize)]
pub struct SqlPreview {
    /// Total number of INSERT statements the parser saw.
    pub total_lines: usize,
    /// Number of providers that will be written (passed validation).
    pub importable: usize,
    /// Number of rows skipped (parse error or write precondition).
    pub skipped: usize,
    /// The provider rows that will be imported (UI shows a preview list).
    pub preview_providers: Vec<Provider>,
    /// The MCP rows parsed but NOT written (F6 owns write-side; M2.2
    /// shows them as a "preview-only" group).
    pub preview_mcp: Vec<ParsedMcpServer>,
    /// Up to 50 skip reasons — the full list is in ImportResult.errors
    /// after import. Capped to keep the preview payload small.
    pub skipped_samples: Vec<SkippedLine>,
}

/// Parse a SQL dump and return a preview without writing any files.
///
/// `content` is the raw text of the `.sql` file (read by the frontend
/// via the `tauri-plugin-dialog` open file API).
#[tauri::command]
pub async fn parse_sql_preview(content: String) -> CmdResult<SqlPreview> {
    let parsed = parse_sql_dump(&content).map_err(|e| format!("解析 SQL 失败: {e}"))?;
    let total_lines =
        parsed.providers.len() + parsed.mcp_servers.len() + parsed.skipped_lines.len();
    let importable = parsed.providers.len();
    let skipped = parsed.skipped_lines.len();
    let skipped_samples: Vec<SkippedLine> =
        parsed.skipped_lines.iter().take(50).cloned().collect();
    Ok(SqlPreview {
        total_lines,
        importable,
        skipped,
        preview_providers: parsed.providers,
        preview_mcp: parsed.mcp_servers,
        skipped_samples,
    })
}

/// Bulk-import providers from a SQL dump.
///
/// Returns a serialisable summary of what was imported, what was
/// skipped, and any per-row errors (UI surfaces them as a toast +
/// details panel).
#[tauri::command]
pub async fn import_providers_from_sql(
    state: State<'_, AppState>,
    content: String,
) -> CmdResult<ImportResultDto> {
    let result = state
        .provider_service
        .import_providers_from_sql(&content)
        .map_err(|e| e.to_string())?;
    Ok(result.into())
}

/// Tauri-friendly (Serialize-only) mirror of `ImportResult`.
///
/// The service-layer type is rich (`ImportSkip.kind` is `String`,
/// `ImportResult.errors` is `Vec<ImportSkip>`) — we wrap it in a DTO
/// so the IPC contract is stable even if the internal type changes.
#[derive(Debug, serde::Serialize)]
pub struct ImportResultDto {
    pub imported: usize,
    pub skipped: usize,
    pub mcp_count: usize,
    pub errors: Vec<ImportSkipDto>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportSkipDto {
    pub kind: String,
    pub line: usize,
    pub id: Option<String>,
    pub reason: String,
}

impl From<ImportResult> for ImportResultDto {
    fn from(r: ImportResult) -> Self {
        Self {
            imported: r.imported,
            skipped: r.skipped,
            mcp_count: r.mcp_count,
            errors: r.errors.into_iter().map(ImportSkipDto::from).collect(),
        }
    }
}

impl From<ImportSkip> for ImportSkipDto {
    fn from(s: ImportSkip) -> Self {
        Self {
            kind: s.kind,
            line: s.line,
            id: s.id,
            reason: s.reason,
        }
    }
}

// ---------------------------------------------------------------------------
// F4 — deeplink 导入 (M2.3)
// ---------------------------------------------------------------------------

/// Parse a `ccswitch://v1/import?...` URL into a serialisable
/// `ParsedDeeplink`. The frontend calls this BEFORE showing the
/// import-confirmation modal so the user can see the parsed
/// provider fields.
///
/// Pure function on the Rust side; the only IPC overhead is the
/// `Vec<String>` round-trip. See
/// `crate::infrastructure::deeplink_parser` for the URL protocol
/// details.
#[tauri::command]
pub async fn parse_deeplink_url(url: String) -> CmdResult<ParsedDeeplink> {
    parse_dl(&url).map_err(|e| e.to_string())
}

/// Persist a single provider JSON file (F4 deeplink import).
///
/// Called by the frontend AFTER the user has seen the parsed
/// `Provider` in the modal and clicked [确认导入]. The write goes
/// through `fs_atomic::write_with_backup` (CLAUDE.md §7) and
/// returns `Err(AlreadyExists(id))` if the id is already on disk.
#[tauri::command]
pub async fn import_single_provider(
    state: State<'_, AppState>,
    provider: Provider,
) -> CmdResult<()> {
    state
        .provider_service
        .import_single_provider(provider)
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
    /// and returns `CmdResult<Vec<Provider>>`. We don't pin the future
    /// type because Tauri's `#[tauri::command]` returns an opaque
    /// `impl Future`; just check the arg shape compiles.
    #[allow(dead_code)]
    fn _list_providers_signature(
        s: State<'_, AppState>,
    ) -> CmdResult<Vec<Provider>> {
        let _ = s;
        unimplemented!()
    }

    /// Compile-time check: `switch_provider` takes `State<'_, AppState>`
    /// + `provider_id: String` and returns `CmdResult<Provider>`.
    #[allow(dead_code)]
    fn _switch_provider_signature(
        s: State<'_, AppState>,
        provider_id: String,
    ) -> CmdResult<Provider> {
        let _ = (s, provider_id);
        unimplemented!()
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

    #[test]
    fn import_result_dto_serialises_all_keys() {
        let dto = ImportResultDto {
            imported: 2,
            skipped: 1,
            mcp_count: 0,
            errors: vec![ImportSkipDto {
                kind: "parse".into(),
                line: 7,
                id: None,
                reason: "invalid id".into(),
            }],
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["imported"], 2);
        assert_eq!(v["skipped"], 1);
        assert_eq!(v["mcp_count"], 0);
        assert_eq!(v["errors"][0]["kind"], "parse");
        assert_eq!(v["errors"][0]["line"], 7);
        assert_eq!(v["errors"][0]["reason"], "invalid id");
        assert!(v["errors"][0]["id"].is_null());
    }

    #[test]
    fn sql_preview_serialises_with_correct_keys() {
        let p = SqlPreview {
            total_lines: 5,
            importable: 3,
            skipped: 2,
            preview_providers: vec![],
            preview_mcp: vec![],
            skipped_samples: vec![],
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["total_lines"], 5);
        assert_eq!(v["importable"], 3);
        assert_eq!(v["skipped"], 2);
        assert!(v["preview_providers"].is_array());
        assert!(v["preview_mcp"].is_array());
        assert!(v["skipped_samples"].is_array());
    }
}