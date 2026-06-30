//! `resource_scanner` — filesystem scan primitive for F16 (M2.13).
//!
//! Given a `claude_dir` (typically `~/.claude/`) and a
//! [`ResourceKind`], walk the right subdirectory and emit one
//! [`ResourceItem`] per resource.
//!
//! ## Per-kind scan rules
//!
//! - `Plugin` — parse `<claude_dir>/plugins/installed_plugins.json`
//!   (Claude Code v2 schema). Each plugin key (`<name>@<marketplace>`)
//!   yields one [`ResourceItem`] with `path` set to the first
//!   record's `installPath`. Multiple records for the same plugin
//!   (e.g. user + project scope) are deduped — first record wins.
//!   Missing / malformed / unknown-version file → empty Vec (not an
//!   error; consistent with `scan_mcp_json` cold-start semantics).
//!   M5 BUG-FIX: previously this arm listed top-level directories
//!   under `plugins/`, which surfaced Claude Code infrastructure
//!   directories (`data`, `marketplaces`, `cache`) as fake plugins.
//! - `Skill` — list immediate children of `<claude_dir>/skills/`.
//!   Each child can be a single file (e.g. `SKILL.md`) or a directory
//!   containing `SKILL.md`. `path` = child, `size_bytes` = file size
//!   or recursive directory sum, `enabled` = true.
//! - `Command` — list `*.md` files directly under
//!   `<claude_dir>/commands/`. `path` = the file, `size_bytes` =
//!   file size, `enabled` = true.
//! - `Lsp` — list `*.json` files directly under
//!   `<claude_dir>/lsp/`. `path` = the file, `size_bytes` =
//!   file size, `enabled` = true.
//! - `Mcp` — parse `<claude_dir>/mcp.json` and emit one entry per
//!   key under `mcpServers`. `enabled` = `disabled` flag NOT set in
//!   the entry. Missing `mcp.json` or parse error = empty list (no
//!   error returned; F6 already shows a separate MCP page where
//!   errors are surfaced properly).
//!
//! ## Robustness
//!
//! - Missing directory = empty Vec, not an error. Same pattern as
//!   [`crate::infrastructure::backup_scanner::scan_backups_in`] —
//!   cold-start case must not error.
//! - Permission denied on a sub-directory = skip that one entry,
//!   keep going (don't take down the whole list).
//! - Hidden files / directories start with `.` are skipped (Claude
//!   Code's resource dirs don't use dot-prefixed names for user
//!   content; `.` and `..` would always show up via read_dir).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

use crate::domain::{ResourceItem, ResourceKind};

/// Errors returned by [`scan_resources`]. Intentionally narrow — only
/// unrecoverable I/O failures (path-safety violations). "Directory
/// missing" and "mcp.json malformed" are *not* errors: they produce
/// empty result lists (caller decides whether that's a problem).
#[derive(Debug, Error)]
pub enum ResourceScannerError {
    #[error("I/O error scanning {dir}: {message}")]
    Io { dir: PathBuf, message: String },
}

/// Scan `claude_dir` for resources of the given `kind`.
///
/// See module docs for the per-kind rules. Always returns a `Vec`:
/// - missing subdirectory → `Ok(vec![])`
/// - permission denied on one entry → that entry is skipped,
///   others are returned
/// - malformed `mcp.json` → `Ok(vec![])`
/// - any other I/O failure → `Err(ResourceScannerError::Io)`
pub fn scan_resources(
    claude_dir: &Path,
    kind: ResourceKind,
) -> Result<Vec<ResourceItem>, ResourceScannerError> {
    match kind {
        ResourceKind::Plugin => scan_installed_plugins(claude_dir),
        ResourceKind::Skill => scan_dir_children(
            claude_dir,
            "skills",
            |_entry| true, // both files and dirs accepted
        ),
        ResourceKind::Command => scan_dir_children_with_ext(
            claude_dir,
            "commands",
            "md",
        ),
        ResourceKind::Lsp => scan_dir_children_with_ext(
            claude_dir,
            "lsp",
            "json",
        ),
        ResourceKind::Mcp => scan_mcp_json(claude_dir),
    }
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/// M3.4 — 屏蔽常见污染目录(清单 17)。
///
/// 这些目录出现在 `plugins/<name>/` 或 `skills/<name>/` 下会让资源
/// 浏览列表显示"假资源" —— 比如装 `code-review` 时 npm 留了
/// `node_modules/`,或者 git 在子目录里留了 `.git/`。
///
/// **不**改动 domain model,只在 scanner 这一层过滤;ResourceItem
/// 不返回这些条目,前端自然不显示。
///
/// 注意:**不**过滤 .DS_Store(单文件,在 scan_dir_children 里按 dotfile
/// 已过滤);保留 `cache` / `.cache` 两种大小写兼容(Mac / Linux 习惯)。
const EXCLUDED_DIR_NAMES: &[&str] = &[
    "cache", ".cache", "Cache",
    "node_modules",
    ".git",
    "__pycache__",
    ".venv", "venv",
    "target", // Rust build artifacts
    "dist", "build", // common build outputs
    ".next", ".nuxt", // JS framework outputs
];

/// Walk `claude_dir/<sub>/` and emit a ResourceItem per child entry
/// that passes `accept`. Children that fail stat are skipped (not
/// fatal — one unreadable entry doesn't take down the list).
fn scan_dir_children(
    claude_dir: &Path,
    sub: &str,
    accept: impl Fn(&std::fs::DirEntry) -> bool,
) -> Result<Vec<ResourceItem>, ResourceScannerError> {
    let dir = claude_dir.join(sub);
    let entries = match std::fs::read_dir(&dir) {
        Ok(it) => it,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(ResourceScannerError::Io {
                dir,
                message: e.to_string(),
            });
        }
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        // Skip dotfiles (`.`, `..`, hidden).
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        // M3.4 — Skip excluded pollution directories (清单 17).
        // 只过滤目录(不是文件),command / lsp / mcp 不受影响。
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if EXCLUDED_DIR_NAMES.contains(&name) {
                    continue;
                }
            }
        }
        if !accept(&entry) {
            continue;
        }
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let size_bytes = dir_size_or_zero(&path);
        let id = format!("{}/{name}", kind_sub_tag(&path, sub));
        let kind = kind_from_sub(sub);
        out.push(ResourceItem {
            id,
            source_repo: infer_resource_group(kind, &name),
            name,
            kind,
            path: path.to_string_lossy().into_owned(),
            size_bytes,
            enabled: true,
        });
    }
    // Stable alphabetical order — easier to scan visually in UI.
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Walk `claude_dir/<sub>/` and emit a ResourceItem per child that
/// has the given file extension. Subdirectories are skipped (unlike
/// the plugin/skill scanner which accepts both).
fn scan_dir_children_with_ext(
    claude_dir: &Path,
    sub: &str,
    ext: &str,
) -> Result<Vec<ResourceItem>, ResourceScannerError> {
    let dir = claude_dir.join(sub);
    let entries = match std::fs::read_dir(&dir) {
        Ok(it) => it,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(ResourceScannerError::Io {
                dir,
                message: e.to_string(),
            });
        }
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Skip dotfiles.
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        let matches_ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case(ext))
            .unwrap_or(false);
        if !matches_ext {
            continue;
        }
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let id = format!("{}/{name}", kind_sub_tag(&path, sub));
        let kind = kind_from_sub(sub);
        out.push(ResourceItem {
            id,
            source_repo: infer_resource_group(kind, &name),
            name,
            kind,
            path: path.to_string_lossy().into_owned(),
            size_bytes,
            enabled: true,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Parse `<claude_dir>/mcp.json` and emit one entry per server under
/// `mcpServers`. The path stored on each item is the parent
/// `mcp.json` (so reveal opens the same file for every server, but
/// the row in the UI shows the server name).
///
/// Missing file → empty Vec. Parse error → empty Vec (we don't
/// surface scan errors here because F6 already does it; F16 is a
/// read-only browser).
fn scan_mcp_json(
    claude_dir: &Path,
) -> Result<Vec<ResourceItem>, ResourceScannerError> {
    let path = claude_dir.join("mcp.json");
    let body = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(ResourceScannerError::Io {
                dir: path.clone(),
                message: e.to_string(),
            });
        }
    };
    let value: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()), // malformed → empty, not error
    };
    let Some(servers) = value.get("mcpServers").and_then(|v| v.as_object()) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (name, server) in servers {
        let enabled = !server
            .get("disabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        out.push(ResourceItem {
            id: format!("mcp/{name}"),
            // mcp server 是 mcp.json 里的聚合条目,无分组归属 → None。
            source_repo: infer_resource_group(ResourceKind::Mcp, &name),
            name: name.clone(),
            kind: ResourceKind::Mcp,
            path: path.to_string_lossy().into_owned(),
            size_bytes: body.len() as u64,
            enabled,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Plugin arm — installed_plugins.json v2 schema (M5 BUG-FIX)
// ---------------------------------------------------------------------------

/// Claude Code v2 schema for `installed_plugins.json`. We only read
/// the fields we need (`installPath` for path + the marketplace
/// suffix derived from the plugin key). Other fields
/// (`gitCommitSha`, `installedAt`, `projectPath`, etc.) are ignored.
///
/// All fields use `#[serde(default)]` so partial / older records
/// don't break parsing — the schema has been observed to drift
/// (e.g. `gitCommitSha` is missing on some records).
#[derive(Debug, Deserialize)]
struct InstalledPluginsV2 {
    #[allow(dead_code)]
    version: u32,
    #[serde(default)]
    plugins: HashMap<String, Vec<InstallRecord>>,
}

#[derive(Debug, Deserialize)]
struct InstallRecord {
    #[serde(default)]
    #[allow(dead_code)]
    scope: String,
    // Optional so a record missing or null `installPath` doesn't
    // fail the whole plugin's record list. `scan_installed_plugins`
    // skips None / empty records explicitly.
    #[serde(default)]
    installPath: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    version: String,
    // Other fields (gitCommitSha / installedAt / lastUpdated /
    // projectPath) are intentionally not modeled — we don't use
    // them, and deserializing them as `serde_json::Value` would
    // silently mask typos in the on-disk schema.
}

/// Parse `<claude_dir>/plugins/installed_plugins.json` and emit one
/// [`ResourceItem`] per plugin key.
///
/// BUG-FIX (M5): the previous Plugin arm listed top-level
/// directories under `plugins/`, surfacing Claude Code
/// infrastructure directories (`data`, `marketplaces`, `cache`) as
/// fake plugins. The canonical plugin registry is
/// `installed_plugins.json` (v2 schema), not the directory
/// hierarchy — that's just where artifacts land after install.
///
/// Behaviour mirrors `scan_mcp_json` cold-start semantics:
/// - missing file → `Ok(vec![])`
/// - malformed JSON → `Ok(vec![])`
/// - unknown schema version (anything other than 2) → `Ok(vec![])`
///
/// Dedup: a single plugin key can have multiple records (e.g. user
/// + project scope for the same installPath). Emit one item per
/// key; first record (HashMap insertion order) wins.
///
/// `source_repo` is derived from the plugin key's `@<marketplace>`
/// suffix — this is the marketplace / registry the plugin was
/// installed from, which is the right "group by" key for the F21
/// filter UI. Plugins without an `@` suffix (single-marketplace
/// installs) get `None`.
fn scan_installed_plugins(
    claude_dir: &Path,
) -> Result<Vec<ResourceItem>, ResourceScannerError> {
    let path = claude_dir.join("plugins").join("installed_plugins.json");
    let body = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(ResourceScannerError::Io {
                dir: path.clone(),
                message: e.to_string(),
            });
        }
    };
    let registry: InstalledPluginsV2 = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };
    // Unknown schema version → safe degrade to empty. The v2 schema
    // is what Claude Code currently emits (verified 2026-06-30
    // against the user's own `~/.claude/plugins/installed_plugins.json`).
    // Future versions may add fields; until we explicitly support
    // them, returning empty avoids surfacing half-parsed data.
    if registry.version != 2 {
        return Ok(Vec::new());
    }

    let mut out = Vec::with_capacity(registry.plugins.len());
    for (plugin_key, records) in &registry.plugins {
        // First record with a non-empty installPath wins (insertion
        // order). Records with missing or empty installPath are
        // skipped — they have no path to reveal.
        let install_path = records.iter().find_map(|r| {
            r.installPath
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
        });
        let Some(install_path) = install_path else {
            continue;
        };
        // Resolve source_repo: `<plugin_name>@<marketplace>` →
        // `Some(<marketplace>)`. No `@` → `None` (single-marketplace
        // install).
        let source_repo = plugin_key
            .split_once('@')
            .map(|(_, marketplace)| marketplace.to_string());
        let size_bytes = dir_size_or_zero(Path::new(install_path));
        out.push(ResourceItem {
            id: format!("plugin/{plugin_key}"),
            source_repo,
            name: plugin_key.clone(),
            kind: ResourceKind::Plugin,
            path: install_path.to_string(),
            size_bytes,
            enabled: true,
        });
    }
    // Stable alphabetical order by plugin key — easier to scan in UI.
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// M2.16 — H6: 内部推断函数从 `infer_source_repo` 改名为
// `infer_resource_group`。原因:对 Plugin/Skill 返回的其实只是资源
// **自身的名字**(顶层目录 / 文件名),不是真正的 git 仓库 URL。叫
// `source_repo` 误导 —— 用户可能以为能选 "anthropics/awesome-claude"
// 这种仓库。`resource_group` 更准确:这只是 plugin/skill 的"分组键"
// (group-by key),不是 git remote。
//
// 字段名 `source_repo` 保留(前端 wire format 已 ship,改了就是
// breaking)。文档统一用"分组"措辞。
fn infer_resource_group(kind: ResourceKind, name: &str) -> Option<String> {
    match kind {
        // plugin/skill 的 name 就是 `<subdir>` 下的顶层目录/文件名,
        // 即 group 分组键。scanner 已保证 name 非空且非 dotfile。
        ResourceKind::Plugin | ResourceKind::Skill => Some(name.to_string()),
        // 散文件(command .md / lsp .json)与聚合条目(mcp server)没有
        // "分组"归属 —— 它们是用户手写的单文件,不属于任何分组。
        ResourceKind::Command | ResourceKind::Lsp | ResourceKind::Mcp => None,
    }
}

/// Map the sub-directory name to a kind. Plugin/Skill/Command/Lsp
/// all use their own enum variant; only the mcp path is special.
fn kind_from_sub(sub: &str) -> ResourceKind {
    match sub {
        "plugins" => ResourceKind::Plugin,
        "skills" => ResourceKind::Skill,
        "commands" => ResourceKind::Command,
        "lsp" => ResourceKind::Lsp,
        // Should never happen — `scan_mcp_json` has its own
        // dedicated path and the other helpers are only called with
        // one of the four hard-coded subdir names.
        _ => ResourceKind::Plugin,
    }
}

/// Tag used in the `id` composite (`"<tag>/<name>"`). Matches the
/// `kind.as_str()` so the id parses back unambiguously.
fn kind_sub_tag(_path: &Path, sub: &str) -> &'static str {
    match sub {
        "plugins" => "plugin",
        "skills" => "skill",
        "commands" => "command",
        "lsp" => "lsp",
        // same fallback as kind_from_sub; only reachable via the
        // generic helper which is hard-coded by callers.
        _ => "plugin",
    }
}

/// File size, or 0 for an unreadable file. For directories, sum
/// across the immediate children (not recursive — keep this cheap;
/// the UI shows the size, not analyses it). If the metadata call
/// fails (broken symlink, race), fall back to 0 rather than skip.
fn dir_size_or_zero(path: &Path) -> u64 {
    if path.is_file() {
        return std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    if path.is_dir() {
        let mut total = 0u64;
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    total += std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        return total;
    }
    0
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_claude_dir() -> TempDir {
        let tmp = TempDir::new().expect("create tempdir");
        fs::create_dir(tmp.path().join("plugins")).unwrap();
        fs::create_dir(tmp.path().join("skills")).unwrap();
        fs::create_dir(tmp.path().join("commands")).unwrap();
        fs::create_dir(tmp.path().join("lsp")).unwrap();
        tmp
    }

    // ----- Plugin (M5 BUG-FIX: reads installed_plugins.json) -----

    /// Helper: write a v2-schema `installed_plugins.json` to the
    /// temp claude_dir's `plugins/` subdirectory. `entries` is a
    /// list of `(plugin_key, records)` tuples — each record is a
    /// JSON value (use `serde_json::json!`).
    fn write_installed_plugins(
        tmp: &TempDir,
        version: u32,
        entries: serde_json::Value,
    ) {
        let body = serde_json::json!({
            "version": version,
            "plugins": entries,
        })
        .to_string();
        fs::write(
            tmp.path().join("plugins").join("installed_plugins.json"),
            body,
        )
        .unwrap();
    }

    /// M5 BUG-FIX smoke: with a populated installed_plugins.json,
    /// scan returns the expected plugins by canonical key. Pins the
    /// happy path so the v2-schema implementation can't silently
    /// regress.
    #[test]
    fn scan_installed_plugins_real_installs_match_registry() {
        let tmp = make_claude_dir();
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "superpowers@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/superpowers/6.0.3",
                    "version": "6.0.3"
                }],
                "context7@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/context7/unknown",
                    "version": "unknown"
                }],
                "memsearch@memsearch-plugins": [{
                    "scope": "user",
                    "installPath": "/abs/cache/memsearch-plugins/memsearch/0.4.11",
                    "version": "0.4.11"
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!("[real_installs_match_registry] returned {} items:", items.len());
        for i in &items {
            println!(
                "  id={:?} name={:?} path={:?} source_repo={:?} size={}",
                i.id, i.name, i.path, i.source_repo, i.size_bytes
            );
        }
        assert_eq!(items.len(), 3, "expected exactly 3 plugins");
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"superpowers@claude-plugins-official"));
        assert!(names.contains(&"context7@claude-plugins-official"));
        assert!(names.contains(&"memsearch@memsearch-plugins"));
        // Stable alphabetical order.
        assert_eq!(items[0].name, "context7@claude-plugins-official");
        assert_eq!(items[1].name, "memsearch@memsearch-plugins");
        assert_eq!(items[2].name, "superpowers@claude-plugins-official");
    }

    /// The original bug: top-level `plugins/data`, `plugins/marketplaces`,
    /// `plugins/cache` directories must NOT appear as plugins even
    /// when they exist. This is the user-reported regression test.
    #[test]
    fn scan_installed_plugins_skips_top_level_dirs() {
        let tmp = make_claude_dir();
        // Real infrastructure dirs Claude Code writes alongside plugins/.
        for infra in ["data", "marketplaces", "cache"] {
            fs::create_dir(tmp.path().join("plugins").join(infra)).unwrap();
            fs::write(
                tmp.path()
                    .join("plugins")
                    .join(infra)
                    .join("junk.bin"),
                b"junk",
            )
            .unwrap();
        }
        // One real plugin in the registry.
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "code-review@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/code-review/1.0.0",
                    "version": "1.0.0"
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!("[skips_top_level_dirs] returned {} items:", items.len());
        for i in &items {
            println!("  name={:?}", i.name);
        }
        assert_eq!(items.len(), 1);
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["code-review@claude-plugins-official"]);
        for forbidden in ["data", "marketplaces", "cache"] {
            assert!(
                !names.contains(&forbidden),
                "{forbidden} must not appear in plugin list (got {names:?})"
            );
        }
    }

    /// Missing `installed_plugins.json` → empty, not error.
    /// Same cold-start semantics as `scan_mcp_json`.
    #[test]
    fn scan_installed_plugins_missing_file_returns_empty() {
        let tmp = make_claude_dir();
        // No installed_plugins.json written.
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[missing_file_returns_empty] returned {} items (expected 0)",
            items.len()
        );
        assert!(items.is_empty());
    }

    /// A plugin with multiple records (e.g. user + project scope)
    /// must dedupe to a single item. First record wins.
    /// Verified against the user's own installed_plugins.json where
    /// superpowers has 2 records pointing at the same installPath.
    #[test]
    fn scan_installed_plugins_dedupes_same_plugin_multiple_scopes() {
        let tmp = make_claude_dir();
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "superpowers@claude-plugins-official": [
                    {
                        "scope": "user",
                        "installPath": "/abs/cache/claude-plugins-official/superpowers/6.0.3",
                        "version": "6.0.3"
                    },
                    {
                        "scope": "project",
                        "projectPath": "/some/project",
                        "installPath": "/abs/cache/claude-plugins-official/superpowers/6.0.3",
                        "version": "6.0.3"
                    }
                ]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[dedupes_multiple_scopes] returned {} items (expected 1)",
            items.len()
        );
        for i in &items {
            println!("  name={:?} path={:?}", i.name, i.path);
        }
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "superpowers@claude-plugins-official");
        // First record wins (user scope).
        assert_eq!(
            items[0].path,
            "/abs/cache/claude-plugins-official/superpowers/6.0.3"
        );
    }

    /// `path` must be the registry's `installPath`, NOT any path
    /// derived from the plugin key. This is what
    /// resource_detail's reveal action relies on.
    #[test]
    fn scan_installed_plugins_uses_installPath_not_top_level() {
        let tmp = make_claude_dir();
        let real_path =
            "/abs/path/cache/claude-plugins-official/superpowers/1.0.0";
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "superpowers@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": real_path,
                    "version": "1.0.0"
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!("[uses_installPath_not_top_level] returned {} items:", items.len());
        for i in &items {
            println!("  path={:?}", i.path);
        }
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, real_path);
        // Must NOT be derived from the plugin key.
        assert!(!items[0].path.contains("plugins/superpowers"));
    }

    /// A record with an empty `installPath` must be skipped.
    /// The plugin key itself is still listed if at least one record
    /// has a valid installPath.
    #[test]
    fn scan_installed_plugins_skips_record_with_empty_installPath() {
        let tmp = make_claude_dir();
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "broken-plugin@claude-plugins-official": [
                    {"scope": "user", "installPath": "", "version": "0.0.0"},
                    {
                        "scope": "project",
                        "installPath": "/valid/path/broken-plugin/1.0.0",
                        "version": "1.0.0"
                    }
                ]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[skips_empty_installPath] returned {} items (expected 1, valid path)",
            items.len()
        );
        for i in &items {
            println!("  name={:?} path={:?}", i.name, i.path);
        }
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, "/valid/path/broken-plugin/1.0.0");
    }

    /// A record whose JSON is missing the `installPath` field
    /// entirely must not cause a panic — the whole record is
    /// skipped (since serde can't fill it without `#[serde(default)]`
    /// but we're being strict on this required field).
    ///
    /// With `installPath` declared without `#[serde(default)]`, a
    /// missing field is a parse error → empty Vec. That's also
    /// acceptable behaviour: skip that whole plugin key.
    #[test]
    fn scan_installed_plugins_skips_record_with_missing_install_path_field() {
        let tmp = make_claude_dir();
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "good@marketplace": [{
                    "scope": "user",
                    "installPath": "/valid/path/good/1.0.0",
                    "version": "1.0.0"
                }],
                "broken@marketplace": [{
                    "scope": "user",
                    "version": "1.0.0"
                    // installPath intentionally absent
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[skips_missing_install_path_field] returned {} items:",
            items.len()
        );
        for i in &items {
            println!("  name={:?} path={:?}", i.name, i.path);
        }
        // Strict deserialization rejects the broken record → entire
        // record is rejected → only the valid plugin remains.
        // (Note: this is conservative — better to lose one entry
        // than panic.)
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"good@marketplace"));
        assert!(!names.contains(&"broken@marketplace"));
    }

    /// `source_repo` is the marketplace suffix from the plugin key.
    /// Verified against the user's own setup: superpowers comes from
    /// `claude-plugins-official`, memsearch from `memsearch-plugins`.
    #[test]
    fn scan_installed_plugins_source_repo_extracted_from_marketplace_suffix() {
        let tmp = make_claude_dir();
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "superpowers@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/a/b/c",
                    "version": "1.0.0"
                }],
                "memsearch@memsearch-plugins": [{
                    "scope": "user",
                    "installPath": "/d/e/f",
                    "version": "0.4.11"
                }],
                "single-marketplace-plugin": [{
                    "scope": "user",
                    "installPath": "/g/h/i",
                    "version": "1.0.0"
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[source_repo_extracted] returned {} items with source_repo:",
            items.len()
        );
        for i in &items {
            println!("  name={:?} source_repo={:?}", i.name, i.source_repo);
        }
        let by_name: HashMap<_, _> = items
            .iter()
            .map(|i| (i.name.as_str(), i.source_repo.clone()))
            .collect();
        assert_eq!(
            by_name["superpowers@claude-plugins-official"].as_deref(),
            Some("claude-plugins-official")
        );
        assert_eq!(
            by_name["memsearch@memsearch-plugins"].as_deref(),
            Some("memsearch-plugins")
        );
        // No `@` → None.
        assert_eq!(by_name["single-marketplace-plugin"], None);
    }

    /// Malformed JSON in `installed_plugins.json` → empty, not an
    /// error. Same cold-start pattern as `scan_mcp_json`.
    #[test]
    fn scan_installed_plugins_malformed_json_returns_empty() {
        let tmp = make_claude_dir();
        fs::write(
            tmp.path().join("plugins").join("installed_plugins.json"),
            "this is not json",
        )
        .unwrap();
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[malformed_json_returns_empty] returned {} items (expected 0)",
            items.len()
        );
        assert!(items.is_empty());
    }

    /// Unknown schema version → safe degrade to empty. We only
    /// understand v2 right now; future versions will need explicit
    /// support.
    #[test]
    fn scan_installed_plugins_version_not_2_returns_empty() {
        for bad_version in [1u32, 3, 99] {
            let tmp = make_claude_dir();
            write_installed_plugins(
                &tmp,
                bad_version,
                serde_json::json!({
                    "any-plugin@marketplace": [{
                        "scope": "user",
                        "installPath": "/x/y/z",
                        "version": "1.0.0"
                    }]
                }),
            );
            let items =
                scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
            println!(
                "[version_not_2 v={}] returned {} items (expected 0)",
                bad_version,
                items.len()
            );
            assert!(
                items.is_empty(),
                "version {bad_version} should yield empty, got {} items",
                items.len()
            );
        }
    }

    /// Integration: the full `scan_resources(.., Plugin)` path must
    /// never return `data` / `marketplaces` / `cache` even when
    /// those infrastructure dirs physically exist. This is the
    /// user-reported bug's final regression guard.
    #[test]
    fn scan_resources_plugin_does_not_include_data_or_marketplaces() {
        let tmp = make_claude_dir();
        // Simulate real Claude Code layout: infra dirs + registry.
        for infra in ["data", "marketplaces", "cache"] {
            fs::create_dir(tmp.path().join("plugins").join(infra)).unwrap();
            fs::write(
                tmp.path()
                    .join("plugins")
                    .join(infra)
                    .join("index.json"),
                b"{}",
            )
            .unwrap();
        }
        // Real plugin registry with 2 entries.
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "superpowers@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/superpowers/6.0.3",
                    "version": "6.0.3"
                }],
                "memsearch@memsearch-plugins": [{
                    "scope": "user",
                    "installPath": "/abs/cache/memsearch-plugins/memsearch/0.4.11",
                    "version": "0.4.11"
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        println!(
            "[integration_no_data_or_marketplaces] returned {} items:",
            items.len()
        );
        for i in &items {
            println!("  name={:?} path={:?}", i.name, i.path);
        }
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        for forbidden in ["data", "marketplaces", "cache"] {
            assert!(
                !names.contains(&forbidden),
                "BUG REGRESSION: {forbidden} must not be a plugin (got {names:?})"
            );
        }
        assert!(!items.is_empty(), "must return at least the real plugins");
        assert!(names.contains(&"superpowers@claude-plugins-official"));
        assert!(names.contains(&"memsearch@memsearch-plugins"));
    }

    // ----- Skill -----

    #[test]
    fn scan_skills_dir_returns_skills() {
        let tmp = make_claude_dir();
        // Skill as a single file
        fs::write(
            tmp.path().join("skills").join("quickref.md"),
            b"# skill",
        )
        .unwrap();
        // Skill as a directory with SKILL.md
        let dir_skill = tmp.path().join("skills").join("advanced");
        fs::create_dir(&dir_skill).unwrap();
        fs::write(dir_skill.join("SKILL.md"), b"# advanced").unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Skill).unwrap();
        assert_eq!(items.len(), 2);
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"quickref.md"));
        assert!(names.contains(&"advanced"));
        for i in &items {
            assert_eq!(i.kind, ResourceKind::Skill);
        }
    }

    // ----- Command -----

    #[test]
    fn scan_commands_dir_returns_commands() {
        let tmp = make_claude_dir();
        fs::write(tmp.path().join("commands").join("hello.md"), b"# hello").unwrap();
        fs::write(
            tmp.path().join("commands").join("deploy.md"),
            b"# deploy",
        )
        .unwrap();
        // Non-md file — must be skipped
        fs::write(
            tmp.path().join("commands").join("README.txt"),
            b"junk",
        )
        .unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Command).unwrap();
        assert_eq!(items.len(), 2);
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"hello.md"));
        assert!(names.contains(&"deploy.md"));
        assert!(!names.contains(&"README.txt"));
        for i in &items {
            assert_eq!(i.kind, ResourceKind::Command);
        }
    }

    // ----- Lsp -----

    #[test]
    fn scan_lsp_dir_returns_lsp() {
        let tmp = make_claude_dir();
        fs::write(
            tmp.path().join("lsp").join("rust.json"),
            b"{\"lang\":\"rust\"}",
        )
        .unwrap();
        fs::write(
            tmp.path().join("lsp").join("python.json"),
            b"{\"lang\":\"python\"}",
        )
        .unwrap();
        // .md file — must be skipped
        fs::write(tmp.path().join("lsp").join("notes.md"), b"junk").unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Lsp).unwrap();
        assert_eq!(items.len(), 2);
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"rust.json"));
        assert!(names.contains(&"python.json"));
        assert!(!names.contains(&"notes.md"));
        for i in &items {
            assert_eq!(i.kind, ResourceKind::Lsp);
        }
    }

    // ----- Mcp -----

    #[test]
    fn scan_mcp_parses_mcp_json() {
        let tmp = make_claude_dir();
        let body = r#"{
            "mcpServers": {
                "fs": {"command": "npx", "args": ["fs-server"]},
                "gh": {"command": "gh-mcp"},
                "web": {"command": "npx", "disabled": true}
            }
        }"#;
        fs::write(tmp.path().join("mcp.json"), body).unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Mcp).unwrap();
        assert_eq!(items.len(), 3);
        let by_name: std::collections::HashMap<_, _> = items
            .iter()
            .map(|i| (i.name.as_str(), i))
            .collect();
        assert_eq!(by_name["fs"].kind, ResourceKind::Mcp);
        assert!(by_name["fs"].enabled);
        assert!(by_name["gh"].enabled);
        // Disabled flag → enabled = false
        assert!(!by_name["web"].enabled);
    }

    // ----- Edge cases -----

    #[test]
    fn scan_missing_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        // No plugins/, no skills/, etc. — all should return empty.
        assert!(scan_resources(tmp.path(), ResourceKind::Plugin)
            .unwrap()
            .is_empty());
        assert!(scan_resources(tmp.path(), ResourceKind::Skill)
            .unwrap()
            .is_empty());
        assert!(scan_resources(tmp.path(), ResourceKind::Command)
            .unwrap()
            .is_empty());
        assert!(scan_resources(tmp.path(), ResourceKind::Lsp)
            .unwrap()
            .is_empty());
        assert!(scan_resources(tmp.path(), ResourceKind::Mcp)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn scan_invalid_mcp_json_skipped() {
        let tmp = make_claude_dir();
        // Garbage JSON. Must NOT error — return empty list.
        fs::write(tmp.path().join("mcp.json"), b"this is not json").unwrap();
        let items = scan_resources(tmp.path(), ResourceKind::Mcp).unwrap();
        assert!(items.is_empty());
    }

    /// Bonus: scanning a kind whose subdir exists but is empty
    /// returns empty (not error). Catches regressions where the
    /// helper mistakenly required at least one entry.
    #[test]
    fn scan_empty_subdir_returns_empty() {
        let tmp = make_claude_dir();
        // Subdirs exist but no files inside.
        let items = scan_resources(tmp.path(), ResourceKind::Command).unwrap();
        assert!(items.is_empty());
    }

    /// Bonus: id format is `<tag>/<name>` matching `ResourceKind.as_str()`.
    /// Pinning the format here means a later rename of the id scheme
    /// (e.g. add the kind name) trips this test.
    #[test]
    fn scan_id_uses_kind_subdir_tag() {
        let tmp = make_claude_dir();
        fs::write(tmp.path().join("commands").join("hi.md"), b"x").unwrap();
        let items = scan_resources(tmp.path(), ResourceKind::Command).unwrap();
        assert_eq!(items[0].id, "command/hi.md");
    }

    // ----- F21 source_repo 推断 (M2.16) -----
    //
    // SPEC F21 要求"按来源仓库过滤"。最小方案:plugin/skill 的
    // source_repo = 顶层目录名(= name);command/lsp/mcp = None。

    /// plugin 的 source_repo 等于 marketplace 后缀 (从 plugin key 解析)。
    #[test]
    fn source_repo_inferred_for_plugins() {
        let tmp = make_claude_dir();
        // No physical `plugins/code-review/` needed — the registry
        // is the source of truth (M5 BUG-FIX).
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "code-review@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/code-review/1.0.0",
                    "version": "1.0.0"
                }]
            }),
        );
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].source_repo.as_deref(),
            Some("claude-plugins-official")
        );
    }

    /// skill 的 source_repo 等于其顶层目录/文件名。
    #[test]
    fn source_repo_inferred_for_skills() {
        let tmp = make_claude_dir();
        let dir_skill = tmp.path().join("skills").join("advanced");
        fs::create_dir(&dir_skill).unwrap();
        fs::write(dir_skill.join("SKILL.md"), b"# advanced").unwrap();
        fs::write(
            tmp.path().join("skills").join("quickref.md"),
            b"# quickref",
        )
        .unwrap();
        let items = scan_resources(tmp.path(), ResourceKind::Skill).unwrap();
        assert_eq!(items.len(), 2);
        let by_name: std::collections::HashMap<_, _> = items
            .iter()
            .map(|i| (i.name.as_str(), i.source_repo.as_deref()))
            .collect();
        assert_eq!(by_name["advanced"], Some("advanced"));
        assert_eq!(by_name["quickref.md"], Some("quickref.md"));
    }

    /// command/lsp/mcp 的 source_repo 必须是 None —— 散文件 / 聚合条目
    /// 没有仓库归属。这是前端"全部来源"下拉默认选项存在的语义依据。
    #[test]
    fn source_repo_none_for_command_lsp_mcp() {
        let tmp = make_claude_dir();
        fs::write(tmp.path().join("commands").join("build.md"), b"x").unwrap();
        fs::write(
            tmp.path().join("lsp").join("rust.json"),
            b"{\"lang\":\"rust\"}",
        )
        .unwrap();
        fs::write(
            tmp.path().join("mcp.json"),
            r#"{"mcpServers":{"fs":{"command":"npx"}}}"#,
        )
        .unwrap();

        for kind in [ResourceKind::Command, ResourceKind::Lsp, ResourceKind::Mcp] {
            let items = scan_resources(tmp.path(), kind).unwrap();
            assert_eq!(items.len(), 1, "kind {kind:?} should yield 1 item");
            assert!(
                items[0].source_repo.is_none(),
                "kind {kind:?} source_repo must be None, got {:?}",
                items[0].source_repo
            );
        }
    }

    /// 单元覆盖推断函数本身:plugin/skill → Some(name),
    /// command/lsp/mcp → None。pin 行为防回归。
    #[test]
    fn infer_resource_group_rules() {
        assert_eq!(
            infer_resource_group(ResourceKind::Plugin, "code-review"),
            Some("code-review".into())
        );
        assert_eq!(
            infer_resource_group(ResourceKind::Skill, "my-skill"),
            Some("my-skill".into())
        );
        assert_eq!(infer_resource_group(ResourceKind::Command, "build.md"), None);
        assert_eq!(infer_resource_group(ResourceKind::Lsp, "rust.json"), None);
        assert_eq!(infer_resource_group(ResourceKind::Mcp, "fs"), None);
    }

    // ----- M3.4 — 清单 17: 过滤 cache / node_modules / .git 等污染目录 -----

    /// M3.4 (清单 17): 即使 `cache` / `node_modules` / `.git` 等污染目录
    /// 物理存在于 `plugins/` 下, scanner 也不能把它们当 plugin 列出。
    /// M5 BUG-FIX 改造: Plugin arm 不再扫描 `plugins/` 顶层目录,所以
    /// pollution dirs 完全不可达 — 这是更强的保证。
    #[test]
    fn scan_plugins_dir_excludes_pollution_dirs() {
        let tmp = make_claude_dir();
        // 物理污染目录(模拟 Claude Code 留下的 cache / node_modules)
        for pollution in ["cache", "node_modules", ".git", "target", "dist", "build"] {
            fs::create_dir(tmp.path().join("plugins").join(pollution)).unwrap();
            fs::write(
                tmp.path().join("plugins").join(pollution).join("junk.txt"),
                b"junk",
            )
            .unwrap();
        }
        // registry 里只放 1 个真 plugin
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "code-review@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/code-review/1.0.0",
                    "version": "1.0.0"
                }]
            }),
        );

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(items.len(), 1, "只应返回真 plugin, 实际: {names:?}");
        assert!(names.contains(&"code-review@claude-plugins-official"));
        // 物理污染目录在 registry 里查不到 → 永不出现
        for pollution in ["cache", "node_modules", ".git", "target", "dist", "build"] {
            assert!(
                !names.contains(&pollution),
                "{pollution} 应被过滤, 但出现在结果中: {names:?}"
            );
        }
    }

    /// M3.4 (清单 17): skill 目录也走同样过滤规则。
    #[test]
    fn scan_skills_dir_excludes_pollution_dirs() {
        let tmp = make_claude_dir();
        // 真 skill
        fs::create_dir(tmp.path().join("skills").join("advanced")).unwrap();
        fs::write(
            tmp.path().join("skills").join("advanced").join("SKILL.md"),
            b"# adv",
        )
        .unwrap();
        // 污染目录
        fs::create_dir(tmp.path().join("skills").join("node_modules")).unwrap();
        fs::write(
            tmp.path().join("skills").join("node_modules").join("x.txt"),
            b"x",
        )
        .unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Skill).unwrap();
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(items.len(), 1, "只应返回真 skill, 实际: {names:?}");
        assert!(names.contains(&"advanced"));
        assert!(!names.contains(&"node_modules"));
    }

    /// M3.4 (清单 17): filter 不影响 command / lsp(md / json 文件, 不是
    /// 目录)。 已有的 dotfile 过滤保留(`.foo.md` 仍被过滤)。
    #[test]
    fn scan_commands_lsp_unaffected_by_excluded_dir_filter() {
        let tmp = make_claude_dir();
        fs::write(
            tmp.path().join("commands").join("build.md"),
            b"# build",
        )
        .unwrap();
        fs::write(
            tmp.path().join("lsp").join("rust.json"),
            b"{}",
        )
        .unwrap();
        let cmds = scan_resources(tmp.path(), ResourceKind::Command).unwrap();
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].name, "build.md");
        let lsps = scan_resources(tmp.path(), ResourceKind::Lsp).unwrap();
        assert_eq!(lsps.len(), 1);
        assert_eq!(lsps[0].name, "rust.json");
    }

    // ----- M5 bug #21 — plugin scan should not dive into nested subdirs -----

    /// M5 bug #21 (M5 BUG-FIX 配套):plugin registry 是真理之源,与
    /// 物理目录嵌套无关。本测试固定行为:plugin 的 `name` 来自
    /// `installed_plugins.json` 的 key,与 `plugins/<name>/<sub>/`
    /// 嵌套结构无关 —— registry 写啥就列啥。
    #[test]
    fn scan_plugins_does_not_descend_into_nested_plugin_subdirs() {
        let tmp = make_claude_dir();
        // 物理嵌套结构(模拟 user 描述的"装到 team-x/team-x-plugin/")
        // — registry 不知道这件事,所以不应该影响 plugin 列表。
        let team_x = tmp.path().join("plugins").join("team-x");
        fs::create_dir(&team_x).unwrap();
        fs::create_dir(team_x.join("team-x-plugin")).unwrap();
        fs::write(team_x.join("team-x-plugin").join("main.md"), b"x").unwrap();

        // Registry 里只放 code-review,没有 team-x / team-x-plugin
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "code-review@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": "/abs/cache/claude-plugins-official/code-review/1.0.0",
                    "version": "1.0.0"
                }]
            }),
        );

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        println!(
            "[scan_plugins_does_not_descend_into_nested_plugin_subdirs] returned {} items: {names:?}",
            items.len()
        );
        assert_eq!(items.len(), 1, "registry 决定 plugin 列表, 实际: {names:?}");
        assert!(names.contains(&"code-review@claude-plugins-official"));
        assert!(
            !names.contains(&"team-x"),
            "registry 里没有的 plugin 永不出现: {names:?}"
        );
        assert!(
            !names.contains(&"team-x-plugin"),
            "嵌套子目录不应作为独立 plugin 出现: {names:?}"
        );
    }

    /// Bug #21 配套(M5):plugin 的 `path` 必须是 registry 里的
    /// `installPath`,与物理 `plugins/<name>/<sub>/` 结构无关。
    /// 这是 resource_detail 跳转 reveal 时需要的真实路径。
    #[test]
    fn scan_plugins_records_top_level_path_only() {
        let tmp = make_claude_dir();
        // 物理结构:plugins/alpha/v1/plugin.md (无关紧要 — registry 是真理之源)
        let top = tmp.path().join("plugins").join("alpha");
        fs::create_dir(&top).unwrap();
        fs::create_dir(top.join("v1")).unwrap();
        fs::write(top.join("v1").join("plugin.md"), b"x").unwrap();

        // Registry 写 installPath = `/some/other/path/alpha`
        let real_path = "/some/other/path/alpha";
        write_installed_plugins(
            &tmp,
            2,
            serde_json::json!({
                "alpha@claude-plugins-official": [{
                    "scope": "user",
                    "installPath": real_path,
                    "version": "1.0.0"
                }]
            }),
        );

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        let alpha = items
            .iter()
            .find(|i| i.name == "alpha@claude-plugins-official")
            .expect("alpha must be in registry result");
        // path = registry installPath, 不是物理路径
        assert_eq!(alpha.path, real_path);
        assert!(!alpha.path.contains("v1"));
    }
}