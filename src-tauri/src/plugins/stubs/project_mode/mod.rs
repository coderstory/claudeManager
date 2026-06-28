//! F8/M3.10 — 项目模式 (plugin).

pub mod commands;

use super::super::traits::*;

pub struct ProjectModePlugin;

impl IPlugin for ProjectModePlugin {
    fn id(&self) -> &'static str { "project-mode" }
    fn name(&self) -> &'static str { "项目模式" }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/project".to_string(),
            plugin_id: "project-mode",
            display_name: "项目模式".to_string(),
        }]
    }
}