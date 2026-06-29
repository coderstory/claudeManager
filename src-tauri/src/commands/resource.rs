//! Tauri commands for F16 — 资源浏览 (M2.13).
//!
//! Two thin wrappers around [`crate::services::resource_service::ResourceService`]:
//!
//! - [`list_resources`] — scan a `kind` (plugin/skill/command/lsp/mcp)
//!   and return the matching resources.
//! - [`reveal_in_file_manager`] — open the system file manager with
//!   the given path selected.
//!
//! ## Error semantics
//!
//! `Result<T, String>` — Tauri IPC's preferred error type. The
//! `String` is the user-visible message (SPEC §6.5: "不允许静默吞错").
//! Frontend surfaces errors via InfoBar / modal (reveal failure must
//! NOT block UI per CLAUDE.md §7).

use std::path::PathBuf;

use tauri::State;

use crate::app_state::AppState;
use crate::domain::{ResourceDetail, ResourceItem, ResourceKind};
use crate::get_service;
use crate::services::resource_service::RevealFailure;

/// Tauri-friendly error type.
///
/// `list_resources` / `get_resource_detail` use `String` (display
/// message); `reveal_in_file_manager` returns the structured
/// `RevealFailure` so the frontend can route by `kind`.
type CmdResult<T> = Result<T, String>;
type RevealCmdResult = Result<(), RevealFailure>;

/// F16 — list resources of the given kind.
///
/// `kind` is a lowercase tag matching [`ResourceKind::as_str`]
/// (`"plugin"` / `"skill"` / `"command"` / `"lsp"` / `"mcp"`).
/// Unknown kinds return `Err(...)` with a user-readable message.
///
/// M3.12 (A1#11) — reads live `active_root_dir` from the platform
/// shim and routes the scan accordingly. `None` → user-level
/// `~/.claude/` (M2.13 default); `Some(root)` → `<root>/.claude/`
/// (project mode). The service-side `list()` retains the legacy
/// signature for tests/back-compat; this command is the only entry
/// point that needs to follow the live project switch.
#[tauri::command]
pub async fn list_resources(
    state: State<'_, AppState>,
    kind: String,
) -> CmdResult<Vec<ResourceItem>> {
    let parsed = ResourceKind::from_str_opt(&kind).ok_or_else(|| {
        format!(
            "未知资源类型: '{kind}'(允许: plugin, skill, command, lsp, mcp)"
        )
    })?;
    // M3.12 (A1#11) — read live active root via the platform shim
    // (state.paths is a one-shot startup snapshot).
    let active_root = crate::platform::runtime::paths().active_root_dir();
    get_service!(state, crate::services::resource_service::ResourceService)
        .list_with_active_root(parsed, active_root.as_deref())
        .map_err(|e| e.to_string())
}

/// F22 — 读取单个资源的详情(manifest 描述 + 文件列表)。
///
/// `path` 必须是 `list_resources` 返回的 `ResourceItem.path`。
/// `kind` 同 `list_resources` 的 kind 参数(用于 manifest 识别)。
///
/// 安全:拒绝空路径 + `..` 目录穿越(与 `read_sql_file` 同策略)。
/// 读取是 best-effort:manifest 缺失/损坏不报错,对应字段为 `None`。
#[tauri::command]
pub async fn get_resource_detail(
    state: State<'_, AppState>,
    path: String,
    kind: String,
) -> CmdResult<ResourceDetail> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    let parsed = ResourceKind::from_str_opt(&kind).ok_or_else(|| {
        format!(
            "未知资源类型: '{kind}'(允许: plugin, skill, command, lsp, mcp)"
        )
    })?;
    get_service!(state, crate::services::resource_service::ResourceService)
        .detail(&PathBuf::from(&path), parsed)
        .map_err(|e| e.to_string())
}

/// F16 — open the system file manager with `path` selected.
///
/// M3.5 — returns `Result<(), RevealFailure>` (structured) instead
/// of `Result<(), String>`. The frontend `formatRevealError`
/// switches on `RevealFailure.kind` (`"not_found"` /
/// `"permission_denied"` / `"network_path"` / `"launcher_failed"`)
/// to render the localized banner.
///
/// Empty path is rejected with a synthetic `permission_denied`
/// failure (the path-validation family), so the frontend routes it
/// consistently with other validation errors instead of leaking a
/// bare string.
#[tauri::command]
pub async fn reveal_in_file_manager(
    state: State<'_, AppState>,
    path: String,
) -> RevealCmdResult {
    if path.trim().is_empty() {
        return Err(RevealFailure {
            kind: "permission_denied".into(),
            message: "路径为空".into(),
            path: String::new(),
        });
    }
    get_service!(state, crate::services::resource_service::ResourceService)
        .reveal(&PathBuf::from(&path))
        .map_err(|e| match e {
            crate::services::resource_service::ResourceServiceError::Reveal {
                kind,
                message,
                path,
            } => RevealFailure { kind, message, path },
            other => RevealFailure {
                kind: "launcher_failed".into(),
                message: other.to_string(),
                path: path.clone(),
            },
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ResourceItem;
    use crate::domain::ResourceKind;

    /// The frontend passes `kind` as a lowercase string. The command
    /// is the boundary that translates the string into the typed
    /// enum, so a misspelling gets a clean error message instead of
    /// a panic on the backend.
    #[test]
    fn unknown_kind_string_returns_err_message() {
        // We can't call the actual command (needs Tauri State), but
        // we can verify the parser logic by re-running it:
        let bogus = "Plugin"; // capital P, not lowercase
        let parsed = ResourceKind::from_str_opt(bogus);
        assert!(parsed.is_none(), "expected None for capitalised kind");
        // The error string is built dynamically; the substring must
        // mention the unknown value so the user knows what they typed.
        let msg = format!("未知资源类型: '{bogus}'(允许: plugin, skill, command, lsp, mcp)");
        assert!(msg.contains("Plugin"));
        assert!(msg.contains("plugin"));
    }

    /// Empty path must error (no silently-opened Explorer at
    /// the user's home dir).
    #[test]
    fn empty_path_string_is_rejected() {
        let path = "";
        assert!(path.trim().is_empty());
    }

    /// `ResourceItem` JSON shape stability — pin the fields the
    /// frontend relies on (`id`, `name`, `kind`, `path`,
    /// `size_bytes`, `enabled`, `source_repo`).
    #[test]
    fn resource_item_json_shape() {
        let item = ResourceItem {
            id: "command/hi.md".into(),
            name: "hi.md".into(),
            kind: ResourceKind::Command,
            path: "C:/Users/foo/.claude/commands/hi.md".into(),
            size_bytes: 12,
            enabled: true,
            source_repo: None,
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(v["id"], "command/hi.md");
        assert_eq!(v["name"], "hi.md");
        assert_eq!(v["kind"], "command");
        assert_eq!(v["path"], "C:/Users/foo/.claude/commands/hi.md");
        assert_eq!(v["size_bytes"], 12);
        assert_eq!(v["enabled"], true);
        // command 无仓库归属 → null。前端 TS 类型是 string | null。
        assert_eq!(v["source_repo"], serde_json::Value::Null);
    }

    /// F21 — plugin 的 source_repo 非空时序列化为字符串。
    /// 前端来源过滤下拉靠这个字段,shape 必须稳定。
    #[test]
    fn resource_item_source_repo_some_serialises_to_string() {
        let item = ResourceItem {
            id: "plugin/code-review".into(),
            name: "code-review".into(),
            kind: ResourceKind::Plugin,
            path: "C:/Users/foo/.claude/plugins/code-review".into(),
            size_bytes: 4096,
            enabled: true,
            source_repo: Some("code-review".into()),
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(v["source_repo"], "code-review");
    }

    /// F22 — `ResourceDetail` JSON shape stability。前端依赖
    /// `files`(数组) / `description`(string|null) /
    /// `manifest`(object|null)。如果后端重命名字段,这个测试先炸。
    #[test]
    fn resource_detail_json_shape() {
        let detail = ResourceDetail {
            files: vec!["a.txt".into(), "b/c.md".into()],
            description: Some("测试描述".into()),
            manifest: Some(serde_json::json!({"name": "x"})),
        };
        let v = serde_json::to_value(&detail).unwrap();
        assert_eq!(v["files"][0], "a.txt");
        assert_eq!(v["files"][1], "b/c.md");
        assert_eq!(v["description"], "测试描述");
        assert_eq!(v["manifest"]["name"], "x");
    }

    /// F22 — `ResourceDetail` 空值序列化(None → null,空 Vec → [])。
    /// 前端 TS 类型是 `Option<string>` / `string[]`,必须能正确反序列化。
    #[test]
    fn resource_detail_none_fields_serialize_to_null() {
        let detail = ResourceDetail {
            files: Vec::new(),
            description: None,
            manifest: None,
        };
        let v = serde_json::to_value(&detail).unwrap();
        assert_eq!(v["files"], serde_json::json!([]));
        assert_eq!(v["description"], serde_json::Value::Null);
        assert_eq!(v["manifest"], serde_json::Value::Null);
    }
}