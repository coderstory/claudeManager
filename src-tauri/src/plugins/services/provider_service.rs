//! Provider-service plugin (Phase 45).
//!
//! Last service to init — depends on both `backup-service` (so
//! updates/deletes auto-backup via F13) and `history-service` (so
//! state changes log to history).

use std::sync::Arc;

use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::backup_service::BackupService;
use crate::services::provider_service::ProviderService;

pub struct ProviderServicePlugin;

impl IPlugin for ProviderServicePlugin {
    fn id(&self) -> &'static str {
        "provider-service"
    }
    fn name(&self) -> &'static str {
        "Provider Service"
    }
    fn depends_on(&self) -> Vec<&'static str> {
        vec!["backup-service", "history-service"]
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let registry = ctx
            .services
            .as_ref()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        let backup_arc: Arc<BackupService> = registry
            .get::<BackupService>()
            .ok_or_else(|| PluginError::InitFailed("backup-service not registered".into()))?;

        let svc = ProviderService::new(paths).with_backup_service(backup_arc);

        let registry_mut = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry_mut.register_arc::<ProviderService>(Arc::new(svc));
        Ok(())
    }
}