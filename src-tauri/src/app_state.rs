//! Shared Tauri state.
//!
//! `AppState` is the single struct held in Tauri's `State<>` and shared
//! across all commands. Currently it owns:
//!
//! - `paths: AppPaths` — resolved once at startup via `IPlatformPaths`,
//!   cached for the lifetime of the process. Commands and services read
//!   from this; they never call `paths.resolve()` again.
//!
//! Per CLAUDE.md §3.2: services must NOT call `IPlatformPaths` directly
//! when running inside a Tauri command — they read `AppPaths` from state.
//! This guarantees `ensure_dirs` was called exactly once at startup.

use std::sync::Arc;

use crate::platform::{runtime, AppPaths};

/// Singleton Tauri state.
pub struct AppState {
    /// Resolved at startup; immutable for the process lifetime.
    pub paths: AppPaths,
    /// Shared service instances. `Arc` so the same instance is used by
    /// any future commands that need cross-command caching (e.g. F19
    /// backup cache). M2.1 only uses `provider_service`.
    pub provider_service: Arc<crate::services::provider_service::ProviderService>,
}

impl AppState {
    /// Build the state by resolving `AppPaths` from the current OS's
    /// `IPlatformPaths` impl and creating the services that need it.
    ///
    /// MUST be called from `lib.rs::run` *after* `platform::init_for_runtime`
    /// and *after* `ensure_dirs` so all app-data subdirs exist.
    pub fn build() -> Self {
        let paths_impl = runtime::paths();
        let paths = paths_impl.resolve();
        // We intentionally swallow the error here — if ensure_dirs fails
        // the user has bigger problems and the first command will surface
        // the I/O error with a clear path.
        let _ = paths_impl.ensure_dirs();
        let provider_service = Arc::new(
            crate::services::provider_service::ProviderService::new(paths.clone()),
        );
        Self {
            paths,
            provider_service,
        }
    }
}