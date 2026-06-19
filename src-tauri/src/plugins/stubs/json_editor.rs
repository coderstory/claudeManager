//! F5 — JSON 编辑器 (stub). Frontend-only modal; no route, no service.

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
