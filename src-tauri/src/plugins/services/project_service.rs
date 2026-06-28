//! Project-service plugin (Phase 45).
//!
//! Owns `<app_data>/projects.json` for the 5 project commands (list
//! / add / remove / switch / current). Indirectly feeds
//! `IPlatformPaths::active_root_dir()` (Windows impl reads the same
//! file). No service-level deps.

use std::sync::Arc;

use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::project_service::ProjectService;

pub struct ProjectServicePlugin;

impl IPlugin for ProjectServicePlugin {
    fn id(&self) -> &'static str {
        "project-service"
    }
    fn name(&self) -> &'static str {
        "Project Service"
    }
    fn depends_on(&self) -> Vec<&'static str> {
        Vec::new()
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let svc = ProjectService::new(paths);
        let registry = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry.register_arc::<ProjectService>(Arc::new(svc));
        Ok(())
    }
}