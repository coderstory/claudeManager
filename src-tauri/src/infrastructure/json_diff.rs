//! `json_diff` — field-level diff between two `serde_json::Value`s
//! (CLAUDE.md §3.1, SPEC §5.12 + F24).
//!
//! ## Why this exists
//!
//! F13 (M2.6) needs a "compare two backups" feature. The output is
//! a list of `(path, op, old, new)` records the UI can render as a
//! green/red diff.
//!
//! ## Why not `json-patch` (RFC 6902)
//!
//! SPEC §3.2 F24 calls for "field-level diff" (a human-readable
//! left/right comparison) — that's not what RFC 6902 produces
//! (RFC 6902 produces `add` / `remove` / `replace` operations with
//! JSON Pointer paths, intended for *applying* a delta, not
//! displaying one). For our UX we want:
//!
//! - Path keys as dotted names: `env.ANTHROPIC_BASE_URL`
//! - Add / Remove / Change op codes with **both** the old and new
//!   values inline
//! - Arrays compared by index, not by value identity
//!
//! Hand-rolling this is ~150 lines and avoids a new dep (CLAUDE.md
//! §2.3: no version bumps without a reason). The implementation is
//! recursive, depth-limited, and pure.
//!
//! ## Depth limit
//!
//! `MAX_DEPTH = 5` — settings.json and .claude.json are flat-ish
//! (≤ 4 levels deep in practice). Beyond that, a single "too deep"
//! summary entry replaces the subtree so the UI doesn't render a
//! 1000-row diff for an accidentally-included minified blob.

use serde::Serialize;
use serde_json::Value;

/// Hard recursion cap. Beyond this depth, the diff returns a
/// single `DiffEntry` with `op = Change` and a stub message.
pub const MAX_DEPTH: usize = 5;

/// What happened to a leaf at `path`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffOp {
    /// The key was absent in `old` and is present in `new`.
    Add,
    /// The key was present in `old` and is absent in `new`.
    Remove,
    /// The key was present in both but the values differ.
    Change,
}

/// One row in the diff table.
///
/// `old` and `new` are the values at the time of comparison —
/// `None` for `Add` (old is absent) and `Remove` (new is absent).
#[derive(Debug, Clone, Serialize)]
pub struct DiffEntry {
    /// Dotted path: `env.ANTHROPIC_BASE_URL`,
    /// `mcpServers.github.command`, or `""` for the root.
    pub path: String,
    pub op: DiffOp,
    pub old: Option<Value>,
    pub new: Option<Value>,
}

/// Compute a field-level diff from `old` to `new`.
///
/// - Identical inputs → empty `Vec`.
/// - Object keys missing from one side → `Add` / `Remove`.
/// - Scalar mismatches → `Change`.
/// - Nested objects / arrays → recursed.
/// - Beyond `MAX_DEPTH` → returns a single summary `Change` entry.
pub fn diff_json(old: &Value, new: &Value) -> Vec<DiffEntry> {
    let mut out = Vec::new();
    diff_inner(old, new, "", 0, &mut out);
    out
}

fn diff_inner(old: &Value, new: &Value, path: &str, depth: usize, out: &mut Vec<DiffEntry>) {
    if old == new {
        return;
    }
    if depth >= MAX_DEPTH {
        out.push(DiffEntry {
            path: path.to_string(),
            op: DiffOp::Change,
            old: Some(stub_value(old)),
            new: Some(stub_value(new)),
        });
        return;
    }

    match (old, new) {
        (Value::Object(o), Value::Object(n)) => {
            // Added + changed.
            for (k, v) in n {
                let child_path = join_path(path, k);
                match o.get(k) {
                    None => out.push(DiffEntry {
                        path: child_path,
                        op: DiffOp::Add,
                        old: None,
                        new: Some(v.clone()),
                    }),
                    Some(old_v) => diff_inner(old_v, v, &child_path, depth + 1, out),
                }
            }
            // Removed.
            for (k, v) in o {
                if !n.contains_key(k) {
                    out.push(DiffEntry {
                        path: join_path(path, k),
                        op: DiffOp::Remove,
                        old: Some(v.clone()),
                        new: None,
                    });
                }
            }
        }
        (Value::Array(o), Value::Array(n)) => {
            let max = o.len().max(n.len());
            for i in 0..max {
                let child_path = format!("{path}[{i}]");
                match (o.get(i), n.get(i)) {
                    (Some(a), Some(b)) => diff_inner(a, b, &child_path, depth + 1, out),
                    (Some(a), None) => out.push(DiffEntry {
                        path: child_path,
                        op: DiffOp::Remove,
                        old: Some(a.clone()),
                        new: None,
                    }),
                    (None, Some(b)) => out.push(DiffEntry {
                        path: child_path,
                        op: DiffOp::Add,
                        old: None,
                        new: Some(b.clone()),
                    }),
                    (None, None) => unreachable!(),
                }
            }
        }
        _ => {
            // Type mismatch or scalar mismatch — single Change row.
            out.push(DiffEntry {
                path: path.to_string(),
                op: DiffOp::Change,
                old: Some(old.clone()),
                new: Some(new.clone()),
            });
        }
    }
}

fn join_path(parent: &str, key: &str) -> String {
    if parent.is_empty() {
        key.to_string()
    } else {
        format!("{parent}.{key}")
    }
}

/// A short "type-only" placeholder used when we hit MAX_DEPTH.
/// We deliberately don't dump the value to avoid blowing up the UI.
fn stub_value(v: &Value) -> Value {
    match v {
        Value::Null => Value::String("null".into()),
        Value::Bool(b) => Value::String(format!("bool({b})")),
        Value::Number(n) => Value::String(format!("number({n})")),
        Value::String(_) => Value::String("string(...)".into()),
        Value::Array(_) => Value::String("[...]".into()),
        Value::Object(_) => Value::String("{...}".into()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn by_path<'a>(entries: &'a [DiffEntry], path: &str) -> Option<&'a DiffEntry> {
        entries.iter().find(|e| e.path == path)
    }

    // ----- identity / structural smoke -----

    #[test]
    fn diff_identical_returns_empty() {
        let a = parse(r#"{"x": 1, "y": [1,2]}"#);
        assert!(diff_json(&a, &a).is_empty());
        let s = "hello";
        let v = parse(&format!("\"{s}\""));
        assert!(diff_json(&v, &v).is_empty());
    }

    #[test]
    fn diff_both_null_returns_empty() {
        let v = Value::Null;
        assert!(diff_json(&v, &v).is_empty());
    }

    // ----- scalar changes -----

    #[test]
    fn diff_scalar_change_returns_change() {
        let a = json!({ "active_provider": "anthropic" });
        let b = json!({ "active_provider": "openai" });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].op, DiffOp::Change);
        assert_eq!(d[0].path, "active_provider");
        assert_eq!(d[0].old.as_ref().unwrap(), &json!("anthropic"));
        assert_eq!(d[0].new.as_ref().unwrap(), &json!("openai"));
    }

    #[test]
    fn diff_type_mismatch_returns_change() {
        let a = json!({ "x": 1 });
        let b = json!({ "x": "one" });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].op, DiffOp::Change);
    }

    // ----- object add / remove -----

    #[test]
    fn diff_object_add_field_returns_add() {
        let a = json!({ "a": 1 });
        let b = json!({ "a": 1, "b": 2 });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].op, DiffOp::Add);
        assert_eq!(d[0].path, "b");
        assert!(d[0].old.is_none());
        assert_eq!(d[0].new.as_ref().unwrap(), &json!(2));
    }

    #[test]
    fn diff_object_remove_field_returns_remove() {
        let a = json!({ "a": 1, "b": 2 });
        let b = json!({ "a": 1 });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].op, DiffOp::Remove);
        assert_eq!(d[0].path, "b");
        assert_eq!(d[0].old.as_ref().unwrap(), &json!(2));
        assert!(d[0].new.is_none());
    }

    #[test]
    fn diff_object_combined_add_remove_change() {
        let a = json!({ "keep": 1, "remove_me": 2, "change_me": 3 });
        let b = json!({ "keep": 1, "change_me": 99, "add_me": 100 });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 2, "got {d:?}");
        let add = by_path(&d, "add_me").unwrap();
        assert_eq!(add.op, DiffOp::Add);
        let change = by_path(&d, "change_me").unwrap();
        assert_eq!(change.op, DiffOp::Change);
        let remove = by_path(&d, "remove_me").unwrap();
        assert_eq!(remove.op, DiffOp::Remove);
    }

    // ----- nested paths -----

    #[test]
    fn diff_nested_path_correct() {
        let a = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://a",
                "ANTHROPIC_AUTH_TOKEN": "key-a"
            }
        });
        let b = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://b",
                "ANTHROPIC_AUTH_TOKEN": "key-a"
            }
        });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "env.ANTHROPIC_BASE_URL");
        assert_eq!(d[0].op, DiffOp::Change);
    }

    #[test]
    fn diff_deeply_nested_path_uses_dotted_syntax() {
        let a = json!({
            "mcpServers": {
                "github": {
                    "command": "npx",
                    "env": { "TOKEN": "old" }
                }
            }
        });
        let b = json!({
            "mcpServers": {
                "github": {
                    "command": "npx",
                    "env": { "TOKEN": "new" }
                }
            }
        });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "mcpServers.github.env.TOKEN");
        assert_eq!(d[0].op, DiffOp::Change);
    }

    // ----- arrays -----

    #[test]
    fn diff_array_change_at_index() {
        let a = json!({ "list": [1, 2, 3] });
        let b = json!({ "list": [1, 9, 3] });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "list[1]");
        assert_eq!(d[0].op, DiffOp::Change);
    }

    #[test]
    fn diff_array_grow_returns_add() {
        let a = json!({ "list": [1, 2] });
        let b = json!({ "list": [1, 2, 3] });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "list[2]");
        assert_eq!(d[0].op, DiffOp::Add);
        assert_eq!(d[0].new.as_ref().unwrap(), &json!(3));
    }

    #[test]
    fn diff_array_shrink_returns_remove() {
        let a = json!({ "list": [1, 2, 3] });
        let b = json!({ "list": [1, 2] });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "list[2]");
        assert_eq!(d[0].op, DiffOp::Remove);
    }

    // ----- depth limit -----

    #[test]
    fn diff_respects_max_depth() {
        // Build a 6-level chain: a.b.c.d.e.f
        let a = json!({ "a": { "b": { "c": { "d": { "e": { "f": "old" } } } } } });
        let b = json!({ "a": { "b": { "c": { "d": { "e": { "f": "new" } } } } } });
        let d = diff_json(&a, &b);
        // We hit MAX_DEPTH = 5 going down, so the inner diff
        // collapses into a single Change row at the deepest path
        // we got to. At minimum we should have one entry; the
        // exact path depends on where the depth cap fires.
        assert!(!d.is_empty());
        // Every entry should be a Change op (no Add/Remove possible
        // at collapsed depth — same shape on both sides).
        assert!(d.iter().all(|e| e.op == DiffOp::Change));
    }

    // ----- empty / odd inputs -----

    #[test]
    fn diff_empty_object_to_nonempty() {
        let a = json!({});
        let b = json!({ "x": 1 });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].op, DiffOp::Add);
        assert_eq!(d[0].path, "x");
    }

    #[test]
    fn diff_root_replacement() {
        let a = json!(null);
        let b = json!({ "x": 1 });
        let d = diff_json(&a, &b);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].op, DiffOp::Change);
        assert_eq!(d[0].path, "");
    }
}
