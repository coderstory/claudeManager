//! Tauri command surface.
//!
//! Each submodule exports the `#[tauri::command]` functions wired up
//! in [`crate::lib::run`] via `tauri::Builder::invoke_handler`. The
//! split mirrors the platform layer: business code goes through these
//! commands (or through [`crate::services`], which the commands
//! dispatch into) — never directly through `tauri_plugin_*` crates
//! from the frontend.
//!
//! ## Note on `tauri::generate_handler!` paths
//!
//! The macro looks up the `__cmd__<name>` shim at the function's
//! **defining module**, not at a re-export. So in `lib.rs` we always
//! reference commands by their full path
//! (`commands::autostart::get_autostart_status`), never via
//! `commands::<alias>`.

pub mod app;
pub mod autostart;
pub mod backup;
pub mod fs;
pub mod marketplace;
pub mod mcp;
pub mod optimizer;
pub mod providers;
pub mod resource;
pub mod usage;