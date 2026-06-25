//! `resource_scanner` — filesystem scan primitive for F16 (M2.13).
//!
//! Given a `claude_dir` (typically `~/.claude/`) and a
//! [`ResourceKind`], walk the right subdirectory and emit one
//! [`ResourceItem`] per resource.
//!
//! ## Per-kind scan rules
//!
//! - `Plugin` — list immediate children of `<claude_dir>/plugins/`.
//!   Each child is a directory; `path` = that directory, `size_bytes`
//!   = recursive sum across its files, `enabled` = true (no per-plugin
//!   disable flag exists in M2.13).
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

use std::path::{Path, PathBuf};

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
        ResourceKind::Plugin => scan_dir_children(
            claude_dir,
            "plugins",
            |entry| entry.path().is_dir(),
        ),
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
// Utilities
// ---------------------------------------------------------------------------

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

    // ----- Plugin -----

    #[test]
    fn scan_plugins_dir_returns_plugins() {
        let tmp = make_claude_dir();
        let p1 = tmp.path().join("plugins").join("code-review");
        let p2 = tmp.path().join("plugins").join("doc-writer");
        fs::create_dir(&p1).unwrap();
        fs::create_dir(&p2).unwrap();
        fs::write(p1.join("index.md"), b"hello").unwrap();
        fs::write(p2.join("index.md"), b"hi world").unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        assert_eq!(items.len(), 2);
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"code-review"));
        assert!(names.contains(&"doc-writer"));
        for i in &items {
            assert_eq!(i.kind, ResourceKind::Plugin);
            assert!(i.path.contains("plugins"));
            assert!(i.enabled);
        }
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

    /// plugin 的 source_repo 等于其目录名(= repo 分组键)。
    #[test]
    fn source_repo_inferred_for_plugins() {
        let tmp = make_claude_dir();
        fs::create_dir(tmp.path().join("plugins").join("code-review")).unwrap();
        fs::write(
            tmp.path().join("plugins").join("code-review").join("index.md"),
            b"x",
        )
        .unwrap();
        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source_repo.as_deref(), Some("code-review"));
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

    /// M3.4 (清单 17): plugin 目录下放 `cache` / `node_modules` / `.git`
    /// 等污染目录, scanner 必须过滤掉,不返回假 ResourceItem。
    #[test]
    fn scan_plugins_dir_excludes_pollution_dirs() {
        let tmp = make_claude_dir();
        // 真 plugin
        fs::create_dir(tmp.path().join("plugins").join("code-review")).unwrap();
        fs::write(
            tmp.path().join("plugins").join("code-review").join("index.md"),
            b"x",
        )
        .unwrap();
        // 污染目录(应被过滤)
        for pollution in ["cache", "node_modules", ".git", "target", "dist", "build"] {
            fs::create_dir(tmp.path().join("plugins").join(pollution)).unwrap();
            fs::write(
                tmp.path().join("plugins").join(pollution).join("junk.txt"),
                b"junk",
            )
            .unwrap();
        }

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(items.len(), 1, "只应返回真 plugin, 实际: {names:?}");
        assert!(names.contains(&"code-review"));
        // 污染目录全部过滤
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

    /// Bug #21: 用户把 plugins 装到嵌套路径 (例如
    /// `plugins/team-x/team-x-plugin/`),scanner 只看 `plugins/<name>/`
    /// 顶层,返回 `team-x` 作为 plugin(不是 `team-x-plugin`)。本测试
    /// 固定行为:plugin 的 `name` = `plugins/` 下的顶层目录名,不递归
    /// 进入 `plugins/<name>/<sub>/`。
    #[test]
    fn scan_plugins_does_not_descend_into_nested_plugin_subdirs() {
        let tmp = make_claude_dir();
        // 顶层 plugin:应被列出。
        fs::create_dir(tmp.path().join("plugins").join("code-review")).unwrap();
        fs::write(
            tmp.path().join("plugins")
                .join("code-review")
                .join("index.md"),
            b"x",
        )
        .unwrap();
        // 嵌套结构(`plugins/team-x/team-x-plugin/`):
        // scanner 只看顶层,`team-x` 应作为 plugin 列出,
        // 而 `team-x-plugin` 不应在结果里(它不是 `plugins/` 的直接子)。
        let team_x = tmp.path().join("plugins").join("team-x");
        fs::create_dir(&team_x).unwrap();
        fs::create_dir(team_x.join("team-x-plugin")).unwrap();
        fs::write(team_x.join("team-x-plugin").join("main.md"), b"x").unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"code-review"));
        assert!(
            names.contains(&"team-x"),
            "team-x (顶层) 应被列为 plugin, 实际: {names:?}"
        );
        assert!(
            !names.contains(&"team-x-plugin"),
            "嵌套子目录不应作为独立 plugin 出现: {names:?}"
        );
        // 总数 = 2(code-review + team-x),不是 3。
        assert_eq!(items.len(), 2);
    }

    /// Bug #21 配套:顶层 plugin 的 `path` 必须是 `plugins/<name>`,
    /// 不应是嵌套结构(`plugins/<name>/<sub>/`)。这是 resource_detail
    /// 跳转 reveal 时需要的真实路径。
    #[test]
    fn scan_plugins_records_top_level_path_only() {
        let tmp = make_claude_dir();
        let top = tmp.path().join("plugins").join("alpha");
        fs::create_dir(&top).unwrap();
        fs::create_dir(top.join("v1")).unwrap();
        fs::write(top.join("v1").join("plugin.md"), b"x").unwrap();

        let items = scan_resources(tmp.path(), ResourceKind::Plugin).unwrap();
        let alpha = items.iter().find(|i| i.name == "alpha").unwrap();
        let path = std::path::Path::new(&alpha.path);
        assert!(path.ends_with("plugins/alpha") || path.ends_with("plugins\\alpha"));
        assert!(!alpha.path.contains("v1"));
    }
}