//! Tauri commands for F8 — 单文件部署 / app metadata (M2.8).
//!
//! `get_app_metadata` is a read-only command that returns build-time
//! and runtime info for the SingleFileDeployPage. The page uses it to
//! show the user "what version of the app is running, and what
//! commit/target it was built from" before they go off and run
//! `scripts/build-installer.sh`.
//!
//! ## Field sources (build-time)
//!
//! - `version`         — `env!("CARGO_PKG_VERSION")` (Cargo.toml)
//! - `identifier`      — hard-coded const, kept in sync with
//!                        `tauri.conf.json` `identifier` (manual; we do
//!                        NOT parse the JSON at runtime — the bundle
//!                        identifier is a compile-time concern).
//! - `product_name`    — same approach as `identifier`.
//! - `git_commit`      — `env!("BUILD_GIT_COMMIT")` from `build.rs`.
//! - `build_target`    — `std::env::consts::OS` + `ARCH`.
//! - `build_timestamp` — `env!("BUILD_TIMESTAMP")` parsed to i64.
//!
//! ## Why not parse `tauri.conf.json` at runtime?
//!
//! - The file is bundled into the binary by `tauri::generate_context!`
//!   already, but the public Tauri API does not expose it as a
//!   structured object on a stable channel.
//! - Hard-coded mirrors are 2 strings; a manifest validator (M3+) can
//!   guard drift if needed.
//!
//! ## Errors
//!
//! `get_app_metadata` is infallible by construction — every field
//! has a fallback. Returning `CmdResult` keeps the IPC signature
//! consistent with the rest of the surface (Tauri requires
//! `Result<T, String>` to span threads). The `String` error is
//! reserved for future fields that may legitimately fail.

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;

type CmdResult<T> = Result<T, String>;

/// Mirror of `tauri.conf.json` `productName`. Kept in sync manually;
/// see module docstring.
const PRODUCT_NAME: &str = "ClaudeManager";

/// Mirror of `tauri.conf.json` `identifier`. Kept in sync manually;
/// see module docstring.
///
/// NOTE: bundle identifier (used for macOS bundle id / Windows
/// installer) stays as `IDENTIFIER` (= `com.claudeconfigmanager.app`).
/// `DISPLAY_IDENTIFIER` is a separate constant returned by the
/// IPC to the About page so the displayed name matches the
/// rebrand without touching the system-level bundle id.
///
/// Reserved by design (CLAUDE.md §6.5) — even though `current()`
/// returns `DISPLAY_IDENTIFIER`, this constant must stay available
/// for the system-level bundle id (macOS bundle / Windows
/// installer / registry / mutex name / AppData path). M3.0.3
/// rebrand preserved it on purpose; do not delete.
#[allow(dead_code)]
const IDENTIFIER: &str = "com.claudeconfigmanager.app";

/// Display-only identifier shown on the About page. Independent
/// of `IDENTIFIER` (the bundle id) — changing this has no effect
/// on the OS / installer / registry.
const DISPLAY_IDENTIFIER: &str = "com.claudemanager.app";

/// Snapshot of "which app is running" — version, build provenance,
/// target triple. Returned to the frontend by `get_app_metadata`.
///
/// Field names are snake_case so they match the TS mirror after
/// Tauri's automatic camelCase → snake_case roundtrip is bypassed
/// (we declare `serde(rename_all = "snake_case")` for clarity).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AppMetadata {
    /// CARGO_PKG_VERSION (semver from Cargo.toml).
    pub version: String,
    /// Display identifier, e.g. "com.claudemanager.app". Independent
    /// of the system bundle id (which stays "com.claudeconfigmanager.app"
    /// for OS / installer compatibility).
    pub identifier: String,
    /// Product name, e.g. "ClaudeManager".
    pub product_name: String,
    /// Short git SHA of HEAD at build time, or "unknown".
    pub git_commit: String,
    /// "<os>/<arch>", e.g. "windows/x86_64".
    pub build_target: String,
    /// Unix epoch seconds at build time. 0 means unavailable.
    pub build_timestamp: i64,
}

impl AppMetadata {
    /// Build the snapshot from compile-time `env!` constants. Pure;
    /// no I/O. Exposed as `pub` so the integration test in
    /// `tests/about.rs` can call it without constructing a Tauri
    /// `State` (it exercises the same kernel as `get_app_metadata`).
    pub fn current() -> Self {
        let git_commit = env!("BUILD_GIT_COMMIT").to_string();
        let build_timestamp: i64 = env!("BUILD_TIMESTAMP").parse().unwrap_or(0);
        let build_target = format!(
            "{}/{}",
            std::env::consts::OS,
            std::env::consts::ARCH,
        );
        Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            identifier: DISPLAY_IDENTIFIER.to_string(),
            product_name: PRODUCT_NAME.to_string(),
            git_commit,
            build_target,
            build_timestamp,
        }
    }
}

/// F8 — return the running app's metadata for the SingleFileDeployPage.
///
/// `state` is unused today but threaded for parity with the other
/// commands and so future fields (e.g. install path from
/// `state.paths`) don't change the IPC signature.
#[tauri::command]
pub async fn get_app_metadata(state: State<'_, AppState>) -> CmdResult<AppMetadata> {
    let _ = state;
    Ok(AppMetadata::current())
}

// ---------------------------------------------------------------------------
// Tests — pin field non-emptiness, target shape, identifier mirror.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_has_non_empty_required_fields() {
        let m = AppMetadata::current();
        assert!(!m.version.is_empty(), "version should never be empty");
        assert!(!m.identifier.is_empty(), "identifier should never be empty");
        assert!(!m.product_name.is_empty(), "product_name should never be empty");
        assert!(!m.git_commit.is_empty(), "git_commit defaults to 'unknown'");
        assert!(!m.build_target.is_empty(), "build_target derived from std::env::consts");
    }

    #[test]
    fn build_target_has_slash_separator() {
        let m = AppMetadata::current();
        assert!(
            m.build_target.contains('/'),
            "build_target should be 'os/arch', got: {}",
            m.build_target
        );
        let parts: Vec<&str> = m.build_target.split('/').collect();
        assert_eq!(parts.len(), 2, "exactly two segments: os and arch");
        assert!(!parts[0].is_empty());
        assert!(!parts[1].is_empty());
    }

    #[test]
    fn identifier_returns_display_value_for_about_page() {
        // DISPLAY_IDENTIFIER is the value returned by IPC to the
        // About page — independent of the system bundle id
        // (`IDENTIFIER` = "com.claudeconfigmanager.app"), which
        // stays unchanged for OS / installer compatibility.
        assert_eq!(
            AppMetadata::current().identifier,
            "com.claudemanager.app"
        );
    }

    #[test]
    fn product_name_mirrors_tauri_conf() {
        assert_eq!(AppMetadata::current().product_name, "ClaudeManager");
    }

    #[test]
    fn version_matches_cargo_pkg_version() {
        // Sanity: env!("CARGO_PKG_VERSION") is what `version` returns.
        assert_eq!(AppMetadata::current().version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn build_timestamp_is_non_negative() {
        // 0 means "couldn't read clock at build time" — still valid.
        // Negative would mean the parser flipped sign.
        assert!(AppMetadata::current().build_timestamp >= 0);
    }

    #[test]
    fn metadata_serializes_to_snake_case_json() {
        let m = AppMetadata::current();
        let json = serde_json::to_string(&m).unwrap();
        // The TS mirror in src/types/app.ts must use these exact keys.
        assert!(json.contains("\"version\""));
        assert!(json.contains("\"identifier\""));
        assert!(json.contains("\"product_name\""));
        assert!(json.contains("\"git_commit\""));
        assert!(json.contains("\"build_target\""));
        assert!(json.contains("\"build_timestamp\""));
        // No camelCase leakage.
        assert!(!json.contains("productName"));
        assert!(!json.contains("buildTarget"));
    }

    /// Compile-time check: `get_app_metadata` signature is stable.
    #[allow(dead_code)]
    fn _get_app_metadata_signature(s: State<'_, AppState>) -> CmdResult<AppMetadata> {
        let _ = s;
        unimplemented!()
    }
}
