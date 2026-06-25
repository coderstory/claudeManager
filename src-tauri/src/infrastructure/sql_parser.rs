//! `sql_parser` — parse cc-switch SQLite dump strings into domain models
//! (F3, M2.2).
//!
//! cc-switch's `dump_sql` (see
//! `cc-switch-main/src-tauri/src/database/backup.rs::dump_sql`) emits a
//! SQLite dump that contains, among other things, two tables we care about:
//!
//! - `providers(id, app_type, name, settings_config, ...)` — the
//!   `settings_config` column is a **JSON string**. Its shape depends on
//!   `app_type`:
//!   - `claude` / `claude-desktop`: `{ "env": { "ANTHROPIC_BASE_URL",
//!     "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL" }, "model": "...", ... }`.
//!     api 信息在 `env.ANTHROPIC_*`。
//!   - `codex` / `gemini` / `opencode`: 结构各异，parser 保留 raw，不强解析。
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
//!    - Match the table name and the parenthesised column list (if
//!      present) or fall back to the table's known column order (cc-switch
//!      `.dump` uses position-based `INSERT INTO t VALUES (...)` without
//!      a column list) and VALUES tuple.
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

use crate::domain::{is_valid_id, Provider, ProviderModels};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// One MCP server entry as it appears in a cc-switch SQLite dump
/// (M2.2 parser output — write-side is F6 scope and lives in
/// `domain::mcp_server::McpServer`).
///
/// We keep this type distinct from `domain::mcp_server::McpServer`
/// because the *parser* shape is a flat string-only projection of
/// the dump's `server_config` JSON, while the *F6* shape is the
/// editable struct with `transport` / `enabled` / `created_at`. The
/// F3 preview uses this struct; F6 builds a fresh domain::McpServer
/// from it on user-confirmed import.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ParsedMcpServer {
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
    /// Provider / MCP name if extractable from the row (best-effort).
    /// M5 bug #8: UI shows "name (line N)" instead of just "line N" so users
    /// can identify which provider failed at a glance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Human-readable reason (e.g. "missing required field `name`").
    pub reason: String,
}

/// Result of [`parse_sql_dump`].
#[derive(Debug, Clone, Default)]
pub struct ParsedSql {
    pub providers: Vec<Provider>,
    pub mcp_servers: Vec<ParsedMcpServer>,
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
                name: None,
                reason: "could not detect table name in INSERT".into(),
            });
            return;
        }
    };

    // 拆分列名与 VALUES 元组。支持两种形式：
    //   INSERT INTO "t" (col1, col2) VALUES (...)   —— 显式列名
    //   INSERT INTO t VALUES (...)                  —— 无列名（cc-switch .dump 标准格式）
    let (columns, values_block, explicit) = match split_columns_values(stmt, &table) {
        Some(triple) => triple,
        None => {
            out.skipped_lines.push(SkippedLine {
                line,
                name: None,
                reason: format!("missing VALUES in INSERT INTO {table}"),
            });
            return;
        }
    };

    let values = match parse_value_list(&values_block) {
        Ok(v) => v,
        Err(reason) => {
            out.skipped_lines.push(SkippedLine { line, name: None, reason });
            return;
        }
    };

    // 显式列名：values 必须与 columns 精确匹配。
    // 无列名：cc-switch 后续版本可能加列，容忍 values 多于已知列
    // （按位置 zip 截断，多余列忽略）；但 values 少于已知列说明 schema
    // 漂移过大或 dump 截断，跳过该行。
    if explicit && values.len() != columns.len() {
        out.skipped_lines.push(SkippedLine {
            line,
            name: None,
            reason: format!(
                "INSERT INTO {table} has {} values but {} columns",
                values.len(),
                columns.len()
            ),
        });
        return;
    }
    if !explicit && values.len() < columns.len() {
        out.skipped_lines.push(SkippedLine {
            line,
            name: None,
            reason: format!(
                "INSERT INTO {table} VALUES has {} values but table defines {} columns",
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
        "providers" => match parse_provider_row(&row) {
            Ok(p) => out.providers.push(p),
            Err(reason) => {
                let name = extract_row_name(&row);
                out.skipped_lines.push(SkippedLine { line, name, reason });
            }
        },
        "mcp_servers" => match parse_mcp_row(&row) {
            Ok(m) => out.mcp_servers.push(m),
            Err(reason) => {
                let name = extract_row_name(&row);
                out.skipped_lines.push(SkippedLine { line, name, reason });
            }
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

/// 拆分 `(col1, col2, ...)` 和 `(v1, v2, ...)` 两部分。返回
/// `(column_names, values_block, explicit)`：
/// - `explicit = true`：语句带显式列名（`INSERT INTO t (a, b) VALUES (...)`）
/// - `explicit = false`：无列名（`INSERT INTO t VALUES (...)`），此时
///   `column_names` 来自 [`known_table_columns`] 按位置预定义的顺序。
///
/// cc-switch 的 `.dump`（`backup.rs::dump_sql`）默认使用无列名形式，
/// 所以无列名支持是导入真实 dump 的硬性要求。
fn split_columns_values(stmt: &str, table: &str) -> Option<(Vec<String>, String, bool)> {
    // 找 "VALUES"（大小写不敏感，且不在字符串内）。
    let upper = stmt.to_ascii_uppercase();
    let values_pos = find_keyword_outside_strings(&upper, "VALUES")?;
    let before = &stmt[..values_pos];
    let after = &stmt[values_pos + "VALUES".len()..];

    // 显式列名：table 与 VALUES 之间有 `(...)`。
    if let Some(close) = before.rfind(')') {
        if let Some(open) = before.rfind('(') {
            if close > open {
                let cols_raw = &before[open + 1..close];
                let columns = parse_identifier_list(cols_raw);
                if !columns.is_empty() {
                    // VALUES 元组：从 after 的首个 '(' 到匹配的 ')'。
                    let after_trim = after.trim_start();
                    if !after_trim.starts_with('(') {
                        return None;
                    }
                    let values_block = find_matching_paren(after_trim)?;
                    return Some((
                        columns,
                        values_block[1..values_block.len() - 1].to_string(),
                        true,
                    ));
                }
            }
        }
    }

    // 无列名：直接 `INSERT INTO t VALUES (...)`。
    // 按位置套用预定义列顺序。未知表返回 None（无法定位字段）。
    let columns = known_table_columns(table)?;
    let after_trim = after.trim_start();
    if !after_trim.starts_with('(') {
        return None;
    }
    let values_block = find_matching_paren(after_trim)?;
    Some((
        columns,
        values_block[1..values_block.len() - 1].to_string(),
        false,
    ))
}

/// 已知表的标准列顺序（按 cc-switch `backup.rs::dump_sql` 的 schema）。
/// 无列名 INSERT 时按位置匹配这些名字。新增列一律追加到末尾，以保证
/// 旧 dump 仍按位置正确匹配前 N 列。
fn known_table_columns(table: &str) -> Option<Vec<String>> {
    let cols: &[&str] = match table {
        "providers" => &[
            "id",
            "app_type",
            "name",
            "settings_config",
            "website_url",
            "category",
            "created_at",
            "sort_index",
            "notes",
            "icon",
            "icon_color",
            "meta",
            "is_current",
            "in_failover_queue",
            "cost_multiplier",
            "limit_daily_usd",
            "limit_monthly_usd",
            "provider_type",
        ],
        "mcp_servers" => &[
            "id",
            "name",
            "server_config",
            "description",
            "homepage",
            "docs",
            "tags",
            "enabled_claude",
            "enabled_codex",
            "enabled_gemini",
            "enabled_opencode",
            "enabled_hermes",
        ],
        _ => return None,
    };
    Some(cols.iter().map(|s| s.to_string()).collect())
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
        // M3.13 — UTF-8 多字节字符解码:
        // 进入字符串字面量后,如果遇到 high bit 置位的字节(0x80+),
        // 不能按 byte 单独 push(`b as char` 会把每个字节当成 Latin-1
        // code point,导致 "中文" 0xE4 0xB8 0xAD 变成 U+00E4 U+00B8
        // U+00AD 三个 mojibake 字符)。需要按 UTF-8 字符边界消费完整
        // multi-byte sequence。
        //
        // 此分支必须在所有 ASCII 分支之后、fallback 之前,且要求当前
        // 处于字符串内(in_single || in_double),因为 SQL 关键字 /
        // NULL / whitespace 都是 ASCII,不会走到这里。
        if (in_single || in_double) && b >= 0x80 {
            // 找到下一个 UTF-8 字符边界;`from_utf8` 返回首个完整 char
            // 及其字节长度。`s` 已经是合法 &str(从 Rust 端传入),所以
            // 这里总是能解码成功,无需处理 InvalidSequence 错误。
            match std::str::from_utf8(&bytes[i..]) {
                Ok(rest) => {
                    let ch = rest.chars().next().expect("non-empty bytes => one char");
                    buf_is_set = true;
                    buf.push(ch);
                    i += ch.len_utf8();
                    continue;
                }
                Err(_) => {
                    // 理论不可达:调用方传 &str,字节一定是合法 UTF-8。
                    // 防御性 fallback:按字节 push(老行为,避免无限循环)。
                    buf_is_set = true;
                    buf.push(b as char);
                    i += 1;
                    continue;
                }
            }
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

/// cc-switch `settings_config` JSON 形态（按 `app_type` 分派）。
///
/// cc-switch 的 `settings_config` 不是统一的 `api_base/api_key/models`
/// 扁平结构，而是 Claude Code settings.json 的完整树，按 `app_type`
/// 分 4 种形态：
/// - `claude` / `claude-desktop`：`{ "env": { "ANTHROPIC_BASE_URL",
///   "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL" }, "model": "...", ... }`
///   api 信息在 `env.ANTHROPIC_*`。
/// - `codex`：`{ "auth": {}, "config": "" }`（结构空，无 api_base）。
/// - `gemini`：`{ "env": {}, "config": {} }`（同上）。
/// - `opencode`：`{ "npm": "...", "options": { "baseURL", "apiKey" },
///   "models": {...} }`。
///
/// 因此 parser 不强求统一结构——保留原始 JSON 透传，仅对 claude 系
/// 提取 `env.ANTHROPIC_*` 到 Provider 的 `api_base` / `api_key` /
/// `models` 字段；其余 `app_type` 保留 raw，不强解析（结构差异大，
/// 强解析易脆）。这样真实 dump 喂进来不再全行命中
/// `api_base is empty` 被 skip。
#[derive(Debug, Deserialize)]
struct ProviderSettings {
    /// claude 系：`settings_config.env`，承载 `ANTHROPIC_*`。
    #[serde(default)]
    env: Option<BTreeMap<String, String>>,
    /// claude 系：顶层 `model`（回退来源，优先级低于 env.ANTHROPIC_MODEL）。
    #[serde(default)]
    model: Option<String>,
}

impl ProviderSettings {
    /// 从 claude 系 settings_config 提取 base_url。
    fn anthropic_base_url(&self) -> Option<&str> {
        self.env
            .as_ref()
            .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
            .map(String::as_str)
            .filter(|s| !s.is_empty())
    }

    /// 从 claude 系 settings_config 提取 auth token（脱敏由调用方决定）。
    fn anthropic_auth_token(&self) -> Option<&str> {
        self.env
            .as_ref()
            .and_then(|e| e.get("ANTHROPIC_AUTH_TOKEN"))
            .map(String::as_str)
            .filter(|s| !s.is_empty())
    }

    /// 从 claude 系 settings_config 提取 model（env.ANTHROPIC_MODEL 优先，
    /// 回退顶层 model）。
    fn anthropic_model(&self) -> Option<String> {
        let from_env = self
            .env
            .as_ref()
            .and_then(|e| e.get("ANTHROPIC_MODEL"))
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        from_env.or_else(|| self.model.clone().filter(|s| !s.is_empty()))
    }
}

/// 判断 `app_type` 是否属于 claude 系（共享 `env.ANTHROPIC_*` 结构）。
fn is_claude_family(app_type: &str) -> bool {
    matches!(app_type, "claude" | "claude-desktop")
}

fn parse_provider_row(
    row: &[(&str, &SqlValue)],
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

    // settings_config 是 JSON 字符串。空字符串允许（codex/gemini 可能
    // 为空），但非空时必须是合法 JSON。
    let settings: Option<ProviderSettings> = if settings_json.trim().is_empty() {
        None
    } else {
        match serde_json::from_str::<ProviderSettings>(&settings_json) {
            Ok(s) => Some(s),
            Err(e) => {
                return Err(format!("settings_config invalid JSON: {e}"));
            }
        }
    };

    // 按 app_type 分派提取。
    // - claude 系：从 env.ANTHROPIC_* 提取 base_url + token + model。
    //   base_url 为空 → 跳过（该 provider 无法激活，无意义）。
    //   token 为空 → 允许（用户可能只想保存 base_url 模板）。
    // - 非 claude 系（codex/gemini/opencode/custom）：不强解析，
    //   保留 raw settings_config（透传），api_base 留空。
    let (api_base, api_key, models) = if is_claude_family(&app_type) {
        match &settings {
            Some(s) => {
                let base = s.anthropic_base_url().map(|s| s.to_string()).unwrap_or_default();
                // base_url 为空 → 该 claude 系 provider 无法激活。
                if base.is_empty() {
                    return Err(
                        "settings_config.env.ANTHROPIC_BASE_URL is empty".into(),
                    );
                }
                let key = s
                    .anthropic_auth_token()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                // M4.6.1 — sql dump only carries the primary model name
                // (env.ANTHROPIC_MODEL or top-level `model`); map it to
                // `ProviderModels.default`. Haiku/sonnet/opus/by_tier
                // stay unset (None) — the user can fill them later via
                // the JSON edit modal (F5).
                let mdls = ProviderModels {
                    default: s.anthropic_model().unwrap_or_default(),
                    ..Default::default()
                };
                (base, key, mdls)
            }
            // claude 系但 settings_config 为空 → 无法提取 base_url。
            None => {
                return Err(
                    "claude-family provider has empty settings_config".into(),
                );
            }
        }
    } else {
        // 非 claude 系：保留 raw，不强解析。api_base 留空——下游
        // Provider::validate 不在此路径调用（import_providers_from_sql
        // 用 serde_json::to_string_pretty 直写，不经 validate）。
        (String::new(), String::new(), ProviderModels::default())
    };

    // line 只用于 skip 消息；Provider 不存储。
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

fn parse_mcp_row(row: &[(&str, &SqlValue)]) -> Result<ParsedMcpServer, String> {
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
    // We accept either a direct object or a string-encoded one (cc-switch
    // sometimes double-encodes — i.e. the column stores a JSON string
    // whose contents are themselves JSON).
    let server_obj: ServerConfigJson = if server_config.trim().is_empty() {
        ServerConfigJson::default()
    } else {
        // 第一次尝试:直接解析为对象(主流情况)。
        match serde_json::from_str::<ServerConfigJson>(&server_config) {
            Ok(v) => v,
            Err(_) => {
                // 第二次尝试:先解析为 JSON string(整体带引号),
                // 再 unquote 后用 ServerConfigJson 解析内容。
                // 这是真正的"string-encoded JSON"分支,老代码只是
                // 复制粘贴第一次调用(死代码,无效)。
                match serde_json::from_str::<String>(&server_config) {
                    Ok(unquoted) => serde_json::from_str::<ServerConfigJson>(&unquoted)
                        .map_err(|e| format!("server_config invalid JSON: {e}"))?,
                    Err(e) => {
                        return Err(format!("server_config invalid JSON: {e}"));
                    }
                }
            }
        }
    };

    Ok(ParsedMcpServer {
        id,
        name,
        command: server_obj.command.unwrap_or_default(),
        args: server_obj.args.unwrap_or_default(),
        env: server_obj.env.unwrap_or_default(),
        description,
    })
}

/// Best-effort extract of the provider/MCP `name` from a parsed row, so
/// the SkippedLine UI can show "name (line N)" instead of just "line N".
/// Returns None if the column isn't present or is NULL.
fn extract_row_name(row: &[(&str, &SqlValue)]) -> Option<String> {
    row.iter()
        .find(|(c, _)| c.eq_ignore_ascii_case("name"))
        .and_then(|(_, v)| match v {
            SqlValue::Str(s) if !s.is_empty() => Some(s.clone()),
            _ => None,
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

    /// 真实 cc-switch 风格的 dump（脱敏 token）。
    /// 4 个 provider（claude / claude-desktop / codex / gemini）+ 1 mcp_server，
    /// 使用无列名的 `INSERT INTO t VALUES (...)` 形式（cc-switch .dump 标准）。
    fn sample_dump() -> String {
        let glm_env = r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com","ANTHROPIC_AUTH_TOKEN":"sk-test-1","ANTHROPIC_MODEL":"claude-sonnet-4-6"},"model":"claude-sonnet-4-6"}"#;
        let ds_env = r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.deepseek.com","ANTHROPIC_AUTH_TOKEN":"sk-test-2","ANTHROPIC_MODEL":"deepseek-chat"},"model":"deepseek-chat"}"#;
        let codex = r#"{"auth":{},"config":""}"#;
        let gemini = r#"{"env":{},"config":{}}"#;
        let mcp = r#"{"command":"npx","args":["-y","@mcp/filesystem"],"env":{"ROOT":"/tmp"}}"#;
        format!(
            r#"
-- CC Switch SQLite 导出
-- 生成时间: 2026-06-21 12:00:00
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
INSERT INTO providers VALUES('glm-46','claude','GLM-4.6','{glm_env}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{{}}',0,0,'1.0',NULL,NULL,NULL);
INSERT INTO providers VALUES('deepseek','claude-desktop','DeepSeek','{ds_env}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{{}}',0,0,'1.0',NULL,NULL,NULL);
INSERT INTO providers VALUES('codex-official','codex','OpenAI Official','{codex}','https://chatgpt.com/codex','official',NULL,0,NULL,NULL,NULL,'{{}}',0,0,'1.0',NULL,NULL,NULL);
INSERT INTO providers VALUES('gemini-official','gemini','Google Official','{gemini}','https://ai.google.dev/','official',NULL,0,NULL,NULL,NULL,'{{}}',0,0,'1.0',NULL,NULL,NULL);
INSERT INTO mcp_servers VALUES('fs-1','Filesystem','{mcp}','Local FS',NULL,NULL,'[]',1,0,0,1,0);
COMMIT;
"#,
        )
    }

    /// 构造 claude 系 settings_config JSON（脱敏 token）。
    fn claude_settings(base: &str, token: &str, model: &str) -> String {
        format!(
            r#"{{"env":{{"ANTHROPIC_BASE_URL":"{base}","ANTHROPIC_AUTH_TOKEN":"{token}","ANTHROPIC_MODEL":"{model}"}},"model":"{model}"}}"#
        )
    }

    // ----- claude 系提取 -----

    #[test]
    fn parse_claude_provider_extracts_env_anthropic_fields() {
        // 显式列名形式（兼容旧测试约定）。
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('glm-46', 'claude', 'GLM-4.6', '{}');",
            claude_settings("https://api.anthropic.com", "sk-test", "claude-sonnet-4-6")
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        let p = &parsed.providers[0];
        assert_eq!(p.id, "glm-46");
        assert_eq!(p.name, "GLM-4.6");
        assert_eq!(p.api_base, "https://api.anthropic.com");
        assert_eq!(p.api_key, "sk-test");
        assert_eq!(p.provider_type, "claude");
        assert_eq!(p.models.default, "claude-sonnet-4-6");
        assert!(p.models.haiku.is_none());
        assert!(parsed.mcp_servers.is_empty());
        assert!(parsed.skipped_lines.is_empty());
    }

    #[test]
    fn parse_claude_desktop_extracts_env_anthropic_fields() {
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('ds', 'claude-desktop', 'DS', '{}');",
            claude_settings("https://api.deepseek.com", "sk-2", "deepseek-chat")
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        let p = &parsed.providers[0];
        assert_eq!(p.provider_type, "claude-desktop");
        assert_eq!(p.api_base, "https://api.deepseek.com");
        assert_eq!(p.api_key, "sk-2");
        assert_eq!(p.models.default, "deepseek-chat");
    }

    #[test]
    fn parse_claude_model_falls_back_to_top_level_model_when_env_missing() {
        // env.ANTHROPIC_MODEL 缺失，但顶层 model 存在 → 回退到顶层。
        let settings = r#"{"env":{"ANTHROPIC_BASE_URL":"https://x","ANTHROPIC_AUTH_TOKEN":"k"},"model":"fallback-model"}"#;
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'P', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].models.default, "fallback-model");
    }

    #[test]
    fn parse_claude_empty_base_url_skipped() {
        // claude 系但 ANTHROPIC_BASE_URL 为空 → 跳过（无法激活）。
        let settings = r#"{"env":{"ANTHROPIC_BASE_URL":"","ANTHROPIC_AUTH_TOKEN":"k"},"model":"m"}"#;
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'P', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0]
            .reason
            .contains("ANTHROPIC_BASE_URL is empty"));
    }

    #[test]
    fn parse_claude_empty_settings_config_skipped() {
        // claude 系但 settings_config 为空 → 跳过。
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'P', '');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("empty settings_config"));
    }

    // ----- 非 claude 系（codex / gemini / opencode）保留 raw -----

    #[test]
    fn parse_codex_provider_keeps_raw_without_base_url() {
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('codex-official', 'codex', 'OpenAI', '{\"auth\":{},\"config\":\"\"}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1, "codex 应保留（不强解析）");
        let p = &parsed.providers[0];
        assert_eq!(p.id, "codex-official");
        assert_eq!(p.provider_type, "codex");
        assert_eq!(p.api_base, "", "非 claude 系 api_base 留空");
        assert_eq!(p.api_key, "");
        assert_eq!(p.models, ProviderModels::default());
    }

    #[test]
    fn parse_gemini_provider_keeps_raw_without_base_url() {
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('gemini-official', 'gemini', 'Google', '{\"env\":{},\"config\":{}}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].provider_type, "gemini");
        assert_eq!(parsed.providers[0].api_base, "");
    }

    #[test]
    fn parse_opencode_provider_keeps_raw_without_base_url() {
        let settings = r#"{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://x/v1","apiKey":"k"},"models":{"m":{"name":"m"}}}"#;
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('oc', 'opencode', 'OC', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1, "opencode 应保留");
        assert_eq!(parsed.providers[0].provider_type, "opencode");
        assert_eq!(parsed.providers[0].api_base, "");
    }

    // ----- 无列名 INSERT（cc-switch .dump 标准格式）-----

    #[test]
    fn parse_positional_insert_without_column_list() {
        // cc-switch .dump 的标准格式：INSERT INTO t VALUES(...)
        // 无列名，按 known_table_columns 顺序匹配。
        let parsed = parse_sql_dump(&sample_dump()).unwrap();
        // 4 providers（claude + claude-desktop + codex + gemini）全部保留。
        assert_eq!(parsed.providers.len(), 4);
        assert_eq!(parsed.mcp_servers.len(), 1);
        let ids: Vec<&str> = parsed.providers.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"glm-46"));
        assert!(ids.contains(&"deepseek"));
        assert!(ids.contains(&"codex-official"));
        assert!(ids.contains(&"gemini-official"));
        // claude 系提取了 base_url；非 claude 系留空。
        let glm = parsed.providers.iter().find(|p| p.id == "glm-46").unwrap();
        assert_eq!(glm.api_base, "https://api.anthropic.com");
        let codex = parsed.providers.iter().find(|p| p.id == "codex-official").unwrap();
        assert_eq!(codex.api_base, "");
    }

    #[test]
    fn parse_positional_insert_with_extra_columns_tolerated() {
        // cc-switch 后续版本加列 → values 多于 known columns。
        // 多余列忽略（zip 截断），不报错。
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers VALUES('p','claude','P','{settings}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{{}}',0,0,'1.0',NULL,NULL,NULL,'extra-col-19','extra-col-20');"
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1, "多余列应被容忍");
        assert_eq!(parsed.providers[0].id, "p");
    }

    #[test]
    fn parse_positional_insert_with_too_few_values_skipped() {
        // values 少于 known columns → schema 漂移过大，跳过。
        let sql = "INSERT INTO providers VALUES('p','claude');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("VALUES has"));
    }

    #[test]
    fn parse_unknown_table_positional_insert_silently_ignored() {
        // 未知表无列名 → known_table_columns 返回 None → 跳过 INSERT。
        // 与"已知表静默忽略"行为一致（不产生 toast 噪音）。
        let sql = "INSERT INTO proxy_request_logs VALUES(1, 'bar');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert!(parsed.skipped_lines.is_empty());
    }

    // ----- 错误处理 / 跳过行 -----

    #[test]
    fn parse_invalid_sql_recorded_as_skipped_no_panic() {
        let sql = "NOT SQL AT ALL; this is garbage;";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert!(parsed.mcp_servers.is_empty());
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
        assert_eq!(parsed.providers.len(), 4);
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
    fn parse_malformed_json_recorded_as_skipped() {
        // settings_config 是非法 JSON → 跳行 + reason。
        let sql = "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('bad', 'claude', 'Bad', '{not json');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("settings_config"));
    }

    #[test]
    fn parse_missing_required_field_recorded_as_skipped() {
        // 显式列名形式：列数与值数不匹配 → 跳行。
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
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('Bad.ID', 'claude', 'Bad', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert!(parsed.providers.is_empty());
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].reason.contains("invalid id"));
    }

    #[test]
    fn parse_ignores_create_and_pragma_statements() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "CREATE TABLE providers (id TEXT);\n\
             INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p1', 'claude', 'P1', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].id, "p1");
    }

    #[test]
    fn parse_handles_unknown_table_with_columns_silently() {
        // 未知表带显式列名 → 静默忽略（不产生 toast 噪音）。
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO proxy_request_logs (id, foo) VALUES (1, 'bar');\n\
             INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p1', 'claude', 'P1', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert!(parsed.skipped_lines.is_empty());
    }

    #[test]
    fn parse_escaped_quote_in_string_value() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'It''s ok', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].name, "It's ok");
    }

    #[test]
    fn parse_semicolon_inside_string_does_not_split_statement() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p', 'claude', 'a;b', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].name, "a;b");
    }

    // ----- McpServer shape -----

    #[test]
    fn mcp_server_minimal_with_no_command() {
        // server_config 是空对象 → command 默认 ""。
        let sql = "INSERT INTO mcp_servers (id, name, server_config) VALUES ('m1', 'M1', '{}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.mcp_servers.len(), 1);
        assert_eq!(parsed.mcp_servers[0].id, "m1");
        assert_eq!(parsed.mcp_servers[0].command, "");
        assert!(parsed.mcp_servers[0].args.is_empty());
        assert!(parsed.mcp_servers[0].env.is_empty());
        assert!(parsed.mcp_servers[0].description.is_none());
    }

    #[test]
    fn mcp_server_positional_insert_with_stdio_config() {
        // 真实 cc-switch mcp_servers 行：type/command/args（无 env）。
        let sql = "INSERT INTO mcp_servers VALUES('codegraph','codegraph','{\"type\":\"stdio\",\"command\":\"codegraph\",\"args\":[\"serve\",\"--mcp\"]}',NULL,NULL,NULL,'[]',1,0,0,1,0);";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.mcp_servers.len(), 1);
        let m = &parsed.mcp_servers[0];
        assert_eq!(m.id, "codegraph");
        assert_eq!(m.name, "codegraph");
        assert_eq!(m.command, "codegraph");
        assert_eq!(m.args, vec!["serve".to_string(), "--mcp".to_string()]);
        assert!(m.env.is_empty());
    }

    // ----- determinism / idempotency -----

    #[test]
    fn parse_is_deterministic_for_same_input() {
        let a = parse_sql_dump(&sample_dump()).unwrap();
        let b = parse_sql_dump(&sample_dump()).unwrap();
        assert_eq!(a.providers.len(), b.providers.len());
        assert_eq!(a.mcp_servers.len(), b.mcp_servers.len());
        assert_eq!(a.skipped_lines.len(), b.skipped_lines.len());
        for (x, y) in a.providers.iter().zip(b.providers.iter()) {
            assert_eq!(x.id, y.id);
            assert_eq!(x.api_base, y.api_base);
            assert_eq!(x.api_key, y.api_key);
        }
    }

    // ----- M2.16 — C3: parse_mcp_row server_config 解码 -----

    /// C3: 直接 JSON 对象(主流情况) — 必须正确解析。
    #[test]
    fn parse_mcp_row_direct_json_object() {
        let id = SqlValue::Str("fs".into());
        let name = SqlValue::Str("fs".into());
        let cfg = SqlValue::Str(r#"{"command":"npx","args":["fs-server"]}"#.into());
        let row: Vec<(&str, &SqlValue)> = vec![
            ("id", &id),
            ("name", &name),
            ("server_config", &cfg),
        ];
        let parsed = parse_mcp_row(&row).expect("parse");
        assert_eq!(parsed.command, "npx");
        assert_eq!(parsed.args, vec!["fs-server".to_string()]);
    }

    /// C3: 双重编码 JSON(cc-switch 偶尔这样)— 整体被引号包,
    /// 内容是合法 JSON。老实现是复制粘贴的死代码(无效),新实现
    /// 先解析为 String 再解析内容。
    #[test]
    fn parse_mcp_row_double_encoded_json() {
        // 整体 JSON string:外层双引号 + 内容是合法 JSON 对象。
        let inner = r#"{"command":"uvx","args":["mcp-fetch"]}"#;
        let outer = format!(r#""{}""#, inner);
        let id = SqlValue::Str("fetch".into());
        let name = SqlValue::Str("fetch".into());
        let cfg = SqlValue::Str(outer);
        let row: Vec<(&str, &SqlValue)> = vec![
            ("id", &id),
            ("name", &name),
            ("server_config", &cfg),
        ];
        let parsed = parse_mcp_row(&row).expect("parse");
        assert_eq!(parsed.command, "uvx");
        assert_eq!(parsed.args, vec!["mcp-fetch".to_string()]);
    }

    /// C3: 真正畸形的 JSON — 返回 Err,错误信息准确。
    #[test]
    fn parse_mcp_row_invalid_json_errors_with_clear_message() {
        let id = SqlValue::Str("bad".into());
        let name = SqlValue::Str("bad".into());
        let cfg = SqlValue::Str("not json at all".into());
        let row: Vec<(&str, &SqlValue)> = vec![
            ("id", &id),
            ("name", &name),
            ("server_config", &cfg),
        ];
        let err = parse_mcp_row(&row).unwrap_err();
        assert!(err.contains("server_config invalid JSON"), "got: {err}");
    }

    /// C3: 空 server_config — 用 default(空 command/args/env)。
    #[test]
    fn parse_mcp_row_empty_server_config_uses_default() {
        let id = SqlValue::Str("empty".into());
        let name = SqlValue::Str("empty".into());
        let cfg = SqlValue::Str(String::new());
        let row: Vec<(&str, &SqlValue)> = vec![
            ("id", &id),
            ("name", &name),
            ("server_config", &cfg),
        ];
        let parsed = parse_mcp_row(&row).expect("parse");
        assert_eq!(parsed.command, "");
        assert!(parsed.args.is_empty());
        assert!(parsed.env.is_empty());
    }

    // ----- M3.13 — UTF-8 中文 / 多字节字符在字符串字面量中的正确解码 -----

    /// H1 RED: `parse_value_list` 之前用 `buf.push(b as char)` 按字节
    /// 切分,UTF-8 多字节被当成多个独立 Latin-1 字符("中" 0xE4 0xB8 0xAD
    /// 变成 U+00E4 U+00B8 U+00AD 三个 mojibake 字符)。此测试应当失败
    /// 直到 parser 改为按 UTF-8 字符消费。
    #[test]
    fn parse_chinese_provider_name_preserves_utf8() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p1', 'claude', '中文测试', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(
            parsed.providers[0].name, "中文测试",
            "中文 provider name must round-trip as UTF-8 (got mojibake: {:?})",
            parsed.providers[0].name
        );
    }

    /// 同 H1,混合 ASCII + 中文 + 日文,确保非 ASCII 段不被切碎。
    #[test]
    fn parse_mixed_ascii_and_cjk_provider_name_preserves_utf8() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p2', 'claude', 'Claude-中文-日本語', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].name, "Claude-中文-日本語");
    }

    /// 同 H1,无列名 cc-switch dump 形式中的中文 provider name(更接近
    /// 真实 .dump 文件,settings_config JSON 内也可能含中文)。
    #[test]
    fn parse_chinese_provider_name_in_positional_insert() {
        let sql = "INSERT INTO providers VALUES('p3','claude','深度求索公司','{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://api.deepseek.com\",\"ANTHROPIC_AUTH_TOKEN\":\"k\",\"ANTHROPIC_MODEL\":\"deepseek-chat\"},\"model\":\"deepseek-chat\"}',NULL,'official',NULL,0,NULL,NULL,NULL,'{}',0,0,'1.0',NULL,NULL,NULL);";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers[0].name, "深度求索公司");
        assert_eq!(parsed.providers[0].api_base, "https://api.deepseek.com");
    }

    // ----- M5 bug #8 — SkippedLine.name 暴露 provider/MCP name 供 UI 显示 -----

    /// Bug #8 RED: 当 INSERT INTO providers 被拒绝(如 id 含 `.`),UI 应能
    /// 从 row 里挑出 name 用于 "Test (line N): invalid id" 形式提示。
    /// 修前:`SkippedLine.name` 字段不存在 / UI 只能显示行号。
    #[test]
    fn skipped_line_carries_provider_name_for_id_rejection() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('Bad.ID', 'claude', 'Test Provider', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert_eq!(parsed.skipped_lines[0].name.as_deref(), Some("Test Provider"));
        assert_eq!(parsed.skipped_lines[0].line, 1);
        assert!(parsed.skipped_lines[0].reason.contains("invalid id"));
    }

    /// Bug #8: 缺 name 的 row(name 列 NULL/缺失)不应崩,UI 退化为纯行号显示。
    #[test]
    fn skipped_line_without_name_is_none() {
        // id 不合法 → name 没机会填,但 row 没 name 列,extract_row_name 返回 None。
        let sql = "INSERT INTO providers (id, app_type, settings_config) VALUES ('Bad.ID', 'claude', '{}');";
        let parsed = parse_sql_dump(sql).unwrap();
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].name.is_none());
    }

    /// Bug #8: 空字符串 name 也视为无 name(避免显示空括弧)。
    #[test]
    fn skipped_line_with_empty_name_is_none() {
        let settings = claude_settings("https://x", "k", "m");
        let sql = format!(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('Bad.ID', 'claude', '', '{}');",
            settings
        );
        let parsed = parse_sql_dump(&sql).unwrap();
        assert_eq!(parsed.skipped_lines.len(), 1);
        assert!(parsed.skipped_lines[0].name.is_none());
    }
}
