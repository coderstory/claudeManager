//! F5 — JSON 编辑器 (plugin).
//!
//! Phase 42 — subdirectory migration. This plugin is **frontend-only**:
//! the JSON Editor is a Tauri modal opened from settings, all logic
//! runs in the React layer. No backend commands are registered and no
//! `inventory::submit!(CommandSpec { .. })` entries exist. The
//! `commands` submodule is kept as a structural placeholder so the
//! stub follows the same layout as marketplace / updater / etc.
//!
//! See [`commands`] for the (currently empty) dispatch surface.

pub mod commands;

use super::super::traits::*;

pub struct JsonEditorPlugin;

impl IPlugin for JsonEditorPlugin {
    fn id(&self) -> &'static str {
        "json-editor"
    }
    fn name(&self) -> &'static str {
        "JSON 编辑器"
    }
}