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
/// - `source_repo`: F21 — 资源分组键(M2.16)。从 `path` 推断:
///   plugin/skill 取 `.claude/<subdir>/<X>` 中的 `<X>`(顶层目录名);
///   command/lsp/mcp 为 `None`(散文件 / 聚合条目,无分组概念)。
///   前端 F21 据此做"按来源过滤"。注意:这只是 group-by key,**不**
///   是 git remote URL(详见 `resource_scanner::infer_resource_group`)。
///   字段名沿用 `source_repo` 是历史原因(M2.13 wire format 已 ship),
///   改字段名 = breaking change。内部推断函数已重命名为
///   `infer_resource_group`。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceItem {
    pub id: String,
    pub name: String,
    pub kind: ResourceKind,
    pub path: String,
    pub size_bytes: u64,
    pub enabled: bool,
    pub source_repo: Option<String>,
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

/// F22 — 资源详情(manifest 描述 + 文件列表),M2.16。
///
/// 与 [`ResourceItem`] **分离**:ResourceItem 是列表层(扫描产出,
/// F16 已 ship),ResourceDetail 是详情层(按需读取)。这样不破坏
/// F16 已 ship 的领域模型(反事故:不改 ResourceItem)。
///
/// ## 字段
/// - `files`:资源目录下的相对路径列表(深度 ≤ 2,上限 200 项,
///   `/` 分隔)。单文件资源(command/lsp/mcp)为空 Vec。
/// - `description`:从 manifest 提取的描述(plugin.json /
///   package.json 的 description 字段,或 SKILL.md frontmatter 的
///   description)。无 manifest 或解析失败时为 `None`。
/// - `manifest`:解析后的 manifest(JSON Value)。markdown
///   frontmatter 也转成 JSON 对象。无 manifest 时为 `None`。
///
/// 读取是 best-effort:manifest 缺失/损坏不报错,只返回 `None`。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceDetail {
    /// 资源目录下的相对路径(深度 ≤ 2,上限 200 项)。单文件资源为空。
    pub files: Vec<String>,
    /// manifest 提取的描述。无 manifest 时为 `None`。
    pub description: Option<String>,
    /// 解析后的 manifest(JSON Value)。无 manifest 时为 `None`。
    pub manifest: Option<serde_json::Value>,
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
            source_repo: Some("code-review".into()),
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