//! Tauri commands for F18 — 配置优化 + F23 — 优化报告导出 (M2.16).
//!
//! Mirrors the M2.5 / M2.7 command-layer pattern:
//!
//! - Each `#[tauri::command]` is a thin wrapper around an
//!   [`OptimizerService`] method（F18）或纯函数 + I/O（F23）。
//! - State is extracted with `State<'_, AppState>` (NOT `Arc<AppState>`
//!   — see the M2.2.3 fix note in `lib.rs`).
//! - All errors flatten to `String` for the IPC boundary; the message
//!   is user-readable so the UI can render it directly (SPEC §6.5
//!   "不允许静默吞错").
//!
//! ## Frontend contract
//!
//! - `scan_optimizations` → `Vec<OptimizationFinding>`. JSON shape:
//!   snake_case fields (see `domain::optimization`), severity is
//!   lowercase ("info" / "warning" / "error").
//! - `apply_optimizations({ findingIds })` → `Vec<ApplyResult>`.
//!   findingIds order is preserved; each result has `applied`
//!   (bool), `backupPath` (camelCased? — note: serde's
//!   `rename_all = "snake_case"` keeps it as `backup_path` on the
//!   wire; the TS mirror in `src/types/app.ts` converts).
//! - `export_optimization_report({ findings, applyResults, generatedAt })`
//!   → `Option<String>`（保存路径）。用户在保存框取消 → `None`。

use std::fmt::Write as _;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::domain::{ApplyResult, OptimizationFinding, Severity};
use crate::get_service;
use crate::infrastructure::fs_atomic;

/// `Result<T, String>` — Tauri IPC's preferred error type. `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F18 — scan all configured files and return every issue every
/// rule found. Results are sorted by severity (Error → Warning → Info).
///
/// Always reads fresh — no cache. Findings carry uuid `id`s that
/// only stay valid until the next scan.
#[tauri::command]
pub async fn scan_optimizations(
    state: State<'_, AppState>,
) -> CmdResult<Vec<OptimizationFinding>> {
    // M3.11 (A1#10) — read live active root from the platform shim
    // (state.paths is a one-shot startup snapshot; active_root can
    // change at runtime via the project switcher).
    let active_root = crate::platform::runtime::paths().active_root_dir();
    get_service!(state, crate::services::optimizer_service::OptimizerService)
        .scan_with_root(active_root.as_deref())
        .map_err(|e| format!("配置扫描失败: {e}"))
}

/// F18 — apply the rules behind the requested findings, in order.
///
/// `findingIds` should come from a recent `scan_optimizations`
/// response. Stale ids return `ApplyResult { applied: false,
/// error: "finding 已过期..." }` rather than failing the whole call.
///
/// Each auto-apply rule writes via `fs_atomic::write_with_backup`
/// (CLAUDE.md §7) and returns the (predicted) `.bak.<ts>` path so
/// the UI can show "已自动备份"。
///
/// M3.11 (A1#10) — write target resolves from `active_root_dir`:
/// `None` → `~/.claude/settings.json` (M2.9 default); `Some(root)` →
/// `<root>/.claude/settings.json` (project mode). The service
/// refuses to write into a root that does not exist (no auto-mkdir).
#[tauri::command]
pub async fn apply_optimizations(
    state: State<'_, AppState>,
    finding_ids: Vec<String>,
) -> CmdResult<Vec<ApplyResult>> {
    // M3.11 (A1#10) — same live read as scan_optimizations. Snapshot
    // is taken here (command boundary) so the service stays a pure
    // `&self` method.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    get_service!(state, crate::services::optimizer_service::OptimizerService)
        .apply_findings(finding_ids, active_root.as_deref())
        .map_err(|e| format!("应用优化失败: {e}"))
}

/// M3.3 (Phase 4, SC #2 / #3) — per-rule Fix button backend.
///
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
#[tauri::command]
pub async fn apply_rule_fix(
    state: State<'_, AppState>,
    rule_id: String,
) -> CmdResult<Vec<ApplyResult>> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let results = get_service!(state, crate::services::optimizer_service::OptimizerService)
        .apply_rule_fix(&rule_id, active_root.as_deref())
        .map_err(|e| format!("应用规则修复失败: {e}"))?;
    if results.is_empty() {
        // The service returns an empty vec when the rule_id is
        // unknown OR when the rule didn't fire on the current
        // config. Distinguish by checking the registry directly so
        // the UI gets a useful message.
        if get_service!(
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
}

// ---------------------------------------------------------------------------
// F23 — 优化建议导出 (M2.16)
// ---------------------------------------------------------------------------

/// F23 — 把当前 scan 的所有优化项导成 markdown 报告,弹原生保存框
/// 写盘。
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
/// ## 算法
///
/// 1. [`build_markdown_report`] 把 findings（+ 可选 applyResults）拼成
///    markdown 字符串。纯函数,确定性输出（同输入 → 同输出,便于 diff
///    + 归档)。
/// 2. 弹原生保存框（`tauri-plugin-dialog` 的 `blocking_save_file`,只在
///    非主线程的 async command 里用,文档明确允许)。默认文件名
///    `claude-optimization-report-YYYYMMDD-HHMMSS.md`,过滤器只收 `.md`。
/// 3. 用户取消 → 返回 `Ok(None)`;前端据此不显示任何提示。
/// 4. 用户选了路径 → `write_with_backup` 原子写盘（CLAUDE.md §7)。
///    返回保存路径供前端展示成功提示。
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
#[tauri::command]
pub async fn export_optimization_report(
    app: AppHandle,
    findings: Vec<OptimizationFinding>,
    apply_results: Option<Vec<ApplyResult>>,
    generated_at: Option<String>,
) -> CmdResult<Option<String>> {
    // 1. 纯函数生成 markdown。
    let markdown = build_markdown_report(&findings, apply_results.as_deref(), generated_at.as_deref());

    // 2. 弹原生保存框。默认文件名带时间戳,便于多次导出不覆盖。
    let default_name = default_report_filename();
    let file_path = app
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

    let path = file_path.into_path().map_err(|e| {
        format!("无法解析保存路径: {e}")
    })?;

    // 4. 原子写盘。首次写不产生备份（fs_atomic 语义)。
    fs_atomic::write_with_backup(&path, &markdown)
        .map_err(|e| format!("写入失败 {}: {e}", path.display()))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

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
pub(crate) fn build_markdown_report(
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
// Tests — F23 markdown 生成是纯函数,重点单测；命令层只验签名。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn finding(
        id: &str,
        rule_id: &str,
        severity: Severity,
        auto_apply: bool,
    ) -> OptimizationFinding {
        OptimizationFinding {
            id: id.into(),
            rule_id: rule_id.into(),
            severity,
            title: format!("{} 标题", rule_id),
            description: format!("{} 说明", rule_id),
            affected_path: format!("~/.claude/settings.json:{}", rule_id),
            suggested_action: format!("{} 建议", rule_id),
            auto_apply,
        }
    }

    /// 报告头部 + 元信息三行:标题、生成时间、配置文件。
    #[test]
    fn report_has_header_and_meta_lines() {
        let md = build_markdown_report(&[], None, Some("2026-06-21 10:00:00"));
        assert!(md.starts_with("# Claude 配置优化报告"));
        assert!(md.contains("> 生成时间: 2026-06-21 10:00:00"));
        assert!(md.contains("> 配置文件: ~/.claude/settings.json"));
    }

    /// 概览统计:严重度 + 修复方式计数正确。
    #[test]
    fn overview_counts_severity_and_auto_apply() {
        let findings = vec![
            finding("1", "ORPHAN_PROVIDER", Severity::Warning, false),
            finding("2", "INSECURE_API_KEY", Severity::Error, false),
            finding("3", "DEPRECATED_FIELD", Severity::Info, true),
        ];
        let md = build_markdown_report(&findings, None, Some("2026-06-21 10:00:00"));
        assert!(md.contains("- 总建议数: 3"));
        assert!(md.contains("- 按严重度: 错误 1, 建议 1, 提示 1"));
        assert!(md.contains("- 按修复方式: 可自动修复 1, 需手动处理 2"));
    }

    /// apply_results 为 None 时,概览不含"应用结果"行。
    #[test]
    fn overview_omits_apply_result_line_when_none() {
        let md = build_markdown_report(&[], None, Some("2026-06-21 10:00:00"));
        assert!(!md.contains("- 应用结果:"));
    }

    /// apply_results 有值时,概览含"成功 N, 未应用 M"行。
    #[test]
    fn overview_includes_apply_result_line_when_present() {
        let findings = vec![finding("1", "DEPRECATED_FIELD", Severity::Info, true)];
        let results = vec![
            ApplyResult::ok("1", Some("/tmp/bak.md".into())),
            ApplyResult::manual("2", "需手动"),
        ];
        let md = build_markdown_report(&findings, Some(&results), Some("2026-06-21 10:00:00"));
        assert!(md.contains("- 应用结果: 成功 1, 未应用 1"));
    }

    /// 每条 finding 渲染成 ### 编号小节,含规则/字段/说明/建议/修复方式。
    #[test]
    fn each_finding_renders_as_numbered_section() {
        let findings = vec![
            finding("1", "ORPHAN_PROVIDER", Severity::Warning, false),
            finding("2", "INSECURE_API_KEY", Severity::Error, false),
        ];
        let md = build_markdown_report(&findings, None, Some("2026-06-21 10:00:00"));
        assert!(md.contains("### 1. [建议] ORPHAN_PROVIDER 标题"));
        assert!(md.contains("### 2. [错误] INSECURE_API_KEY 标题"));
        assert!(md.contains("- 规则: `ORPHAN_PROVIDER`"));
        assert!(md.contains("- 字段: `~/.claude/settings.json:ORPHAN_PROVIDER`"));
        assert!(md.contains("- 说明: ORPHAN_PROVIDER 说明"));
        assert!(md.contains("- 建议: ORPHAN_PROVIDER 建议"));
        assert!(md.contains("- 修复方式: 需手动处理"));
    }

    /// apply_results 能匹配到 finding 时,渲染"应用状态"行 + 备份路径。
    #[test]
    fn apply_status_shown_when_result_matches_finding() {
        let findings = vec![finding("1", "DEPRECATED_FIELD", Severity::Info, true)];
        let results = vec![ApplyResult::ok(
            "1",
            Some("/tmp/settings.json.bak.20260621-100000".into()),
        )];
        let md = build_markdown_report(&findings, Some(&results), Some("2026-06-21 10:00:00"));
        assert!(md.contains("- 应用状态: 已应用"));
        assert!(md.contains("- 备份: `/tmp/settings.json.bak.20260621-100000`"));
        assert!(md.contains("- 修复方式: 可自动修复"));
    }

    /// 未应用的 finding 渲染"未应用 (原因)"。
    #[test]
    fn apply_status_shows_reason_when_not_applied() {
        let findings = vec![finding("1", "ORPHAN_PROVIDER", Severity::Warning, false)];
        let results = vec![ApplyResult::manual("1", "请回到 Provider 列表页删除")];
        let md = build_markdown_report(&findings, Some(&results), Some("2026-06-21 10:00:00"));
        assert!(md.contains("- 应用状态: 未应用 (请回到 Provider 列表页删除)"));
    }

    /// 空 findings → "未发现需优化的项"友好提示。
    #[test]
    fn empty_findings_shows_friendly_message() {
        let md = build_markdown_report(&[], None, Some("2026-06-21 10:00:00"));
        assert!(md.contains("未发现需优化的项"));
    }

    /// 附录含 16 行规则参考表(M3.3:13 文件规则 + 3 env 规则)。
    #[test]
    fn appendix_has_16_rule_rows() {
        let md = build_markdown_report(&[], None, Some("2026-06-21 10:00:00"));
        // 表头 + 分隔行 + 16 数据行 = 18 行含 `|` 的行。粗略数 `|---|`
        // 后的 16 个 `|` 开头行。
        let data_rows = md
            .lines()
            .skip_while(|l| !l.contains("| 规则 ID |"))
            .skip(2) // 表头 + 分隔
            .take_while(|l| l.starts_with("| `"))
            .count();
        assert_eq!(data_rows, 16);
    }

    /// 确定性:同输入 → 同输出（便于 diff 归档)。
    #[test]
    fn report_is_deterministic_for_same_input() {
        let findings = vec![
            finding("1", "ORPHAN_PROVIDER", Severity::Warning, false),
            finding("2", "DEPRECATED_FIELD", Severity::Info, true),
        ];
        let a = build_markdown_report(&findings, None, Some("2026-06-21 10:00:00"));
        let b = build_markdown_report(&findings, None, Some("2026-06-21 10:00:00"));
        assert_eq!(a, b);
    }

    /// generated_at 为 None 时,后端用当前时间填充（不为空)。
    #[test]
    fn generated_at_defaults_to_current_time_when_none() {
        let md = build_markdown_report(&[], None, None);
        assert!(md.contains("> 生成时间: 20"));
    }

    /// epoch → UTC 日期转换正确性（已知锚点:2026-06-21 00:00:00 UTC)。
    #[test]
    fn epoch_to_ymdhms_known_anchor() {
        // 2026-06-21 00:00:00 UTC = 1781932800
        let (y, mo, d, h, mi, s) = epoch_to_ymdhms(1_781_932_800);
        assert_eq!((y, mo, d, h, mi, s), (2026, 6, 21, 0, 0, 0));
    }

    /// 默认文件名格式 + `.md` 后缀。
    #[test]
    fn default_filename_is_md_with_timestamp() {
        let name = default_report_filename();
        assert!(name.starts_with("claude-optimization-report-"));
        assert!(name.ends_with(".md"));
        // 长度:前缀 30 + 15(YYYYMMDD-HHMMSS) + 3(.md) = 48
        assert_eq!(name.len(), 48);
    }

    /// 编译期签名检查:`export_optimization_report` 参数 + 返回类型。
    #[allow(dead_code)]
    fn _export_signature(
        app: AppHandle,
        findings: Vec<OptimizationFinding>,
        apply_results: Option<Vec<ApplyResult>>,
        generated_at: Option<String>,
    ) -> CmdResult<Option<String>> {
        let _ = (app, findings, apply_results, generated_at);
        unimplemented!()
    }
}
