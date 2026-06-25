//! ProviderService — F1 (list) + F2 (switch) business logic (M2.1).
//!
//! Reads `<app-data>/providers/*.json` and the live
//! `~/.claude/settings.json`, recomputes `is_active` per SPEC §2.3,
//! and switches the active provider with an atomic write + timestamped
//! backup per SPEC §6.1/§6.2.
//!
//! # Design constraints (CLAUDE.md §3.1 + §7)
//!
//! - All I/O is `infrastructure::fs_atomic` — no direct `std::fs`
//!   calls in this module.
//! - Path resolution goes through `AppPaths` (which the platform
//!   layer filled in via `IPlatformPaths`). This module never reads
//!   `dirs::home_dir()` directly.
//! - Settings.json is read as a `serde_json::Value` and patched in
//!   place — we never `serde_json::from_str::<Settings>` then
//!   `to_string_pretty` because that would drop unknown keys (SPEC
//!   §6.1 "不破坏未知字段"). Same for the provider library files:
//!   each `Provider::from_json_file` round-trips only the file we
//!   touch.
//! - Every error is a `String` (Tauri requires Serialize) wrapping a
//!   user-readable message. No silent failures.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::de::Error as _;
use serde_json::{json, Value};

use crate::domain::{is_valid_id, Provider, ProviderError, ProviderInput};
use crate::infrastructure::fs_atomic;
use crate::platform::AppPaths;
use crate::services::backup_service::BackupService;

// ---------------------------------------------------------------------------
// ProviderService
// ---------------------------------------------------------------------------

/// Business logic for F1 + F2. Stateless apart from the resolved
/// `AppPaths` snapshot it was constructed with.
pub struct ProviderService {
    paths: AppPaths,
    /// M3.6 (清单 22) — CRUD 写操作(update / delete)前调 `backup_now`
    /// 在 `<app_data>/backups/providers/` 下生成 `<id>.bak.<ts>`。
    /// `None` = 跳过备份(用于单测和未接 F13 的环境;M3.6 production
    /// 路径必传 `Some`)。
    backup_service: Option<Arc<BackupService>>,
}

impl ProviderService {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths, backup_service: None }
    }

    /// M3.6 — 接 F13 备份。`AppState::build()` 调此方法把
    /// `Arc<BackupService>` 注入,CRUD 写操作(update/delete)前自动
    /// 备份前态。
    pub fn with_backup_service(mut self, svc: Arc<BackupService>) -> Self {
        self.backup_service = Some(svc);
        self
    }

    /// Borrow the resolved paths (read-only — services don't mutate).
    #[allow(dead_code)]
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    // -----------------------------------------------------------------------
    // F1 — list_providers
    // -----------------------------------------------------------------------

    /// List all providers in `<app_data>/providers/`, with `is_active`
    /// re-computed from the live settings.json (SPEC §2.3).
    ///
    /// Returns `Vec<Provider>` always — never errors on a missing
    /// directory or an empty library. Individual corrupt files are
    /// silently skipped (the UI gets a partial list + a warning via
    /// [`list_providers_with_warnings`] for that case).
    ///
    /// **M3.12 deprecation note:** this is the legacy (user-level only)
    /// entry point. New callers MUST use [`list_providers_with_active_root`]
    /// (A1#1) so the read target honours the live active project.
    pub fn list_providers(&self) -> Vec<Provider> {
        self.list_providers_with_warnings().0
    }

    /// Same as [`list_providers`] but also returns the list of
    /// corrupted provider file paths so the UI can show a warning.
    /// The tuple is `(providers, warnings)`.
    ///
    /// M3.12 adapter — prefer [`list_providers_with_active_root`]
    /// (A1#1). This legacy method is kept for callers that don't
    /// know about `active_root_dir` (e.g. internal unit tests for
    /// pre-M3.10 flows). It always reads from the user-level
    /// `<app_data>/providers/` directory.
    pub fn list_providers_with_warnings(&self) -> (Vec<Provider>, Vec<PathBuf>) {
        let dir = self.paths.app_data.join("providers");
        let mut providers = Vec::new();
        let mut warnings = Vec::new();

        let entries = match std::fs::read_dir(&dir) {
            Ok(it) => it,
            Err(_) => return (providers, warnings), // dir missing → empty list
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            match Provider::from_json_file(&path) {
                Ok(p) => {
                    // is_active is set below from live settings.json —
                    // keep the file's value as a hint for ordering
                    // (M2.3+ might use created_at).
                    providers.push(p);
                }
                Err(_) => warnings.push(path),
            }
        }

        // Sort by name for stable display order.
        providers.sort_by(|a, b| a.name.cmp(&b.name));

        // Recompute is_active from settings.json (SPEC §2.3).
        let (current_base, current_key) = read_current_active_env(&self.paths.settings_json);
        for p in &mut providers {
            p.is_active = match (&current_base, &current_key) {
                (Some(b), Some(k)) => p.api_base == *b && p.api_key == *k,
                _ => false,
            };
        }

        (providers, warnings)
    }

    /// M3.12 adapter (A1#1) — `list_providers` with active-root
    /// awareness. Returns the same `(providers, warnings)` tuple as
    /// [`list_providers_with_warnings`] but routes the read target
    /// through the active root when one is set.
    ///
    /// ## Behavior
    ///
    /// - `Some(root)` → reads `<root>/.claude/providers/`.
    ///   - If that directory is missing → **returns an empty list**
    ///     (does NOT fall back to user-level). This is a deliberate
    ///     safety choice (A1#1): a project view must not silently
    ///     surface globally-installed providers.
    /// - `None` → reads the user-level `<app_data>/providers/`
    ///   (same as the legacy method).
    ///
    /// `is_active` is recomputed from the *project's* settings.json
    /// when in project mode (so the active-marker matches the file
    /// Claude Code actually uses in that project).
    pub fn list_providers_with_active_root(
        &self,
        active_root: Option<&Path>,
    ) -> Result<(Vec<Provider>, Vec<PathBuf>), ProviderError> {
        let dir = self.providers_dir_for_active_root(active_root);

        // Project mode + missing dir → return empty (no fallback).
        // User-level + missing dir → also empty (same as legacy
        // `list_providers_with_warnings`).
        let entries = match std::fs::read_dir(&dir) {
            Ok(it) => it,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Vec::new(), Vec::new()));
            }
            Err(e) => return Err(ProviderError::Io(e)),
        };

        let mut providers = Vec::new();
        let mut warnings = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            match Provider::from_json_file(&path) {
                Ok(p) => providers.push(p),
                Err(_) => warnings.push(path),
            }
        }

        // Sort by name for stable display order.
        providers.sort_by(|a, b| a.name.cmp(&b.name));

        // Recompute is_active from the active root's settings.json
        // (project mode) or the user-level one (user mode).
        let settings_for_active =
            self.settings_json_for_active_root(active_root);
        let (current_base, current_key) = read_current_active_env(&settings_for_active);
        for p in &mut providers {
            p.is_active = match (&current_base, &current_key) {
                (Some(b), Some(k)) => p.api_base == *b && p.api_key == *k,
                _ => false,
            };
        }

        Ok((providers, warnings))
    }

    // -----------------------------------------------------------------------
    // F2 — switch_provider
    // -----------------------------------------------------------------------

    /// Activate the provider with `provider_id`. Writes settings.json
    /// atomically with a timestamped backup (SPEC §6.1 + §6.2).
    /// Returns the activated provider on success.
    pub fn switch_provider(&self, provider_id: &str) -> Result<Provider, ProviderError> {
        let provider_path = self.provider_path(provider_id);
        let provider = Provider::from_json_file(&provider_path)?;

        // Load settings.json as a generic JSON value so we don't drop
        // unknown fields when we round-trip (SPEC §6.1).
        let mut settings = load_settings(&self.paths.settings_json)?;

        // Patch env.ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN.
        // Create the env map if missing.
        let env_obj = ensure_object(&mut settings, "env");
        // Use insert() (not IndexMut) — env_obj starts empty after
        // ensure_object, so `env_obj["X"] = ...` panics with
        // "no entry found for key". insert() auto-creates the slot.
        env_obj.insert("ANTHROPIC_BASE_URL".into(), Value::String(provider.api_base.clone()));
        env_obj.insert("ANTHROPIC_AUTH_TOKEN".into(), Value::String(provider.api_key.clone()));
        // M4.6.1 — write all 5 ANTHROPIC_*_MODEL env keys from the
        // 4-tier + by_tier mapping (ProviderModels::to_env_json skips
        // empty/None entries).
        for (k, v) in provider.models.to_env_json() {
            env_obj.insert(k, v);
        }

        let json = serde_json::to_string_pretty(&settings)
            .map_err(|e| ProviderError::Json(e))?;

        fs_atomic::write_with_backup(&self.paths.settings_json, &json)
            .map_err(map_fs_atomic_to_provider)?;

        // Update provider library: stamp last_used_at + is_active (M2.3+
        // will own this fully — for M2.1 we just write the file back).
        let mut updated = provider.clone();
        updated.last_used_at = Some(now_unix_secs());
        updated.is_active = true;
        updated
            .to_json_file(&provider_path)
            .map_err(|e| ProviderError::Io(std::io::Error::other(format!("{e}"))))?;

        Ok(updated)
    }

    /// Path to a provider's JSON file (helper).
    fn provider_path(&self, id: &str) -> PathBuf {
        self.providers_dir().join(format!("{id}.json"))
    }

    /// Directory where provider JSON files live.
    fn providers_dir(&self) -> PathBuf {
        self.paths.app_data.join("providers")
    }

    /// M3.12 helper — full path to a provider's JSON file under the
    /// active root (or user-level when `active_root` is `None`).
    fn provider_path_for_active_root(&self, id: &str, active_root: Option<&Path>) -> PathBuf {
        self.providers_dir_for_active_root(active_root)
            .join(format!("{id}.json"))
    }

    /// M3.10 adapter (3-high F2) — switch_provider with active-root awareness.
    ///
    /// - `active_root = None` → legacy behaviour, writes
    ///   `paths.settings_json` (user-level). Used by the original
    ///   `switch_provider` callers that don't care about project mode.
    /// - `active_root = Some(p)` → writes `<p>/.claude/settings.json`,
    ///   taking a backup in the same directory via fs_atomic (the
    ///   standard `.bak.<ts>` file). Library file (`<id>.json`) stays
    ///   in `<app_data>/providers/` regardless of mode (the library is
    ///   a user-level resource).
    pub fn switch_provider_with_active_root(
        &self,
        provider_id: &str,
        active_root: Option<&Path>,
    ) -> Result<Provider, ProviderError> {
        let provider_path = self.provider_path(provider_id);
        let provider = Provider::from_json_file(&provider_path)?;

        // M3.10 — pick the settings.json path based on active root.
        let settings_path = self.settings_json_for_active_root(active_root);
        let mut settings = load_settings(&settings_path)?;

        let env_obj = ensure_object(&mut settings, "env");
        // Use insert() not IndexMut — env_obj starts empty.
        env_obj.insert("ANTHROPIC_BASE_URL".into(), Value::String(provider.api_base.clone()));
        env_obj.insert("ANTHROPIC_AUTH_TOKEN".into(), Value::String(provider.api_key.clone()));
        // M4.6.1 — same 5-key fan-out as the legacy switch_provider.
        for (k, v) in provider.models.to_env_json() {
            env_obj.insert(k, v);
        }

        let json = serde_json::to_string_pretty(&settings)
            .map_err(|e| ProviderError::Json(e))?;

        fs_atomic::write_with_backup(&settings_path, &json)
            .map_err(map_fs_atomic_to_provider)?;

        let mut updated = provider.clone();
        updated.last_used_at = Some(now_unix_secs());
        updated.is_active = true;
        updated
            .to_json_file(&provider_path)
            .map_err(|e| ProviderError::Io(std::io::Error::other(format!("{e}"))))?;

        Ok(updated)
    }

    // -----------------------------------------------------------------------
    // F14 — get_provider (导出单 provider, M2.16)
    // -----------------------------------------------------------------------

    /// Read a single provider by id (F14 export). Returns the provider
    /// exactly as stored on disk — `is_active` keeps its cached value
    /// (the recipient recomputes it via `list_providers`, so a stale
    /// `true` is harmless). The command layer
    /// (`commands::providers::export_provider`) owns serialisation +
    /// native save dialog + write; this method is the *pure read* so it
    /// stays unit-testable without a Tauri `AppHandle`.
    ///
    /// # Errors
    ///
    /// - [`ProviderError::Io`] — no file for `provider_id` (cold path:
    ///   the user picked an id that isn't in the library). Mirrors
    ///   `switch_provider`'s unknown-id behaviour.
    /// - [`ProviderError::Json`] — the file is present but malformed.
    pub fn get_provider(&self, provider_id: &str) -> Result<Provider, ProviderError> {
        let path = self.provider_path(provider_id);
        Provider::from_json_file(&path).map_err(|e| match e {
            // 业务层 NotFound — 区分磁盘层 Io(NotFound).
            // M3.6 之前没转换,导致 e2e 测试期望 "not found" 却拿到 Io error.
            ProviderError::Io(ref io) if io.kind() == std::io::ErrorKind::NotFound => {
                ProviderError::NotFound(provider_id.to_string())
            }
            other => other,
        })
    }

    /// Generate a `Provider` from the current `~/.claude/settings.json`.
    ///
    /// Reads the active env (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN)
    /// and either:
    /// - Returns the provider matching the current base_url (if one exists
    ///   in the library), or
    /// - Creates a new `Provider` with an auto-generated id (based on the
    ///   base_url domain) if no match exists.
    ///
    /// The caller (frontend) decides whether to persist via
    /// `import_single_provider` — this method is pure read + construct so
    /// it stays testable.
    ///
    /// Errors:
    /// - `Io` — settings.json unreadable
    /// - `Json` — settings.json malformed
    pub fn generate_from_current_config(&self) -> Result<GeneratedProvider, ProviderError> {
        self.generate_with_active_root(None)
    }

    pub fn generate_with_active_root(
        &self,
        active_root: Option<&Path>,
    ) -> Result<GeneratedProvider, ProviderError> {
        let settings_path = self.settings_json_for_active_root(active_root);
        let (base_url, auth_token) = read_current_active_env(&settings_path);

        let (base_url, auth_token) = match (base_url, auth_token) {
            (Some(b), Some(k)) => (b, k),
            _ => {
                return Err(ProviderError::Json(serde_json::Error::custom(
                    "当前配置不完整:缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN",
                )));
            }
        };

        // Check if a provider with this base_url already exists
        let providers = self.list_providers();
        if let Some(existing) = providers.iter().find(|p| p.api_base == base_url) {
            return Ok(GeneratedProvider {
                provider: existing.clone(),
                is_new: false,
            });
        }

        // Auto-generate id from domain
        let id = domain_to_id(&base_url);
        let name = domain_to_name(&base_url);

        // Check if the auto-generated id already exists (different base_url
        // but rare collision) — if so, append a suffix.
        let final_id = if providers.iter().any(|p| p.id == id) {
            format!("{}-{}", id, 1)
        } else {
            id
        };

        let provider = Provider::new(
            &final_id,
            &name,
            "anthropic",
            &base_url,
            &auth_token,
        );

        Ok(GeneratedProvider {
            provider,
            is_new: true,
        })
    }

    // -----------------------------------------------------------------------
    // F4 — import_single_provider (M2.3)
    // -----------------------------------------------------------------------

    /// Persist a single provider JSON file (F4, M2.3 deeplink import).
    ///
    /// # Algorithm
    ///
    /// 1. If `<providers_dir>/<id>.json` already exists, return
    ///    [`ProviderError::AlreadyExists`] (M2.3 ships a "deny"
    ///    policy; v1.1 will offer an overwrite path).
    /// 2. Atomic-write the provider JSON via
    ///    [`fs_atomic::write_with_backup`] (CLAUDE.md §7: "任何写盘
    ///    操作必须先备份"). The first write to a non-existent file
    ///    produces no backup (matching
    ///    `fs_atomic::write_with_backup_succeeds_when_file_does_not_exist`).
    ///
    /// # Why this is separate from `import_providers_from_sql`
    ///
    /// The F3 SQL-import path (M2.2) parses a *batch* of rows and
    /// silently skips duplicates. The F4 deeplink path is a *user-
    /// initiated single* import — silently skipping a duplicate
    /// would hide a UX problem ("I clicked import, why didn't
    /// anything happen?"). Returning a hard error lets the frontend
    /// show "provider X already exists, please rename".
    ///
    /// # Errors
    ///
    /// - [`ProviderError::AlreadyExists`] — file already present
    /// - [`ProviderError::Json`] — `serde_json` failed
    /// - [`ProviderError::Io`] — disk-level error (mkdir, write, rename)
    pub fn import_single_provider(&self, provider: Provider) -> Result<(), ProviderError> {
        let target = self.provider_path(&provider.id);
        if target.exists() {
            return Err(ProviderError::AlreadyExists(provider.id.clone()));
        }
        let json = serde_json::to_string_pretty(&provider)?;
        fs_atomic::write_with_backup(&target, &json).map_err(map_fs_atomic_to_provider)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // M3.6 — CRUD (清单 22)
    // -----------------------------------------------------------------------

    /// M3.10 adapter — resolve settings.json path for the active root.
    ///
    /// - `Some(root)` = active project; return `<root>/.claude/settings.json`.
    /// - `None` = user-level; return cached `paths.settings_json`.
    ///
    /// This is the 3-high F1/F2 adaptation point (M3.10-dataflow §5).
    /// Plugin callers (commands::providers::switch_provider) MUST
    /// route through this helper so user/project mode switches
    /// transparently without rewriting AppPaths.
    pub fn settings_json_for_active_root(&self, active_root: Option<&Path>) -> PathBuf {
        match active_root {
            Some(root) => root.join(".claude").join("settings.json"),
            None => self.paths.settings_json.clone(),
        }
    }

    /// M3.10 adapter — providers dir for the active root. Library
    /// files follow the same convention as settings.json.
    pub fn providers_dir_for_active_root(&self, active_root: Option<&Path>) -> PathBuf {
        match active_root {
            Some(root) => root.join(".claude").join("providers"),
            None => self.paths.app_data.join("providers"),
        }
    }

    /// M3.6 — Create。新增一个 provider。
    ///
    /// 1. 验证 `input.id` 符合 `[a-z0-9-_]+` → 否则 `InvalidId`。
    /// 2. 验证 `name` / `base_url` / `api_key` / `model` 都非空 →
    ///    否则 `Json` 错(沿用 `Provider::validate` 语义)。
    /// 3. 检查 `<providers_dir>/<id>.json` 不存在 → 已存在 `AlreadyExists`。
    ///    注:add 是"首次写"路径,无前态可备;F13 备份仅 update / delete 触发。
    /// 4. `fs_atomic::write_with_backup` 原子写(首次写不生成 .bak)。
    /// 5. 返回新 `Provider`(`is_active=false`,`created_at=now`)。
    pub fn add_provider(&self, input: ProviderInput) -> Result<Provider, ProviderError> {
        // 业务字段非空校验(input 不走 Provider::validate,自己来)。
        if input.id.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "id must not be empty",
            )));
        }
        if !is_valid_id(&input.id) {
            return Err(ProviderError::InvalidId(input.id.clone()));
        }
        if input.name.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "name must not be empty",
            )));
        }
        if input.base_url.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "base_url must not be empty",
            )));
        }
        if input.api_key.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "api_key must not be empty",
            )));
        }
        if input.models.default.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "at least one model required (default)",
            )));
        }

        let target = self.provider_path(&input.id);
        if target.exists() {
            return Err(ProviderError::AlreadyExists(input.id.clone()));
        }

        let now = now_unix_secs();
        let provider = Provider {
            id: input.id.clone(),
            name: input.name,
            provider_type: "anthropic".to_string(), // M3.6 范围单类型
            api_base: input.base_url,
            api_key: input.api_key,
            models: input.models.clone(),
            is_active: false,
            created_at: now,
            last_used_at: None,
            notes: input.notes,
        };

        let json = serde_json::to_string_pretty(&provider)?;
        fs_atomic::write_with_backup(&target, &json).map_err(map_fs_atomic_to_provider)?;
        Ok(provider)
    }

    /// M3.6 — Update。修改一个已存在 provider 的元数据。
    ///
    /// 1. 读旧 provider → 不存在 `NotFound(id)`。
    /// 2. F13 备份(`backup_now` 把前态拷到 `<backups>/providers/<id>.bak.<ts>`)。
    /// 3. 拼装新 `Provider`(保留 `created_at` / `last_used_at` /
    ///    `is_active`;更新 name/api_base/api_key/models/notes)。
    /// 4. `fs_atomic::write_with_backup` 原子写(可能再生成一份 .bak——
    ///    这两层 backup 各司其职:F13 给"用户可见的备份时间线",
    ///    fs_atomic 的 .bak 是"写盘失败兜底")。
    /// 5. 不动 `~/.claude/settings.json`(F2 switch 行为);如新内容
    ///    影响当前激活 provider 的 base_url,用户下次 [激活] 时同步。
    pub fn update_provider(
        &self,
        id: &str,
        input: ProviderInput,
    ) -> Result<Provider, ProviderError> {
        // 业务字段非空校验。
        if input.name.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "name must not be empty",
            )));
        }
        if input.base_url.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "base_url must not be empty",
            )));
        }
        if input.api_key.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "api_key must not be empty",
            )));
        }
        if input.models.default.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "at least one model required (default)",
            )));
        }

        let target = self.provider_path(id);
        // 读旧 — 不存在 = 业务 NotFound(与 F14 get_provider 一致:
        // 文件层 Io(NotFound) 翻译为业务 NotFound(id) 给前端可读消息)。
        let old = Provider::from_json_file(&target).map_err(|e| match e {
            ProviderError::Io(ref io) if io.kind() == std::io::ErrorKind::NotFound => {
                ProviderError::NotFound(id.to_string())
            }
            other => other,
        })?;

        // F13 备份前态(CLAUDE.md §7 + M3.6 任务交付物 3)。
        if let Some(bs) = &self.backup_service {
            let _ = bs.backup_now(&target); // 备份失败不阻塞 update
        }

        let new_provider = Provider {
            id: old.id.clone(), // id 不可改(file stem)
            name: input.name,
            provider_type: old.provider_type, // 保留旧 type
            api_base: input.base_url,
            api_key: input.api_key,
            models: input.models.clone(),
            is_active: old.is_active,    // 保留 is_active
            created_at: old.created_at,  // 保留创建时间
            last_used_at: old.last_used_at, // 保留最后使用时间
            notes: input.notes.or(old.notes),
        };

        let json = serde_json::to_string_pretty(&new_provider)?;
        fs_atomic::write_with_backup(&target, &json).map_err(map_fs_atomic_to_provider)?;
        Ok(new_provider)
    }

    /// M3.6 — Delete。删除一个 provider 文件。
    ///
    /// 1. 读旧 → 不存在 `NotFound(id)`。
    /// 2. 检查是否当前激活(查 settings.json 的 ANTHROPIC_BASE_URL
    ///    是否匹配 provider.api_base)→ 激活中 `CannotDeleteActive(id)`。
    ///    简化决策:不允许自动切走再删(避免破坏用户当前状态);
    ///    M3.10+ 评估"自动切到下一个"。
    /// 3. F13 备份前态。
    /// 4. `std::fs::remove_file` 删原文件(删除操作无"原子写"概念)。
    pub fn delete_provider(&self, id: &str) -> Result<(), ProviderError> {
        let target = self.provider_path(id);
        let old = Provider::from_json_file(&target).map_err(|e| match e {
            ProviderError::Io(ref io) if io.kind() == std::io::ErrorKind::NotFound => {
                ProviderError::NotFound(id.to_string())
            }
            other => other,
        })?;

        // 当前激活检查
        if is_provider_active(&self.paths.settings_json, &old) {
            return Err(ProviderError::CannotDeleteActive(id.to_string()));
        }

        // F13 备份前态
        if let Some(bs) = &self.backup_service {
            let _ = bs.backup_now(&target);
        }

        std::fs::remove_file(&target)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // F3 — import_providers_from_sql (M2.2)
    // -----------------------------------------------------------------------

    /// Bulk-import providers from a cc-switch-style SQLite dump string
    /// (M2.2, F3). Provider rows that already exist (by `id`) are
    /// silently skipped — repeat imports are idempotent.
    ///
    /// # Algorithm
    ///
    /// 1. Parse the dump via [`crate::infrastructure::sql_parser`].
    /// 2. For each parsed `Provider`:
    ///    - if `<providers_dir>/<id>.json` already exists, increment
    ///      `skipped` and continue;
    ///    - else, atomic-write the provider JSON via
    ///      [`fs_atomic::write_with_backup`] (CLAUDE.md §7).
    /// 3. Return `(imported, skipped, errors)`.
    ///
    /// # Errors
    ///
    /// Returns `Err(ProviderError)` ONLY if the very first parse fails
    /// (i.e. the dump is empty). Per-row errors are recorded in the
    /// `errors` field of [`ImportResult`], not bubbled — this matches
    /// the F3 brief ("跳过行数（语法错 / 字段不全）") and CLAUDE.md §7
    /// ("不允许静默吞错" — we surface them in the result, just not
    /// as fatal).
    ///
    /// # Idempotency
    ///
    /// Calling `import_providers_from_sql` twice with the same dump
    /// MUST write each provider exactly once.
    pub fn import_providers_from_sql(
        &self,
        content: &str,
    ) -> Result<ImportResult, ProviderError> {
        let parsed = crate::infrastructure::sql_parser::parse_sql_dump(content)
            .map_err(|e| {
                ProviderError::Json(serde_json::Error::custom(format!(
                    "SQL parse failed: {e}"
                )))
            })?;

        let mut imported = 0usize;
        let mut skipped = 0usize;
        let mut write_errors: Vec<WriteError> = Vec::new();

        for provider in parsed.providers {
            let target = self.provider_path(&provider.id);
            if target.exists() {
                skipped += 1;
                continue;
            }
            let json = match serde_json::to_string_pretty(&provider) {
                Ok(s) => s,
                Err(e) => {
                    write_errors.push(WriteError {
                        id: provider.id.clone(),
                        reason: format!("serialise failed: {e}"),
                    });
                    continue;
                }
            };
            if let Err(e) = fs_atomic::write_with_backup(&target, &json) {
                write_errors.push(WriteError {
                    id: provider.id.clone(),
                    reason: format!("atomic write failed: {e}"),
                });
                continue;
            }
            imported += 1;
        }

        // Merge parser-level skip reasons + write-level errors into one
        // list the UI can show as a unified "skipped lines" panel.
        let errors = parsed
            .skipped_lines
            .into_iter()
            .map(|s| ImportSkip {
                kind: "parse".into(),
                line: s.line,
                id: None,
                reason: s.reason,
            })
            .chain(write_errors.into_iter().map(|w| ImportSkip {
                kind: "write".into(),
                line: 0,
                id: Some(w.id),
                reason: w.reason,
            }))
            .collect();

        Ok(ImportResult {
            imported,
            skipped,
            errors,
            mcp_count: parsed.mcp_servers.len(),
        })
    }

    /// M3.12 adapter (A1#3) — `import_providers_from_sql` with
    /// active-root awareness.
    ///
    /// ## Behavior
    ///
    /// - `None` → identical to the legacy `import_providers_from_sql`
    ///   (writes to `<app_data>/providers/`).
    /// - `Some(root)` → writes to `<root>/.claude/providers/`.
    ///
    /// ## Safety
    ///
    /// **Does NOT auto-`mkdir` the project root.** If
    /// `<root>/.claude/providers/` does not exist, `fs_atomic` will
    /// fail with an `Io` error (parent dir missing). This matches
    /// M3.11 F18's safety boundary — the active project must already
    /// be initialized (e.g. via `claude init`) before providers are
    /// imported. Silently creating directories under an unknown
    /// project path is a footgun we explicitly avoid.
    ///
    /// Returns the same `ImportResult` shape as the legacy method
    /// (imported count / skipped count / per-row errors / mcp_count).
    /// Per-row write errors are surfaced via `ImportSkip { kind:
    /// "write", id, reason }` so the UI can show them in a details
    /// panel.
    pub fn import_providers_from_sql_with_active_root(
        &self,
        content: &str,
        active_root: Option<&Path>,
    ) -> Result<ImportResult, ProviderError> {
        let parsed = crate::infrastructure::sql_parser::parse_sql_dump(content)
            .map_err(|e| {
                ProviderError::Json(serde_json::Error::custom(format!(
                    "SQL parse failed: {e}"
                )))
            })?;

        let mut imported = 0usize;
        let mut skipped = 0usize;
        let mut write_errors: Vec<WriteError> = Vec::new();

        for provider in parsed.providers {
            let target = self.provider_path_for_active_root(&provider.id, active_root);
            if target.exists() {
                skipped += 1;
                continue;
            }
            let json = match serde_json::to_string_pretty(&provider) {
                Ok(s) => s,
                Err(e) => {
                    write_errors.push(WriteError {
                        id: provider.id.clone(),
                        reason: format!("serialise failed: {e}"),
                    });
                    continue;
                }
            };
            if let Err(e) = fs_atomic::write_with_backup(&target, &json) {
                write_errors.push(WriteError {
                    id: provider.id.clone(),
                    reason: format!("atomic write failed: {e}"),
                });
                continue;
            }
            imported += 1;
        }

        // Merge parser-level skip reasons + write-level errors into one
        // list the UI can show as a unified "skipped lines" panel.
        let errors = parsed
            .skipped_lines
            .into_iter()
            .map(|s| ImportSkip {
                kind: "parse".into(),
                line: s.line,
                id: None,
                reason: s.reason,
            })
            .chain(write_errors.into_iter().map(|w| ImportSkip {
                kind: "write".into(),
                line: 0,
                id: Some(w.id),
                reason: w.reason,
            }))
            .collect();

        Ok(ImportResult {
            imported,
            skipped,
            errors,
            mcp_count: parsed.mcp_servers.len(),
        })
    }
}

// ---------------------------------------------------------------------------
// Import result types (F3 — M2.2)
// ---------------------------------------------------------------------------

/// Result of [`ProviderService::generate_from_current_config`].
#[derive(Debug, Clone)]
pub struct GeneratedProvider {
    /// The provider (either existing match or newly constructed).
    pub provider: Provider,
    /// `false` = matched an existing library entry; `true` = brand new.
    pub is_new: bool,
}

/// Convert a base_url to a kebab-case id.
/// e.g. "https://api.anthropic.com" → "api-anthropic-com"
fn domain_to_id(base_url: &str) -> String {
    let without_scheme = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    // Take just the host (strip port and path)
    let host = without_scheme
        .split(|c: char| c == '/' || c == ':')
        .next()
        .unwrap_or(without_scheme);
    // Replace dots and invalid chars with dashes, collapse dashes
    let mut result = String::new();
    let mut prev_dash = false;
    for c in host.chars() {
        if c.is_ascii_alphanumeric() {
            result.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            result.push('-');
            prev_dash = true;
        }
    }
    result.trim_matches('-').to_string()
}

/// Convert a base_url to a human-readable name.
/// e.g. "https://api.anthropic.com" → "Api Anthropic"
fn domain_to_name(base_url: &str) -> String {
    let without_scheme = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = without_scheme
        .split(|c: char| c == '/' || c == ':')
        .next()
        .unwrap_or(without_scheme);
    // Split on dots, title-case each segment
    host.split('.')
        .filter(|s| !s.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                None => String::new(),
                Some(c) => {
                    let mut s = c.to_uppercase().to_string();
                    s.extend(chars.flat_map(|c| c.to_lowercase()));
                    s
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Result of [`ProviderService::import_providers_from_sql`].
#[derive(Debug, Clone)]
pub struct ImportResult {
    /// Number of provider files newly written this call.
    pub imported: usize,
    /// Number of provider rows skipped because the target file already
    /// existed (idempotency — re-running with the same dump is safe).
    pub skipped: usize,
    /// Parsing or write errors encountered. Each entry is one row that
    /// couldn't be processed — the UI shows them in a details panel.
    pub errors: Vec<ImportSkip>,
    /// Number of MCP server rows parsed (preview only — F6 owns write).
    pub mcp_count: usize,
}

/// One row that couldn't be processed during import.
#[derive(Debug, Clone)]
pub struct ImportSkip {
    /// `"parse"` = parser rejected the SQL row, `"write"` = serialise
    /// or write failed.
    pub kind: String,
    /// 1-based line number in the original SQL dump (`0` for write
    /// errors since they don't correspond to a single source line).
    pub line: usize,
    /// Provider id when known (`None` for parser errors that never
    /// got far enough to extract an id).
    pub id: Option<String>,
    /// Human-readable reason for the UI to show.
    pub reason: String,
}

/// Internal helper for write-side failures (kept private to the service).
#[derive(Debug)]
struct WriteError {
    id: String,
    reason: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read `(base_url, api_key)` from settings.json's `env` map.
/// Returns `(None, None)` if the file is missing or env is absent.
///
/// Accepts both `ANTHROPIC_AUTH_TOKEN` (Claude Code 早期命名) and
/// `ANTHROPIC_API_KEY` (Claude Code 当前标准命名). `ANTHROPIC_API_KEY`
/// is preferred if both are present.
fn read_current_active_env(settings_path: &Path) -> (Option<String>, Option<String>) {
    let raw = match std::fs::read_to_string(settings_path) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    let env = v.get("env").and_then(|e| e.as_object());
    let base = env
        .and_then(|m| m.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str())
        .map(String::from);
    // Prefer ANTHROPIC_API_KEY (Claude Code current standard), fall back
    // to ANTHROPIC_AUTH_TOKEN (legacy/alias name).
    let key = env
        .and_then(|m| {
            m.get("ANTHROPIC_API_KEY")
                .or_else(|| m.get("ANTHROPIC_AUTH_TOKEN"))
        })
        .and_then(|v| v.as_str())
        .map(String::from);
    (base, key)
}

/// Load settings.json as `Value`. Missing file → empty `{}`.
/// Corrupt JSON → `ProviderError::Json`.
fn load_settings(path: &Path) -> Result<Value, ProviderError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(ProviderError::Json),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(ProviderError::Io(e)),
    }
}

/// Get-or-create the object at `key` inside `value`, returning a
/// mutable reference to it. `value` must be a JSON object.
fn ensure_object<'a>(value: &'a mut Value, key: &str) -> &'a mut serde_json::Map<String, Value> {
    let obj = value
        .as_object_mut()
        .expect("settings root must be a JSON object");
    if !obj.contains_key(key) {
        obj.insert(
            key.to_string(),
            Value::Object(serde_json::Map::new()),
        );
    }
    obj.get_mut(key)
        .and_then(|v| v.as_object_mut())
        .expect("env slot must be a JSON object")
}

/// Convert `fs_atomic::FsAtomicError` → `ProviderError` (we keep
/// ProviderError the public surface; FsAtomicError stays internal).
fn map_fs_atomic_to_provider(e: fs_atomic::FsAtomicError) -> ProviderError {
    use fs_atomic::FsAtomicError;
    match e {
        FsAtomicError::Io(io) => ProviderError::Io(io),
        // The remaining variants wrap io errors or path state; collapse
        // to a generic Io with the message so the UI can display it.
        other => ProviderError::Io(std::io::Error::other(format!(
            "atomic write failed: {other}"
        ))),
    }
}

fn now_unix_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// M3.6 — `delete_provider` 用:读 settings.json 的
/// `env.ANTHROPIC_BASE_URL` + `env.ANTHROPIC_AUTH_TOKEN`,判断
/// `provider` 是否是当前激活的。settings.json 缺失/损坏 → 视作没人
/// 激活(provider 不能"误删"激活态)。
fn is_provider_active(settings_path: &Path, provider: &Provider) -> bool {
    let raw = match std::fs::read_to_string(settings_path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let env = v.get("env").and_then(|e| e.as_object());
    let base = env
        .and_then(|m| m.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str());
    let key = env
        .and_then(|m| m.get("ANTHROPIC_AUTH_TOKEN"))
        .and_then(|v| v.as_str());
    match (base, key) {
        (Some(b), Some(k)) => b == provider.api_base && k == provider.api_key,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ProviderModels;
    use std::fs;
    use std::time::SystemTime;
    use tempfile::TempDir;

    /// Build an AppPaths pointing at the temp dir for both
    /// `app_data` and `settings_json`. Tests don't care about claude_dir,
    /// home, etc.
    fn test_paths(app_data: &Path, settings: &Path) -> AppPaths {
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

    fn write_provider(p_dir: &Path, p: &Provider) {
        std::fs::create_dir_all(p_dir).unwrap();
        p.to_json_file(&p_dir.join(format!("{}.json", p.id))).unwrap();
    }

    fn sample_provider(id: &str, name: &str, base: &str) -> Provider {
        let mut p = Provider::new(id, name, "anthropic", base, format!("key-for-{id}"));
        p.models = ProviderModels {
            default: "claude-sonnet-4-6".into(),
            ..Default::default()
        };
        p
    }

    fn write_settings(path: &Path, base: &str, key: &str) {
        let body = serde_json::json!({
            "env": {
                "ANTHROPIC_BASE_URL": base,
                "ANTHROPIC_AUTH_TOKEN": key,
            },
            "enabledPlugins": { "superpowers": true },
            "hooks": { "PreToolUse": [] },
        });
        std::fs::write(path, serde_json::to_string_pretty(&body).unwrap()).unwrap();
    }

    // ----- list_providers -----

    #[test]
    fn list_providers_empty_dir_returns_empty_vec() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let result = svc.list_providers();
        assert!(result.is_empty());
    }

    #[test]
    fn list_providers_missing_providers_dir_returns_empty_vec() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let result = svc.list_providers();
        assert!(result.is_empty());
    }

    #[test]
    fn list_providers_returns_three_providers_when_three_files_exist() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // settings.json: 模拟当前激活的是 glm-46(provider key 是
        // sample_provider 生成的 "key-for-glm-46",不是 "key-glm")。
        write_settings(&settings, "https://api.anthropic.com", "key-for-glm-46");
        write_provider(
            &p_dir,
            &sample_provider("glm-46", "GLM-4.6", "https://api.anthropic.com"),
        );
        write_provider(
            &p_dir,
            &sample_provider("deepseek", "DeepSeek", "https://api.deepseek.com"),
        );
        write_provider(
            &p_dir,
            &sample_provider("custom", "Custom", "https://internal.example.com"),
        );

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let list = svc.list_providers();
        assert_eq!(list.len(), 3);
        // Sorted by name — Custom, DeepSeek, GLM-4.6
        assert_eq!(list[0].id, "custom");
        assert_eq!(list[1].id, "deepseek");
        assert_eq!(list[2].id, "glm-46");
        // Only glm-46 matches settings.json
        assert!(list[2].is_active);
        assert!(!list[0].is_active);
        assert!(!list[1].is_active);
    }

    #[test]
    fn list_providers_warns_on_corrupt_files() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        std::fs::create_dir_all(&p_dir).unwrap();
        write_provider(
            &p_dir,
            &sample_provider("good", "Good", "https://x.example"),
        );
        std::fs::write(p_dir.join("bad.json"), "{ this is not json").unwrap();

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let (list, warnings) = svc.list_providers_with_warnings();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "good");
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].ends_with("bad.json"));
    }

    #[test]
    fn list_providers_settings_missing_yields_no_active() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json"); // not created
        write_provider(
            &p_dir,
            &sample_provider("only", "Only", "https://x.example"),
        );

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let list = svc.list_providers();
        assert_eq!(list.len(), 1);
        assert!(!list[0].is_active);
    }

    #[test]
    fn list_providers_settings_corrupt_yields_no_active_no_panic() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(
            &p_dir,
            &sample_provider("only", "Only", "https://x.example"),
        );
        fs::write(&settings, "{ corrupted").unwrap();

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let list = svc.list_providers();
        assert_eq!(list.len(), 1);
        assert!(!list[0].is_active);
    }

    #[test]
    fn list_providers_non_json_files_are_ignored() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(
            &p_dir,
            &sample_provider("real", "Real", "https://x.example"),
        );
        fs::write(p_dir.join("readme.txt"), "ignore me").unwrap();
        fs::write(p_dir.join(""), "shouldn't crash").unwrap_or(());

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let list = svc.list_providers();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "real");
    }

    // ----- switch_provider -----

    #[test]
    fn switch_provider_writes_new_env_atomic_with_backup() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_settings(&settings, "https://api.anthropic.com", "key-old");
        write_provider(
            &p_dir,
            &sample_provider("deepseek", "DeepSeek", "https://api.deepseek.com"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let activated = svc.switch_provider("deepseek").unwrap();
        assert_eq!(activated.id, "deepseek");
        assert!(activated.is_active);

        // settings.json now reflects the new provider
        let raw = fs::read_to_string(&settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        let env = v.get("env").unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").unwrap().as_str(),
            Some("https://api.deepseek.com")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").unwrap().as_str(),
            Some("key-for-deepseek")
        );

        // Backup exists with old content
        let mut found_bak = None;
        for entry in fs::read_dir(tmp.path()).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if name.starts_with("settings.json.bak.") {
                found_bak = Some(entry.path());
                break;
            }
        }
        let bak = found_bak.expect("backup should exist");
        let bak_raw = fs::read_to_string(&bak).unwrap();
        assert!(bak_raw.contains("key-old"));
    }

    #[test]
    fn switch_provider_preserves_unknown_top_level_fields() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_settings(&settings, "https://api.anthropic.com", "key-old");
        write_provider(
            &p_dir,
            &sample_provider("custom", "Custom", "https://custom.example"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        svc.switch_provider("custom").unwrap();

        let raw = fs::read_to_string(&settings).unwrap();
        assert!(raw.contains("\"enabledPlugins\""), "unknown field dropped");
        assert!(raw.contains("\"hooks\""), "unknown field dropped");
        assert!(raw.contains("\"superpowers\""), "nested value lost");
    }

    #[test]
    fn switch_provider_creates_settings_when_missing() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json"); // not created
        write_provider(
            &p_dir,
            &sample_provider("only", "Only", "https://only.example"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        svc.switch_provider("only").unwrap();

        let raw = fs::read_to_string(&settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.get("env")
                .unwrap()
                .get("ANTHROPIC_BASE_URL")
                .unwrap()
                .as_str(),
            Some("https://only.example")
        );
        // No backup should exist (file didn't exist before write)
        for entry in fs::read_dir(tmp.path()).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            assert!(!name.contains(".bak."), "unexpected backup: {name}");
        }
    }

    #[test]
    fn switch_provider_updates_last_used_at_and_is_active() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(
            &p_dir,
            &sample_provider("a", "A", "https://a.example"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let before = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let activated = svc.switch_provider("a").unwrap();
        assert!(activated.is_active);
        assert!(activated.last_used_at.is_some());
        assert!(activated.last_used_at.unwrap() >= before);

        // Reload library file and confirm persistence
        let reloaded = Provider::from_json_file(&p_dir.join("a.json")).unwrap();
        assert!(reloaded.is_active);
        assert!(reloaded.last_used_at.is_some());
    }

    // M5 bug #4 regression — `switch_provider_with_active_root(None)`
    // must write to the same settings.json that
    // `list_providers_with_active_root(None)` reads. Pre-fix, on
    // macOS the platform shim always returned active_root=None (D6
    // stub — fixed in bug #19), but the user-level fall-through
    // relied on this exact invariant: if the write target and read
    // target diverge, the is_active badge stays stale.
    //
    // This test asserts the invariant: after switching via the
    // "with_active_root" path (the real IPC entrypoint), the
    // subsequent "with_active_root" list reflects the change.
    #[test]
    fn switch_then_list_with_active_root_none_round_trips() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");

        write_provider(
            &p_dir,
            &sample_provider("a", "A", "https://a.example"),
        );
        write_provider(
            &p_dir,
            &sample_provider("b", "B", "https://b.example"),
        );
        // Initial: b is the active one.
        write_settings(&settings, "https://b.example", "key-for-b");

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        // Switch to a using the with_active_root(None) variant —
        // mirrors what the IPC command does at runtime.
        svc.switch_provider_with_active_root("a", None).unwrap();

        // Re-list with the same active_root=None — the is_active
        // recomputation must see the just-written env.
        let (list, _) = svc
            .list_providers_with_active_root(None)
            .expect("list should succeed");
        let a = list.iter().find(|p| p.id == "a").expect("a in list");
        let b = list.iter().find(|p| p.id == "b").expect("b in list");
        assert!(
            a.is_active,
            "M5 bug #4: just-switched provider must show is_active=true after list reload"
        );
        assert!(
            !b.is_active,
            "M5 bug #4: previously-active provider must show is_active=false after list reload"
        );
    }

    #[test]
    fn switch_provider_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let err = svc.switch_provider("nonexistent").unwrap_err();
        assert!(matches!(err, ProviderError::Io(_)));
    }

    #[test]
    fn switch_provider_sets_model_when_provider_has_models() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let mut p = sample_provider("p", "P", "https://p.example");
        p.models = ProviderModels {
            default: "my-model".into(),
            ..Default::default()
        };
        write_provider(&p_dir, &p);
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        svc.switch_provider("p").unwrap();
        let raw = fs::read_to_string(&settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.get("env")
                .unwrap()
                .get("ANTHROPIC_MODEL")
                .unwrap()
                .as_str(),
            Some("my-model")
        );
    }

    #[test]
    fn switch_provider_does_not_set_model_when_provider_models_empty() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // settings.json already has ANTHROPIC_MODEL
        let body = json!({"env": {"ANTHROPIC_MODEL": "old-model"}});
        std::fs::write(&settings, serde_json::to_string_pretty(&body).unwrap()).unwrap();
        let mut p = sample_provider("p", "P", "https://p.example");
        p.models = ProviderModels::default();
        write_provider(&p_dir, &p);
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        svc.switch_provider("p").unwrap();
        let raw = fs::read_to_string(&settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        // Preserved old model
        assert_eq!(
            v.get("env")
                .unwrap()
                .get("ANTHROPIC_MODEL")
                .unwrap()
                .as_str(),
            Some("old-model")
        );
    }

    // ----- import_providers_from_sql (F3, M2.2) -----

    /// Build a 2-row dump string for testing.
    /// 使用真实 cc-switch schema（claude 系 settings_config.env.ANTHROPIC_*）。
    fn sample_sql_dump() -> String {
        r#"
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('glm-46', 'claude', 'GLM-4.6', '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com","ANTHROPIC_AUTH_TOKEN":"sk-a","ANTHROPIC_MODEL":"claude-sonnet-4-6"},"model":"claude-sonnet-4-6"}');
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('deepseek', 'claude', 'DeepSeek', '{"env":{"ANTHROPIC_BASE_URL":"https://api.deepseek.com","ANTHROPIC_AUTH_TOKEN":"sk-b","ANTHROPIC_MODEL":"deepseek-chat"},"model":"deepseek-chat"}');
INSERT INTO mcp_servers (id, name, server_config) VALUES ('m1', 'M1', '{"command":"npx"}');
"#
        .to_string()
    }

    #[test]
    fn import_3_providers_writes_3_files() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let sql = r#"
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('a1', 'claude', 'A1', '{"env":{"ANTHROPIC_BASE_URL":"https://a","ANTHROPIC_AUTH_TOKEN":"k1","ANTHROPIC_MODEL":"m1"},"model":"m1"}');
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('b2', 'claude', 'B2', '{"env":{"ANTHROPIC_BASE_URL":"https://b","ANTHROPIC_AUTH_TOKEN":"k2","ANTHROPIC_MODEL":"m2"},"model":"m2"}');
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('c3', 'claude', 'C3', '{"env":{"ANTHROPIC_BASE_URL":"https://c","ANTHROPIC_AUTH_TOKEN":"k3","ANTHROPIC_MODEL":"m3"},"model":"m3"}');
"#;
        let result = svc.import_providers_from_sql(sql).unwrap();
        assert_eq!(result.imported, 3);
        assert_eq!(result.skipped, 0);
        assert!(result.errors.is_empty());

        // All 3 files exist on disk and round-trip.
        for id in ["a1", "b2", "c3"] {
            let path = p_dir.join(format!("{id}.json"));
            assert!(path.exists(), "{path:?} should exist");
            let raw = fs::read_to_string(&path).unwrap();
            let p = Provider::from_json_file(&path).unwrap();
            assert_eq!(p.id, id);
            assert!(raw.contains("\"id\""));
        }
    }

    #[test]
    fn import_with_duplicates_skips_existing() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // Pre-existing provider with same id as one in the dump.
        write_provider(&p_dir, &sample_provider("glm-46", "OLD", "https://old.example"));
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let result = svc.import_providers_from_sql(&sample_sql_dump()).unwrap();
        // glm-46 already existed → skipped. deepseek is new → imported.
        assert_eq!(result.imported, 1);
        assert_eq!(result.skipped, 1);
        // Pre-existing file's content untouched (id matches name="OLD").
        let raw = fs::read_to_string(p_dir.join("glm-46.json")).unwrap();
        assert!(raw.contains("OLD"), "existing file should not be overwritten");
        assert!(!raw.contains("GLM-4.6"), "old content not overwritten");
        // New file written.
        assert!(p_dir.join("deepseek.json").exists());
    }

    #[test]
    fn import_records_parse_errors_in_result() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        // Mix of valid + 2 invalid rows.
        let sql = r#"
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('ok', 'claude', 'OK', '{"env":{"ANTHROPIC_BASE_URL":"https://x","ANTHROPIC_AUTH_TOKEN":"k","ANTHROPIC_MODEL":"m"},"model":"m"}');
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('Bad.ID', 'claude', 'Bad', '{"env":{"ANTHROPIC_BASE_URL":"https://x","ANTHROPIC_AUTH_TOKEN":"k","ANTHROPIC_MODEL":"m"},"model":"m"}');
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('also-ok', 'claude', 'OK2', '{"env":{"ANTHROPIC_BASE_URL":"https://y","ANTHROPIC_AUTH_TOKEN":"k2","ANTHROPIC_MODEL":"m2"},"model":"m2"}');
"#;
        let result = svc.import_providers_from_sql(sql).unwrap();
        assert_eq!(result.imported, 2, "two valid rows should import");
        assert_eq!(result.skipped, 0);
        assert_eq!(result.errors.len(), 1, "Bad.ID should be the only parse error");
        assert_eq!(result.errors[0].kind, "parse");
        assert!(result.errors[0].reason.contains("invalid id"));

        // Files exist for the two valid rows.
        assert!(p_dir.join("ok.json").exists());
        assert!(p_dir.join("also-ok.json").exists());
        assert!(!p_dir.join("Bad.ID.json").exists());
    }

    #[test]
    fn import_mcp_rows_are_parsed_but_not_written() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let result = svc.import_providers_from_sql(&sample_sql_dump()).unwrap();
        // mcp_count is reported back to the UI (preview) but no file written.
        assert_eq!(result.mcp_count, 1);
        assert_eq!(p_dir.read_dir().unwrap().count(), 2);
    }

    #[test]
    fn import_with_empty_dump_returns_error() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let err = svc.import_providers_from_sql("").unwrap_err();
        // The empty case is mapped to ProviderError::Json by the service.
        assert!(matches!(err, ProviderError::Json(_)));
    }

    // -----------------------------------------------------------------------
    // read_current_active_env + generate_from_current_config (M3.13.4
    // regression: ANTHROPIC_API_KEY vs ANTHROPIC_AUTH_TOKEN).
    //
    // Claude Code current standard uses ANTHROPIC_API_KEY. Project
    // code historically used ANTHROPIC_AUTH_TOKEN. The reader must
    // accept both; ANTHROPIC_API_KEY wins on conflict.
    // -----------------------------------------------------------------------

    fn write_raw_settings(tmp: &TempDir, body: &str) {
        std::fs::write(tmp.path().join("settings.json"), body).unwrap();
    }

    #[test]
    fn read_env_accepts_anthropic_api_key() {
        let tmp = TempDir::new().unwrap();
        write_raw_settings(
            &tmp,
            r#"{
                "env": {
                    "ANTHROPIC_API_KEY": "sk-test-123",
                    "ANTHROPIC_BASE_URL": "https://example.com"
                }
            }"#,
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &tmp.path().join("settings.json")));
        let result = svc.generate_from_current_config().unwrap();
        assert_eq!(result.provider.api_base, "https://example.com");
        assert_eq!(result.provider.api_key, "sk-test-123");
        assert!(result.is_new);
    }

    #[test]
    fn read_env_accepts_anthropic_auth_token_legacy() {
        let tmp = TempDir::new().unwrap();
        write_raw_settings(
            &tmp,
            r#"{
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "sk-legacy-456",
                    "ANTHROPIC_BASE_URL": "https://legacy.example.com"
                }
            }"#,
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &tmp.path().join("settings.json")));
        let result = svc.generate_from_current_config().unwrap();
        assert_eq!(result.provider.api_base, "https://legacy.example.com");
        assert_eq!(result.provider.api_key, "sk-legacy-456");
    }

    #[test]
    fn read_env_prefers_api_key_over_auth_token_when_both_present() {
        let tmp = TempDir::new().unwrap();
        write_raw_settings(
            &tmp,
            r#"{
                "env": {
                    "ANTHROPIC_API_KEY": "sk-current-789",
                    "ANTHROPIC_AUTH_TOKEN": "sk-legacy-000",
                    "ANTHROPIC_BASE_URL": "https://both.example.com"
                }
            }"#,
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &tmp.path().join("settings.json")));
        let result = svc.generate_from_current_config().unwrap();
        assert_eq!(result.provider.api_key, "sk-current-789");
    }

    #[test]
    fn read_env_missing_base_url_returns_error() {
        let tmp = TempDir::new().unwrap();
        write_raw_settings(
            &tmp,
            r#"{ "env": { "ANTHROPIC_API_KEY": "sk-only-key" } }"#,
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &tmp.path().join("settings.json")));
        let err = svc.generate_from_current_config().unwrap_err();
        // Verify the user-facing error message contains the actionable hint.
        assert!(
            err.to_string().contains("ANTHROPIC_BASE_URL"),
            "expected error to mention ANTHROPIC_BASE_URL, got: {}",
            err
        );
    }

    #[test]
    fn import_creates_providers_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        // No `providers` subdir created.
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('late', 'claude', 'Late', '{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://z\",\"ANTHROPIC_AUTH_TOKEN\":\"k\",\"ANTHROPIC_MODEL\":\"m\"},\"model\":\"m\"}');";
        let result = svc.import_providers_from_sql(sql).unwrap();
        assert_eq!(result.imported, 1);
        let p_dir = tmp.path().join("providers");
        assert!(p_dir.join("late.json").exists());
    }

    #[test]
    fn import_is_idempotent_second_call_writes_zero() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let first = svc.import_providers_from_sql(&sample_sql_dump()).unwrap();
        assert_eq!(first.imported, 2);
        assert_eq!(first.skipped, 0);

        let second = svc.import_providers_from_sql(&sample_sql_dump()).unwrap();
        assert_eq!(second.imported, 0, "second import writes nothing");
        assert_eq!(second.skipped, 2, "second import sees both as duplicates");
        assert!(second.errors.is_empty());
    }

    // ----- get_provider (F14, M2.16) -----

    #[test]
    fn get_provider_returns_stored_provider_round_trip() {
        // 正常路径：取一个已写盘的 provider,字段逐个对得上。
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(
            &p_dir,
            &sample_provider("glm-46", "GLM-4.6", "https://api.anthropic.com"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let p = svc.get_provider("glm-46").unwrap();
        assert_eq!(p.id, "glm-46");
        assert_eq!(p.name, "GLM-4.6");
        assert_eq!(p.api_base, "https://api.anthropic.com");
        assert_eq!(p.api_key, "key-for-glm-46");
    }

    #[test]
    fn get_provider_unknown_id_errors_not_found() {
        // 不存在的 id → NotFound error (M3.6 清单 22: 与磁盘层 Io(NotFound)
        // 区分,这里返回业务层 NotFound,前端可以据此显示
        // "provider X 未找到")。
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(&p_dir, &sample_provider("a", "A", "https://a.example"));
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let err = svc.get_provider("does-not-exist").unwrap_err();
        assert!(matches!(err, ProviderError::NotFound(_)));
    }

    #[test]
    fn get_provider_corrupt_file_errors_json() {
        // 文件在但不是合法 JSON → Json error(和 list_providers_with_warnings
        // 对坏文件的判定一致,只是这里冒泡给调用方)。
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        std::fs::create_dir_all(&p_dir).unwrap();
        std::fs::write(p_dir.join("bad.json"), "{ not json").unwrap();
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let err = svc.get_provider("bad").unwrap_err();
        assert!(matches!(err, ProviderError::Json(_)));
    }

    // ----- import_single_provider (F4, M2.3) -----

    #[test]
    fn import_single_new_writes_file() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let p = sample_provider("new-via-deeplink", "Deeplink", "https://dl.example");
        svc.import_single_provider(p.clone()).unwrap();

        let path = p_dir.join("new-via-deeplink.json");
        assert!(path.exists(), "provider file should exist on disk");
        let reloaded = Provider::from_json_file(&path).unwrap();
        assert_eq!(reloaded.id, "new-via-deeplink");
        assert_eq!(reloaded.api_base, "https://dl.example");
        assert_eq!(reloaded.api_key, "key-for-new-via-deeplink");
    }

    #[test]
    fn import_single_existing_errors() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // Pre-existing provider with the same id.
        write_provider(
            &p_dir,
            &sample_provider("dup", "ORIGINAL", "https://orig.example"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let p = sample_provider("dup", "OVERWRITE_ATTEMPT", "https://other.example");
        let err = svc.import_single_provider(p).unwrap_err();
        assert!(matches!(err, ProviderError::AlreadyExists(id) if id == "dup"));

        // Original file content untouched
        let raw = fs::read_to_string(p_dir.join("dup.json")).unwrap();
        assert!(raw.contains("ORIGINAL"), "existing file must not be overwritten");
        assert!(!raw.contains("OVERWRITE_ATTEMPT"));
    }

    #[test]
    fn import_single_creates_providers_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        // No `providers` subdir created yet.
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let p = sample_provider("late-deeplink", "Late", "https://late.example");
        svc.import_single_provider(p).unwrap();

        let p_dir = tmp.path().join("providers");
        assert!(p_dir.join("late-deeplink.json").exists());
    }

    #[test]
    fn import_single_does_not_create_settings_backup() {
        // The first write to a non-existent file should NOT take a
        // backup (there's nothing to back up). Settings.json is
        // untouched for F4 import (deferred to F2 switch).
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let p = sample_provider("only", "Only", "https://x.example");
        svc.import_single_provider(p).unwrap();

        for entry in fs::read_dir(tmp.path()).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            assert!(!name.contains(".bak."), "unexpected backup: {name}");
        }
        assert!(!settings.exists(), "settings.json should be untouched by F4");
    }

    // ----- M3.6 (清单 22) — CRUD -----

    /// 合法 input → 文件落盘 + 字段映射对得上
    /// (id/name/api_base/api_key/models[0]=model/notes/created_at/!is_active)。
    #[test]
    fn add_provider_writes_new_file_with_input_fields() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let input = ProviderInput {
            id: "glm-46".into(),
            name: "GLM-4.6 官方".into(),
            base_url: "https://api.anthropic.com".into(),
            api_key: "sk-ant-test".into(),
            models: ProviderModels {
                default: "claude-sonnet-4-6".into(),
                ..Default::default()
            },
            notes: Some("官方默认".into()),
        };
        let p = svc.add_provider(input).unwrap();
        assert_eq!(p.id, "glm-46");
        assert_eq!(p.name, "GLM-4.6 官方");
        assert_eq!(p.provider_type, "anthropic"); // M3.6 范围固定
        assert_eq!(p.api_base, "https://api.anthropic.com");
        assert_eq!(p.api_key, "sk-ant-test");
        assert_eq!(p.models.default, "claude-sonnet-4-6");
        assert!(!p.is_active);
        assert!(p.last_used_at.is_none());
        assert_eq!(p.notes.as_deref(), Some("官方默认"));

        // 文件落盘 + 内容可解析。
        let path = tmp.path().join("providers").join("glm-46.json");
        assert!(path.exists());
        let reloaded = Provider::from_json_file(&path).unwrap();
        assert_eq!(reloaded.id, "glm-46");
    }

    /// 重复 id → AlreadyExists 错,旧文件不动。
    #[test]
    fn add_provider_duplicate_id_errors() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(&p_dir, &sample_provider("dup", "ORIGINAL", "https://orig.example"));
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let input = ProviderInput {
            id: "dup".into(),
            name: "OVERWRITE".into(),
            base_url: "https://other.example".into(),
            api_key: "k2".into(),
            models: ProviderModels {
                default: "m2".into(),
                ..Default::default()
            },
            notes: None,
        };
        let err = svc.add_provider(input).unwrap_err();
        assert!(matches!(err, ProviderError::AlreadyExists(id) if id == "dup"));

        // 旧文件不动
        let raw = fs::read_to_string(p_dir.join("dup.json")).unwrap();
        assert!(raw.contains("ORIGINAL"));
        assert!(!raw.contains("OVERWRITE"));
    }

    /// input.id 不合规(大写/空格)→ InvalidId 错。
    #[test]
    fn add_provider_invalid_id_errors() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let input = ProviderInput {
            id: "Bad.ID".into(),
            name: "x".into(),
            base_url: "https://x".into(),
            api_key: "k".into(),
            models: ProviderModels {
                default: "m".into(),
                ..Default::default()
            },
            notes: None,
        };
        let err = svc.add_provider(input).unwrap_err();
        assert!(matches!(err, ProviderError::InvalidId(_)));
    }

    /// 字段非空校验:base_url 空 → Json 错。
    #[test]
    fn add_provider_empty_base_url_errors() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let input = ProviderInput {
            id: "ok".into(),
            name: "OK".into(),
            base_url: "".into(),
            api_key: "k".into(),
            models: ProviderModels { default: "m".into(), ..Default::default() },
            notes: None,
        };
        let err = svc.add_provider(input).unwrap_err();
        assert!(matches!(err, ProviderError::Json(_)));
    }

    /// 合法 update → 字段更新,id / created_at / is_active 保留。
    #[test]
    fn update_provider_modifies_fields_preserves_id_and_timestamps() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let mut p = sample_provider("a", "OLD", "https://old.example");
        p.notes = Some("old note".into());
        p.last_used_at = Some(1_700_000_000);
        write_provider(&p_dir, &p);
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let input = ProviderInput {
            id: "a".into(), // 与原 id 一致(允许但不变更)
            name: "NEW".into(),
            base_url: "https://new.example".into(),
            api_key: "new-key".into(),
            models: ProviderModels {
                default: "new-model".into(),
                ..Default::default()
            },
            notes: Some("new note".into()),
        };
        let updated = svc.update_provider("a", input).unwrap();
        assert_eq!(updated.id, "a"); // id 保留
        assert_eq!(updated.name, "NEW");
        assert_eq!(updated.api_base, "https://new.example");
        assert_eq!(updated.api_key, "new-key");
        assert_eq!(updated.models.default, "new-model");
        assert_eq!(updated.notes.as_deref(), Some("new note"));
        // 时间戳保留
        assert_eq!(updated.last_used_at, Some(1_700_000_000));
        assert!(updated.created_at > 0);

        // 磁盘已更新
        let reloaded = Provider::from_json_file(&p_dir.join("a.json")).unwrap();
        assert_eq!(reloaded.name, "NEW");
    }

    /// 不存在 id → NotFound 业务错(不是 Io NotFound)。
    #[test]
    fn update_provider_not_found_errors() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let input = ProviderInput {
            id: "ghost".into(),
            name: "X".into(),
            base_url: "https://x".into(),
            api_key: "k".into(),
            models: ProviderModels { default: "m".into(), ..Default::default() },
            notes: None,
        };
        let err = svc.update_provider("ghost", input).unwrap_err();
        assert!(matches!(err, ProviderError::NotFound(id) if id == "ghost"));
    }

    /// 当前激活的 provider 不能删 → CannotDeleteActive。
    #[test]
    fn delete_provider_active_errors() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // settings 写明激活的是 a(匹配 sample_provider 的 base/key)
        write_settings(&settings, "https://a.example", "key-for-a");
        write_provider(&p_dir, &sample_provider("a", "A", "https://a.example"));
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let err = svc.delete_provider("a").unwrap_err();
        assert!(matches!(err, ProviderError::CannotDeleteActive(id) if id == "a"));

        // 文件未删
        assert!(p_dir.join("a.json").exists());
    }

    /// 非激活的 provider → 删除成功,文件消失。
    #[test]
    fn delete_provider_inactive_succeeds() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // settings 指向 b,a 不活跃
        write_settings(&settings, "https://b.example", "key-for-b");
        write_provider(&p_dir, &sample_provider("a", "A", "https://a.example"));
        write_provider(&p_dir, &sample_provider("b", "B", "https://b.example"));
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        svc.delete_provider("a").unwrap();
        assert!(!p_dir.join("a.json").exists());
        // b 不动
        assert!(p_dir.join("b.json").exists());
    }

    /// 不存在 id → NotFound 业务错。
    #[test]
    fn delete_provider_not_found_errors() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let err = svc.delete_provider("ghost").unwrap_err();
        assert!(matches!(err, ProviderError::NotFound(id) if id == "ghost"));
    }

    // ----- M3.10 adapter (3-high F1 + F2) -----

    /// 用户级(None) → 返回 cached `paths.settings_json`(用户级)。
    #[test]
    fn settings_json_for_active_root_none_returns_user_level() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let got = svc.settings_json_for_active_root(None);
        assert_eq!(got, settings);
    }

    /// 项目级(Some) → 返回 `<active_root>/.claude/settings.json`。
    #[test]
    fn settings_json_for_active_root_some_returns_project_settings() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let project_root = PathBuf::from("/proj-a");
        let got = svc.settings_json_for_active_root(Some(&project_root));
        assert_eq!(got, PathBuf::from("/proj-a/.claude/settings.json"));
    }

    /// providers 目录同源逻辑:None → `<app_data>/providers/`,
    /// Some → `<active_root>/.claude/providers/`。
    #[test]
    fn providers_dir_for_active_root_resolves_per_mode() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let user = svc.providers_dir_for_active_root(None);
        assert_eq!(user, tmp.path().join("providers"));

        let proj = svc.providers_dir_for_active_root(Some(Path::new("/proj-b")));
        assert_eq!(proj, PathBuf::from("/proj-b/.claude/providers"));
    }

    /// F2 切换 + 活跃项目模式 → settings.json 写到项目根的 .claude/。
    /// 这是 3-high F2 适配点的端到端验证。
    #[test]
    fn switch_provider_with_active_root_writes_to_project_claude_dir() {
        let tmp = TempDir::new().unwrap();
        // 项目根(模拟)— 完全独立于 app_data。
        let project_root = tmp.path().join("proj-x");
        std::fs::create_dir_all(&project_root).unwrap();
        // 用户级 settings.json 永远不会被这个测试触碰。
        let user_settings = tmp.path().join("user-settings.json");
        write_settings(&user_settings, "https://user.example", "user-key");

        let p_dir = tmp.path().join("providers");
        write_provider(
            &p_dir,
            &sample_provider("glm-46", "GLM-4.6", "https://api.anthropic.com"),
        );

        let svc = ProviderService::new(test_paths(tmp.path(), &user_settings));
        let activated = svc
            .switch_provider_with_active_root("glm-46", Some(&project_root))
            .unwrap();
        assert_eq!(activated.id, "glm-46");

        // 项目级 settings.json 被写入,用户级 settings.json 未被改。
        let project_settings = project_root.join(".claude").join("settings.json");
        assert!(project_settings.exists(), "project settings.json must be created");
        let raw = std::fs::read_to_string(&project_settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.get("env")
                .unwrap()
                .get("ANTHROPIC_BASE_URL")
                .unwrap()
                .as_str(),
            Some("https://api.anthropic.com")
        );

        let user_raw = std::fs::read_to_string(&user_settings).unwrap();
        assert!(user_raw.contains("user-key"));
        assert!(!user_raw.contains("api.anthropic.com"));
    }

    /// F2 切换 + 用户级(None)= 走原路径,完全向后兼容。
    #[test]
    fn switch_provider_with_active_root_none_matches_legacy() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_settings(&settings, "https://old.example", "old-key");
        write_provider(
            &p_dir,
            &sample_provider("deepseek", "DeepSeek", "https://api.deepseek.com"),
        );

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let activated = svc
            .switch_provider_with_active_root("deepseek", None)
            .unwrap();
        assert_eq!(activated.id, "deepseek");

        let raw = std::fs::read_to_string(&settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.get("env")
                .unwrap()
                .get("ANTHROPIC_BASE_URL")
                .unwrap()
                .as_str(),
            Some("https://api.deepseek.com")
        );
    }

    /// F1 + F3 — M3.12 adapter (3-medium A1#1 + A1#3): `list_providers` +
    /// `list_providers_with_warnings` + `import_providers_from_sql` 接
    /// `active_root_dir`。业务方法签名从 `()` 变成
    /// `(Option<&Path>, content: &str)` 等,这样命令层先读 live
    /// active_root 再注入,避免 service 自己再读 platform runtime
    /// (保持 service 的"只接业务参数"分层原则)。
    ///
    /// 行为契约(与 A1#1 / A1#3 决策一致):
    ///   - `None` → 走用户级 `<app_data>/providers/`(完全向后兼容)
    ///   - `Some(root)` → 走 `<root>/.claude/providers/`
    ///   - 项目模式读取时,providers 目录不存在 → **返回空数组**(不
    ///     fallback 到用户级,防止读到与项目无关的全局 provider)
    ///   - 项目模式写时,providers 目录不存在 → 写盘失败(Io 错)
    ///     (M3.11 F18 安全边界:不自动 mkdir 未知 root)

    /// F1 用户级 (None) — 与原 `list_providers` 行为完全一致。
    #[test]
    fn list_providers_with_active_root_none_matches_user_level_legacy() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        // sample_provider 生成的 key 是 "key-for-glm-46" —— 必须
        // 与 settings.json 的 ANTHROPIC_AUTH_TOKEN 一致,is_active 才为 true。
        write_settings(&settings, "https://api.anthropic.com", "key-for-glm-46");
        write_provider(
            &p_dir,
            &sample_provider("glm-46", "GLM-4.6", "https://api.anthropic.com"),
        );
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let (list, _warnings) = svc.list_providers_with_active_root(None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "glm-46");
        assert!(list[0].is_active);
    }

    /// F1 项目级 (Some) — root 下有 providers → 读到正确内容。
    #[test]
    fn list_providers_with_active_root_some_reads_project_providers() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("proj-x");
        std::fs::create_dir_all(project_root.join(".claude").join("providers")).unwrap();
        write_provider(
            &project_root.join(".claude").join("providers"),
            &sample_provider("proj-only", "ProjOnly", "https://proj.example"),
        );
        // 用户级也写一个同名 id 的 provider,但 *不同* name — 验证
        // 走的是项目级目录而非 fallback。
        let p_dir = tmp.path().join("providers");
        write_provider(
            &p_dir,
            &sample_provider("user-only", "UserOnly", "https://user.example"),
        );
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let (list, _warnings) = svc
            .list_providers_with_active_root(Some(&project_root))
            .unwrap();
        assert_eq!(list.len(), 1, "only project-level providers visible");
        assert_eq!(list[0].id, "proj-only");
    }

    /// F1 项目级 (Some) — root 下 *无* providers 目录 → **返回空数
    /// 组**(不 fallback 到用户级)。这是 A1#1 的安全决策:避免泄漏
    /// 全局 provider 到项目视图。
    #[test]
    fn list_providers_with_active_root_missing_project_dir_returns_empty_no_fallback() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("proj-empty");
        std::fs::create_dir_all(&project_root).unwrap(); // .claude 不存在
        // 用户级有 1 个 provider — 确认不会泄漏。
        let p_dir = tmp.path().join("providers");
        write_provider(
            &p_dir,
            &sample_provider("user-leak", "UserLeak", "https://user.example"),
        );
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let (list, _warnings) = svc
            .list_providers_with_active_root(Some(&project_root))
            .unwrap();
        assert!(
            list.is_empty(),
            "missing project dir must NOT fallback to user-level"
        );
    }

    /// F3 用户级 (None) — 写盘走 `<app_data>/providers/`,与原
    /// `import_providers_from_sql` 一致。
    #[test]
    fn import_providers_from_sql_with_active_root_none_writes_user_level() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('a1', 'claude', 'A1', '{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://a\",\"ANTHROPIC_AUTH_TOKEN\":\"k1\",\"ANTHROPIC_MODEL\":\"m1\"},\"model\":\"m1\"}');";
        let result = svc
            .import_providers_from_sql_with_active_root(sql, None)
            .unwrap();
        assert_eq!(result.imported, 1);
        assert!(p_dir.join("a1.json").exists());
    }

    /// F3 项目级 (Some) — 写盘走 `<root>/.claude/providers/`。
    /// 关键验证:用户级 providers 目录不会被触碰(无泄漏)。
    #[test]
    fn import_providers_from_sql_with_active_root_some_writes_project_level() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("proj-y");
        std::fs::create_dir_all(&project_root).unwrap();
        let user_p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('proj-import', 'claude', 'P', '{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://p\",\"ANTHROPIC_AUTH_TOKEN\":\"k\",\"ANTHROPIC_MODEL\":\"m\"},\"model\":\"m\"}');";
        let result = svc
            .import_providers_from_sql_with_active_root(sql, Some(&project_root))
            .unwrap();
        assert_eq!(result.imported, 1);

        // 写到项目级。
        let target = project_root.join(".claude").join("providers").join("proj-import.json");
        assert!(target.exists(), "project provider file must exist: {target:?}");

        // 用户级未被污染。
        assert!(!user_p_dir.join("proj-import.json").exists());
    }

    /// F3 项目级 (Some) — 写后读回,内容正确。
    #[test]
    fn import_providers_from_sql_with_active_root_some_round_trip() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("proj-z");
        std::fs::create_dir_all(&project_root).unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = ProviderService::new(test_paths(tmp.path(), &settings));

        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('rt', 'claude', 'RT', '{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://rt\",\"ANTHROPIC_AUTH_TOKEN\":\"krt\",\"ANTHROPIC_MODEL\":\"mrt\"},\"model\":\"mrt\"}');";
        svc.import_providers_from_sql_with_active_root(sql, Some(&project_root))
            .unwrap();

        let raw = std::fs::read_to_string(
            project_root.join(".claude").join("providers").join("rt.json"),
        )
        .unwrap();
        let p = Provider::from_json_file(
            &project_root.join(".claude").join("providers").join("rt.json"),
        )
        .unwrap();
        assert_eq!(p.id, "rt");
        assert_eq!(p.name, "RT");
        assert_eq!(p.api_base, "https://rt");
        assert_eq!(p.api_key, "krt");
        assert!(raw.contains("\"id\": \"rt\""));
    }

    /// 失败/边界:不存在的项目根 (Some) → 调用方负责创建;.claude/
    /// 父目录不存在则 fs_atomic::write_with_backup 自己报错(写盘
    /// 失败不属于此函数范围,符合 M3.11 F18 的安全边界 — 不自动
    /// mkdir 未知 root)。
    #[test]
    fn switch_provider_with_active_root_resolves_to_correct_target() {
        let tmp = TempDir::new().unwrap();
        let p_dir = tmp.path().join("providers");
        let settings = tmp.path().join("settings.json");
        write_provider(&p_dir, &sample_provider("a", "A", "https://a.example"));

        let svc = ProviderService::new(test_paths(tmp.path(), &settings));
        let ghost = PathBuf::from("/never/created/proj-z");
        // 写盘会因父目录不存在失败 → 我们只关心错误是 Io 类(原路径找不到)。
        let err = svc
            .switch_provider_with_active_root("a", Some(&ghost))
            .unwrap_err();
        assert!(matches!(err, ProviderError::Io(_)));
    }
}