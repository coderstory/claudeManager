//! Resource-service plugin (Phase 45).
//!
//! Scans 5 resource kinds (plugins / skills / commands / lsp / mcp)
//! under `<claude_dir>/`. Delegates file-manager reveals to
//! `IPlatformReveal` (WindowsReveal on Win, MacReveal stub on macOS).

use std::sync::Arc;

use crate::platform::runtime;
use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::resource_service::ResourceService;

pub struct ResourceServicePlugin;

impl IPlugin for ResourceServicePlugin {
    fn id(&self) -> &'static str {
        "resource-service"
    }
    fn name(&self) -> &'static str {
        "Resource Service"
    }
    fn depends_on(&self) -> Vec<&'static str> {
        Vec::new()
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let claude_dir = paths
            .claude_dir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| paths.home.join(".claude"));
        let svc = ResourceService::new(claude_dir, runtime::reveal());
        let registry = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry.register_arc::<ResourceService>(Arc::new(svc));
        Ok(())
    }
}