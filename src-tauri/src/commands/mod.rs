//! Tauri command surface.
//!
//! Each submodule exports the `#[tauri::command]` functions wired up
//! in [`crate::lib::run`] via `tauri::Builder::invoke_handler`. The
//! split mirrors the platform layer: business code goes through these
//! commands (or through [`crate::services`], which the commands
//! dispatch into) — never directly through `tauri_plugin_*` crates
//! from the frontend.
//!
//! M1.7 ships one command module: [`autostart`]. M2+ will add more
//! (provider list, MCP management, etc.) under their own F-number
//! subdirectory in `src-tauri/src/commands/`.
//!
//! ## Note on `tauri::generate_handler!` paths
//!
//! The macro looks up the `__cmd__<name>` shim at the function's
//! **defining module**, not at a re-export. So in `lib.rs` we always
//! reference commands by their full path
//! (`commands::autostart::get_autostart_status`), never via
//! `commands::<alias>`.

pub mod autostart;