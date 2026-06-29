//! History-service plugin (Phase 45).
//!
//! Owns the SQLite history db (`<app_data>/history.db`). All other
//! services that need to write history rows (F7 usage, F13 backup)
//! depend on this plugin so `HistoryService` is registered before
//! they `init`.
//!
//! ## Failure handling (G9 — best-effort)
//!
//! 3-tier fallback borrowed from `app_state.rs::build` (the previous
//! monolithic initializer):
//!
//! 1. Open the on-disk `<app_data>/history.db`. Run migrations.
//! 2. On failure, open an **in-memory** db and run migrations on it.
//!    This still satisfies the schema expectations but doesn't
//!    persist across restarts.
//! 3. On second failure, open a raw `Connection::open_in_memory()` with
//!    no migrations (last-ditch fallback so the app still starts).
//!
//! Every tier registers the resulting `Arc<HistoryService>` so the
//! registry is never empty after `init` returns.

use std::sync::{Arc, Mutex};

use crate::infrastructure::sqlite::history_db;
use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::history_service::HistoryService;

pub struct HistoryServicePlugin;

impl IPlugin for HistoryServicePlugin {
    fn id(&self) -> &'static str {
        "history-service"
    }
    fn name(&self) -> &'static str {
        "History Service"
    }
    /// No deps — history is the deepest layer.
    fn depends_on(&self) -> Vec<&'static str> {
        Vec::new()
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let history_db_path = paths.history_db.clone();
        let claude_dir = paths
            .claude_dir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| paths.home.join(".claude"));
        let backups_dir = paths.backups_dir.clone();

        let svc: Arc<HistoryService> =
            match history_db::open_history_db(&history_db_path) {
                Ok(conn) => {
                    let svc = HistoryService::new(conn);
                    if let Err(e) = svc.init() {
                        log::warn!("[history-service] init (schema check) failed: {e}");
                    }
                    // First-launch backfill — scan the existing
                    // `.bak.<ts>` files so a returning user sees their
                    // old backups in the F13 timeline. Failure here is
                    // also best-effort (G9).
                    match svc.backfill_bak(&backups_dir, Some(&claude_dir)) {
                        Ok(n) if n > 0 => {
                            log::info!("[history-service] backfilled {n} backups into history");
                        }
                        Ok(_) => {}
                        Err(e) => log::warn!("[history-service] backfill_bak failed: {e}"),
                    }
                    Arc::new(svc)
                }
                Err(e) => {
                    log::warn!(
                        "[history-service] open_history_db failed: {e} — falling back to in-memory"
                    );
                    match history_db::open_in_memory_db() {
                        Ok(conn) => Arc::new(HistoryService::new(conn)),
                        Err(e2) => {
                            log::warn!(
                                "[history-service] in-memory open also failed: {e2} — last-ditch raw"
                            );
                            let conn = rusqlite::Connection::open_in_memory()
                                .expect("in-memory sqlite must always open");
                            Arc::new(HistoryService::new(Arc::new(Mutex::new(conn))))
                        }
                    }
                }
            };

        // G9 — always register; never panic on init.
        let registry = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry.register_arc::<HistoryService>(svc);
        Ok(())
    }
}