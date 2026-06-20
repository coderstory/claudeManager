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

use serde_json::{json, Value};

use crate::domain::{Provider, ProviderError};
use crate::infrastructure::fs_atomic;
use crate::platform::AppPaths;

// ---------------------------------------------------------------------------
// ProviderService
// ---------------------------------------------------------------------------

/// Business logic for F1 + F2. Stateless apart from the resolved
/// `AppPaths` snapshot it was constructed with.
pub struct ProviderService {
    paths: AppPaths,
}

impl ProviderService {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
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
    pub fn list_providers(&self) -> Vec<Provider> {
        self.list_providers_with_warnings().0
    }

    /// Same as [`list_providers`] but also returns the list of
    /// corrupted provider file paths so the UI can show a warning.
    /// The tuple is `(providers, warnings)`.
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
        env_obj["ANTHROPIC_BASE_URL"] = Value::String(provider.api_base.clone());
        env_obj["ANTHROPIC_AUTH_TOKEN"] = Value::String(provider.api_key.clone());
        // Set ANTHROPIC_MODEL if provider declares models. We use the
        // first entry as "primary"; if it's empty, leave existing.
        if let Some(first_model) = provider.models.first() {
            if !first_model.is_empty() {
                env_obj["ANTHROPIC_MODEL"] = Value::String(first_model.clone());
            }
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
        self.paths.app_data.join("providers").join(format!("{id}.json"))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read `(base_url, api_key)` from settings.json's `env` map.
/// Returns `(None, None)` if the file is missing or env is absent.
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
    let key = env
        .and_then(|m| m.get("ANTHROPIC_AUTH_TOKEN"))
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
        }
    }

    fn write_provider(p_dir: &Path, p: &Provider) {
        std::fs::create_dir_all(p_dir).unwrap();
        p.to_json_file(&p_dir.join(format!("{}.json", p.id))).unwrap();
    }

    fn sample_provider(id: &str, name: &str, base: &str) -> Provider {
        let mut p = Provider::new(id, name, "anthropic", base, format!("key-for-{id}"));
        p.models = vec!["claude-sonnet-4-6".into()];
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
        write_settings(&settings, "https://api.anthropic.com", "key-glm");
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
            let name = entry.unwrap().file_name().into_string().unwrap();
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
        p.models = vec!["my-model".into()];
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
        p.models = vec![];
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
}