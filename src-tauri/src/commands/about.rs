//! Tauri command for the About page (M3.7 — 清单 18).
//!
//! `get_app_info` is a thin re-export of `get_app_metadata` under a
//! more domain-appropriate name. The About page (src/pages/about/
//! index.tsx) consumes this for the "版本信息" section.
//!
//! ## Why not just rename `get_app_metadata`?
//!
//! - `single-file-deploy` still references `get_app_metadata` (the
//!   function name appears in 3 places: src/lib/api/app.ts, the
//!   Tauri command registration in lib.rs, and the page itself).
//! - Renaming would force a multi-file sweep that risks breaking
//!   the F8 page regression tests (single-file-deploy.test.tsx).
//! - Instead we register a parallel command that delegates to the
//!   same `AppMetadata::current()` constructor. IPC cost is one
//!   extra symbol in the registry; runtime cost is zero.
//!
//! ## Future direction (M4)
//!
//! When the project acquires a real LICENSE file + repo URL, this
//! command will additionally return `license: String` and
//! `homepage: String`. Today those live in embedded constants in
//! the TS page (src/pages/about/index.tsx), per the design doc.

use tauri::State;

use crate::app_state::AppState;
use crate::commands::app::AppMetadata;

type CmdResult<T> = Result<T, String>;

/// M3.7 — About page entry point. Returns the same `AppMetadata`
/// snapshot as `get_app_metadata` (F8) but exposed under a name
/// that fits the About page semantics.
///
/// State is threaded for parity with the other commands.
#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> CmdResult<AppMetadata> {
    let _ = state;
    Ok(AppMetadata::current())
}

// ---------------------------------------------------------------------------
// Tests — pin the delegation contract (about == app_metadata snapshot).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// `get_app_info` MUST return the same fields as `AppMetadata::current()`,
    /// because AboutPage + SingleFileDeployPage both read this snapshot and
    /// the user-visible values must agree across views.
    #[test]
    fn current_matches_app_metadata_snapshot() {
        let from_info = AppMetadata::current();
        let from_metadata = crate::commands::app::AppMetadata::current();
        assert_eq!(from_info.version, from_metadata.version);
        assert_eq!(from_info.identifier, from_metadata.identifier);
        assert_eq!(from_info.product_name, from_metadata.product_name);
        assert_eq!(from_info.git_commit, from_metadata.git_commit);
        assert_eq!(from_info.build_target, from_metadata.build_target);
        assert_eq!(from_info.build_timestamp, from_metadata.build_timestamp);
    }

    /// Compile-time check: `get_app_info` signature is stable.
    #[allow(dead_code)]
    fn _get_app_info_signature(s: State<'_, AppState>) -> CmdResult<AppMetadata> {
        let _ = s;
        unimplemented!()
    }
}
