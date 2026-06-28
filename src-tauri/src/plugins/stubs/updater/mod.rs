//! F15 — 错误反馈 / 自动更新 (plugin).
//!
//! M4.3 ships the config-read surface (pubkey + endpoints) and a
//! `check_update` stub that returns "not implemented". The heavy
//! lifting (download / install) is owned by `tauri-plugin-updater`'s
//! built-in commands — this plugin only exposes the Rust-side config
//! reads the frontend needs.
//!
//! See [`commands`] for the dispatch fns and `inventory::submit!`
//! registrations.

pub mod commands;

use super::super::traits::*;

pub struct UpdaterPlugin;

impl IPlugin for UpdaterPlugin {
    fn id(&self) -> &'static str {
        "updater"
    }
    fn name(&self) -> &'static str {
        "自动更新"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/updater".to_string(),
            plugin_id: "updater",
            display_name: "自动更新".to_string(),
        }]
    }
}
