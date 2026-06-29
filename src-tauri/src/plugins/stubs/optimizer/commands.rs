//! F18 — 配置优化 (plugin commands).
//!
//! Phase 42 — physical migration of the 4 optimizer commands from
//! `src-tauri/src/commands/optimizer.rs` to this plugin's commands
//! module. The frontend invoke names (`scan_optimizations`,
//! `apply_optimizations`, `apply_rule_fix`,
//! `export_optimization_report`) are preserved verbatim — Tauri uses
//! them as the global IPC namespace, so they must match the
//! pre-migration command set exactly.
//!
//! (Note: 42-HANDOFF.md claims "optimizer (5)" but the actual source
//! file has 4 `#[tauri::command]` async fns. We register the 4 that
//! match the frontend IPC namespace.)
//!
//! Behaviour preserved verbatim from the source command file:
//! - `scan_optimizations`         → `Vec<OptimizationFinding>` (live read).
//! - `apply_optimizations`        → ordered `Vec<ApplyResult>` per finding id.
//! - `apply_rule_fix`             → `Vec<ApplyResult>` for a single rule.
//! - `export_optimization_report` → build markdown + native save dialog
//!   + atomic write, returns saved path or `None` on cancel.
//!
//! `build_markdown_report` / `default_report_filename` /
//! `epoch_to_ymdhms` / `severity_zh` / `current_timestamp_str` /
//! `RULE_REFERENCE` are pure helpers lifted verbatim from
//! `commands/optimizer.rs` — they have no Tauri dependency and can
//! be unit-tested in isolation.
//!
//! App state is fetched via `invoke.message.webview().state::<AppState>()`
//! (mirrors `usage_query` / `resource_browser` patterns). The dialog
//! for `export_optimization_report` requires `AppHandle`, reachable
//! via `webview().app_handle().clone()` (Webview implements Manager).

use std::fmt::Write as _;

use tauri::ipc::{Invoke, InvokeBody, InvokeError};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::domain::{ApplyResult, OptimizationFinding, Severity};
use crate::get_service;
use crate::infrastructure::fs_atomic;
use crate::plugins::dispatch::CommandSpec;
use crate::services::optimizer_service::OptimizerService;

/// Pull the JSON args off an `InvokeMessage` payload.
fn json_args(invoke: &Invoke<tauri::Wry>) -> serde_json::Value {
    match invoke.message.payload() {
        InvokeBody::Json(v) => v.clone(),
        InvokeBody::Raw(_) => panic!(
            "optimizer dispatch received raw InvokeBody — Tauri desktop only \
             sends JSON, this is an API misuse"
        ),
    }
}

/// Extract `Vec<String>` from the JSON args. Missing / wrong type →
/// empty Vec (matches the original `Vec<String>` parameter default).
fn payload_string_vec(invoke: &Invoke<tauri::Wry>, key: &str) -> Vec<String> {
    match invoke.message.payload() {
        InvokeBody::Json(v) => v
            .get(key)
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        InvokeBody::Raw(_) => Vec::new(),
    }
}

/// Extract the `ruleId` (or legacy `rule_id`) from the JSON args of
/// the `apply_rule_fix` invoke.
///
/// M5 (A4) — the frontend `applyRuleFix(ruleId)` wrapper sends
/// camelCase `{ ruleId: "..." }` because Tauri's default IPC convention
/// uses the parameter name verbatim as the JSON key. The dispatch
/// layer MUST read from that exact key — a literal `"rule_id"` lookup
/// would return empty string and produce the user-facing
/// "未知规则: " error reported in A4.
///
/// Older bundles (predating the rename) sent `{ rule_id: "..." }`;
/// fall back to that key for backward compatibility.
///
/// Pure helper — operates on `serde_json::Value` so we can unit-test
/// the camelCase/snake_case resolution without needing a real
/// `Invoke<tauri::Wry>` (which requires the Tauri runtime + Webview state).
fn extract_rule_id_from_payload(args: &serde_json::Value) -> String {
    // Prefer camelCase (current frontend convention).
    let v = args
        .get("ruleId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();
    if !v.is_empty() {
        return v;
    }
    // Fall back to snake_case for legacy bundles.
    args.get("rule_id")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// dispatch_scan_optimizations
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `scan_optimizations`.
///
/// F18 — scan all configured files and return every issue every
/// rule found. Results are sorted by severity (Error → Warning → Info).
/// Always reads fresh — no cache. Findings carry uuid `id`s that
/// only stay valid until the next scan.
pub fn dispatch_scan_optimizations(invoke: Invoke<tauri::Wry>) -> bool {
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<Vec<OptimizationFinding>, String> =
        tauri::async_runtime::block_on(async move {
            // M3.11 (A1#10) — read live active root from the platform shim
            // (state.paths is a one-shot startup snapshot; active_root can
            // change at runtime via the project switcher).
            let active_root = crate::platform::runtime::paths().active_root_dir();
            get_service!(state, OptimizerService)
                .scan_with_root(active_root.as_deref())
                .map_err(|e| format!("配置扫描失败: {e}"))
        });
    let response: Result<Vec<OptimizationFinding>, InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_apply_optimizations
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `apply_optimizations(findingIds)`.
///
/// F18 — apply the rules behind the requested findings, in order.
/// `findingIds` should come from a recent `scan_optimizations`
/// response. Stale ids return `ApplyResult { applied: false, error:
/// "finding 已过期..." }` rather than failing the whole call.
///
/// Each auto-apply rule writes via `fs_atomic::write_with_backup`
/// (CLAUDE.md §7) and returns the (predicted) `.bak.<ts>` path so
/// the UI can show "已自动备份".
///
/// M3.11 (A1#10) — write target resolves from `active_root_dir`:
/// `None` → `~/.claude/settings.json` (M2.9 default); `Some(root)` →
/// `<root>/.claude/settings.json` (project mode). The service
/// refuses to write into a root that does not exist (no auto-mkdir).
pub fn dispatch_apply_optimizations(invoke: Invoke<tauri::Wry>) -> bool {
    let finding_ids = payload_string_vec(&invoke, "findingIds");
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<Vec<ApplyResult>, String> = tauri::async_runtime::block_on(async move {
        let active_root = crate::platform::runtime::paths().active_root_dir();
        get_service!(state, OptimizerService)
            .apply_findings(finding_ids, active_root.as_deref())
            .map_err(|e| format!("应用优化失败: {e}"))
    });
    let response: Result<Vec<ApplyResult>, InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_apply_rule_fix
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `apply_rule_fix(rule_id)`.
///
/// M3.3 (Phase 4, SC #2 / #3) — per-rule Fix button backend.
/// Looks up `rule_id` in the registered rule set, re-scans, then runs
/// the rule's `apply` for every auto-fixable finding. Returns one
/// `ApplyResult` per finding the rule emitted (manual-only rules
/// return `ApplyResult::manual`).
///
/// Each auto-apply writes via `fs_atomic::write_with_backup` (the
/// same atomic pattern `apply_optimizations` uses, proven by the
/// `apply_findings_creates_backup_for_auto_rules` test).
///
/// Returns `Err` when the `rule_id` doesn't match any registered rule
/// so the UI can surface "未知规则" to the user (vs a silent
/// empty-vector success).
pub fn dispatch_apply_rule_fix(invoke: Invoke<tauri::Wry>) -> bool {
    // M5 (A4 fix) — frontend `applyRuleFix(ruleId)` sends camelCase
    // `{ ruleId: "..." }` (matching Tauri's default IPC convention
    // where the parameter name is the JSON key). The dispatch layer
    // must read from that exact key — a literal `"rule_id"` lookup
    // would return empty string and produce the user-facing
    // "未知规则: " error. Fall back to `"rule_id"` for older bundles
    // that predate the rename.
    let rule_id = extract_rule_id_from_payload(&json_args(&invoke));
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<Vec<ApplyResult>, String> = tauri::async_runtime::block_on(async move {
        let active_root = crate::platform::runtime::paths().active_root_dir();
        let results = get_service!(state, OptimizerService)
            .apply_rule_fix(&rule_id, active_root.as_deref())
            .map_err(|e| format!("应用规则修复失败: {e}"))?;
        if results.is_empty() {
            // The service returns an empty vec when the rule_id is
            // unknown OR when the rule didn't fire on the current
            // config. Distinguish by checking the registry directly so
            // the UI gets a useful message.
            if crate::get_service!(
                state,
                crate::services::optimizer_service::OptimizerService
            )
            .find_rule(&rule_id)
            .is_none()
            {
                return Err(format!("未知规则: {rule_id}"));
            }
            // Known rule but no findings — surface as a no-op success
            // (the UI's status icon will just stay green-check; the
            // user is happy their config is clean).
        }
        Ok(results)
    });
    let response: Result<Vec<ApplyResult>, InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_export_optimization_report
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `export_optimization_report(findings,
/// applyResults, generatedAt)`.
///
/// F23 — 把当前 scan 的所有优化项导成 markdown 报告,弹原生保存框
/// 写盘。需要 `AppHandle` 走 `tauri-plugin-dialog`,通过
/// `invoke.message.webview().app_handle()` 拿到 (Webview 实现 Manager)。
///
/// ## 设计选择 — 后端全权处理 dialog + 写盘（同 F14 `export_provider`）
///
/// SPEC F23 要求是"把当前 settings.json 的所有优化项导成 markdown
/// 报告（便于发给团队 / 存档）"。`findings` 已经在前端 state 里,
/// 理论上 JS 拼字符串即可。但**保存对话框**必须走 Rust——本仓库
/// 没装 `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-fs` 的 JS
/// wrapper（CLAUDE.md §2.3 依赖白名单,见 `package.json`),HTML input
/// 只能"打开"不能"保存"。
///
/// 所以方案是:**前端把 findings（+ applyResults + generatedAt）传给
/// 后端,后端生成 markdown → 弹原生保存框 → 原子写盘 → 返回路径**。
/// markdown 生成函数 [`build_markdown_report`] 是纯函数,单独单测,不
/// 依赖 Tauri / fs。命令层只负责 I/O + dialog,符合 M2.5 起的分层。
///
/// ## 返回值
///
/// `Ok(Some(path))` — 成功写盘,`path` 是绝对路径字符串。
/// `Ok(None)` — 用户在保存框点了取消（非错误,静默处理)。
/// `Err(msg)` — markdown 生成 / 写盘失败,`msg` 给用户看。
///
/// ## 为什么 `apply_results` + `generated_at` 是可选的
///
/// - `applyResults`:用户可能在"扫描后没应用"时直接导出,这时只有
///   findings 没有 applyResults;也可能"应用完再导出",这时两者都有。
///   前端按 state 有无传 `Option`。None 时报告只列待处理项,不列应用结果。
/// - `generatedAt`:报告头部的"生成时间"。前端传 `Date.now()`/ISO
///   字符串;None 时后端用当前时间,保证总有值。
pub fn dispatch_export_optimization_report(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let findings: Vec<OptimizationFinding> = serde_json::from_value(
        args.get("findings").cloned().unwrap_or(serde_json::Value::Null),
    )
    .unwrap_or_default();
    let apply_results: Option<Vec<ApplyResult>> = args
        .get("apply_results")
        .and_then(|v| if v.is_null() { None } else { serde_json::from_value(v.clone()).ok() });
    let generated_at: Option<String> = args
        .get("generated_at")
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    let webview = invoke.message.webview();
    let app_handle = webview.app_handle().clone();
    let result: Result<Option<String>, String> = tauri::async_runtime::block_on(async move {
        // 1. 纯函数生成 markdown。
        let markdown = build_markdown_report(
            &findings,
            apply_results.as_deref(),
            generated_at.as_deref(),
        );

        // 2. 弹原生保存框。默认文件名带时间戳,便于多次导出不覆盖。
        let default_name = default_report_filename();
        let file_path = app_handle
            .dialog()
            .file()
            .set_title("导出优化建议报告")
            .set_file_name(default_name)
            .add_filter("Markdown", &["md"])
            .blocking_save_file();

        // 3. 用户取消 — 静默,返回 None。
        let file_path = match file_path {
            Some(fp) => fp,
            None => return Ok(None),
        };

        let path = file_path
            .into_path()
            .map_err(|e| format!("无法解析保存路径: {e}"))?;

        // 4. 原子写盘。首次写不产生备份（fs_atomic 语义)。
        fs_atomic::write_with_backup(&path, &markdown)
            .map_err(|e| format!("写入失败 {}: {e}", path.display()))?;

        Ok(Some(path.to_string_lossy().into_owned()))
    });
    let response: Result<Option<String>, InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// Pure helpers (lifted verbatim from commands/optimizer.rs)
// ---------------------------------------------------------------------------

/// 生成 `claude-optimization-report-YYYYMMDD-HHMMSS.md` 形式的默认
/// 文件名。本地时间,秒精度,文件名安全（无冒号)。
fn default_report_filename() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 简单的 epoch→UTC 拆分,避免拉 chrono 依赖（CLAUDE.md §2.3)。
    let (y, mo, d, h, mi, s) = epoch_to_ymdhms(secs);
    format!(
        "claude-optimization-report-{:04}{:02}{:02}-{:02}{:02}{:02}.md",
        y, mo, d, h, mi, s
    )
}

/// epoch 秒 → (年, 月, 日, 时, 分, 秒) UTC。手写日历算法,避免
/// chrono 依赖。范围够用（1970-2100+),民用历（忽略闰秒)。
fn epoch_to_ymdhms(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let mut days = secs / 86400;
    // 从 1970-01-01 往后数天。算法:逐年扣,再逐月扣。
    let mut y = 1970u64;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
        let dy = if leap { 366 } else { 365 };
        if days < dy {
            break;
        }
        days -= dy;
        y += 1;
    }
    const DMONTH: [u64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    let mut mo = 1u64;
    for (i, &dm) in DMONTH.iter().enumerate() {
        let dm = if i == 1 && leap { 29 } else { dm };
        if days < dm {
            break;
        }
        days -= dm;
        mo += 1;
    }
    (y, mo, days + 1, h, m, s)
}

/// F23 — 把 findings（+ 可选 applyResults)拼成 markdown 报告。
///
/// 纯函数,确定性输出。布局（SPEC F23 任务 brief 指定):
///
/// ```markdown
/// # Claude 配置优化报告
///
/// > 生成时间: YYYY-MM-DD HH:MM:SS
/// > 配置文件: ~/.claude/settings.json
///
/// ## 概览
/// - 总建议数: N
/// - 按严重度: 错误 x, 建议 y, 提示 z
/// - 按修复方式: 可自动修复 a, 需手动处理 b
/// - 应用结果（如有): 成功 c, 未应用 d
///
/// ## 建议详情
/// ### 1. [错误] <title>
/// - 规则: `<rule_id>`
/// - 字段: `<affected_path>`
/// - 说明: <description>
/// - 建议: <suggested_action>
/// - 修复方式: 可自动修复 / 需手动处理
/// - 应用状态（如有): 已应用 / 未应用 (原因)
///
/// ## 附录: 16 条规则参考
/// ...
/// ```
///
/// `apply_results` 为 None 时省略"应用结果"概览行 + 每项的"应用状态"
/// 行。findings 顺序保持输入顺序（前端已按 severity 排序）。
fn build_markdown_report(
    findings: &[OptimizationFinding],
    apply_results: Option<&[ApplyResult]>,
    generated_at: Option<&str>,
) -> String {
    let mut out = String::with_capacity(4096);

    // ---- 标题 + 元信息 ----
    out.push_str("# Claude 配置优化报告\n\n");
    let ts = generated_at
        .map(|s| s.to_string())
        .unwrap_or_else(current_timestamp_str);
    let _ = writeln!(out, "> 生成时间: {}", ts);
    out.push_str("> 配置文件: ~/.claude/settings.json\n\n");

    // ---- 概览 ----
    let mut n_error = 0u64;
    let mut n_warning = 0u64;
    let mut n_info = 0u64;
    let mut n_auto = 0u64;
    let mut n_manual = 0u64;
    for f in findings {
        match f.severity {
            Severity::Error => n_error += 1,
            Severity::Warning => n_warning += 1,
            Severity::Info => n_info += 1,
        }
        if f.auto_apply {
            n_auto += 1;
        } else {
            n_manual += 1;
        }
    }
    let total = findings.len();
    let _ = writeln!(out, "## 概览\n");
    let _ = writeln!(out, "- 总建议数: {}", total);
    let _ = writeln!(
        out,
        "- 按严重度: 错误 {}, 建议 {}, 提示 {}",
        n_error, n_warning, n_info
    );
    let _ = writeln!(
        out,
        "- 按修复方式: 可自动修复 {}, 需手动处理 {}",
        n_auto, n_manual
    );
    if let Some(results) = apply_results {
        let ok = results.iter().filter(|r| r.applied).count();
        let fail = results.len() - ok;
        let _ = writeln!(out, "- 应用结果: 成功 {}, 未应用 {}", ok, fail);
    }
    out.push('\n');

    // ---- 建议详情 ----
    out.push_str("## 建议详情\n");
    // 按 finding id 建索引,让 apply 状态能 O(1) 查（apply_results 的
    // finding_id 对应 findings 的 id)。
    let apply_map: std::collections::HashMap<&str, &ApplyResult> = apply_results
        .map(|rs| rs.iter().map(|r| (r.finding_id.as_str(), r)).collect())
        .unwrap_or_default();
    if findings.is_empty() {
        out.push_str("\n未发现需优化的项。所有 16 个规则都已通过。\n");
    } else {
        for (i, f) in findings.iter().enumerate() {
            let sev_label = severity_zh(f.severity);
            let _ = writeln!(out, "\n### {}. [{}] {}", i + 1, sev_label, f.title);
            let _ = writeln!(out, "- 规则: `{}`", f.rule_id);
            let _ = writeln!(out, "- 字段: `{}`", f.affected_path);
            let _ = writeln!(out, "- 说明: {}", f.description);
            let _ = writeln!(out, "- 建议: {}", f.suggested_action);
            let _ = writeln!(
                out,
                "- 修复方式: {}",
                if f.auto_apply { "可自动修复" } else { "需手动处理" }
            );
            if let Some(r) = apply_map.get(f.id.as_str()) {
                if r.applied {
                    let _ = writeln!(out, "- 应用状态: 已应用");
                    if let Some(bp) = &r.backup_path {
                        let _ = writeln!(out, "  - 备份: `{}`", bp);
                    }
                } else {
                    let reason = r.error.as_deref().unwrap_or("未知原因");
                    let _ = writeln!(out, "- 应用状态: 未应用 ({})", reason);
                }
            }
        }
        out.push('\n');
    }

    // ---- 附录: 16 条规则参考 ----
    out.push_str("## 附录: 16 条优化规则参考\n\n");
    out.push_str("| 规则 ID | 严重度 | 可自动修复 | 说明 |\n");
    out.push_str("|---|---|---|---|\n");
    for (rid, sev, auto, desc) in RULE_REFERENCE {
        let _ = writeln!(
            out,
            "| `{}` | {} | {} | {} |",
            rid,
            severity_zh(sev),
            if auto { "是" } else { "否" },
            desc
        );
    }
    out.push('\n');

    out
}

/// 16 条优化规则的静态参考表（与 `optimizer_rules::all_rules` 对齐)。
/// 用于报告附录,让接收方不看代码也能理解每条规则的语义。
///
/// M3.3 增量:在 13 个文件规则之后追加 ENV001/002/003 三条 env 规则,
///
/// 合计 16 条规则。
const RULE_REFERENCE: [(&str, Severity, bool, &str); 16] = [
    ("ORPHAN_PROVIDER", Severity::Warning, false, "settings.json 引用了不存在的 provider"),
    ("UNREFERENCED_PROVIDER", Severity::Info, false, "provider 从未被使用,可考虑删除"),
    ("DUPLICATE_MCP", Severity::Warning, false, "MCP server 重复（同 command/url)"),
    ("EMPTY_FIELD", Severity::Warning, false, "provider 的 api_key / api_base 为空"),
    ("DEPRECATED_FIELD", Severity::Info, true, "settings.json 含已弃用的旧字段名,可移除"),
    ("INSECURE_API_KEY", Severity::Error, false, "api_key 长度 < 16 字符,可能不合法"),
    ("MCP_MISSING_TRANSPORT", Severity::Warning, false, "MCP server 缺 transport 必需字段"),
    ("LONG_PROVIDER_NAME", Severity::Info, false, "provider name > 50 字符,UI 会截断"),
    ("UNUSED_BACKUP", Severity::Info, true, "备份文件 mtime 超 30 天,可删除"),
    ("LARGE_SETTINGS", Severity::Warning, false, "settings.json > 1MB,建议人工精简"),
    ("MISSING_ACTIVE_PROVIDER", Severity::Warning, false, "env.ANTHROPIC_BASE_URL 缺失,无法使用"),
    ("DANGLING_ACTIVE_PROVIDER", Severity::Error, false, "活动 provider 指向不存在的目标"),
    ("INCONSISTENT_PROVIDER_TYPE", Severity::Info, true, "provider_type 大小写不一致,统一 lowercase"),
    // M3.3 — 3 个 env 规则
    ("ENV001", Severity::Info, true, "CLAUDE_CODE_ATTRIBUTION_HEADER=0,关闭内置 attribution"),
    ("ENV002", Severity::Info, true, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1,禁用非必要流量"),
    ("ENV003", Severity::Info, true, "CLAUDE_CODE_EFFORT_LEVEL=max,默认更深推理"),
];

/// 严重度 → 中文标签（与前端 `severityLabel` 对齐)。
fn severity_zh(s: Severity) -> &'static str {
    match s {
        Severity::Error => "错误",
        Severity::Warning => "建议",
        Severity::Info => "提示",
    }
}

/// 当前时间的 `YYYY-MM-DD HH:MM:SS` 字符串（UTC)。避免 chrono 依赖。
fn current_timestamp_str() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = epoch_to_ymdhms(secs);
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, mo, d, h, mi, s)
}

// ---------------------------------------------------------------------------
// inventory::submit! — register all 4 commands into the global dispatch table.
// ---------------------------------------------------------------------------
//
// `name` is the string the frontend uses in `invoke("name", ...)` and
// MUST match the original `#[tauri::command]` fn name exactly — Tauri
// uses it as the global IPC namespace (never namespaced by `plugin_id`).

inventory::submit!(CommandSpec {
    name: "scan_optimizations",
    plugin_id: "optimizer",
    dispatch: dispatch_scan_optimizations,
});

inventory::submit!(CommandSpec {
    name: "apply_optimizations",
    plugin_id: "optimizer",
    dispatch: dispatch_apply_optimizations,
});

inventory::submit!(CommandSpec {
    name: "apply_rule_fix",
    plugin_id: "optimizer",
    dispatch: dispatch_apply_rule_fix,
});

inventory::submit!(CommandSpec {
    name: "export_optimization_report",
    plugin_id: "optimizer",
    dispatch: dispatch_export_optimization_report,
});

// ---------------------------------------------------------------------------
// Tests — verify all 4 commands register under plugin_id="optimizer"
// and that the global dispatch table can route them by name.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the global inventory and return every CommandSpec whose
    /// `plugin_id` is "optimizer". Used by the test below to assert the
    /// stub registered exactly 4 commands (no more, no fewer).
    fn optimizer_specs() -> Vec<&'static CommandSpec> {
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == "optimizer")
            .collect()
    }

    /// TDD RED gate — guard the 4-command contract. If a future
    /// refactor accidentally drops an `inventory::submit!`, or adds
    /// a 5th one, this test fails first (before the smoke test).
    #[test]
    fn inventory_registers_four_optimizer_commands() {
        let specs = optimizer_specs();
        let names: Vec<&str> = specs.iter().map(|c| c.name).collect();
        assert!(
            names.contains(&"scan_optimizations"),
            "missing scan_optimizations in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"apply_optimizations"),
            "missing apply_optimizations in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"apply_rule_fix"),
            "missing apply_rule_fix in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"export_optimization_report"),
            "missing export_optimization_report in inventory: {:?}",
            names
        );
        assert_eq!(
            specs.len(),
            4,
            "optimizer plugin should register exactly 4 commands, got {} ({:?})",
            specs.len(),
            names
        );
    }

    #[test]
    fn dispatch_table_routes_optimizer_commands() {
        let table = crate::plugins::dispatch::DispatchTable::from_inventory();
        for name in &[
            "scan_optimizations",
            "apply_optimizations",
            "apply_rule_fix",
            "export_optimization_report",
        ] {
            let spec = table.get(name).unwrap_or_else(|| {
                panic!("optimizer command `{}` must be in dispatch table", name)
            });
            assert_eq!(spec.plugin_id, "optimizer");
        }
    }

    /// Smoke-test that all 4 dispatch fn pointers are callable as
    /// `fn(Invoke<tauri::Wry>) -> bool`. We can't construct a real
    /// `Invoke` without a Tauri runtime, but we can verify the
    /// function symbols exist by taking their addresses.
    #[allow(unused)]
    #[test]
    fn dispatch_fn_symbols_exist() {
        let _ = &(dispatch_scan_optimizations as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_apply_optimizations as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_apply_rule_fix as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_export_optimization_report as fn(Invoke<tauri::Wry>) -> bool);
    }

    /// Pin the return-shape compatibility — the dispatch fns return
    /// `Vec<OptimizationFinding>` / `Vec<ApplyResult>` / `Option<String>`
    /// from the same service / helper functions the old
    /// `commands/optimizer.rs` wrapped.
    #[allow(dead_code)]
    fn _type_pins() {
        // Type-only assertion; never executed.
        fn assert_send<T: Send>() {}
        assert_send::<OptimizationFinding>();
        assert_send::<ApplyResult>();
    }

    // -----------------------------------------------------------------------
    // A4 regression tests — extract_rule_id_from_payload
    // -----------------------------------------------------------------------
    //
    // M5 (A4 bug) — the dispatch layer must read `ruleId` (camelCase,
    // Tauri's default IPC key naming) — a literal `"rule_id"` lookup
    // would return empty string and produce the user-facing
    // "未知规则: " error. These tests pin the contract:
    //
    //   1. camelCase `ruleId` (current frontend) — wins.
    //   2. snake_case `rule_id` (legacy bundles) — fallback only.
    //   3. both present — camelCase wins.
    //   4. neither — empty (caller sees this as unknown rule).
    //   5. wrong type — empty (defensive, no panic).

    #[test]
    fn extract_rule_id_camel_case_wins() {
        // 当前前端 `applyRuleFix(ruleId)` 走这条路径 (Tauri 默认 IPC 约定).
        let args = serde_json::json!({ "ruleId": "ENV001" });
        assert_eq!(extract_rule_id_from_payload(&args), "ENV001");
    }

    #[test]
    fn extract_rule_id_snake_case_legacy_fallback() {
        // 旧 bundle (a6cfb3b 之前的版本) 用 snake_case; 我们要保留兼容.
        let args = serde_json::json!({ "rule_id": "DEPRECATED_FIELD" });
        assert_eq!(
            extract_rule_id_from_payload(&args),
            "DEPRECATED_FIELD",
            "snake_case `rule_id` is the legacy fallback — must still resolve"
        );
    }

    #[test]
    fn extract_rule_id_prefers_camel_case_over_snake_case() {
        // 两个都在 → camelCase 胜出 (current frontend wins).
        let args = serde_json::json!({
            "ruleId": "ENV002",
            "rule_id": "DEPRECATED_FIELD"
        });
        assert_eq!(extract_rule_id_from_payload(&args), "ENV002");
    }

    #[test]
    fn extract_rule_id_missing_keys_returns_empty() {
        // 都没传 → empty string (caller 走 `未知规则: ` 路径).
        let args = serde_json::json!({});
        assert_eq!(extract_rule_id_from_payload(&args), "");
    }

    #[test]
    fn extract_rule_id_empty_string_is_not_a_hit() {
        // 前端传了空字符串 — 应 fallback 到 snake_case (而不是返回空).
        let args = serde_json::json!({
            "ruleId": "",
            "rule_id": "DEPRECATED_FIELD"
        });
        assert_eq!(extract_rule_id_from_payload(&args), "DEPRECATED_FIELD");
    }

    #[test]
    fn extract_rule_id_wrong_type_falls_through() {
        // ruleId 不是 string (e.g. number, object) — 不能 panic,
        // 必须 silently fallback 到 snake_case, 再 fallback 到 empty.
        let args_num = serde_json::json!({ "ruleId": 42 });
        assert_eq!(extract_rule_id_from_payload(&args_num), "");

        let args_obj = serde_json::json!({ "ruleId": { "x": 1 } });
        assert_eq!(extract_rule_id_from_payload(&args_obj), "");

        // snake_case 是合法 string — 即使 ruleId 类型错也 fallback 到它.
        let args_legacy = serde_json::json!({
            "ruleId": null,
            "rule_id": "DEPRECATED_FIELD"
        });
        assert_eq!(
            extract_rule_id_from_payload(&args_legacy),
            "DEPRECATED_FIELD",
            "null `ruleId` must fall back to snake_case `rule_id`"
        );
    }
}
