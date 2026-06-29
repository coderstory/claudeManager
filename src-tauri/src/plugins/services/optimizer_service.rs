//! Optimizer-service plugin (Phase 45).
//!
//! Composes the 13 `OptimizerRule` instances and scans settings.json +
//! providers/ + mcp.json. No service-level deps.

use std::sync::Arc;

use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::optimizer_service::OptimizerService;

pub struct OptimizerServicePlugin;

impl IPlugin for OptimizerServicePlugin {
    fn id(&self) -> &'static str {
        "optimizer-service"
    }
    fn name(&self) -> &'static str {
        "Optimizer Service"
    }
    fn depends_on(&self) -> Vec<&'static str> {
        Vec::new()
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let svc = OptimizerService::new(paths);
        let registry = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry.register_arc::<OptimizerService>(Arc::new(svc));
        Ok(())
    }
}