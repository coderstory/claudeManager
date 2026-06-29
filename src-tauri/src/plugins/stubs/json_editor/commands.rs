//! F5 — JSON 编辑器 (plugin commands).
//!
//! Phase 42 — **0 backend commands**. The JSON Editor is a frontend-only
//! modal: file reads / writes / validation all happen in the React
//! layer via the `@uiw/react-json-view` editor surface. The Rust side
//! intentionally registers no `inventory::submit!(CommandSpec { .. })`
//! entries — the dispatch table for plugin_id `"json-editor"` is empty.
//!
//! This file exists only so the stub follows the same
//! `stubs/<id>/{mod.rs,commands.rs}` layout as marketplace / updater /
//! resource_browser, keeping the directory tree uniform across all 13
//! plugins. If a future phase needs to move file-editing commands here
//! (e.g. for F5 atomic write + backup), add dispatch fns + inventory
//! entries below and update `provider_list::commands` to remove any
//! duplicated `invoke` calls.