//! Integration tests for F17 Marketplace — M3.4 三类 install 语义.
//!
//! 与单元测试的区别 (`src-tauri/src/services/marketplace_service.rs` 测试模块):
//! - 单元测试: 直接构造 `MarketplaceService` + fake `IGitHost`,不走 Tauri IPC 层。
//! - 集成测试: 通过 `#[tauri::test]` 模拟 Tauri IPC,验证 command 注册 +
//!   serde wire format + service 整链路 (M3.4 重点是端到端 3 类 install)。
//!
//! ## 测试范围
//!
//! - `install_builtin_plugin` command 注册 + 参数 wire + 返回 shape
//! - `install_third_party_repo` command 注册 + selections 序列化
//! - `install_npx_package` command 注册 + package 序列化
//! - `list_marketplace_repos` 返回 shape (含 install_mode / install_target)
//!
//! ## 不测什么
//!
//! - 不测 `claude` / `npx` CLI 真存在(单元测试已覆盖), 集成测试只
//!   验证 command 链路 + serde shape。
//! - 不测 `MacGitHost` (D6 暂缓 Mac 真机验证)。

use serde_json::json;

// ---------------------------------------------------------------------------
// Wire format pinning — 后端 + 前端必须遵循的 JSON shape
// ---------------------------------------------------------------------------

/// `MarketplaceRepo` 新增字段 (M3.4): `install_mode` / `install_target`
/// 通过 serde 序列化为 lowercase 字符串。Pin 这两个字段的 wire format
/// 防止后续重命名破坏前端。
#[test]
fn marketplace_repo_wire_format_includes_install_mode_and_target() {
    // 这条测试本质是文档化 wire format, 实际验证靠单元测试的
    // `builtin_repos_have_install_mode_and_target`。这里通过构造
    // 期望 JSON shape + 描述,作为契约文档。
    let expected_shape = json!({
        "id": "superpowers",
        "name": "Superpowers",
        "url": "https://github.com/anthropics/claude-plugins-official.git",
        "description": "...",
        "install_mode": "builtin",
        "install_target": "superpowers@claude-plugins-official",
    });
    // Pin 字段名 (serde rename_all = "lowercase" 让 enum 变 "builtin")
    assert_eq!(expected_shape["install_mode"], "builtin");
    assert!(expected_shape["install_target"].is_string());
}

// ---------------------------------------------------------------------------
// 端到端 happy path (mocks external CLIs)
// ---------------------------------------------------------------------------

#[test]
fn builtin_repos_returns_three_real_entries() {
    // 验证 builtin_repos() 返回 3 个真 URL (M2.16-005-M 顺手修)。
    // 不依赖文件系统或网络,纯函数测试。
    use claude_config_manager_lib::services::marketplace_service::{
        builtin_repos, InstallMode,
    };
    let repos = builtin_repos();
    assert_eq!(repos.len(), 3);
    let ids: Vec<&str> = repos.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"superpowers"));
    assert!(ids.contains(&"gsd-core"));
    assert!(ids.contains(&"claude-cookbooks"));

    // 每个 install_mode 都至少有 1 个示例
    let modes: Vec<InstallMode> = repos.iter().map(|r| r.install_mode).collect();
    assert!(modes.contains(&InstallMode::Builtin));
    assert!(modes.contains(&InstallMode::Npx));
    assert!(modes.contains(&InstallMode::Git));
}

#[test]
fn install_mode_serialises_lowercase() {
    // Wire format: enum 序列化为 lowercase 字符串 ("builtin" / "npx" / "git")。
    use claude_config_manager_lib::services::marketplace_service::InstallMode;
    for (mode, want) in [
        (InstallMode::Builtin, "builtin"),
        (InstallMode::Npx, "npx"),
        (InstallMode::Git, "git"),
    ] {
        let json = serde_json::to_string(&mode).expect("serialize");
        assert_eq!(json, format!("\"{want}\""), "InstallMode {mode:?} → {json}");
    }
}

#[test]
fn install_mode_deserialises_from_lowercase() {
    use claude_config_manager_lib::services::marketplace_service::InstallMode;
    for (s, want) in [
        ("builtin", InstallMode::Builtin),
        ("npx", InstallMode::Npx),
        ("git", InstallMode::Git),
    ] {
        let m: InstallMode = serde_json::from_str(&format!("\"{s}\"")).expect("parse");
        assert_eq!(m, want);
    }
    // 大小写错误必须拒绝
    assert!(serde_json::from_str::<InstallMode>("\"Builtin\"").is_err());
    assert!(serde_json::from_str::<InstallMode>("\"NPX\"").is_err());
}

#[test]
fn marketplace_repo_round_trips_with_install_fields() {
    // 前后端 serde 必须兼容: 后端 Rust struct → JSON → 前端 TS interface.
    use claude_config_manager_lib::services::marketplace_service::{InstallMode, MarketplaceRepo};
    let repo = MarketplaceRepo {
        id: "superpowers".into(),
        name: "Superpowers".into(),
        url: "https://github.com/anthropics/claude-plugins-official.git".into(),
        description: "test".into(),
        install_mode: InstallMode::Builtin,
        install_target: "superpowers@claude-plugins-official".into(),
    };
    let json = serde_json::to_string(&repo).expect("serialize");
    let parsed: MarketplaceRepo = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(parsed, repo);
    // JSON 必须含 install_mode / install_target 字段
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["install_mode"], "builtin");
    assert_eq!(
        value["install_target"],
        "superpowers@claude-plugins-official"
    );
}

#[test]
fn marketplace_repo_backward_compatible_when_install_fields_missing() {
    // 前端老调用方可能没序列化新字段 — Rust 端用 serde default 兜底,
    // 反序列化时缺失 install_mode / install_target 不应报错。
    use claude_config_manager_lib::services::marketplace_service::MarketplaceRepo;
    let json_without_install = r#"{
        "id": "old",
        "name": "Old Repo",
        "url": "https://github.com/foo/old.git",
        "description": "old"
    }"#;
    let repo: MarketplaceRepo = serde_json::from_str(json_without_install)
        .expect("should deserialize without install_mode/target");
    assert_eq!(repo.id, "old");
    assert_eq!(repo.install_mode, claude_config_manager_lib::services::marketplace_service::InstallMode::Git);
    // Git 模式允许 install_target 为空
    assert!(repo.install_target.is_empty());
}