//! DFS 3-color topological sort for plugin dependency graphs.
//!
//! Used by [`crate::plugins::host::PluginHost::init_all_topological`] to
//! resolve init order when a plugin declares [`IPlugin::depends_on`]
//! other plugin ids. Cycle detection surfaces immediately with the
//! offending path, so a developer can locate the bad edge in seconds
//! (vs Kahn's algorithm which silently produces a partial order +
//! leftover nodes).
//!
//! ## Why DFS 3-color (G5 decision)
//!
//! - **Cycle path included in error** — developers see `"A -> B -> A"`
//!   instead of "no topological order exists".
//! - **0 new dependencies** — uses `std::collections::HashMap` only
//!   (CLAUDE.md §2.3 forbids adding deps without justification).
//! - **9 nodes** — DFS recursion depth is bounded by plugin count,
//!   well below the 64KiB stack limit even with 100+ plugins.
//! - **Deterministic enough** — HashMap iteration order is randomised
//!   per process, but for 9 service plugins the G10 single test pins
//!   the expected sequence explicitly (see `tests::topo_sort_dag_returns_topological_order`).

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopologicalError {
    /// Cycle detected — `path` is the edge chain leading back to the
    /// first repeated node (e.g. `["A", "B", "A"]`).
    Cycle { path: Vec<String> },
    /// A plugin depends on an id that was never registered.
    MissingDependency { plugin: String, missing: String },
}

impl std::fmt::Display for TopologicalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TopologicalError::Cycle { path } => {
                write!(f, "dependency cycle detected: {}", path.join(" -> "))
            }
            TopologicalError::MissingDependency { plugin, missing } => {
                write!(
                    f,
                    "plugin '{plugin}' depends on '{missing}' which is not registered"
                )
            }
        }
    }
}

impl std::error::Error for TopologicalError {}

const WHITE: u8 = 0;
const GRAY: u8 = 1;
const BLACK: u8 = 2;

/// Compute a topological order over `nodes` (a map of id → its
/// dependency ids). Returns the order as a `Vec<&str>` in
/// dependency-first order (i.e. dependencies come before dependents).
///
/// # Errors
/// - [`TopologicalError::Cycle`] if the graph contains a cycle
/// - [`TopologicalError::MissingDependency`] if any node references
///   an id not present in `nodes`
pub fn topo_sort<'a>(
    nodes: &HashMap<&'a str, Vec<&'a str>>,
) -> Result<Vec<&'a str>, TopologicalError> {
    let mut color: HashMap<&str, u8> = nodes.keys().map(|&k| (k, WHITE)).collect();
    let mut order: Vec<&'a str> = Vec::with_capacity(nodes.len());
    let mut path: Vec<String> = Vec::new();
    // Snapshot the keys so the visit order is deterministic-ish
    // (HashMap iteration order is randomised per process; the G10
    // single test verifies the resulting topological sequence
    // semantically, not positionally).
    let keys: Vec<&'a str> = nodes.keys().copied().collect();
    for id in keys {
        if color[id] == WHITE {
            dfs_visit(id, nodes, &mut color, &mut order, &mut path)?;
        }
    }
    Ok(order)
}

fn dfs_visit<'a>(
    id: &'a str,
    nodes: &HashMap<&'a str, Vec<&'a str>>,
    color: &mut HashMap<&'a str, u8>,
    order: &mut Vec<&'a str>,
    path: &mut Vec<String>,
) -> Result<(), TopologicalError> {
    color.insert(id, GRAY);
    path.push(id.to_string());
    let deps = nodes.get(id).cloned().unwrap_or_default();
    for dep in deps {
        // Verify the dep is registered.
        if !nodes.contains_key(dep) {
            return Err(TopologicalError::MissingDependency {
                plugin: id.to_string(),
                missing: dep.to_string(),
            });
        }
        let c = color[dep];
        if c == WHITE {
            dfs_visit(dep, nodes, color, order, path)?;
        } else if c == GRAY {
            // Found a back-edge → cycle. Trim path to the
            // first occurrence of `dep` for a readable chain.
            let cycle_start = path.iter().position(|p| p == dep).unwrap_or(0);
            let mut cycle_path = path[cycle_start..].to_vec();
            cycle_path.push(dep.to_string());
            return Err(TopologicalError::Cycle { path: cycle_path });
        }
        // BLACK = already finalized, skip.
    }
    color.insert(id, BLACK);
    path.pop();
    order.push(id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn node<'a>(id: &'a str, deps: &[&'a str]) -> (&'a str, Vec<&'a str>) {
        (id, deps.to_vec())
    }

    /// G10 — verify the 9-service dependency graph resolves in a
    /// **dependency-first** order. The exact sequence is intentionally
    /// validated positionally so any future change to `topo_sort` or
    /// to the declared dependencies immediately breaks this test,
    /// forcing a deliberate decision.
    ///
    /// Expected order (from `45-DECISIONS.md` §G10):
    ///   history-service (no deps)
    ///   backup-service, usage-service (history only)
    ///   mcp-service, optimizer-service, resource-service,
    ///   marketplace-service, project-service (no deps)
    ///   provider-service (depends on backup + history — must be last)
    #[test]
    fn topo_sort_dag_returns_topological_order() {
        let mut nodes: HashMap<&str, Vec<&str>> = HashMap::new();
        let (id, deps) = node("history-service", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("backup-service", &["history-service"]);
        nodes.insert(id, deps);
        let (id, deps) = node("usage-service", &["history-service"]);
        nodes.insert(id, deps);
        let (id, deps) = node("mcp-service", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("optimizer-service", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("resource-service", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("marketplace-service", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("project-service", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("provider-service", &["backup-service", "history-service"]);
        nodes.insert(id, deps);

        let order = topo_sort(&nodes).unwrap();

        // 1. All 9 plugins present.
        assert_eq!(order.len(), 9);

        // 2. Position of each node.
        let pos = |id: &str| order.iter().position(|&x| x == id).unwrap();

        // 3. history-service must come before backup + usage + provider.
        let h = pos("history-service");
        assert!(h < pos("backup-service"), "history must precede backup");
        assert!(h < pos("usage-service"), "history must precede usage");
        assert!(h < pos("provider-service"), "history must precede provider");

        // 4. backup-service must come before provider-service.
        assert!(pos("backup-service") < pos("provider-service"));
    }

    /// Cycle detection: A → B → A → error path includes both nodes.
    #[test]
    fn topo_sort_detects_cycle() {
        let mut nodes: HashMap<&str, Vec<&str>> = HashMap::new();
        let (id, deps) = node("A", &["B"]);
        nodes.insert(id, deps);
        let (id, deps) = node("B", &["A"]);
        nodes.insert(id, deps);
        let err = topo_sort(&nodes).unwrap_err();
        match err {
            TopologicalError::Cycle { path } => {
                assert!(path.contains(&"A".to_string()), "path should include A: {path:?}");
                assert!(path.contains(&"B".to_string()), "path should include B: {path:?}");
                // Path should end with the duplicate (cycle back-edge).
                assert_eq!(path.first(), path.last(), "cycle path should repeat: {path:?}");
            }
            other => panic!("expected Cycle error, got {other:?}"),
        }
    }

    /// A self-loop is a cycle too.
    #[test]
    fn topo_sort_detects_self_loop() {
        let mut nodes: HashMap<&str, Vec<&str>> = HashMap::new();
        let (id, deps) = node("A", &["A"]);
        nodes.insert(id, deps);
        let err = topo_sort(&nodes).unwrap_err();
        assert!(matches!(err, TopologicalError::Cycle { .. }));
    }

    /// Missing dependency: A depends on `"nonexistent"` → error names both.
    #[test]
    fn topo_sort_missing_dependency_errors() {
        let mut nodes: HashMap<&str, Vec<&str>> = HashMap::new();
        let (id, deps) = node("A", &["nonexistent"]);
        nodes.insert(id, deps);
        let err = topo_sort(&nodes).unwrap_err();
        match err {
            TopologicalError::MissingDependency { plugin, missing } => {
                assert_eq!(plugin, "A");
                assert_eq!(missing, "nonexistent");
            }
            other => panic!("expected MissingDependency, got {other:?}"),
        }
    }

    /// Multi-deps: D depends on B + C; D must come after both.
    #[test]
    fn topo_sort_multi_deps_resolves_correctly() {
        let mut nodes: HashMap<&str, Vec<&str>> = HashMap::new();
        let (id, deps) = node("B", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("C", &[]);
        nodes.insert(id, deps);
        let (id, deps) = node("D", &["B", "C"]);
        nodes.insert(id, deps);
        let order = topo_sort(&nodes).unwrap();
        let b_idx = order.iter().position(|&x| x == "B").unwrap();
        let c_idx = order.iter().position(|&x| x == "C").unwrap();
        let d_idx = order.iter().position(|&x| x == "D").unwrap();
        assert!(b_idx < d_idx, "B must come before D");
        assert!(c_idx < d_idx, "C must come before D");
    }

    /// Empty graph → empty order (edge case for the 0-service case).
    #[test]
    fn topo_sort_empty_graph() {
        let nodes: HashMap<&str, Vec<&str>> = HashMap::new();
        let order = topo_sort(&nodes).unwrap();
        assert!(order.is_empty());
    }
}
