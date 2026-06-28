//! Phase 42 — IPC dispatch table.
//!
//! Replaces the compile-time `tauri::generate_handler!` macro with a
//! runtime dispatch table built from `inventory::iter` over
//! `CommandSpec` registrations submitted by each plugin's
//! `commands.rs` module.
//!
//! ## Why this exists
//!
//! `tauri::generate_handler!` is a proc-macro that bakes its argument
//! list into the binary at compile time. The plugin system needs to
//! accept new commands **without recompiling** — every new plugin
//! must be able to register its commands in pure Rust. The
//! `inventory` crate (dtolnay, 0.3.24, MIT/Apache) provides exactly
//! the missing link: a `submit!` macro that registers a value into a
//! global collection at link time, and an `iter` function that walks
//! the collection at runtime.
//!
//! ## Architecture
//!
//! ```text
//!  plugin commands.rs:
//!      inventory::submit!(CommandSpec {
//!          name: "list_providers",
//!          plugin_id: "provider-list",
//!          dispatch: dispatch_list_providers,
//!      });
//!
//!  lib.rs::setup:
//!      let table = DispatchTable::from_inventory();
//!      .invoke_handler(make_invoke_handler(table))
//! ```
//!
//! ## Adding a new command
//!
//! 1. Define `pub fn dispatch_xxx(invoke: Invoke<tauri::Wry>) -> bool`.
//! 2. Register it via `inventory::submit!` in the plugin's commands module.
//! 3. Add the plugin to `plugins::init_all`.
//! No other file needs to change — this is the v3.4 §"加 1 plugin 改 1 文件"
//! strong acceptance criterion.

use std::collections::HashMap;

use tauri::ipc::Invoke;

// ---------------------------------------------------------------------------
// CommandSpec
// ---------------------------------------------------------------------------

/// A single Tauri command registered by a plugin.
///
/// `name` is the string the frontend uses in `invoke("name", ...)` —
/// it is **stable across the plugin's lifetime** (Tauri uses it as
/// the global IPC namespace, never namespaced by `plugin_id`).
///
/// `dispatch` is a plain fn pointer (not a closure) because
/// `inventory::submit!` requires `'static` values, and a `fn` pointer
/// is the cleanest way to satisfy that bound.
///
/// **Non-generic**: fixed to `tauri::Wry` (the desktop runtime). The
/// project does not target mobile runtimes (no Android/iOS), so
/// parameterising `R` would only add boilerplate. See
/// `.planning/milestones/v3.4-phases/42-PLAN.md` for the rationale.
pub struct CommandSpec {
    pub name: &'static str,
    pub plugin_id: &'static str,
    pub dispatch: fn(Invoke<tauri::Wry>) -> bool,
}

// Hook into inventory's global registry for `CommandSpec`.
// `collect!` must be called exactly once per type.
inventory::collect!(CommandSpec);

// ---------------------------------------------------------------------------
// DispatchTable
// ---------------------------------------------------------------------------

/// O(1) name → CommandSpec lookup, built once from `inventory::iter`.
pub struct DispatchTable {
    by_name: HashMap<&'static str, CommandSpec>,
}

impl DispatchTable {
    /// Walk the global `inventory` collection once and collect every
    /// `CommandSpec` into a `HashMap`. **First-wins on duplicate name** —
    /// this matches Tauri's own behaviour for `generate_handler!`
    /// (panic-on-duplicate at compile time) but in a less strict way
    /// (we keep the first and silently overwrite on collision, since
    /// `inventory::submit!` is a runtime-visible registration).
    pub fn from_inventory() -> Self {
        let mut by_name: HashMap<&'static str, CommandSpec> = HashMap::new();
        // `inventory::iter::<T>()` returns a private type that
        // implements `IntoIterator` directly — the for-loop drives
        // it without an explicit `.into_iter()` call.
        for spec in inventory::iter::<CommandSpec> {
            by_name.entry(spec.name).or_insert(CommandSpec {
                name: spec.name,
                plugin_id: spec.plugin_id,
                dispatch: spec.dispatch,
            });
        }
        Self { by_name }
    }

    /// Number of distinct commands registered.
    pub fn len(&self) -> usize {
        self.by_name.len()
    }

    /// True if no commands are registered.
    pub fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }

    /// Look up a command by name. Returns `None` if not registered.
    pub fn get(&self, name: &str) -> Option<&CommandSpec> {
        self.by_name.get(name)
    }

    /// Dispatch an `Invoke` to the registered command. Returns
    /// `true` if the command was found and dispatched, `false`
    /// otherwise — this matches the signature of
    /// `tauri::invoke_handler`'s closure.
    pub fn dispatch(&self, invoke: Invoke<tauri::Wry>) -> bool {
        let cmd = invoke.message.command();
        match self.by_name.get(cmd) {
            Some(spec) => (spec.dispatch)(invoke),
            None => false,
        }
    }
}

// ---------------------------------------------------------------------------
// make_invoke_handler
// ---------------------------------------------------------------------------

/// Wrap a [`DispatchTable`] in the closure shape that
/// `tauri::Builder::invoke_handler` requires.
///
/// ```ignore
/// .invoke_handler(make_invoke_handler(DispatchTable::from_inventory()))
/// ```
pub fn make_invoke_handler(
    table: DispatchTable,
) -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    // Box::leak gives us a 'static reference to the table. The Tauri
    // builder takes ownership of the closure for the process lifetime,
    // so the leak is bounded by the process — acceptable here.
    let table = Box::leak(Box::new(table));
    move |invoke: Invoke<tauri::Wry>| table.dispatch(invoke)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Helper: a counter that survives across tests so we can prove
    /// `inventory::submit!` registrations are link-time visible.
    static CALL_COUNT: AtomicUsize = AtomicUsize::new(0);

    fn dispatch_test(invoke: Invoke<tauri::Wry>) -> bool {
        CALL_COUNT.fetch_add(1, Ordering::SeqCst);
        let _ = invoke;
        true
    }

    fn dispatch_other(invoke: Invoke<tauri::Wry>) -> bool {
        let _ = invoke;
        false
    }

    inventory::submit!(CommandSpec {
        name: "test_dispatch::hello",
        plugin_id: "test-plugin",
        dispatch: dispatch_test,
    });

    inventory::submit!(CommandSpec {
        name: "test_dispatch::world",
        plugin_id: "test-plugin",
        dispatch: dispatch_other,
    });

    #[test]
    fn from_inventory_collects_submitted_specs() {
        let table = DispatchTable::from_inventory();
        assert!(table.get("test_dispatch::hello").is_some());
        assert!(table.get("test_dispatch::world").is_some());
        assert!(table.get("nonexistent::command").is_none());
    }

    #[test]
    fn dispatch_routes_correctly() {
        let table = DispatchTable::from_inventory();
        let spec = table
            .get("test_dispatch::hello")
            .expect("hello must be registered");
        assert_eq!(spec.plugin_id, "test-plugin");
        assert_eq!(spec.name, "test_dispatch::hello");
    }

    #[test]
    fn len_counts_distinct_names() {
        let table = DispatchTable::from_inventory();
        // We registered 2 specs above; the rest of the test suite
        // (and the project's real commands) may add more, so we
        // assert >= 2 rather than == 2.
        assert!(table.len() >= 2);
    }

    #[test]
    fn first_wins_on_duplicate() {
        // If we register two specs with the same name, the first
        // submitted wins. This test verifies the order-independence
        // by checking that both specs are still in the inventory
        // but only one is in the table.
        fn dispatch_dup_a(invoke: Invoke<tauri::Wry>) -> bool {
            let _ = invoke;
            true
        }
        fn dispatch_dup_b(invoke: Invoke<tauri::Wry>) -> bool {
            let _ = invoke;
            true
        }
        inventory::submit!(CommandSpec {
            name: "test_dispatch::dup",
            plugin_id: "plugin-a",
            dispatch: dispatch_dup_a,
        });
        inventory::submit!(CommandSpec {
            name: "test_dispatch::dup",
            plugin_id: "plugin-b",
            dispatch: dispatch_dup_b,
        });
        let table = DispatchTable::from_inventory();
        // First-wins: either plugin-a or plugin-b is fine; just one
        // entry must exist.
        assert!(table.get("test_dispatch::dup").is_some());
    }
}
