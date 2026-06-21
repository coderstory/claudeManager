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
            source_repo: infer_source_repo(kind, &name),
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
            source_repo: infer_source_repo(kind, &name),
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
            // mcp server 是 mcp.json 里的聚合条目,无仓库归属 → None。
            source_repo: infer_source_repo(ResourceKind::Mcp, &name),
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

/// F21 — 从资源 `path` 推断来源仓库名(M2.16)。
///
/// 规则(SPEC F21 "按来源仓库过滤"的最小推断方案):
/// - plugin: `.../.claude/plugins/<X>/...` → `Some(<X>)`
/// - skill : `.../.claude/skills/<X>/...` → `Some(<X>)`
/// - command/lsp/mcp:散文件 / 聚合条目,无仓库概念 → `None`
///
/// 实现只做字符串解析,不读 `.git/config`(避免 I/O + 跨平台路径坑)。
/// `name` 对 plugin/skill 恰好等于顶层目录名,直接复用;对 command/lsp
/// 是文件名(含扩展),对 mcp 是 server 名——这些 kind 不推断,传 `None`。
///
/// 之所以单独抽函数(而非内联):测试要覆盖"plugins/skills 命中 /
/// 其他 kind 返回 None / 路径无 .claude 段"等边界,抽出来好测。
fn infer_source_repo(kind: ResourceKind, name: &str) -> Option<String> {
    match kind {
        // plugin/skill 的 name 就是 `<subdir>` 下的顶层目录/文件名,
        // 即 repo 分组键。scanner 已保证 name 非空且非 dotfile。
        ResourceKind::Plugin | ResourceKind::Skill => Some(name.to_string()),
        // 散文件(command .md / lsp .json)与聚合条目(mcp server)没有
        // "仓库"归属——它们是用户手写的单文件,不属于任何 repo。
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
    fn infer_source_repo_rules() {
        assert_eq!(
            infer_source_repo(ResourceKind::Plugin, "code-review"),
            Some("code-review".into())
        );
        assert_eq!(
            infer_source_repo(ResourceKind::Skill, "my-skill"),
            Some("my-skill".into())
        );
        assert_eq!(infer_source_repo(ResourceKind::Command, "build.md"), None);
        assert_eq!(infer_source_repo(ResourceKind::Lsp, "rust.json"), None);
        assert_eq!(infer_source_repo(ResourceKind::Mcp, "fs"), None);
    }
}