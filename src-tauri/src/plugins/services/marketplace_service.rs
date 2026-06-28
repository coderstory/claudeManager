//! Marketplace-service plugin (Phase 45).
//!
//! Clones git repos into `<app_data>/marketplaces/<slug>/`, scans
//! resources, copies selected ones into `~/.claude/<subdir>/`. Git
//! access goes through `IPlatformGitHost` (Windows: GitHostCli,
//! macOS: MacGitHost).

use std::sync::Arc;

use crate::platform::runtime;
use crate::plugins::traits::{IPlugin, PluginContext, PluginError};
use crate::services::marketplace_service::MarketplaceService;

pub struct MarketplaceServicePlugin;

impl IPlugin for MarketplaceServicePlugin {
    fn id(&self) -> &'static str {
        "marketplace-service"
    }
    fn name(&self) -> &'static str {
        "Marketplace Service"
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
        let marketplaces_dir = paths.marketplaces_dir.clone();
        let svc = MarketplaceService::new(marketplaces_dir, claude_dir, runtime::git_host());
        let registry = ctx
            .services
            .as_mut()
            .ok_or_else(|| PluginError::InitFailed("services registry not available".into()))?;
        registry.register_arc::<MarketplaceService>(Arc::new(svc));
        Ok(())
    }
}