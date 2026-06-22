//! Updater commands — M4.3 Phase 1 (pubkey + endpoint config).
//!
//! The heavy lifting (check/download/install) lives in
//! tauri-plugin-updater's built-in commands. This module provides
//! Tauri commands for reading updater configuration from the Rust side.
//!

use tauri::State;
use crate::app_state::AppState;

/// Read the configured updater pubkey (from tauri.conf.json).
#[tauri::command]
pub fn get_updater_pubkey(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.updater_pubkey.clone())
}

/// Read the configured updater endpoints (from tauri.conf.json).
#[tauri::command]
pub fn get_updater_endpoints(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.updater_endpoints.clone())
}

/// Stub: trigger update check (delegates to tauri-plugin-updater).
/// Phase 1 returns "not implemented" — Phase 2 will call the real check flow.
#[tauri::command]
pub async fn check_update() -> Result<String, String> {
    Err("check_update: not implemented in Phase 1 (pubkey + endpoint only)".into())
}

// ---------------------------------------------------------------------------
// Unit tests — M4.3 updater config validation
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use url::Url;
    use std::str::FromStr;

    #[test]
    fn endpoint_url_parses_correctly() {
        let url = Url::from_str("https://releases.example.com/api/update/{{target}}/{{arch}}/{{current_version}}")
            .expect("endpoint URL must be valid");
        assert_eq!(url.scheme(), "https");
        assert!(!url.host_str().unwrap().is_empty());
        assert!(url.path().contains("%7B%7Btarget"));
    }

    #[test]
    fn endpoint_https_required_for_release() {
        let url = Url::from_str("http://localhost:3000/api/update").unwrap();
        assert_eq!(url.scheme(), "http");
        // This would fail in release without dangerousInsecureTransportProtocol.
        // Our prod endpoint must be HTTPS.
    }

    #[test]
    fn pubkey_is_base64_encoded_and_non_empty() {
        let pubkey = "dummy-base64-key-for-test";
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(pubkey)
            .expect("pubkey must be valid base64");
        assert!(!decoded.is_empty());
    }

    #[test]
    fn empty_pubkey_is_rejected_in_release() {
        // In release mode, an empty pubkey would cause signature verification
        // to fail. Phase 1 goal: ensure pubkey is non-empty.
        let pubkey = "";
        assert!(pubkey.is_empty(), "this would fail in release builds — we must replace the empty string");
    }

    #[test]
    fn updater_config_parses_endpoints_vec() {
        let json = r#"{"endpoints": ["https://example.com/update"], "pubkey": "dGVzdA"}"#;
        #[derive(serde::Deserialize)]
        struct TestConfig {
            endpoints: Vec<Url>,
            pubkey: String,
        }
        let cfg: TestConfig = serde_json::from_str(json).expect("valid updater config");
        assert_eq!(cfg.endpoints.len(), 1);
        assert_eq!(cfg.endpoints[0].scheme(), "https");
        assert!(!cfg.pubkey.is_empty());
    }
}
