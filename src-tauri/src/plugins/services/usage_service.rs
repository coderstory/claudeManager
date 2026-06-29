//! Usage-service plugin (Phase 45).
//!
//! Depends on `history-service` so every fresh usage snapshot writes
//! one row to `usage_history`. The 5-minute TTL cache lives inside
//! the service itself; Phase 45 doesn't change it.

use std::sync::Arc;

use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::history_service::HistoryService;
use crate::services::usage_service::UsageService;

pub struct UsageServicePlugin;

impl IPlugin for UsageServicePlugin {
    fn id(&self) -> &'static str {
        "usage-service"
    }
    fn name(&self) -> &'static str {
        "Usage Service"
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

        let svc = UsageService::new(paths).with_history(history_arc);

        let registry_mut = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry_mut.register_arc::<UsageService>(Arc::new(svc));
        Ok(())
    }
}