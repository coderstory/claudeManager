//! Backup-service plugin (Phase 45).
//!
//! Depends on `history-service` so `BackupService::with_history` can
//! be wired at construction time. Each new `.bak.<ts>` file written
//! by F13 triggers one row in `backup_history` via the injected
//! `HistoryService` Arc.

use std::sync::Arc;

use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::backup_service::BackupService;
use crate::services::history_service::HistoryService;

pub struct BackupServicePlugin;

impl IPlugin for BackupServicePlugin {
    fn id(&self) -> &'static str {
        "backup-service"
    }
    fn name(&self) -> &'static str {
        "Backup Service"
    }
    fn depends_on(&self) -> Vec<&'static str> {
        vec!["history-service"]
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let registry = ctx
            .services
            .as_ref()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        let history_arc: Arc<HistoryService> = registry
            .get::<HistoryService>()
            .ok_or_else(|| PluginError::InitFailed("history-service not registered".into()))?;

        let svc = BackupService::new(paths).with_history(history_arc);

        let registry_mut = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry_mut.register_arc::<BackupService>(Arc::new(svc));
        Ok(())
    }
}