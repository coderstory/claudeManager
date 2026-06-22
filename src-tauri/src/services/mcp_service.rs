//! McpService — F6 (MCP management) business logic (M2.5).
//!
//! Reads + writes the single `~/.claude/mcp.json` file, which
//! contains a `mcpServers` map (name → server config). The on-disk
//! shape is the Claude Code native format; the in-memory shape is
//! `Vec<McpServer>` with a stable UUID per entry for list/toggle
//! operations.
//!
//! # Design constraints (CLAUDE.md §3.1 + §7)
//!
//! - All I/O goes through `infrastructure::fs_atomic` — no direct
//!   `std::fs` calls except for read-back on `list` (which we want
//!   to be a non-destructive snapshot; backup-before-write is
//!   wasteful for reads).
//! - Path resolution goes through `AppPaths::claude_dir()` (which
//!   the platform layer filled in via `IPlatformPaths`).
//! - `mcp.json` is read as a `serde_json::Value` and patched in
//!   place — we never `from_str::<RootShape>` then `to_string_pretty`
//!   because that would drop unknown keys (SPEC §6.1 "不破坏未知
//!   字段"). Same pattern as `ProviderService::switch_provider` for
//!   `settings.json`.
//! - Every error is a `String` (Tauri requires Serialize) wrapping a
//!   user-readable message. No silent failures.
//!
//! # On-disk shape
//!
//! ```json
//! {
//!   "mcpServers": {
//!     "filesystem": { "command": "npx", "args": [...], "env": {...} },
//!     "remote":     { "type": "http", "url": "https://..." }
//!   },
//!   "preferences": { ... }   // preserved
//! }
//! ```
//!
//! The in-memory `McpServer` has the additional fields the F6 UI
//! needs (UUID `id`, `enabled`, `created_at`) which we synthesise
//! when reading and drop when writing (keeping the on-disk shape
//! minimal).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::de::Error as _;
use serde_json::Value;

use crate::domain::{McpError, McpServer, McpTransport};
use crate::infrastructure::fs_atomic;
use crate::platform::AppPaths;

// ---------------------------------------------------------------------------
// McpService
// ---------------------------------------------------------------------------

/// Business logic for F6 (MCP list/toggle/add/update/remove).
/// Stateless apart from the resolved `AppPaths` snapshot.
///
/// M3.12 (A1#4) — `active_root_dir` is the project-mode switch:
/// - `None` → read/write `~/.claude/mcp.json` (user-level, M2.5
///   backwards compatible).
/// - `Some(root)` → read/write `<root>/.claude/mcp.json` (project
///   mode). Refuses to write when `root` does not exist (no auto-
///   `mkdir`); mirrors F18 `apply_findings`.
pub struct McpService {
    paths: AppPaths,
    /// M3.12 — optional project-mode root. `None` = user-level.
    /// Stored as `Option<PathBuf>` (owned) so the service is `'static`
    /// friendly for `Arc` sharing in `AppState`.
    active_root_dir: Option<PathBuf>,
    /// Resolved at construction: either
    /// `<claude_dir>/mcp.json` (user-level) or
    /// `<active_root>/.claude/mcp.json` (project mode). Cached so the
    /// service doesn't re-allocate a `PathBuf` on every call.
    mcp_json_path: PathBuf,
}

impl McpService {
    /// Build a service from the resolved `AppPaths` (M2.5 compat).
    /// The mcp.json path is derived as `<claude_dir>/mcp.json` per
    /// SPEC §2.2 — i.e. **user-level** mode (M3.12).
    ///
    /// Existing call sites in `commands/mcp.rs` keep using this ctor;
    /// project-mode is opt-in via `new_with_active_root` /
    /// `with_root`.
    pub fn new(paths: AppPaths) -> Self {
        Self::new_with_active_root(paths, None)
    }

    /// M3.12 (A1#4) — build a service with an explicit project root.
    ///
    /// - `active_root_dir = None` → resolves to `<claude_dir>/mcp.json`
    ///   (user-level, M2.5 behaviour).
    /// - `active_root_dir = Some(root)` → resolves to
    ///   `<root>/.claude/mcp.json` (project mode).
    ///
    /// Does **not** check `root.exists()` here — the safety boundary
    /// is enforced at `write_all` time (refuses to write into a
    /// non-existent root, matching F18 `apply_findings`).
    pub fn new_with_active_root(paths: AppPaths, active_root_dir: Option<&Path>) -> Self {
        let mcp_json_path = match active_root_dir {
            Some(root) => root.join(".claude").join("mcp.json"),
            None => paths
                .claude_dir()
                .map(|p| p.join("mcp.json"))
                .unwrap_or_else(|| PathBuf::from("mcp.json")),
        };
        Self {
            paths,
            active_root_dir: active_root_dir.map(|p| p.to_path_buf()),
            mcp_json_path,
        }
    }

    /// M3.12 (A1#4) — command-layer convenience: return a new
    /// `McpService` view rooted at `active_root_dir`. Keeps the
    /// existing `Arc<McpService>` in `AppState` intact (cheap shallow
    /// clone of `paths` + a small `PathBuf` for the root).
    ///
    /// Usage (from `commands/mcp.rs`):
    /// ```ignore
    /// let active_root = crate::platform::runtime::paths().active_root_dir();
    /// state.mcp_service.with_root(active_root.as_deref()).list()
    /// ```
    pub fn with_root(&self, active_root_dir: Option<&Path>) -> Self {
        Self::new_with_active_root(self.paths.clone(), active_root_dir)
    }

    /// Borrow the resolved paths (read-only).
    #[allow(dead_code)]
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    /// Path to the on-disk mcp.json file (read-only).
    #[allow(dead_code)]
    pub fn mcp_json_path(&self) -> &Path {
        &self.mcp_json_path
    }

    /// M3.12 — current `active_root_dir`, if any.
    #[allow(dead_code)]
    pub fn active_root_dir(&self) -> Option<&Path> {
        self.active_root_dir.as_deref()
    }

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------

    /// Read `mcp.json` and return all configured MCP servers.
    ///
    /// Returns an empty Vec if the file is missing, the file is
    /// empty, or `mcpServers` is missing. Corrupt JSON is *not* a
    /// silent return — `list_with_warnings` surfaces it.
    pub fn list(&self) -> Vec<McpServer> {
        self.list_with_warnings().0
    }

    /// Same as [`list`] but also returns the parse error (if any)
    /// so the UI can show a non-fatal InfoBar.
    pub fn list_with_warnings(&self) -> (Vec<McpServer>, Option<String>) {
        let raw = match std::fs::read_to_string(&self.mcp_json_path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return (Vec::new(), None);
            }
            Err(e) => return (Vec::new(), Some(format!("读取 mcp.json 失败: {e}"))),
        };
        if raw.trim().is_empty() {
            return (Vec::new(), None);
        }
        let root: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => return (Vec::new(), Some(format!("mcp.json 解析失败: {e}"))),
        };
        let map = match root.get("mcpServers").and_then(|v| v.as_object()) {
            Some(m) => m,
            None => return (Vec::new(), None),
        };

        // Stable sort by name (preserves the on-disk iteration order
        // for users who curated it manually; alphabetical is the
        // fallback when map ordering is lost in some JSON parsers).
        let mut entries: Vec<(&String, &Value)> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));

        let servers: Vec<McpServer> = entries
            .into_iter()
            .filter_map(|(name, value)| parse_entry(name, value))
            .collect();

        (servers, None)
    }

    // -----------------------------------------------------------------------
    // toggle
    // -----------------------------------------------------------------------

    /// Flip the `enabled` flag for the server with the given UUID.
    /// Returns the updated server on success.
    ///
    /// Errors:
    /// - `McpError::NotFound(id)` — no entry with that id.
    /// - `McpError::Io(_)` — disk-level error.
    pub fn toggle(&self, id: &str, enabled: bool) -> Result<McpServer, McpError> {
        let mut servers = self.list();
        let server = servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| McpError::NotFound(id.to_string()))?;
        server.enabled = enabled;
        let updated = server.clone();
        self.write_all(&servers)?;
        Ok(updated)
    }

    // -----------------------------------------------------------------------
    // add
    // -----------------------------------------------------------------------

    /// Add a new MCP server. Errors if an entry with the same
    /// `name` already exists (MCP map keys are names).
    pub fn add(&self, server: McpServer) -> Result<(), McpError> {
        server.validate()?;
        let mut servers = self.list();
        if servers.iter().any(|s| s.name == server.name) {
            return Err(McpError::AlreadyExists(server.name.clone()));
        }
        servers.push(server);
        self.write_all(&servers)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    /// Update an existing server (identified by `id`).
    /// The `id` field of `server` must match the existing one.
    /// The `name` field may change — if it does, we still find the
    /// old entry by `id`, replace it, and the on-disk map key
    /// becomes the new name.
    pub fn update(&self, id: &str, server: McpServer) -> Result<McpServer, McpError> {
        server.validate()?;
        let mut servers = self.list();
        let existing = servers
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| McpError::NotFound(id.to_string()))?;
        if server.id != existing.id {
            return Err(McpError::InvalidField(format!(
                "id mismatch: '{id}' vs '{}'",
                server.id
            )));
        }
        // Name change conflict?
        if server.name != existing.name
            && servers.iter().any(|s| s.name == server.name)
        {
            return Err(McpError::AlreadyExists(server.name.clone()));
        }
        let updated = server.clone();
        // Replace in-place.
        for entry in servers.iter_mut() {
            if entry.id == id {
                *entry = server.clone();
                break;
            }
        }
        self.write_all(&servers)?;
        Ok(updated)
    }

    // -----------------------------------------------------------------------
    // remove
    // -----------------------------------------------------------------------

    /// Remove the server with the given UUID.
    pub fn remove(&self, id: &str) -> Result<(), McpError> {
        let mut servers = self.list();
        let initial_len = servers.len();
        servers.retain(|s| s.id != id);
        if servers.len() == initial_len {
            return Err(McpError::NotFound(id.to_string()));
        }
        self.write_all(&servers)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // write helper
    // -----------------------------------------------------------------------

    /// Write the full server list back to `mcp.json`, preserving
    /// any other top-level keys (preferences, etc.) and going
    /// through `fs_atomic::write_with_backup` (CLAUDE.md §7).
    ///
    /// M3.12 (A1#4) — safety boundary: when `active_root_dir =
    /// Some(root)` and `<root>` does NOT exist on disk, this method
    /// **rejects** the write with `McpError::Io(NotFound)` and does
    /// NOT auto-`mkdir` the unknown root. Mirrors F18
    /// `apply_findings` (CLAUDE.md §7 + §2.4: 不 mkdir 未知路径).
    /// User-level mode (`active_root_dir = None`) skips this check —
    /// the existing `add_creates_parent_dir_if_missing` test pins
    /// that behaviour.
    fn write_all(&self, servers: &[McpServer]) -> Result<(), McpError> {
        // SAFETY BOUNDARY — refuse writes into a non-existent
        // project root. The check is intentionally one level deep
        // (root only, not `.claude/`) so we don't accidentally
        // materialise a project layout the user hasn't authorised.
        if let Some(root) = &self.active_root_dir {
            if !root.exists() {
                return Err(McpError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!(
                        "active root 目录不存在: {} (拒绝写入,避免 mkdir 未知路径)",
                        root.display()
                    ),
                )));
            }
        }

        let mut root: Value = match std::fs::read_to_string(&self.mcp_json_path) {
            Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s)
                .map_err(|e| McpError::Json(serde_json::Error::custom(format!(
                    "mcp.json 解析失败: {e}"
                ))))?,
            _ => Value::Object(Default::default()),
        };

        // Convert Vec<McpServer> → Value::Object(name → entry).
        let map_obj = root
            .as_object_mut()
            .ok_or_else(|| McpError::InvalidField("mcp.json 根必须是对象".into()))?;
        let mut new_servers = serde_json::Map::new();
        for s in servers {
            let value = server_to_value(s)?;
            new_servers.insert(s.name.clone(), value);
        }
        map_obj.insert("mcpServers".into(), Value::Object(new_servers));

        let json = serde_json::to_string_pretty(&root)?;
        fs_atomic::write_with_backup(&self.mcp_json_path, &json).map_err(map_fs_atomic_to_mcp)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a single `mcpServers.<name>` JSON entry into an
/// `McpServer`.
///
/// The on-disk entry can be either:
///
/// - Stdio: `{"command": "npx", "args": [...], "env": {...}}`
/// - Http:  `{"type": "http", "url": "https://..."}`
///
/// Anything missing the `type` field is treated as stdio (matches
/// Claude Code's own default).
fn parse_entry(name: &str, value: &Value) -> Option<McpServer> {
    let transport = match value.get("type").and_then(|v| v.as_str()) {
        Some("http") => McpTransport::Http,
        _ => McpTransport::Stdio,
    };
    let enabled = value
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let command = value
        .get("command")
        .and_then(|v| v.as_str())
        .map(String::from);
    let args = value
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let env: HashMap<String, String> = value
        .get("env")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let url = value
        .get("url")
        .and_then(|v| v.as_str())
        .map(String::from);

    let mut s = McpServer::new(name, transport, command, url);
    s.args = args;
    s.env = env;
    s.enabled = enabled;
    Some(s)
}

/// Serialise an `McpServer` back to the on-disk entry shape.
/// The `id`, `created_at`, and `enabled` flag are NOT part of the
/// canonical on-disk shape — `id`/`created_at` are UI-only
/// metadata; `enabled` is a Claude Code extension field
/// (preserved when explicitly set).
fn server_to_value(s: &McpServer) -> Result<Value, McpError> {
    let mut entry = serde_json::Map::new();
    match s.transport {
        McpTransport::Stdio => {
            // Stdio entries can omit "type" (matches Claude Code's
            // default; older dumps never had a type field).
            if let Some(cmd) = &s.command {
                entry.insert("command".into(), Value::String(cmd.clone()));
            }
            if !s.args.is_empty() {
                let arr: Vec<Value> = s.args.iter().map(|a| Value::String(a.clone())).collect();
                entry.insert("args".into(), Value::Array(arr));
            }
            if !s.env.is_empty() {
                let obj: serde_json::Map<String, Value> = s
                    .env
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect();
                entry.insert("env".into(), Value::Object(obj));
            }
        }
        McpTransport::Http => {
            entry.insert("type".into(), Value::String("http".into()));
            if let Some(url) = &s.url {
                entry.insert("url".into(), Value::String(url.clone()));
            }
        }
    }
    entry.insert("enabled".into(), Value::Bool(s.enabled));
    Ok(Value::Object(entry))
}

/// Convert `fs_atomic::FsAtomicError` → `McpError`.
fn map_fs_atomic_to_mcp(e: fs_atomic::FsAtomicError) -> McpError {
    use fs_atomic::FsAtomicError;
    match e {
        FsAtomicError::Io(io) => McpError::Io(io),
        other => McpError::Io(std::io::Error::other(format!(
            "atomic write failed: {other}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tempfile::TempDir;

    fn test_paths(home: &Path) -> AppPaths {
        let claude_dir = home.join(".claude");
        AppPaths {
            home: home.to_path_buf(),
            app_data: home.join("AppData"),
            settings_json: claude_dir.join("settings.json"),
            claude_json: home.join(".claude.json"),
            backups_dir: home.join("AppData").join("backups"),
            marketplaces_dir: home.join("AppData").join("marketplaces"),
            logs_dir: home.join("AppData").join("logs"),
        }
    }

    fn now_unix_secs() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    /// Build a stdio McpServer with a stable UUID for testing.
    fn sample_stdio(id: &str, name: &str) -> McpServer {
        let mut s = McpServer::new(
            name,
            McpTransport::Stdio,
            Some("npx".into()),
            None,
        );
        s.id = id.into();
        s.args = vec!["-y".into(), "@mcp/test".into()];
        s.env = HashMap::from([("KEY".into(), "v".into())]);
        s.enabled = true;
        s.created_at = now_unix_secs();
        s
    }

    fn sample_http(id: &str, name: &str) -> McpServer {
        let mut s = McpServer::new(
            name,
            McpTransport::Http,
            None,
            Some("https://mcp.example/sse".into()),
        );
        s.id = id.into();
        s.enabled = false;
        s.created_at = now_unix_secs();
        s
    }

    fn write_mcp_json(home: &Path, servers: &Value) {
        let claude_dir = home.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let body = serde_json::json!({ "mcpServers": servers });
        fs::write(
            claude_dir.join("mcp.json"),
            serde_json::to_string_pretty(&body).unwrap(),
        )
        .unwrap();
    }

    // ----- list -----

    #[test]
    fn list_empty_file_returns_empty_vec() {
        let tmp = TempDir::new().unwrap();
        let svc = McpService::new(test_paths(tmp.path()));
        let result = svc.list();
        assert!(result.is_empty());
        let (_, warn) = svc.list_with_warnings();
        assert!(warn.is_none());
    }

    #[test]
    fn list_3_servers_parses_correctly_sorted_by_name() {
        let tmp = TempDir::new().unwrap();
        let servers = serde_json::json!({
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@mcp/filesystem"],
                "env": { "ROOT": "/tmp" }
            },
            "remote": {
                "type": "http",
                "url": "https://mcp.example/sse"
            },
            "alpha": {
                "command": "echo"
            }
        });
        write_mcp_json(tmp.path(), &servers);
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        assert_eq!(list.len(), 3);
        // Sorted by name: alpha, filesystem, remote
        assert_eq!(list[0].name, "alpha");
        assert_eq!(list[1].name, "filesystem");
        assert_eq!(list[2].name, "remote");
        // transport detection
        assert_eq!(list[0].transport, McpTransport::Stdio);
        assert_eq!(list[2].transport, McpTransport::Http);
        assert_eq!(
            list[2].url.as_deref(),
            Some("https://mcp.example/sse")
        );
        // enabled defaults to true
        assert!(list[0].enabled);
        // uuids are non-empty
        for s in &list {
            assert!(!s.id.is_empty());
        }
    }

    #[test]
    fn list_corrupt_json_returns_warning_no_panic() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("mcp.json"), "{ this is not json").unwrap();
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        assert!(list.is_empty());
        let (_, warn) = svc.list_with_warnings();
        assert!(warn.is_some());
        assert!(warn.unwrap().contains("解析失败"));
    }

    #[test]
    fn list_missing_mcp_servers_key_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("mcp.json"),
            r#"{ "preferences": { "theme": "dark" } }"#,
        )
        .unwrap();
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        assert!(list.is_empty());
        let (_, warn) = svc.list_with_warnings();
        assert!(warn.is_none());
    }

    // ----- toggle -----

    #[test]
    fn toggle_enabled_writes_to_file() {
        let tmp = TempDir::new().unwrap();
        let servers = serde_json::json!({
            "fs": { "command": "npx" }
        });
        write_mcp_json(tmp.path(), &servers);
        let svc = McpService::new(test_paths(tmp.path()));

        // First, read to discover the auto-generated id.
        let list = svc.list();
        let id = list[0].id.clone();
        assert!(list[0].enabled);

        let updated = svc.toggle(&id, false).unwrap();
        assert!(!updated.enabled);
        assert_eq!(updated.id, id);

        // Reload to confirm persistence.
        let list2 = svc.list();
        assert!(!list2[0].enabled);
    }

    #[test]
    fn toggle_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        let svc = McpService::new(test_paths(tmp.path()));
        let err = svc.toggle("nonexistent", true).unwrap_err();
        assert!(matches!(err, McpError::NotFound(_)));
    }

    // ----- add -----

    #[test]
    fn add_new_writes_to_file() {
        let tmp = TempDir::new().unwrap();
        write_mcp_json(tmp.path(), &serde_json::json!({}));
        let svc = McpService::new(test_paths(tmp.path()));

        let s = sample_stdio("11111111-1111-1111-1111-111111111111", "new-fs");
        svc.add(s.clone()).unwrap();

        let list = svc.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "new-fs");
        assert_eq!(list[0].command.as_deref(), Some("npx"));
    }

    #[test]
    fn add_duplicate_name_errors() {
        let tmp = TempDir::new().unwrap();
        write_mcp_json(
            tmp.path(),
            &serde_json::json!({
                "fs": { "command": "npx" }
            }),
        );
        let svc = McpService::new(test_paths(tmp.path()));

        let mut dup = sample_stdio("22222222-2222-2222-2222-222222222222", "fs");
        dup.id = "different".into();
        let err = svc.add(dup).unwrap_err();
        assert!(matches!(err, McpError::AlreadyExists(n) if n == "fs"));
    }

    #[test]
    fn add_invalid_server_errors_without_writing() {
        let tmp = TempDir::new().unwrap();
        let svc = McpService::new(test_paths(tmp.path()));

        let mut bad = sample_stdio("33333333-3333-3333-3333-333333333333", "bad");
        bad.command = None; // stdio requires command
        let err = svc.add(bad).unwrap_err();
        assert!(matches!(err, McpError::InvalidField(_)));

        // File was not created.
        let (_, warn) = svc.list_with_warnings();
        assert!(warn.is_none());
        assert!(svc.list().is_empty());
    }

    // ----- update -----

    #[test]
    fn update_existing_replaces_in_file() {
        let tmp = TempDir::new().unwrap();
        write_mcp_json(
            tmp.path(),
            &serde_json::json!({
                "fs": { "command": "npx", "args": ["old"] }
            }),
        );
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        let id = list[0].id.clone();
        let mut updated = list[0].clone();
        updated.args = vec!["new-arg".into()];
        updated.enabled = false;
        let r = svc.update(&id, updated).unwrap();
        assert_eq!(r.args, vec!["new-arg".to_string()]);
        assert!(!r.enabled);

        // Reload and verify the on-disk change.
        let raw = fs::read_to_string(tmp.path().join(".claude").join("mcp.json")).unwrap();
        assert!(raw.contains("new-arg"));
        assert!(!raw.contains("\"old\""));
        assert!(raw.contains("\"enabled\": false"));
    }

    #[test]
    fn update_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        let svc = McpService::new(test_paths(tmp.path()));
        let s = sample_stdio("44444444-4444-4444-4444-444444444444", "x");
        let err = svc.update("nonexistent", s).unwrap_err();
        assert!(matches!(err, McpError::NotFound(_)));
    }

    #[test]
    fn update_id_mismatch_errors() {
        let tmp = TempDir::new().unwrap();
        write_mcp_json(
            tmp.path(),
            &serde_json::json!({
                "fs": { "command": "npx" }
            }),
        );
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        let id = list[0].id.clone();
        let mut tampered = list[0].clone();
        tampered.id = "different-id".into();
        let err = svc.update(&id, tampered).unwrap_err();
        assert!(matches!(err, McpError::InvalidField(_)));
    }

    // ----- remove -----

    #[test]
    fn remove_existing_deletes_from_file() {
        let tmp = TempDir::new().unwrap();
        write_mcp_json(
            tmp.path(),
            &serde_json::json!({
                "a": { "command": "x" },
                "b": { "command": "y" }
            }),
        );
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        let id_a = list.iter().find(|s| s.name == "a").unwrap().id.clone();

        svc.remove(&id_a).unwrap();
        let after = svc.list();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].name, "b");
    }

    #[test]
    fn remove_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        let svc = McpService::new(test_paths(tmp.path()));
        let err = svc.remove("nonexistent").unwrap_err();
        assert!(matches!(err, McpError::NotFound(_)));
    }

    // ----- atomic backup -----

    #[test]
    fn add_creates_backup_of_existing_file() {
        let tmp = TempDir::new().unwrap();
        write_mcp_json(
            tmp.path(),
            &serde_json::json!({
                "existing": { "command": "echo" }
            }),
        );
        let svc = McpService::new(test_paths(tmp.path()));

        let s = sample_stdio("55555555-5555-5555-5555-555555555555", "new");
        svc.add(s).unwrap();

        // A .bak.* file should exist in the same dir.
        let mut found_bak = None;
        for entry in fs::read_dir(tmp.path().join(".claude")).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            if name.starts_with("mcp.json.bak.") {
                found_bak = Some(name);
                break;
            }
        }
        let bak = found_bak.expect("backup should exist");
        let bak_raw = fs::read_to_string(tmp.path().join(".claude").join(&bak)).unwrap();
        assert!(bak_raw.contains("\"existing\""));
        assert!(!bak_raw.contains("\"new\""));
    }

    #[test]
    fn add_creates_parent_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        // No .claude/ subdir yet.
        let svc = McpService::new(test_paths(tmp.path()));

        let s = sample_stdio("66666666-6666-6666-6666-666666666666", "first");
        svc.add(s).unwrap();

        let path = tmp.path().join(".claude").join("mcp.json");
        assert!(path.exists());
    }

    // ----- preserve unknown top-level keys -----

    #[test]
    fn write_preserves_unknown_top_level_keys() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let body = serde_json::json!({
            "mcpServers": {
                "fs": { "command": "npx" }
            },
            "preferences": { "theme": "dark" },
            "userDefined": [1, 2, 3]
        });
        fs::write(
            claude_dir.join("mcp.json"),
            serde_json::to_string_pretty(&body).unwrap(),
        )
        .unwrap();
        let svc = McpService::new(test_paths(tmp.path()));

        let list = svc.list();
        let id = list[0].id.clone();
        svc.toggle(&id, false).unwrap();

        let raw = fs::read_to_string(claude_dir.join("mcp.json")).unwrap();
        assert!(raw.contains("\"preferences\""), "preserved");
        assert!(raw.contains("\"theme\": \"dark\""), "preserved");
        assert!(raw.contains("\"userDefined\""), "preserved");
        assert!(raw.contains("[1, 2, 3]") || raw.contains("1,\n    2,\n    3"), "preserved");
    }

    // ----- M3.12 (A1#4) — `active_root_dir` 接入 -----
    //
    // F6 mcp-management 读写 `active_root/.claude.json` (即
    // `active_root/.claude/mcp.json`)。`None` 走用户级
    // `~/.claude/mcp.json` (向后兼容 M2.5)，`Some(root)` 走
    // `<root>/.claude/mcp.json` (project mode)。写盘前必须校验 root
    // 存在（拒绝 mkdir 未知 root），与 F18 `apply_findings` 同源。

    /// Build an `McpService` rooted at a synthetic home dir, with an
    /// optional `active_root_dir` (M3.12). Mirrors F18's
    /// `build_svc_with_root`.
    ///
    /// Returns `(svc, user_mcp_path, project_mcp_path)`. The project
    /// path is `Some(...)` iff `active_root` is `Some(p)` AND the test
    /// caller is expected to materialise `<p>/.claude/mcp.json` itself
    /// — the helper does NOT pre-create it (the safety-boundary test
    /// needs an absent root).
    fn build_svc_with_root(
        tmp: &TempDir,
        active_root: Option<&Path>,
    ) -> (McpService, PathBuf /* user mcp */, Option<PathBuf> /* project mcp */) {
        let user_claude_dir = tmp.path().join("user").join(".claude");
        fs::create_dir_all(&user_claude_dir).unwrap();
        let user_mcp_path = user_claude_dir.join("mcp.json");

        let project_mcp_path = active_root.map(|root| root.join(".claude").join("mcp.json"));

        let paths = AppPaths {
            home: tmp.path().join("user"),
            app_data: tmp.path().join("user").join("AppData"),
            settings_json: user_claude_dir.join("settings.json"),
            claude_json: tmp.path().join("user").join(".claude.json"),
            backups_dir: tmp.path().join("user").join("AppData").join("backups"),
            marketplaces_dir: tmp.path().join("user").join("AppData").join("marketplaces"),
            logs_dir: tmp.path().join("user").join("AppData").join("logs"),
        };
        let svc = McpService::new_with_active_root(paths, active_root);
        (svc, user_mcp_path, project_mcp_path)
    }

    /// 1. `active_root_dir() = None` + 读 → 读用户级 `~/.claude/mcp.json`。
    ///    向后兼容：M2.5 行为不变（已被现有测试间接覆盖，这里显式 pin 路径）。
    #[test]
    fn read_with_active_root_none_reads_user_dotclaude_mcp_json() {
        let tmp = TempDir::new().unwrap();
        let (svc, user_mcp_path, project_mcp_path) = build_svc_with_root(&tmp, None);
        assert!(project_mcp_path.is_none());

        // Write the user-level mcp.json directly (mimic M2.5 path).
        let body = serde_json::json!({
            "mcpServers": {
                "fs": { "command": "npx" }
            }
        });
        fs::write(&user_mcp_path, serde_json::to_string_pretty(&body).unwrap()).unwrap();

        let list = svc.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "fs");
    }

    /// 2. `active_root_dir() = Some(root)` + 读 → 读 `<root>/.claude/mcp.json`，
    ///    **忽略** 用户级 mcp.json（验证路径已切换）。
    #[test]
    fn read_with_active_root_some_reads_project_mcp_json_not_user() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("project");
        fs::create_dir_all(&project_root).unwrap();
        let project_claude = project_root.join(".claude");
        fs::create_dir_all(&project_claude).unwrap();

        // User-level has a different server — must NOT be returned.
        let (_, user_mcp_path, _) = build_svc_with_root(&tmp, Some(&project_root));
        let user_body = serde_json::json!({
            "mcpServers": {
                "user-only": { "command": "should-not-show" }
            }
        });
        fs::write(&user_mcp_path, serde_json::to_string_pretty(&user_body).unwrap()).unwrap();

        // Project-level has the real data we expect to read.
        let project_body = serde_json::json!({
            "mcpServers": {
                "proj-fs": { "command": "npx", "args": ["-y", "@mcp/proj"] },
                "proj-remote": { "type": "http", "url": "https://proj.example/sse" }
            }
        });
        fs::write(
            project_claude.join("mcp.json"),
            serde_json::to_string_pretty(&project_body).unwrap(),
        )
        .unwrap();

        let (svc, _, _) = build_svc_with_root(&tmp, Some(&project_root));
        let list = svc.list();
        assert_eq!(list.len(), 2, "should read project, not user");
        let names: Vec<&str> = list.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"proj-fs"));
        assert!(names.contains(&"proj-remote"));
        assert!(!names.contains(&"user-only"), "user-level must not leak");
    }

    /// 3. `active_root_dir() = Some(root)` + 写（add 触发 write_all）→
    ///    写到 `<root>/.claude/mcp.json` + atomic rename + 备份；
    ///    用户级 mcp.json 不动。
    #[test]
    fn write_with_active_root_some_writes_to_project_and_creates_backup() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("project");
        fs::create_dir_all(project_root.join(".claude")).unwrap();

        // Pre-existing project-level mcp.json so backup has something to save.
        let existing_body = serde_json::json!({
            "mcpServers": {
                "old": { "command": "echo" }
            }
        });
        fs::write(
            project_root.join(".claude").join("mcp.json"),
            serde_json::to_string_pretty(&existing_body).unwrap(),
        )
        .unwrap();

        let (svc, user_mcp_path, project_mcp_path) =
            build_svc_with_root(&tmp, Some(&project_root));
        let project_mcp_path = project_mcp_path.unwrap();

        // add triggers write_all.
        let s = sample_stdio("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "new-proj");
        svc.add(s).unwrap();

        // Project-level: new entry + atomic backup of the original.
        let raw = fs::read_to_string(&project_mcp_path).unwrap();
        assert!(raw.contains("\"new-proj\""));
        assert!(!raw.contains("\"old\""), "old entry replaced");
        let mut found_bak = None;
        for entry in fs::read_dir(project_root.join(".claude")).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            if name.starts_with("mcp.json.bak.") {
                found_bak = Some(name);
                break;
            }
        }
        let bak = found_bak.expect("project backup should exist");
        let bak_raw = fs::read_to_string(project_root.join(".claude").join(&bak)).unwrap();
        assert!(bak_raw.contains("\"old\""), "backup preserves pre-write content");

        // User-level: untouched (file does not even exist).
        assert!(!user_mcp_path.exists(), "user-level mcp.json must not be touched");
    }

    /// 4. `active_root_dir() = Some(root)` + root 目录不存在 → 写拒绝
    ///    返回 `McpError::Io`，**不** mkdir root，也不创建 mcp.json。
    ///    安全边界：与 F18 `apply_findings` 同源 (CLAUDE.md §7 + §2.4)。
    #[test]
    fn write_with_active_root_some_missing_root_rejects_no_mkdir() {
        let tmp = TempDir::new().unwrap();
        // project_root is **inside** tmp but NEVER created → .exists() == false.
        let ghost_root = tmp.path().join("ghost-project");
        assert!(!ghost_root.exists());

        let (svc, _user_mcp_path, project_mcp_path) =
            build_svc_with_root(&tmp, Some(&ghost_root));
        let project_mcp_path = project_mcp_path.unwrap();
        assert!(!project_mcp_path.exists(), "precondition: target absent");

        // add must fail with Io error and NOT create ghost_root.
        let s = sample_stdio("ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb", "ghost");
        let err = svc.add(s).unwrap_err();
        assert!(
            matches!(err, McpError::Io(_)),
            "expected McpError::Io, got {:?}",
            err
        );

        // SAFETY BOUNDARY: nothing was created. ghost_root still absent,
        // and project_mcp_path still absent.
        assert!(
            !ghost_root.exists(),
            "ghost_root must NOT be auto-mkdir'd (CLAUDE.md §7)"
        );
        assert!(
            !project_mcp_path.exists(),
            "project mcp.json must NOT be created"
        );
    }

    // ----- server_to_value -----

    #[test]
    fn server_to_value_omits_type_for_stdio() {
        let s = sample_stdio("77777777-7777-7777-7777-777777777777", "fs");
        let v = server_to_value(&s).unwrap();
        let obj = v.as_object().unwrap();
        assert!(!obj.contains_key("type"), "stdio should not have type field");
        assert!(obj.contains_key("command"));
        assert!(obj.contains_key("enabled"));
    }

    #[test]
    fn server_to_value_includes_type_for_http() {
        let s = sample_http("88888888-8888-8888-8888-888888888888", "remote");
        let v = server_to_value(&s).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.get("type").unwrap().as_str(), Some("http"));
        assert!(obj.contains_key("url"));
    }

    // ----- parse_entry -----

    #[test]
    fn parse_entry_default_transport_is_stdio() {
        let v = serde_json::json!({ "command": "npx" });
        let s = parse_entry("fs", &v).unwrap();
        assert_eq!(s.transport, McpTransport::Stdio);
        assert_eq!(s.command.as_deref(), Some("npx"));
        assert!(s.args.is_empty());
    }

    #[test]
    fn parse_entry_http_uses_url_and_sets_disabled_flag() {
        let v = serde_json::json!({ "type": "http", "url": "https://x.example", "enabled": false });
        let s = parse_entry("remote", &v).unwrap();
        assert_eq!(s.transport, McpTransport::Http);
        assert_eq!(s.url.as_deref(), Some("https://x.example"));
        assert!(!s.enabled);
    }
}
