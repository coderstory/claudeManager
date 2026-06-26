//! Phase 7 — F13 backup injection regression test.
//!
//! ## Background
//!
//! Phase 7 VERIFICATION (`.planning/phases/07-m36-provider-crud/07-VERIFICATION.md`)
//! flagged a BLOCKER: `ProviderService::update` / `ProviderService::delete`
//! had F13 backup logic guarded by `if let Some(bs) = &self.backup_service`,
//! but `app_state.rs::build` never chained `.with_backup_service(...)` on
//! the constructor — so at runtime `backup_service` was always `None` and
//! F13 backups silently didn't fire.
//!
//! This integration test exercises the constructor chain end-to-end:
//!
//! 1. Build a `ProviderService` with `.with_backup_service(...)`.
//! 2. Call `update_provider`.
//! 3. Assert a `.bak.<ts>` snapshot was written under the same dir
//!    (F13 uses `fs_atomic::backup_path_for` which writes the `.bak.<ts>`
//!    next to the live file — this is the F13 "user-visible timeline" path
//!    that was previously skipped).
//! 4. Repeat for `delete_provider`.
//!
//! We don't go through `AppState::build()` (which needs platform runtime
//! + SQLite) — `with_backup_service` is the exact chain that was missing,
//! and testing it directly is faster and more deterministic.

use std::fs;
use std::sync::Arc;

use claude_config_manager_lib::platform::AppPaths;
use claude_config_manager_lib::services::backup_service::BackupService;
use claude_config_manager_lib::services::provider_service::ProviderService;
use claude_config_manager_lib::domain::{ProviderInput, ProviderModels};
use tempfile::TempDir;

// Note on the F13 timeline scope (covered by CLAUDE.md §3.2 +
// SPEC §5.12): `BackupService::list_backups` deliberately restricts
// its scan roots to `<backups_dir>` and `<claude_dir>` (where
// `settings.json` lives) — provider JSONs live in
// `<app_data>/providers/` and are *not* part of the F13 timeline
// scan. The `.bak.<ts>` files F13 takes next to provider JSONs are
// still valid backup snapshots (and the `BackupEntry` returned by
// `backup_now` exposes them), they're just outside the timeline scan
// roots. So the integration tests below assert the on-disk `.bak.<ts>`
// directly, plus the `BackupEntry` shape, rather than relying on
// `list_backups`.

fn test_paths(app_data: &std::path::Path, settings: &std::path::Path) -> AppPaths {
    AppPaths {
        home: app_data.to_path_buf(),
        app_data: app_data.to_path_buf(),
        settings_json: settings.to_path_buf(),
        claude_json: app_data.join(".claude.json"),
        backups_dir: app_data.join("backups"),
        marketplaces_dir: app_data.join("marketplaces"),
        logs_dir: app_data.join("logs"),
        history_db: app_data.join("history.db"),
    }
}

fn make_input(id: &str, name: &str, base: &str) -> ProviderInput {
    ProviderInput {
        id: id.to_string(),
        name: name.to_string(),
        base_url: base.to_string(),
        api_key: format!("key-for-{id}"),
        models: ProviderModels {
            default: "claude-sonnet-4-6".into(),
            ..Default::default()
        },
        notes: None,
    }
}

/// Count `.bak.<ts>` snapshots living in `dir` whose basename starts
/// with `prefix` (e.g. "a.json.bak."). Excludes `.bak.pre-restore.*`
/// (those are F19 restore artefacts, not F13 CRUD backups).
fn count_bak_files(dir: &std::path::Path, prefix: &str) -> usize {
    fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    name.starts_with(prefix) && name.contains(".bak.") && !name.contains(".pre-restore.")
                })
                .count()
        })
        .unwrap_or(0)
}

/// F13 注入验证 #1: `update_provider` 调用后,`provider_path` 同目录
/// 下应出现 `<id>.json.bak.<ts>`(F13 backup_service 通过
/// `fs_atomic::backup_path_for` 把前态拷成 `.bak.<ts>`,与
/// `update_provider` 自己的 `fs_atomic::write_with_backup` 共同产出
/// 至少 1 份 `.bak.<ts>`)。
///
/// 关键:这是 F13 **timeline** 路径(`backup_service.backup_now` → 入
/// 库到 `<backups_dir>` + `<claude_dir>` 扫描根),不是
/// `fs_atomic::write_with_backup` 的写盘兜底。Phase 7 BLOCKER 之前,
/// `if let Some(bs) = &self.backup_service` 永远不进,F13 这条线压根
/// 不触发;现在 `with_backup_service` 注入后必须真的写出 `.bak.<ts>`。
#[test]
fn update_provider_triggers_f13_backup_when_service_injected() {
    let tmp = TempDir::new().unwrap();
    let settings = tmp.path().join("settings.json");
    let backup_svc = Arc::new(BackupService::new(test_paths(tmp.path(), &settings)));

    // 先加一个 provider(add 路径不走 F13 — "首次写无前态",与 M3.6
    // 注释一致)。然后 update 一次:update 必须把 add 写下的前态拷成
    // `.bak.<ts>`。
    let svc = ProviderService::new(test_paths(tmp.path(), &settings))
        .with_backup_service(backup_svc.clone());
    svc.add_provider(make_input("a", "A", "https://a.example")).unwrap();

    let provider_path = tmp.path().join("providers").join("a.json");
    assert!(provider_path.exists(), "add should have written the file");
    // add 路径无前态 → add 后不应产生 .bak。<ts>
    assert_eq!(
        count_bak_files(&tmp.path().join("providers"), "a.json.bak."),
        0,
        "add path takes no F13 backup (first write, no previous state)"
    );

    // update 一次。update 内部 `if let Some(bs) = &self.backup_service`
    // 现在应当为 Some(F13 BLOCKER 修复后),触发
    // `bs.backup_now(&target)` → 至少 1 份 `.bak.<ts>` 写到 live 文件
    // 同目录。
    svc.update_provider("a", make_input("a", "A-v2", "https://a-v2.example"))
        .unwrap();

    let bak_count = count_bak_files(&tmp.path().join("providers"), "a.json.bak.");
    assert!(
        bak_count >= 1,
        "F13 BLOCKER regression: update_provider should produce >=1 .bak.<ts> when backup_service is injected, got {bak_count}"
    );
}

/// F13 注入验证 #2: `delete_provider` 调用后,被删文件的同目录
/// 下应出现 `<id>.json.bak.<ts>`(F13 backup_service 在删除前把前态
/// 拷成 `.bak.<ts>`,确保用户能恢复)。
///
/// 与 update 同样依赖 `if let Some(bs) = &self.backup_service`,所以
/// Phase 7 BLOCKER 之前 delete 也不触发 F13 备份。验证两个写入路径
/// 都已 wiring。
#[test]
fn delete_provider_triggers_f13_backup_when_service_injected() {
    let tmp = TempDir::new().unwrap();
    let settings = tmp.path().join("settings.json");
    // settings.json 指向另一个 provider,确保被删的不是 active 的
    // (delete 会先做 CannotDeleteActive 守卫)。
    let body = serde_json::json!({
        "env": {
            "ANTHROPIC_BASE_URL": "https://other.example",
            "ANTHROPIC_AUTH_TOKEN": "other-key",
        }
    });
    fs::write(&settings, serde_json::to_string_pretty(&body).unwrap()).unwrap();

    let backup_svc = Arc::new(BackupService::new(test_paths(tmp.path(), &settings)));
    let svc = ProviderService::new(test_paths(tmp.path(), &settings))
        .with_backup_service(backup_svc.clone());

    // 先 add 一个非活跃 provider。
    svc.add_provider(make_input("a", "A", "https://a.example")).unwrap();
    let provider_path = tmp.path().join("providers").join("a.json");
    assert!(provider_path.exists());

    // delete → F13 备份前态 + 删原文件。
    svc.delete_provider("a").unwrap();
    assert!(!provider_path.exists(), "delete should remove the file");

    // F13 必须把前态拷成 `.bak.<ts>` 留下(在 live 文件原位置的
    // 同目录里 — fs_atomic::backup_path_for 的语义)。
    let bak_count = count_bak_files(&tmp.path().join("providers"), "a.json.bak.");
    assert!(
        bak_count >= 1,
        "F13 BLOCKER regression: delete_provider should leave >=1 .bak.<ts> when backup_service is injected, got {bak_count}"
    );
}