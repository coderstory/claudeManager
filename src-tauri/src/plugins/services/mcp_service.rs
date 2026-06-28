//! Mcp-service plugin (Phase 45).
//!
//! Reads / writes `~/.claude/mcp.json`. No service-level deps — the
//! active-root indirection (project vs user mode) is handled at call
//! time via `McpService::with_root(...)`, not at construction time.

use std::sync::Arc;

use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::mcp_service::McpService;

pub struct McpServicePlugin;

impl IPlugin for McpServicePlugin {
    fn id(&self) -> &'static str {
        "mcp-service"
    }
    fn name(&self) -> &'static str {
        "MCP Service"
    }
    fn depends_on(&self) -> Vec<&'static str> {
        Vec::new()
    }

    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let paths = ctx.paths.resolve();
        let svc = McpService::new(paths);
        let registry = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry.register_arc::<McpService>(Arc::new(svc));
        Ok(())
    }
}