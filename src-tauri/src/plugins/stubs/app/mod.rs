//! F8 (removed M5 #18, kept for About page) — app metadata (plugin).

pub mod commands;

use super::super::traits::*;

pub struct AppPlugin;

impl IPlugin for AppPlugin {
    fn id(&self) -> &'static str {
        "app"
    }
    fn name(&self) -> &'static str {
        "App Metadata"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![]
    }
}
