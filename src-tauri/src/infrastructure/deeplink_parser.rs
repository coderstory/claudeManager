//! `deeplink_parser` — parse `ccswitch://v1/import?...` URLs into a
//! `ParsedDeeplink` (F4, M2.3).
//!
//! This module is a pure-function parser with no Tauri / no I/O — it
//! can be unit-tested in isolation. The shape returned
//! ([`ParsedDeeplink`]) is the contract the frontend modal reads
//! after calling the `parse_deeplink_url` Tauri command (see
//! `commands::providers::parse_deeplink_url`).
//!
//! ## URL protocol (v1, M2.3 scope)
//!
//! ```text
//! ccswitch://v1/import?resource=provider&app=claude&name=GLM-4.6
//!   &endpoint=https%3A%2F%2Fapi.anthropic.com&apiKey=sk-xxx
//!   &model=claude-sonnet-4-6&notes=hi
//! ```
//!
//! Only `resource=provider` is supported in M2.3. Other resource
//! types (`mcp` / `prompt` / `skill`) return an error — F6/F17/F18
//! own those later.
//!
//! ## Error semantics
//!
//! Per CLAUDE.md §7 ("不允许静默吞错"), every parse failure is
//! surfaced as a `DeeplinkParseError` with a stable `code` + user
//! message. The frontend renders the message verbatim.

use thiserror::Error;
use url::Url;

use crate::domain::{McpServer, McpTransport, Provider};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Parsed deeplink request (M2.3 — F4 + M2.5 — F6).
///
/// `action` discriminates between provider-import and mcp-import.
/// Exactly one of `provider` / `mcp_server` is populated, matching
/// the `resource=` query parameter.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ParsedDeeplink {
    pub action: DeeplinkAction,
    /// Present iff `action == Import`. The provider fields are
    /// already validated (id slug-ified, models populated).
    pub provider: Option<Provider>,
    /// Present iff `action == ImportMcp` (M2.5 — F6).
    /// The McpServer fields are URL-decoded; transport is inferred
    /// from the presence of `type=http` (default: stdio).
    pub mcp_server: Option<McpServer>,
}

/// What the deeplink asks the app to do.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DeeplinkAction {
    /// `ccswitch://v1/import?resource=provider&...`
    Import,
    /// `ccswitch://v1/import?resource=mcp&...` — M2.5 F6.
    ImportMcp,
}

/// All the ways a deeplink URL can be rejected. Each variant
/// carries a `code` that the frontend can use to render a localised
/// error message + a human-readable fallback.
#[derive(Debug, Error)]
pub enum DeeplinkParseError {
    #[error("invalid URL: {0}")]
    InvalidUrl(String),

    #[error("invalid scheme: expected 'ccswitch', got '{0}'")]
    InvalidScheme(String),

    #[error("unsupported protocol version: '{0}' (only 'v1' is supported)")]
    UnsupportedVersion(String),

    #[error("invalid path: expected '/import', got '{0}'")]
    InvalidPath(String),

    #[error("missing required query parameter: {0}")]
    MissingParam(&'static str),

    #[error("unsupported resource type: '{0}' (only 'provider' is supported in M2.3)")]
    UnsupportedResource(String),

    #[error("invalid app type: '{0}'")]
    InvalidAppType(String),

    #[error("invalid id '{0}': must match [a-z0-9-_]+")]
    InvalidId(String),

    #[error("name cannot be empty after URL decoding")]
    EmptyName,

    #[error("endpoint cannot be empty")]
    EmptyEndpoint,

    #[error("apiKey cannot be empty")]
    EmptyApiKey,

    #[error("MCP command cannot be empty")]
    EmptyMcpCommand,

    #[error("MCP url cannot be empty")]
    EmptyMcpUrl,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Parse a `ccswitch://v1/import?resource=provider&...` URL.
///
/// Pure function. No I/O. Returns `Ok(ParsedDeeplink)` on success.
pub fn parse_deeplink_url(url_str: &str) -> Result<ParsedDeeplink, DeeplinkParseError> {
    // 1. URL-level parse
    let url = Url::parse(url_str).map_err(|e| DeeplinkParseError::InvalidUrl(e.to_string()))?;

    // 2. Scheme check
    if url.scheme() != "ccswitch" {
        return Err(DeeplinkParseError::InvalidScheme(
            url.scheme().to_string(),
        ));
    }

    // 3. Version is the host
    let version = url
        .host_str()
        .ok_or_else(|| DeeplinkParseError::MissingParam("version (in host)"))?;
    if version != "v1" {
        return Err(DeeplinkParseError::UnsupportedVersion(version.to_string()));
    }

    // 4. Path must be exactly /import
    if url.path() != "/import" {
        return Err(DeeplinkParseError::InvalidPath(url.path().to_string()));
    }

    // 5. Resource type
    let resource = url
        .query_pairs()
        .find(|(k, _)| k == "resource")
        .map(|(_, v)| v.into_owned())
        .ok_or(DeeplinkParseError::MissingParam("resource"))?;

    match resource.as_str() {
        "provider" => parse_provider_deeplink(&url),
        "mcp" => parse_mcp_deeplink(&url),
        other => Err(DeeplinkParseError::UnsupportedResource(other.to_string())),
    }
}

/// Parse a `resource=provider` deeplink — original M2.3 logic,
/// extracted so the public entry point can route on resource type.
fn parse_provider_deeplink(url: &Url) -> Result<ParsedDeeplink, DeeplinkParseError> {
    // 6. Pull every query param (URL-decoded).
    let mut name: Option<String> = None;
    let mut app: Option<String> = None;
    let mut endpoint: Option<String> = None;
    let mut api_key: Option<String> = None;
    let mut model: Option<String> = None;
    let mut notes: Option<String> = None;
    let mut explicit_id: Option<String> = None;

    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "name" => name = Some(v.into_owned()),
            "app" => app = Some(v.into_owned()),
            "endpoint" => endpoint = Some(v.into_owned()),
            "apiKey" => api_key = Some(v.into_owned()),
            "model" => model = Some(v.into_owned()),
            "notes" => notes = Some(v.into_owned()),
            "id" => explicit_id = Some(v.into_owned()),
            _ => {} // unknown keys are ignored — forward compat
        }
    }

    let name = name.ok_or(DeeplinkParseError::MissingParam("name"))?;
    if name.is_empty() {
        return Err(DeeplinkParseError::EmptyName);
    }
    let app = app.ok_or(DeeplinkParseError::MissingParam("app"))?;
    if !is_valid_app_type(&app) {
        return Err(DeeplinkParseError::InvalidAppType(app));
    }
    let endpoint = endpoint.ok_or(DeeplinkParseError::MissingParam("endpoint"))?;
    if endpoint.is_empty() {
        return Err(DeeplinkParseError::EmptyEndpoint);
    }
    let api_key = api_key.ok_or(DeeplinkParseError::MissingParam("apiKey"))?;
    if api_key.is_empty() {
        return Err(DeeplinkParseError::EmptyApiKey);
    }

    // 7. id resolution: explicit > slug(name)
    let id = match explicit_id {
        Some(s) if !s.is_empty() => {
            if !crate::domain::is_valid_id(&s) {
                return Err(DeeplinkParseError::InvalidId(s));
            }
            s
        }
        _ => slugify(&name),
    };

    let models = model
        .map(|m| {
            m.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let provider = Provider {
        id,
        name,
        provider_type: app,
        api_base: endpoint,
        api_key,
        models,
        is_active: false,
        created_at: now_unix_secs(),
        last_used_at: None,
        notes,
    };

    Ok(ParsedDeeplink {
        action: DeeplinkAction::Import,
        provider: Some(provider),
        mcp_server: None,
    })
}

/// Parse a `resource=mcp` deeplink — M2.5 F6.
///
/// Expected query shape:
///   `ccswitch://v1/import?resource=mcp&app=claude&name=fs
///      &command=npx&args=-y,@mcp/filesystem&env.ROOT=/tmp;KEY=v`
///
/// `type` query param is optional. If absent, defaults to `stdio`.
/// For `http`, `url` is required and `command` is ignored.
fn parse_mcp_deeplink(url: &Url) -> Result<ParsedDeeplink, DeeplinkParseError> {
    let mut name: Option<String> = None;
    let mut transport_type: Option<String> = None;
    let mut command: Option<String> = None;
    let mut url_val: Option<String> = None;
    let mut args: Option<String> = None;
    let mut env: Option<String> = None;
    let mut _description: Option<String> = None;

    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "name" => name = Some(v.into_owned()),
            "type" => transport_type = Some(v.into_owned()),
            "command" => command = Some(v.into_owned()),
            "url" => url_val = Some(v.into_owned()),
            "args" => args = Some(v.into_owned()),
            "env" => env = Some(v.into_owned()),
            "description" => _description = Some(v.into_owned()),
            _ => {} // unknown keys ignored
        }
    }

    let name = name.ok_or(DeeplinkParseError::MissingParam("name"))?;
    if name.is_empty() {
        return Err(DeeplinkParseError::EmptyName);
    }

    let transport = match transport_type.as_deref() {
        Some("http") | Some("sse") => McpTransport::Http,
        Some("stdio") | None => McpTransport::Stdio,
        Some(other) => {
            return Err(DeeplinkParseError::InvalidAppType(other.to_string()))
        }
    };

    let command = command.filter(|s| !s.is_empty());
    let url_str = url_val.filter(|s| !s.is_empty());

    match transport {
        McpTransport::Stdio => {
            if command.is_none() {
                return Err(DeeplinkParseError::EmptyMcpCommand);
            }
        }
        McpTransport::Http => {
            if url_str.is_none() {
                return Err(DeeplinkParseError::EmptyMcpUrl);
            }
        }
    }

    let args_vec: Vec<String> = args
        .map(|a| {
            a.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let env_map: std::collections::HashMap<String, String> = env
        .map(|raw| {
            raw.split(';')
                .filter_map(|pair| {
                    let mut it = pair.splitn(2, '=');
                    let k = it.next()?.trim().to_string();
                    let v = it.next()?.trim().to_string();
                    if k.is_empty() {
                        None
                    } else {
                        Some((k, v))
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let mut server = McpServer::new(name, transport, command, url_str);
    server.args = args_vec;
    server.env = env_map;
    // id is auto-generated by McpServer::new; created_at too.

    Ok(ParsedDeeplink {
        action: DeeplinkAction::ImportMcp,
        provider: None,
        mcp_server: Some(server),
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Allowed values for `app=` query param. Mapped to Provider.provider_type.
const VALID_APP_TYPES: &[&str] = &[
    "claude",
    "codex",
    "gemini",
    "anthropic",
    "openai",
    "deepseek",
    "custom",
];

fn is_valid_app_type(s: &str) -> bool {
    VALID_APP_TYPES.contains(&s)
}

/// Best-effort kebab-case slug from a free-text provider name.
///
/// Rules:
/// - lowercase
/// - non-`[a-z0-9-_]` → `-`
/// - collapse runs of `-` and trim leading/trailing `-`
/// - empty result → fallback `"provider"`
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_dash = true; // suppress leading dashes
    for ch in name.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if !last_was_dash {
                out.push('-');
                last_was_dash = true;
            }
        } else {
            out.push(mapped);
            last_was_dash = false;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "provider".to_string()
    } else {
        trimmed
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
// Tests (TDD — CLAUDE.md §2.2 / §5.2)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ----- slug helper -----

    #[test]
    fn slugify_handles_chinese_spaces_and_punctuation() {
        assert_eq!(slugify("GLM-4.6 官方"), "glm-4-6");
        assert_eq!(slugify("DeepSeek V3"), "deepseek-v3");
        assert_eq!(slugify("OpenAI   Codex!"), "openai-codex");
        assert_eq!(slugify("中文名"), "provider"); // all-non-ASCII → fallback
    }

    #[test]
    fn slugify_collapses_dashes_and_trims() {
        assert_eq!(slugify("---foo---bar---"), "foo-bar");
        assert_eq!(slugify("a__b"), "a-b");
    }

    // ----- scheme / version / path validation -----

    #[test]
    fn parse_unknown_scheme_errors() {
        let url = "http://v1/import?resource=provider&name=x&app=claude&endpoint=e&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::InvalidScheme(s) if s == "http"));
    }

    #[test]
    fn parse_unsupported_version_errors() {
        let url = "ccswitch://v2/import?resource=provider&name=x&app=claude&endpoint=e&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::UnsupportedVersion(v) if v == "v2"));
    }

    #[test]
    fn parse_wrong_path_errors() {
        let url = "ccswitch://v1/open?resource=provider&name=x&app=claude&endpoint=e&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::InvalidPath(p) if p == "/open"));
    }

    #[test]
    fn parse_malformed_query_errors() {
        // spaces in URL are not percent-encoded → url::Url::parse will fail
        let url = "ccswitch://v1/import?resource=provider name=x&app=claude";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::InvalidUrl(_)));
    }

    // ----- import happy path -----

    #[test]
    fn parse_import_url_full() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=GLM-4.6&endpoint=https%3A%2F%2Fapi.anthropic.com&apiKey=sk-xxx&model=claude-sonnet-4-6&notes=official";
        let parsed = parse_deeplink_url(url).unwrap();
        assert_eq!(parsed.action, DeeplinkAction::Import);
        let p = parsed.provider.expect("provider should be present");
        assert_eq!(p.name, "GLM-4.6");
        assert_eq!(p.provider_type, "claude");
        assert_eq!(p.api_base, "https://api.anthropic.com");
        assert_eq!(p.api_key, "sk-xxx");
        assert_eq!(p.models, vec!["claude-sonnet-4-6".to_string()]);
        assert_eq!(p.notes.as_deref(), Some("official"));
        // id auto-slugged from name
        assert_eq!(p.id, "glm-4-6");
        assert!(!p.is_active);
    }

    #[test]
    fn parse_import_url_missing_key_errors() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=https%3A%2F%2Fx";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::MissingParam("apiKey")));
    }

    #[test]
    fn parse_import_url_explicit_id_is_used() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=GLM&endpoint=https%3A%2F%2Fx&apiKey=k&id=custom-id_42";
        let parsed = parse_deeplink_url(url).unwrap();
        let p = parsed.provider.unwrap();
        assert_eq!(p.id, "custom-id_42");
    }

    #[test]
    fn parse_import_url_explicit_id_invalid_errors() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=https%3A%2F%2Fx&apiKey=k&id=BAD.ID";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::InvalidId(_)));
    }

    #[test]
    fn parse_import_url_unsupported_resource_errors() {
        // Unknown resource types (not provider / mcp) still error.
        let url = "ccswitch://v1/import?resource=prompt&name=x&app=claude&endpoint=e&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::UnsupportedResource(r) if r == "prompt"));
    }

    #[test]
    fn parse_import_url_invalid_app_errors() {
        let url = "ccswitch://v1/import?resource=provider&name=x&app=mystery&endpoint=e&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::InvalidAppType(a) if a == "mystery"));
    }

    #[test]
    fn parse_import_url_model_csv_splits() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=e&apiKey=k&model=claude-opus-4%2Cclaude-sonnet-4-6";
        let parsed = parse_deeplink_url(url).unwrap();
        let p = parsed.provider.unwrap();
        assert_eq!(
            p.models,
            vec!["claude-opus-4".to_string(), "claude-sonnet-4-6".to_string()]
        );
    }

    #[test]
    fn parse_import_url_empty_endpoint_errors() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::EmptyEndpoint));
    }

    #[test]
    fn parse_import_url_empty_api_key_errors() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=e&apiKey=";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::EmptyApiKey));
    }

    #[test]
    fn parse_import_url_empty_name_errors() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=&endpoint=e&apiKey=k";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::EmptyName));
    }

    #[test]
    fn parse_deeplink_serializes_to_json() {
        let url = "ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=e&apiKey=k";
        let parsed = parse_deeplink_url(url).unwrap();
        let v = serde_json::to_value(&parsed).unwrap();
        assert_eq!(v["action"]["kind"], "import");
        assert_eq!(v["provider"]["id"], "x");
        assert_eq!(v["provider"]["provider_type"], "claude");
        assert_eq!(v["provider"]["api_base"], "e");
        assert_eq!(v["provider"]["api_key"], "k");
    }

    // ----- resource=mcp (M2.5 F6) -----

    #[test]
    fn parse_mcp_stdio_full() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=fs&command=npx&args=-y,@mcp/filesystem&env.ROOT=/tmp;KEY=v";
        let parsed = parse_deeplink_url(url).unwrap();
        assert_eq!(parsed.action, DeeplinkAction::ImportMcp);
        assert!(parsed.provider.is_none());
        let s = parsed.mcp_server.expect("mcp_server should be present");
        assert_eq!(s.name, "fs");
        assert_eq!(s.transport, McpTransport::Stdio);
        assert_eq!(s.command.as_deref(), Some("npx"));
        assert_eq!(s.args, vec!["-y".to_string(), "@mcp/filesystem".to_string()]);
        assert_eq!(s.env.get("ROOT").map(String::as_str), Some("/tmp"));
        assert_eq!(s.env.get("KEY").map(String::as_str), Some("v"));
        assert!(!s.id.is_empty(), "uuid generated");
    }

    #[test]
    fn parse_mcp_http_with_type() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=remote&type=http&url=https%3A%2F%2Fmcp.example%2Fsse";
        let parsed = parse_deeplink_url(url).unwrap();
        assert_eq!(parsed.action, DeeplinkAction::ImportMcp);
        let s = parsed.mcp_server.unwrap();
        assert_eq!(s.transport, McpTransport::Http);
        assert_eq!(s.url.as_deref(), Some("https://mcp.example/sse"));
        assert!(s.command.is_none());
    }

    #[test]
    fn parse_mcp_sse_alias_means_http() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=r&type=sse&url=https%3A%2F%2Fx";
        let parsed = parse_deeplink_url(url).unwrap();
        let s = parsed.mcp_server.unwrap();
        assert_eq!(s.transport, McpTransport::Http);
    }

    #[test]
    fn parse_mcp_stdio_default_when_type_omitted() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=fs&command=npx";
        let parsed = parse_deeplink_url(url).unwrap();
        let s = parsed.mcp_server.unwrap();
        assert_eq!(s.transport, McpTransport::Stdio);
    }

    #[test]
    fn parse_mcp_stdio_missing_command_errors() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=fs";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::EmptyMcpCommand));
    }

    #[test]
    fn parse_mcp_http_missing_url_errors() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=remote&type=http";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::EmptyMcpUrl));
    }

    #[test]
    fn parse_mcp_empty_name_errors() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=&command=npx";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::EmptyName));
    }

    #[test]
    fn parse_mcp_unknown_type_errors() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=r&type=websocket&url=https%3A%2F%2Fx";
        let err = parse_deeplink_url(url).unwrap_err();
        assert!(matches!(err, DeeplinkParseError::InvalidAppType(t) if t == "websocket"));
    }

    #[test]
    fn parse_mcp_serializes_with_action_kind_import_mcp() {
        let url = "ccswitch://v1/import?resource=mcp&app=claude&name=fs&command=npx";
        let parsed = parse_deeplink_url(url).unwrap();
        let v = serde_json::to_value(&parsed).unwrap();
        assert_eq!(v["action"]["kind"], "import_mcp");
        assert!(v["provider"].is_null());
        assert_eq!(v["mcp_server"]["name"], "fs");
        assert_eq!(v["mcp_server"]["transport"]["type"], "stdio");
    }
}
