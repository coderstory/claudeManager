//! Plugin service registry — DI container for [`IPlugin::init`] and beyond.
//!
//! ## Phase 42 contract (D-45-A)
//!
//! This module's public API is **locked** by the v3.4 milestone
//! decision `D-45-A` (see `.planning/milestones/v3.4-DECISIONS.md`).
//! Phase 45 depends on this exact shape — any divergence must go through
//! the CLAUDE.md §2.5 negotiation process.
//!
//! ```text
//! pub fn new() -> Self;
//! pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>);
//! pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>;
//! pub fn contains<T: 'static>(&self) -> bool;
//! pub fn count(&self) -> usize;
//! ```
//!
//! ## Why Arc path?
//!
//! Nine services may mutually inject each other (A→B→C→A cycle). The
//! borrow checker rejects `&T` cycles; `Arc<T>` provides shared
//! ownership cheaply (nanosecond-scale clones) and matches the Phase 45
//! topological-init flow.
//!
//! ## Phase 42 status
//!
//! The registry is **constructed** in `lib.rs::setup` but stays empty
//! (no `register_arc` calls yet). Phase 45 will populate it during
//! `IPlugin::init`. The tests below pin the Phase 45 contract.

use std::any::{Any, TypeId};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

// ---------------------------------------------------------------------------
// ServiceRegistry
// ---------------------------------------------------------------------------

/// Type-erased, thread-unsafe service container.
///
/// "Thread-unsafe" is intentional: Phase 45 inserts happen during
/// `IPlugin::init` (single-threaded bootstrap), and reads happen via
/// `State<'_, Arc<ServiceRegistry>>` from Tauri commands. The interior
/// `RefCell` is enough — no `Mutex` overhead.
pub struct ServiceRegistry {
    map: RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
}

impl ServiceRegistry {
    /// Construct an empty registry.
    pub fn new() -> Self {
        Self {
            map: RefCell::new(HashMap::new()),
        }
    }

    /// Register a service by `Arc`. Phase 45 calls this from each
    /// plugin's `init` to publish its owned services for downstream
    /// plugins to consume via `get::<T>()`.
    ///
    /// Re-registering the same `T` **overwrites** — Phase 45 init
    /// order is responsible for ensuring the "last writer wins" is
    /// the correct behavior (no id collision today; future Phase 45
    /// may add a duplicate-detection log).
    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>) {
        self.map
            .borrow_mut()
            .insert(TypeId::of::<T>(), svc as Arc<dyn Any + Send + Sync>);
    }

    /// Look up a previously registered service by type. Returns `None`
    /// if no service of type `T` has been registered.
    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>> {
        self.map
            .borrow()
            .get(&TypeId::of::<T>())
            .and_then(|a| a.clone().downcast::<T>().ok())
    }

    /// Check whether a service of type `T` is registered.
    pub fn contains<T: 'static>(&self) -> bool {
        self.map.borrow().contains_key(&TypeId::of::<T>())
    }

    /// Number of distinct services registered.
    pub fn count(&self) -> usize {
        self.map.borrow().len()
    }
}

impl Default for ServiceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Marker service used by the tests. Each marker is a distinct
    /// type so `register_arc::<A>` doesn't collide with
    /// `register_arc::<B>` in the registry.
    struct A(u32);
    struct B(String);

    #[test]
    fn register_arc_then_get() {
        let r = ServiceRegistry::new();
        let svc = Arc::new(A(42));
        r.register_arc::<A>(svc);
        let got = r.get::<A>().expect("A should be registered");
        assert_eq!(got.0, 42);
    }

    #[test]
    fn register_arc_overwrites() {
        let r = ServiceRegistry::new();
        r.register_arc::<A>(Arc::new(A(1)));
        r.register_arc::<A>(Arc::new(A(2)));
        // Phase 45 init-order dependency: last writer wins.
        assert_eq!(r.get::<A>().unwrap().0, 2);
    }

    #[test]
    fn get_missing_returns_none() {
        let r = ServiceRegistry::new();
        assert!(r.get::<A>().is_none());
        assert!(r.get::<B>().is_none());
    }

    #[test]
    fn contains_distinguishes_types() {
        let r = ServiceRegistry::new();
        r.register_arc::<A>(Arc::new(A(0)));
        assert!(r.contains::<A>());
        assert!(!r.contains::<B>());
    }

    #[test]
    fn count_reflects_distinct_types() {
        let r = ServiceRegistry::new();
        assert_eq!(r.count(), 0);
        r.register_arc::<A>(Arc::new(A(0)));
        assert_eq!(r.count(), 1);
        r.register_arc::<B>(Arc::new(B("x".into())));
        assert_eq!(r.count(), 2);
        // Re-registering same type does NOT increase count.
        r.register_arc::<A>(Arc::new(A(99)));
        assert_eq!(r.count(), 2);
    }
}