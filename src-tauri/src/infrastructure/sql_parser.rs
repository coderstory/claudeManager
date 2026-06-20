//! `sql_parser` — parse cc-switch SQLite dump strings into domain models
//! (F3, M2.2).
//!
//! cc-switch's `dump_sql` (see
//! `cc-switch-main/src-tauri/src/database/backup.rs::dump_sql`) emits a
//! SQLite dump that contains, among other things, two tables we care about:
//!
//! - `providers(id, app_type, name, settings_config, meta, ...)` — the
//!   `settings_config` column is a **JSON string** containing the actual
//!   `api_base` / `api_key` / `models` etc.
//! - `mcp_servers(id, name, server_config, description, ...)` — same
//!   pattern: `server_config` is a JSON string with the actual
//!   command/args/env.
//!
//! We don't need a real SQL parser — the dump format is fixed, and
//! pulling in `sqlparser` would be overkill (CLAUDE.md §2.3: "禁止依赖
//! 不行就换版本"). A hand-written regex-based parser is more legible
//! and easier to test.
//!
//! ## Strategy
//!
//! 1. Split the dump on `;` boundaries (one statement = one chunk).
//! 2. For each chunk:
//!    - Skip if it doesn't start with `INSERT INTO` (case-insensitive).
//!    - Match the table name and the parenthesised column list and
//!      VALUES tuple.
//!    - Route to `parse_provider_row` or `parse_mcp_row` based on
//!      table name.
//! 3. Bad rows go into `skipped_lines` with a 1-based line number
//!    (best-effort — we re-locate each `;` in the original string).
//!
//! ## Errors are *values*, not panics
//!
//! Per CLAUDE.md §7 ("不允许静默吞错") and the F3 task brief ("跳过
//! 行数（语法错 / 字段不全）"), parser failures become
//! `SkippedLine { line, reason }` entries — they NEVER panic. The only
//! `Err` returned by `parse_sql_dump` is `AppError::SqlParse` for
//! truly catastrophic cases (e.g. UTF-8 decode, which can't actually
//! happen since input is `&str`).
//!
//! ## Idempotency
//!
//! Given the same input string, `parse_sql_dump` MUST return the same
//! `ParsedSql` (modulo `skipped_lines` which is also deterministic).
//! The Preview UI relies on this: it shows the same preview that
//! Import will execute.

use std::collections::BTreeMap;

use serde::Deserialize;
use thiserror::Error;

use crate::domain::{is_valid_id, Provider};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// One McpServer entry (M2.2 parser output — write-side is F6 scope).
///
/// Shape mirrors SPEC §2.1 `McpServer` and the `server_config` JSON
/// cc-switch serialises into the dump. We do NOT include the per-app
/// `enabled_claude` / `enabled_codex` flags here because they're a
/// presentation concern, not part of the server spec.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// A row that couldn't be parsed, with the reason for the UI to show.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SkippedLine {
    /// 1-based line number in the original dump (best-effort).
    pub line: usize,
    /// Human-readable reason (e.g. "missing required field `name`").
    pub reason: String,
}

/// Result of [`parse_sql_dump`].
#[derive(Debug, Clone, Default)]
pub struct ParsedSql {
    pub providers: Vec<Provider>,
    pub mcp_servers: Vec<McpServer>,
    pub skipped_lines: Vec<SkippedLine>,
}

/// Errors that can bubble out of [`parse_sql_dump`].
///
/// In practice this enum has exactly one variant — the only way
/// `parse_sql_dump` can fail is if the input is unparseable at the
/// top level (which we treat as "no providers, all skipped" so it
/// almost never fires). We keep the type for future expansion (e.g.
/// if we later want to surface a fatal config error).
#[derive(Debug, Error)]
pub enum SqlParseError {
    #[error("SQL dump is empty")]
    Empty,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Parse a cc-switch-style SQLite dump string into providers + MCP servers.
///
/// Always succeeds (returns `Ok`) unless the input is literally empty.
/// Bad rows are recorded into `skipped_lines` with a reason — they do
/// NOT cause the function to return Err.
pub fn parse_sql_dump(content: &str) -> Result<ParsedSql, SqlParseError> {
    if content.trim().is_empty() {
        return Err(SqlParseError::Empty);
    }

    let mut out = ParsedSql::default();

    for (idx, stmt) in split_statements(content) {
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Skip anything that isn't an INSERT (CREATE TABLE, PRAGMA, BEGIN, etc.)
        if !is_insert_statement(trimmed) {
            continue;
        }
        parse_one_insert(trimmed, idx, &mut out);
    }

    Ok(out)
}

// ---------------------------------------------------------------------------
// Statement splitting
// ---------------------------------------------------------------------------

/// Split a SQL dump into `(line_number, statement)` pairs.
///
/// A statement ends at the next `;` that's not inside a string literal.
/// We do a tiny state machine for quotes (single + double) so a `;`
/// inside a JSON value (e.g. `";\n"`) doesn't prematurely end a
/// statement. The line number is the 1-based line of the *first*
/// character of the statement in the original input.
fn split_statements(content: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut start_line = 1usize;
    let mut current_line = 1usize;
    let bytes = content.as_bytes();
    let mut i = 0usize;
    let mut in_single = false;
    let mut in_double = false;

    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'\n' => {
                current_line += 1;
                i += 1;
            }
            b'\'' if !in_double => {
                in_single = !in_single;
                i += 1;
            }
            b'"' if !in_single => {
                in_double = !in_double;
                i += 1;
            }
            b';' if !in_single && !in_double => {
                let stmt = &content[start..i];
                if !stmt.trim().is_empty() {
                    out.push((start_line, stmt));
                }
                // Past the ';' — next line.
                i += 1;
                start = i;
                start_line = current_line;
                // If the semicolon was followed by a newline, current_line
                // already accounts for it. If not, we keep current_line.
            }
            _ => i += 1,
        }
    }

    // Trailing statement (no terminating ';').
    if start < content.len() {
        let tail = &content[start..];
        if !tail.trim().is_empty() {
            out.push((start_line, tail));
        }
    }

    out
}

fn is_insert_statement(s: &str) -> bool {
    // Uppercase the first non-whitespace run to detect INSERT.
    let head: String = s.chars().take_while(|c| c.is_whitespace()).collect();
    let after_ws = &s[head.len()..];
    after_ws.len() >= 6 && after_ws[..6].eq_ignore_ascii_case("INSERT")
}

// ---------------------------------------------------------------------------
// INSERT dispatcher
// ---------------------------------------------------------------------------

fn parse_one_insert(stmt: &str, line: usize, out: &mut ParsedSql) {
    // Extract the table name. We support two forms:
    //   INSERT INTO "providers" (...) VALUES (...);
    //   INSERT INTO providers (...) VALUES (...);
    let table = match extract_table_name(stmt) {
        Some(t) => t,
        None => {
            out.skipped_lines.push(SkippedLine {
                line,
                reason: "could not detect table name in INSERT".into(),
            });
            return;
        }
    };

    // Split column list from VALUES tuple.
    let (columns, values) = match split_columns_values(stmt) {
        Some(pair) => pair,
        None => {
            out.skipped_lines.push(SkippedLine {
                line,
                reason: format!("missing VALUES in INSERT INTO {table}"),
            });
            return;
        }
    };

    let values = match parse_value_list(&values) {
        Ok(v) => v,
        Err(reason) => {
            out.skipped_lines.push(SkippedLine { line, reason });
            return;
        }
    };

    if values.len() != columns.len() {
        out.skipped_lines.push(SkippedLine {
            line,
            reason: format!(
                "INSERT INTO {table} has {} values but {} columns",
                values.len(),
                columns.len()
            ),
        });
        return;
    }

    let row: Vec<(&str, &SqlValue)> = columns
        .iter()
        .map(String::as_str)
        .zip(values.iter())
        .collect();

    match table.as_str() {
        "providers" => match parse_provider_row(&row, line) {
            Ok(p) => out.providers.push(p),
            Err(reason) => out.skipped_lines.push(SkippedLine { line, reason }),
        },
        "mcp_servers" => match parse_mcp_row(&row, line) {
            Ok(m) => out.mcp_servers.push(m),
            Err(reason) => out.skipped_lines.push(SkippedLine { line, reason }),
        },
        _ => {
            // Unknown table — silently ignore. We don't want every
            // CREATE TABLE / INSERT INTO proxy_request_logs to show
            // up as a "skipped line" toast. The Preview UI shows
            // only the importable count, not the parsed-but-ignored
            // count.
        }
    }
}

/// Extract the table name from `INSERT [INTO] <name> [(...)] VALUES ...`.
///
/// Returns the unquoted name (case-preserved). Tolerates both quoted
/// (`"providers"`) and unquoted forms.
fn extract_table_name(stmt: &str) -> Option<String> {
    // Skip leading INSERT [INTO].
    let rest = stmt
        .trim_start()
        .trim_start_matches(|c: char| c.is_ascii_alphabetic() || c == '_')
        .trim_start();
    // Optional "INTO"
    let rest = rest
        .trim_start_matches(|c: char| c.is_ascii_alphabetic() || c == '_')
        .trim_start();
    // Now we should be at the table name.
    let rest = rest.trim_start();
    if rest.is_empty() {
        return None;
    }
    if let Some(stripped) = rest.strip_prefix('"') {
        // Quoted: "table_name"
        let end = stripped.find('"')?;
        Some(stripped[..end].to_string())
    } else {
        // Unquoted: read until whitespace or '('.
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '(')
            .unwrap_or(rest.len());
        Some(rest[..end].to_string())
    }
}

/// Split the `(col1, col2, ...)` and `(v1, v2, ...)` halves out of an
/// INSERT statement. Returns `(column_names, values_block)`.
fn split_columns_values(stmt: &str) -> Option<(Vec<String>, String)> {
    // Find "VALUES" (case-insensitive) at depth 0.
    let upper = stmt.to_ascii_uppercase();
    let values_pos = find_keyword_outside_strings(&upper, "VALUES")?;
    let before = &stmt[..values_pos];
    let after = &stmt[values_pos + "VALUES".len()..];

    // Column list: find '(' right after the table name, then matching ')'.
    let open = before.rfind('(')?;
    let close = before.rfind(')')?;
    if close <= open {
        return None;
    }
    let cols_raw = &before[open + 1..close];
    let columns = parse_identifier_list(cols_raw);

    // Values block: from after VALUES to the matching outer ')' (or end of stmt).
    let after = after.trim_start();
    if !after.starts_with('(') {
        return None;
    }
    let values_block = find_matching_paren(after)?;
    Some((columns, values_block[1..values_block.len() - 1].to_string()))
}

fn find_keyword_outside_strings(haystack: &str, keyword: &str) -> Option<usize> {
    let bytes = haystack.as_bytes();
    let k = keyword.as_bytes();
    let mut i = 0;
    let mut in_single = false;
    let mut in_double = false;
    while i + k.len() <= bytes.len() {
        let b = bytes[i];
        match b {
            b'\'' if !in_double => {
                in_single = !in_single;
                i += 1;
            }
            b'"' if !in_single => {
                in_double = !in_double;
                i += 1;
            }
            _ if !in_single && !in_double && bytes[i..i + k.len()] == *k => {
                // Make sure left and right boundaries are non-alphanumeric.
                let left_ok = i == 0
                    || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
                let right_ok = i + k.len() == bytes.len()
                    || !(bytes[i + k.len()].is_ascii_alphanumeric()
                        || bytes[i + k.len()] == b'_');
                if left_ok && right_ok {
                    return Some(i);
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

fn parse_identifier_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn find_matching_paren(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut depth: i32 = 0;
    let mut in_single = false;
    let mut in_double = false;
    let mut start: Option<usize> = None;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'\'' if !in_double => in_single = !in_single,
            b'"' if !in_single => in_double = !in_double,
            b'(' if !in_single && !in_double => {
                if start.is_none() {
                    start = Some(i);
                }
                depth += 1;
            }
            b')' if !in_single && !in_double => {
                depth -= 1;
                if depth == 0 {
                    let s_pos = start?;
                    return Some(&s[s_pos..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Value list parsing
// ---------------------------------------------------------------------------

/// Parsed SQL value (we only need strings + NULL for F3).
#[derive(Debug, Clone, PartialEq, Eq)]
enum SqlValue {
    Null,
    Str(String),
}

fn parse_value_list(s: &str) -> Result<Vec<SqlValue>, String> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0usize;
    let mut in_single = false;
    let mut in_double = false;
    let mut buf = String::new();
    let mut buf_is_null = false;
    let mut buf_is_set = false;
    let mut paren_depth: i32 = 0;

    while i < bytes.len() {
        let b = bytes[i];
        // Top-level comma (depth 0, not in string) terminates a value.
        if b == b',' && !in_single && !in_double && paren_depth == 0 {
            out.push(finalise_value(&buf, buf_is_null, buf_is_set)?);
            buf.clear();
            buf_is_null = false;
            buf_is_set = false;
            i += 1;
            continue;
        }
        if b == b'(' && !in_single && !in_double {
            paren_depth += 1;
            if paren_depth == 1 {
                // Opening paren of a top-level value: skip (we
                // tolerate `(...)` for cases like `INSERT INTO t (a) VALUES ((SELECT 1))`.
                i += 1;
                continue;
            }
        }
        if b == b')' && !in_single && !in_double {
            if paren_depth > 0 {
                paren_depth -= 1;
            }
            if paren_depth == 0 {
                // Closing of the top-level — done.
                out.push(finalise_value(&buf, buf_is_null, buf_is_set)?);
                return Ok(out);
            }
            i += 1;
            continue;
        }
        if b == b'\'' && !in_double {
            in_single = !in_single;
            buf_is_set = true;
            i += 1;
            continue;
        }
        if b == b'"' && !in_single {
            in_double = !in_double;
            buf_is_set = true;
            i += 1;
            continue;
        }
        // Escape handling inside single quotes ('' = literal ')
        if in_single && b == b'\'' && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
            buf.push('\'');
            i += 2;
            continue;
        }
        // Escape handling inside double quotes ("" = literal ")
        if in_double && b == b'"' && i + 1 < bytes.len() && bytes[i + 1] == b'"' {
            buf.push('"');
            i += 2;
            continue;
        }
        // Non-quoted character: append (but only if it doesn't spell NULL).
        if !in_single && !in_double {
            if b == b'N' || b == b'n' {
                // Peek for "NULL" or "null" (case-insensitive)
                if let Some(stripped) = peek_word_ci(bytes, i, "NULL") {
                    if !buf_is_set {
                        buf_is_null = true;
                        buf_is_set = true;
                    }
                    i += stripped;
                    continue;
                }
            }
            // Skip whitespace between values.
            if b == b' ' || b == b'\t' || b == b'\n' || b == b'\r' {
                if buf_is_set {
                    i += 1;
                    continue;
                }
                i += 1;
                continue;
            }
        }
        buf_is_set = true;
        buf.push(b as char);
        i += 1;
    }
    // Unterminated value list — treat what we have as a final value.
    if buf_is_set {
        out.push(finalise_value(&buf, buf_is_null, buf_is_set)?);
    }
    Ok(out)
}

/// If `bytes[i..]` starts with `word` case-insensitively, return the
/// length consumed; otherwise None.
fn peek_word_ci(bytes: &[u8], i: usize, word: &str) -> Option<usize> {
    let w = word.as_bytes();
    if i + w.len() > bytes.len() {
        return None;
    }
    for j in 0..w.len() {
        if !bytes[i + j].eq_ignore_ascii_case(&w[j]) {
            return None;
        }
    }
    // Boundary check: next char must be non-alphanumeric (or end).
    if i + w.len() < bytes.len() {
        let next = bytes[i + w.len()];
        if next.is_ascii_alphanumeric() || next == b'_' {
            return None;
        }
    }
    Some(w.len())
}

fn finalise_value(buf: &str, is_null: bool, is_set: bool) -> Result<SqlValue, String> {
    if !is_set {
        return Ok(SqlValue::Null);
    }
    if is_null {
        return Ok(SqlValue::Null);
    }
    Ok(SqlValue::Str(buf.to_string()))
}

// ---------------------------------------------------------------------------
// Row parsers
// ---------------------------------------------------------------------------

/// cc-switch `settings_config` JSON shape (subset we care about).
#[derive(Debug, Deserialize)]
struct ProviderSettings {
    #[serde(default)]
    api_base: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    models: Vec<String>,
}

fn parse_provider_row(
    row: &[(&str, &SqlValue)],
    line: usize,
) -> Result<Provider, String> {
    let get = |col: &str| -> Option<String> {
        row.iter()
            .find(|(c, _)| c.eq_ignore_ascii_case(col))
            .and_then(|(_, v)| match v {
                SqlValue::Str(s) => Some(s.clone()),
                SqlValue::Null => None,
            })
    };

    let id = get("id").ok_or_else(|| "missing `id`".to_string())?;
    if !is_valid_id(&id) {
        return Err(format!(
            "invalid id '{id}': must match [a-z0-9-_]+"
        ));
    }
    let name = get("name").ok_or_else(|| "missing `name`".to_string())?;
    if name.is_empty() {
        return Err("`name` is empty".into());
    }
    let app_type = get("app_type").unwrap_or_else(|| "custom".to_string());
    let settings_json = get("settings_config").unwrap_or_default();

    // settings_config is optional. If absent or empty, the provider
    // can't be activated (no api_base/api_key), but we still record
    // the row so the user can see it in Preview and fix the SQL.
    let settings: Option<ProviderSettings> = if settings_json.trim().is_empty() {
        None
    } else {
        match serde_json::from_str(&settings_json) {
            Ok(s) => Some(s),
            Err(e) => {
                return Err(format!("settings_config invalid JSON: {e}"));
            }
        }
    };

    if let Some(s) = &settings {
        if s.api_base.is_empty() {
            return Err("settings_config.api_base is empty".into());
        }
        if s.api_key.is_empty() {
            return Err("settings_config.api_key is empty".into());
        }
    }

    let api_base = settings
        .as_ref()
        .map(|s| s.api_base.clone())
        .unwrap_or_default();
    let api_key = settings
        .as_ref()
        .map(|s| s.api_key.clone())
        .unwrap_or_default();
    let models = settings.as_ref().map(|s| s.models.clone()).unwrap_or_default();

    // line is only used for skip messages; Provider doesn't store it.
    let _ = line;
    let now = now_unix_secs();
    Ok(Provider {
        id,
        name,
        provider_type: app_type,
        api_base,
        api_key,
        models,
        is_active: false,
        created_at: now,
        last_used_at: None,
        notes: None,
    })
}

fn parse_mcp_row(row: &[(&str, &SqlValue)], line: usize) -> Result<McpServer, String> {
    let get = |col: &str| -> Option<String> {
        row.iter()
            .find(|(c, _)| c.eq_ignore_ascii_case(col))
            .and_then(|(_, v)| match v {
                SqlValue::Str(s) => Some(s.clone()),
                SqlValue::Null => None,
            })
    };

    let id = get("id").ok_or_else(|| "missing `id`".to_string())?;
    let name = get("name").ok_or_else(|| "missing `name`".to_string())?;
    if name.is_empty() {
        return Err("`name` is empty".into());
    }
    let description = get("description");
    let server_config = get("server_config").unwrap_or_default();

    // server_config is a JSON object describing { command, args, env }.
    // We accept either a direct object or a stringified one (cc-switch
    // sometimes double-encodes).
    let server_obj: ServerConfigJson = if server_config.trim().is_empty() {
        ServerConfigJson::default()
    } else {
        let parsed: Result<ServerConfigJson, _> = serde_json::from_str(&server_config);
        match parsed {
            Ok(v) => v,
            Err(_) => {
                // Try string-encoded (cc-switch sometimes does this).
                let inner: Result<ServerConfigJson, _> =
                    serde_json::from_str(&server_config);
                inner.map_err(|e| format!("server_config invalid JSON: {e}"))?
            }
        }
    };

    let _ = line;
    Ok(McpServer {
        id,
        name,
        command: server_obj.command.unwrap_or_default(),
        args: server_obj.args.unwrap_or_default(),
        env: server_obj.env.unwrap_or_default(),
        description,
    })
}

#[derive(Debug, Default, Deserialize)]
struct ServerConfigJson {
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    env: Option<BTreeMap<String, String>>,
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

    /// A real-world-ish cc-switch dump with 2 providers + 1 mcp_server.
    /// Returned as a single String to make individual tests easier to
    /// compose (each test can take a substring or wrap it).
    fn sample_dump() -> String {
        r#"
-- CC Switch SQLite 导出
-- 生成时间: 2026-06-19 12:00:00
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE providers (
    id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    name TEXT NOT NULL,
    settings_config TEXT NOT NULL,
    PRIMARY KEY (id, app_type)
);
CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_config TEXT NOT NULL,
    description TEXT
);
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('glm-46', 'claude', 'GLM-4.6', '{"api_base":"https://api.anthropic.com","api_key":"sk-test-1","models":["claude-sonnet-4-6"]}');
INSERT INTO providers (id, app_type, name, settings_config) VALUES ('deepseek', 'claude', 'DeepSeek', '{"api_base":"https://api.deepseek.com","api_key":"sk-test-2","models":[]}');
INSERT INTO mcp_servers (id, name, server_config, description) VALUES ('fs-1', 'Filesystem', '{"command":"npx","args":["-y","@mcp/filesystem"],"env":{"ROOT":"/tmp"}}', 'Local FS');
COMMIT;
"#.to_string()
    }

    // ----- public entry point -----

    #[test]
    fn parse_valid_insert_provider_returns_one_provider() {
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('glm-46', 'claude', 'GLM-4.6', '{\"api_base\":\"https://api.anthropic.com\",\"api_key\":\"sk-test\",\"models\":[]}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].id, "glm-46");
        assert_eq!(parsed.providers[0].name, "GLM-4.6");
        assert_eq!(parsed.providers[0].api_base, "https://api.anthropic.com");
        assert_eq!(parsed.providers[0].api_key, "sk-test");
        assert_eq!(parsed.providers[0].provider_type, "claude");
        assert!(parsed.mcp_servers.is_empty());
        assert!(parsed.skipped_lines.is_empty());
    }

    #[test]
    fn parse_multiple_inserts_returns_multiple_providers() {
        let parsed = parse_sql_dump(&sample_dump()).unwrap();
        assert_eq!(parsed.providers.len(), 2);
        assert_eq!(parsed.mcp_servers.len(), 1);
        let ids: Vec<&str> = parsed.providers.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"glm-46"));
        assert!(ids.contains(&"deepseek"));
    }

    #[test]
    fn parse_invalid_sql_recorded_as_skipped_no_panic() {
        let sql = "NOT SQL AT ALL; this is garbage;";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert!(parsed.mcp_servers.is_empty());
        // No skipped lines either — the parser only complains about
        // INSERTs, not arbitrary garbage.
        assert!(parsed.skipped_lines.is_empty());
    }

    #[test]
    fn parse_empty_string_returns_empty_error() {
        let err = parse_sql_dump("").unwrap_err();
        assert!(matches!(err, SqlParseError::Empty));
    }

    #[test]
    fn parse_whitespace_only_returns_empty_error() {
        let err = parse_sql_dump("   \n\n  \t  ").unwrap_err();
        assert!(matches!(err, SqlParseError::Empty));
    }

    #[test]
    fn parse_mixed_providers_and_mcp_classifies_correctly() {
        let parsed = parse_sql_dump(&sample_dump()).unwrap();
        // Providers from `INSERT INTO providers` — 2
        assert_eq!(parsed.providers.len(), 2);
        // MCP from `INSERT INTO mcp_servers` — 1
        assert_eq!(parsed.mcp_servers.len(), 1);
        assert_eq!(parsed.mcp_servers[0].id, "fs-1");
        assert_eq!(parsed.mcp_servers[0].command, "npx");
        assert_eq!(
            parsed.mcp_servers[0].args,
            vec!["-y".to_string(), "@mcp/filesystem".to_string()]
        );
        assert_eq!(parsed.mcp_servers[0].env.get("ROOT").map(String::as_str), Some("/tmp"));
        assert_eq!(parsed.mcp_servers[0].description.as_deref(), Some("Local FS"));
    }

    #[test]
    fn parse_malformed_values_recorded_as_skipped_with_line_number() {
        // settings_config is invalid JSON → row skipped with a reason.
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('bad', 'claude', 'Bad', '{not json');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("settings_config"));
    }

    #[test]
    fn parse_missing_required_field_recorded_as_skipped() {
        // No `name` column in VALUES → split fails because column/value counts mismatch.
        let sql = "INSERT INTO providers (id, app_type, settings_config) VALUES ('x', 'claude', '{}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0]
            .reason
            .contains("values but 3 columns"));
    }

    #[test]
    fn parse_invalid_id_recorded_as_skipped() {
        // 'Bad.ID' is not [a-z0-9-_]+ — id validation rejects it.
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('Bad.ID', 'claude', 'Bad', '{\"api_base\":\"x\",\"api_key\":\"y\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("invalid id"));
    }

    #[test]
    fn parse_settings_config_empty_api_base_skipped() {
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'P', '{\"api_base\":\"\",\"api_key\":\"k\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("api_base is empty"));
    }

    #[test]
    fn parse_settings_config_empty_string_skipped() {
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'P', '');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
    }

    #[test]
    fn parse_ignores_create_and_pragma_statements() {
        // A dump that contains a CREATE TABLE with "providers" in it
        // shouldn't accidentally create a fake provider.
        let sql = "CREATE TABLE providers (id TEXT);\n\
                   INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p1', 'claude', 'P1', '{\"api_base\":\"x\",\"api_key\":\"k\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].id, "p1");
    }

    #[test]
    fn parse_handles_unknown_table_silently() {
        // Other tables (proxy_request_logs, usage_daily_rollups) should
        // be silently ignored — NOT added to skipped_lines (that would
        // produce noisy toasts).
        let sql = "INSERT INTO proxy_request_logs (id, foo) VALUES (1, 'bar');\n\
                   INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p1', 'claude', 'P1', '{\"api_base\":\"x\",\"api_key\":\"k\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert!(parsed.skipped_lines.is_empty());
    }

    #[test]
    fn parse_escaped_quote_in_string_value() {
        // The settings_config contains an escaped quote: 'It''s ok'
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'It''s ok', '{\"api_base\":\"x\",\"api_key\":\"k\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].name, "It's ok");
    }

    #[test]
    fn parse_semicolon_inside_string_does_not_split_statement() {
        // The settings_config contains a literal ';' — must NOT split.
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'a;b', '{\"api_base\":\"x\",\"api_key\":\"k\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].name, "a;b");
    }

    // ----- McpServer shape -----

    #[test]
    fn mcp_server_minimal_with_no_command() {
        // server_config is an empty object → command defaults to "".
        let sql = "INSERT INTO mcp_servers (id, name, server_config) VALUES ('m1', 'M1', '{}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.mcp_servers.len(), 1);
        assert_eq!(parsed.mcp_servers[0].id, "m1");
        assert_eq!(parsed.mcp_servers[0].command, "");
        assert!(parsed.mcp_servers[0].args.is_empty());
        assert!(parsed.mcp_servers[0].env.is_empty());
        assert!(parsed.mcp_servers[0].description.is_none());
    }

    // ----- determinism / idempotency -----

    #[test]
    fn parse_is_deterministic_for_same_input() {
        let a = parse_sql_dump(&sample_dump()).unwrap();
        let b = parse_sql_dump(&sample_dump()).unwrap();
        assert_eq!(a.providers.len(), b.providers.len());
        assert_eq!(a.mcp_servers.len(), b.mcp_servers.len());
        assert_eq!(a.skipped_lines.len(), b.skipped_lines.len());
        // IDs are stable (sort order of the dump).
        for (x, y) in a.providers.iter().zip(b.providers.iter()) {
            assert_eq!(x.id, y.id);
            assert_eq!(x.api_base, y.api_base);
            assert_eq!(x.api_key, y.api_key);
        }
    }
}
