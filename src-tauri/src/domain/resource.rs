//! Domain model for F16 — 资源浏览 (M2.13).
//!
//! [`ResourceItem`] is the per-resource record the F16 page renders.
//! Five [`ResourceKind`]s cover the user-visible Claude Code resource
//! categories: Plugin / Skill / Command / Lsp / Mcp. Mcp is a special
//! case — it lives inside `~/.claude/mcp.json` rather than its own
//! subdirectory, but the model treats it uniformly so the UI doesn't
//! need to branch on kind during list rendering.
//!
//! ## Serde
//!
//! `ResourceKind` serialises to lowercase (`"plugin"` / `"skill"` /
//! `"command"` / `"lsp"` / `"mcp"`) so the JSON wire format matches
//! the 5-string contract used by the frontend `ResourceKind` type
//! and the Tauri command `kind` argument.
//!
//! `ResourceItem.id` is `<kind>/<name>` — composite, stable across
//! re-scans (the same plugin keeps the same id). Used as React `key`
//! and as the dropdown option id when F17/F18 add per-resource
//! actions later.

use serde::{Deserialize, Serialize};

/// One user-visible Claude Code resource entry.
///
/// Fields:
/// - `id`: stable composite id (`"<kind>/<name>"`) — React key,
///   M2.17+ command arg, etc.
/// - `name`: human-readable name (the directory or file basename,
///   without the parent path).
/// - `kind`: which of the 5 categories this resource lives under.
/// - `path`: absolute path on disk. For `Plugin` this is the plugin
///   directory; for everything else, the file path.
/// - `size_bytes`: file size in bytes (Plugin: recursive sum across
///   the directory's children).
/// - `enabled`: whether the resource is currently active. For
///   Plugin/Skill/Command/Lsp this is just "path exists" (no
///   per-resource enable toggle exists in M2.13); for Mcp it
///   mirrors `mcp.json.<server>.disabled` (`true` means
///   explicitly turned off by the user via F6).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceItem {
    pub id: String,
    pub name: String,
    pub kind: ResourceKind,
    pub path: String,
    pub size_bytes: u64,
    pub enabled: bool,
}

/// Which of the 5 resource categories a [`ResourceItem`] belongs to.
///
/// Variants serialise as lowercase strings — see module docs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    /// `~/.claude/plugins/<name>/` — directory of files.
    Plugin,
    /// `~/.claude/skills/<name>/SKILL.md` or `<name>/`.
    Skill,
    /// `~/.claude/commands/<name>.md` — single markdown file.
    Command,
    /// `~/.claude/lsp/<name>.json` — single JSON config.
    Lsp,
    /// `~/.claude/mcp.json#mcpServers.<name>` — JSON entry.
    Mcp,
}

impl ResourceKind {
    /// Lowercase tag — the same shape serde emits to JSON.
    ///
    /// Useful for tests + the `kind` arg of `scan_resources`.
    pub fn as_str(&self) -> &'static str {
        match self {
            ResourceKind::Plugin => "plugin",
            ResourceKind::Skill => "skill",
            ResourceKind::Command => "command",
            ResourceKind::Lsp => "lsp",
            ResourceKind::Mcp => "mcp",
        }
    }

    /// Parse a lowercase tag back into a [`ResourceKind`]. Returns
    /// `None` for any other string (including the empty string and
    /// `"Plugin"` with capital P). Used by the Tauri command to
    /// validate the `kind` arg before dispatching to the scanner.
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "plugin" => Some(ResourceKind::Plugin),
            "skill" => Some(ResourceKind::Skill),
            "command" => Some(ResourceKind::Command),
            "lsp" => Some(ResourceKind::Lsp),
            "mcp" => Some(ResourceKind::Mcp),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip: serialise then deserialise and check every field.
    /// Catches drift between Rust and TS shape — if either side adds
    /// a field, the IPC payload will fail this test before reaching
    /// the frontend.
    #[test]
    fn roundtrip_resource_item() {
        let item = ResourceItem {
            id: "plugin/code-review".into(),
            name: "code-review".into(),
            kind: ResourceKind::Plugin,
            path: "C:/Users/foo/.claude/plugins/code-review".into(),
            size_bytes: 4096,
            enabled: true,
        };
        let json = serde_json::to_string(&item).unwrap();
        let parsed: ResourceItem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, item);
    }

    /// Each variant must serialise to its lowercase tag. If anyone
    /// changes `rename_all = "lowercase"` accidentally, this fails
    /// immediately — Tauri IPC would otherwise break silently on
    /// the frontend.
    #[test]
    fn resource_kind_serialises_lowercase() {
        for (k, want) in [
            (ResourceKind::Plugin, "plugin"),
            (ResourceKind::Skill, "skill"),
            (ResourceKind::Command, "command"),
            (ResourceKind::Lsp, "lsp"),
            (ResourceKind::Mcp, "mcp"),
        ] {
            let json = serde_json::to_string(&k).unwrap();
            // JSON encoding of a unit variant is just the bare tag.
            assert_eq!(json, format!("\"{want}\""), "kind {k:?} → {json}");
        }
    }

    /// `from_str_opt` covers the same lowercase tags + rejects
    /// garbage. The frontend passes the kind as a string; if it's
    /// misspelled we want the service to fail with a clean error,
    /// not a panic.
    #[test]
    fn resource_kind_from_str_opt_round_trips() {
        for k in [
            ResourceKind::Plugin,
            ResourceKind::Skill,
            ResourceKind::Command,
            ResourceKind::Lsp,
            ResourceKind::Mcp,
        ] {
            assert_eq!(ResourceKind::from_str_opt(k.as_str()), Some(k));
        }
        // Reject capitalised, mixed case, empty, unknown.
        assert_eq!(ResourceKind::from_str_opt("Plugin"), None);
        assert_eq!(ResourceKind::from_str_opt("PLUGIN"), None);
        assert_eq!(ResourceKind::from_str_opt(""), None);
        assert_eq!(ResourceKind::from_str_opt("agents"), None);
    }
}