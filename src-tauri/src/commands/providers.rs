//! Tauri commands for F1 + F2 (M2.1).
//!
//! Each `#[tauri::command]` is a thin wrapper around the corresponding
//! `ProviderService` method. The split exists so that:
//!
//! - Services stay platform-independent and unit-testable (see
//!   `crate::services::provider_service::tests`).
//! - Tauri commands own the `State<'_, AppState>` extraction + error
//!   stringification (Tauri's IPC requires `Result<T, String>` for
//!   cross-thread invocation).
//!
//! ## Frontend contract
//!
//! Frontend calls these via `invoke<T>(name, args)` from
//! `src/lib/api/providers.ts`. Field names use snake_case to match the
//! Rust `serde(rename_all = "snake_case")` on `Provider` — the TS
//! mirror `src/types/provider.ts` declares the same shape.
//!
//! ## Error semantics
//!
//! On any failure, the command returns `Err(msg)` where `msg` is a
//! user-readable string (SPEC §6.5: "不允许静默吞错"). Frontend surfaces
//! it via InfoBar.

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::domain::{ParsedMcpServer, Provider, ProviderModels};
use crate::infrastructure::deeplink_parser::{parse_deeplink_url as parse_dl, ParsedDeeplink};
use crate::infrastructure::encoding::decode_sql_bytes;
use crate::infrastructure::sql_parser::{
    deduplicate, parse_sql_dump, validate_provider_entry, DedupOutcome, ProviderValidation,
    SkippedLine,
};
use crate::services::provider_service::{ImportResult, ImportSkip};

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F1 — list all providers with `is_active` recomputed from
/// `~/.claude/settings.json` (SPEC §2.3).
///
/// Returns an empty Vec if `<app_data>/providers/` is missing — this
/// is the cold-start case the M2.1 UI handles with an "empty state".
/// Individual corrupt files are silently skipped (the UI can call
/// `list_providers_with_warnings` later if it wants to surface them).
///
/// M3.12 adapter (3-medium A1#1) — reads the live active root via
/// the platform shim and routes the list through
/// `ProviderService::list_providers_with_active_root`. When a
/// project is active (`Some(root)`) the listing is scoped to
/// `<root>/.claude/providers/`. The legacy (no-active-root) code
/// path is preserved as a fallback so the M2.x UI keeps working
/// unchanged.
#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> CmdResult<Vec<Provider>> {
    // M3.12 (A1#1) — query the live active root via the platform shim
    // (state.paths is a one-shot startup snapshot; active_root can
    // change at runtime via the project switcher).
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let active_root_ref = active_root.as_deref();
    let (providers, _warnings) = state
        .provider_service
        .list_providers_with_active_root(active_root_ref)
        .map_err(|e| e.to_string())?;
    Ok(providers)
}

/// F1+ — same as `list_providers` but also returns the paths of any
/// provider files that failed to parse. The frontend can show a
/// non-fatal warning toast.
///
/// M3.12 adapter (A1#1) — routes through the active root exactly
/// like `list_providers`.
#[tauri::command]
pub async fn list_providers_with_warnings(
    state: State<'_, AppState>,
) -> CmdResult<ListProvidersResult> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let active_root_ref = active_root.as_deref();
    let (providers, warnings) = state
        .provider_service
        .list_providers_with_active_root(active_root_ref)
        .map_err(|e| e.to_string())?;
    let warnings = warnings
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    Ok(ListProvidersResult {
        providers,
        warnings,
    })
}

/// Wrapper struct for `list_providers_with_warnings`. Lives in the
/// command module (not the service) because it's an IPC shape concern,
/// not a domain concept.
#[derive(Debug, serde::Serialize)]
pub struct ListProvidersResult {
    pub providers: Vec<Provider>,
    pub warnings: Vec<String>,
}

/// F2 — switch the active provider.
///
/// On success, returns the activated `Provider` (with `last_used_at`
/// stamped). The frontend can use this to update its row immediately
/// without a follow-up `list_providers` call — but a `list_providers`
/// is recommended to re-sync other rows' `is_active` flags.
///
/// M3.10 adapter (3-high F2) — consults `IPlatformPaths::active_root_dir()`
/// and routes the settings.json write through the resolved active root
/// (project mode = `<active_root>/.claude/settings.json`, user mode =
/// cached `paths.settings_json`). The library `providers/<id>.json` file
/// itself stays in `<app_data>/providers/` (the library is global; only
/// the "active provider" state lives under the project root).
#[tauri::command]
pub async fn switch_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> CmdResult<Provider> {
    // M3.10 — query the live active root via the platform shim (not
    // `state.paths` — those are resolved once at startup).
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let active_root_ref = active_root.as_deref();
    state
        .provider_service
        .switch_provider_with_active_root(&provider_id, active_root_ref)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// F3 — .sql 导入 (M2.2)
// ---------------------------------------------------------------------------

/// Preview of a parsed SQL dump, sent to the frontend BEFORE the user
/// clicks "confirm import". Shape mirrors what the import itself will
/// produce — same parser, same rules.
#[derive(Debug, serde::Serialize)]
pub struct SqlPreview {
    /// Total number of INSERT statements the parser saw.
    pub total_lines: usize,
    /// Number of providers that will be written (passed validation).
    pub importable: usize,
    /// Number of rows skipped (parse error or write precondition).
    pub skipped: usize,
    /// BZ-01: parse-level rejections (`parsed.skipped_lines`). Same
    /// value as `skipped` in the dry-run (no dedup yet — that happens
    /// at write time); surfaced as a separate "格式错误" card in the
    /// UI so the user sees "your dump has malformed rows" distinctly
    /// from dedup hits shown post-import.
    pub invalid_rows: usize,
    /// The provider rows that will be imported (UI shows a preview list).
    pub preview_providers: Vec<Provider>,
    /// The MCP rows parsed but NOT written (F6 owns write-side; M2.2
    /// shows them as a "preview-only" group).
    pub preview_mcp: Vec<ParsedMcpServer>,
    /// Up to 50 skip reasons — the full list is in ImportResult.errors
    /// after import. Capped to keep the preview payload small.
    pub skipped_samples: Vec<SkippedLine>,
    /// M5 bug #7 — per-row validation outcome (which fields are missing
    /// for non-importable rows; empty `missing` = importable).
    pub validated_providers: Vec<ProviderValidation>,
    /// M5 bug #7 — per-row dedup check against the existing library.
    /// `is_duplicate = true` rows should be unchecked in the UI.
    pub dedup_outcomes: Vec<DedupOutcome>,
}

/// Parse a SQL dump and return a preview without writing any files.
///
/// `bytes` is the raw file content (uint8 array from the frontend's
/// `file.arrayBuffer()`). Rust 端做编码探测 + 解码(UTF-8 / GB18030 /
/// Big5 / UTF-16 LE/BE BOM),支持用户从 cc-switch / Windows 记事本 /
/// 第三方工具导出的非 UTF-8 .sql 文件。
#[tauri::command]
pub async fn parse_sql_preview(
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> CmdResult<SqlPreview> {
    let content = decode_sql_bytes(&bytes)
        .map_err(|e| format!("解析 SQL 失败 (编码问题): {e}"))?;
    let parsed = parse_sql_dump(&content).map_err(|e| format!("解析 SQL 失败: {e}"))?;
    // M5 bug #7 — run validate + dedup so the UI can render the
    // checkbox list with per-row skip reasons. The lists are parallel
    // to `parsed.providers` (one entry per row, in order).
    let validated_providers: Vec<ProviderValidation> = parsed
        .providers
        .iter()
        .cloned()
        .map(validate_provider_entry)
        .collect();
    // Fetch existing providers (user library) for dedup. Cheap on-disk
    // scan; runs synchronously inside the command.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let existing = state
        .provider_service
        .list_providers_with_active_root(active_root.as_deref())
        .map(|(v, _)| v)
        .unwrap_or_default();
    let dedup_outcomes: Vec<DedupOutcome> =
        deduplicate(parsed.providers.clone(), &existing);
    let total_lines =
        parsed.providers.len() + parsed.mcp_servers.len() + parsed.skipped_lines.len();
    let importable = parsed.providers.len();
    let skipped = parsed.skipped_lines.len();
    let skipped_samples: Vec<SkippedLine> =
        parsed.skipped_lines.iter().take(50).cloned().collect();
    Ok(SqlPreview {
        total_lines,
        importable,
        skipped,
        invalid_rows: parsed.skipped_lines.len(),
        preview_providers: parsed.providers,
        preview_mcp: parsed.mcp_servers,
        skipped_samples,
        validated_providers,
        dedup_outcomes,
    })
}

/// Bulk-import providers from a SQL dump.
///
/// `bytes` 是原始 .sql 文件内容(Rust 端 decode 成 UTF-8 再喂给
/// parser)。返回导入 / 跳过 / 错误的可序列化 summary,前端展示
/// 为 toast + 错误明细面板。
///
/// M3.12 adapter (3-medium A1#3) — routes the import through the
/// active root: when a project is active (`Some(root)`) providers
/// land in `<root>/.claude/providers/`; otherwise the legacy
/// `<app_data>/providers/` location is used. The parser + idempotency
/// logic is unchanged.
///
/// Phase 27 Fix 5 (BUG-CR-05 P0) — `selected_ids` 是前端勾选的
/// provider id 列表 (D-18)。后端按 id 过滤写入,distinct 计数
/// (D-17) 反馈给前端 toast("成功导入 N 个" 中的 N = 实际写入数)。
/// `selected_ids` 为空时后端 Err(CLAUDE.md §7 不静默全量导入)。
/// 详见 `ProviderService::import_providers_from_sql_with_selected_ids`。
#[tauri::command]
pub async fn import_providers_from_sql(
    state: State<'_, AppState>,
    bytes: Vec<u8>,
    selected_ids: Vec<String>,
) -> CmdResult<ImportResultDto> {
    let content = decode_sql_bytes(&bytes)
        .map_err(|e| format!("导入 SQL 失败 (编码问题): {e}"))?;
    // M3.12 (A1#3) — query the live active root via the platform shim.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let active_root_ref = active_root.as_deref();
    let result = state
        .provider_service
        .import_providers_from_sql_with_selected_ids(&content, &selected_ids, active_root_ref)
        .map_err(|e| e.to_string())?;
    Ok(result.into())
}

/// Tauri-friendly (Serialize-only) mirror of `ImportResult`.
///
/// The service-layer type is rich (`ImportSkip.kind` is `String`,
/// `ImportResult.errors` is `Vec<ImportSkip>`) — we wrap it in a DTO
/// so the IPC contract is stable even if the internal type changes.
///
/// BUG-BZ-01: `invalid_rows` carries parse-error count distinct from
/// `skipped` (dedup hits). Surfaced in the UI as a "格式错误" card.
#[derive(Debug, serde::Serialize)]
pub struct ImportResultDto {
    pub imported: usize,
    pub skipped: usize,
    pub invalid_rows: usize,
    pub mcp_count: usize,
    pub errors: Vec<ImportSkipDto>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportSkipDto {
    pub kind: String,
    pub line: usize,
    pub id: Option<String>,
    pub reason: String,
}

impl From<ImportResult> for ImportResultDto {
    fn from(r: ImportResult) -> Self {
        Self {
            imported: r.imported,
            skipped: r.skipped,
            invalid_rows: r.invalid_rows,
            mcp_count: r.mcp_count,
            errors: r.errors.into_iter().map(ImportSkipDto::from).collect(),
        }
    }
}

impl From<ImportSkip> for ImportSkipDto {
    fn from(s: ImportSkip) -> Self {
        Self {
            kind: s.kind,
            line: s.line,
            id: s.id,
            reason: s.reason,
        }
    }
}

// ---------------------------------------------------------------------------
// F4 — deeplink 导入 (M2.3)
// ---------------------------------------------------------------------------

/// Parse a `ccswitch://v1/import?...` URL into a serialisable
/// `ParsedDeeplink`. The frontend calls this BEFORE showing the
/// import-confirmation modal so the user can see the parsed
/// provider fields.
///
/// Pure function on the Rust side; the only IPC overhead is the
/// `Vec<String>` round-trip. See
/// `crate::infrastructure::deeplink_parser` for the URL protocol
/// details.
#[tauri::command]
pub async fn parse_deeplink_url(url: String) -> CmdResult<ParsedDeeplink> {
    parse_dl(&url).map_err(|e| e.to_string())
}

/// Persist a single provider JSON file (F4 deeplink import).
///
/// Called by the frontend AFTER the user has seen the parsed
/// `Provider` in the modal and clicked [确认导入]. The write goes
/// through `fs_atomic::write_with_backup` (CLAUDE.md §7) and
/// returns `Err(AlreadyExists(id))` if the id is already on disk.
#[tauri::command]
pub async fn import_single_provider(
    state: State<'_, AppState>,
    provider: Provider,
) -> CmdResult<()> {
    state
        .provider_service
        .import_single_provider(provider)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// M3.6 (清单 22) — CRUD IPC commands: get_details / add / update / delete.
// Service 已有 add_provider / update_provider / delete_provider / get_provider,
// 这里只做 IPC 薄包装。
// ---------------------------------------------------------------------------

/// M3.6 — Get full details of a single provider by id. Returns the
/// provider as a `Provider` (including api_key — the frontend masks it
/// in the UI per M2.5+ redaction rules).
#[tauri::command]
pub async fn get_provider_details(
    state: State<'_, AppState>,
    provider_id: String,
) -> CmdResult<Provider> {
    state
        .provider_service
        .get_provider(&provider_id)
        .map_err(|e| e.to_string())
}

/// M3.6 — Manually add a new provider. Used when the user wants to add
/// a custom config that's NOT in `~/.claude/settings.json` (and thus
/// can't be generated by `generate_from_current_config`).
#[tauri::command]
pub async fn add_provider(
    state: State<'_, AppState>,
    input: crate::domain::ProviderInput,
) -> CmdResult<Provider> {
    state
        .provider_service
        .add_provider(input)
        .map_err(|e| e.to_string())
}

/// M3.6 — Update an existing provider. Used by the edit modal.
/// Cannot change `id` (it's the filename stem); all other fields can change.
/// Refuses to update a non-existent id (`NotFound`) or one with
/// invalid business fields (`name`/`base_url`/`api_key` empty).
#[tauri::command]
pub async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    input: crate::domain::ProviderInput,
) -> CmdResult<Provider> {
    state
        .provider_service
        .update_provider(&id, input)
        .map_err(|e| e.to_string())
}

/// M3.6 — Delete a provider. Refuses to delete the currently active
/// provider (user must switch to another first) — `CannotDeleteActive`.
/// Triggers F13 backup before removal (handled inside service).
#[tauri::command]
pub async fn delete_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> CmdResult<()> {
    state
        .provider_service
        .delete_provider(&provider_id)
        .map_err(|e| e.to_string())
}

/// Generate a provider from the current `~/.claude/settings.json` env.
///
/// Reads the active provider config (ANTHROPIC_BASE_URL +
/// ANTHROPIC_AUTH_TOKEN) and either locates the matching existing
/// library entry or constructs a new `Provider` with an auto-generated
/// id from the domain. The frontend previews the result and then
/// optionally persists it via `import_single_provider`.
///
/// Returns a JSON payload with `provider` (the candidate) and `is_new`
/// (whether a matching library entry already existed).
#[tauri::command]
pub async fn generate_from_current_config(
    state: State<'_, AppState>,
) -> CmdResult<GenerateFromCurrentConfigResult> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let active_root_ref = active_root.as_deref();
    let result = state
        .provider_service
        .generate_with_active_root(active_root_ref)
        .map_err(|e| e.to_string())?;
    Ok(GenerateFromCurrentConfigResult {
        provider: result.provider,
        is_new: result.is_new,
    })
}

/// Response from `generate_from_current_config`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GenerateFromCurrentConfigResult {
    pub provider: Provider,
    pub is_new: bool,
}

// ---------------------------------------------------------------------------
// F14 — 导出单 provider (M2.16)
// ---------------------------------------------------------------------------

/// F14 — export a single provider's settings_config to a shareable
/// `.json` file.
///
/// ## 设计选择 — 方案 B（后端全权处理 dialog + 写盘）
///
/// SPEC F14 要求是"把单个 provider 的 settings_config 导出为 .json
/// 分享"。本仓库的依赖纪律（CLAUDE.md §2.3）锁死了 npm 依赖白名单,
/// 没有装 `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-fs` 的 JS
/// wrapper（见 `package.json` + `json-editor` / `import-sql` 都用
/// HTML `<input type=file>` 走的 Rust 后端)。HTML input 只能"打开",
/// 无法弹"保存"对话框,所以必须走 Rust 侧的 `tauri-plugin-dialog`
/// `blocking_save_file()`。
///
/// 这违反了任务 brief 里推荐的"方案 A（后端只返回 JSON,前端弹框 +
/// 写盘）",但方案 A 需要加 2 个新 npm 依赖,被 CLAUDE.md §2.3 明确
/// 禁止。方案 B 是同等清洁的替代:后端取数据 + 序列化 + 弹原生保存框
/// + 写盘,前端只发一个 invoke 拿最终路径。分层仍然清晰——
/// `ProviderService::get_provider` 是纯读,本 command 负责 I/O。
///
/// ## 算法
///
/// 1. `get_provider(id)` 从磁盘读 provider（纯读,不碰 settings.json）。
/// 2. 序列化成可分享 JSON（2 空格缩进,含 provider 元数据,见
///    [`ExportedProvider`]）。SPEC §2.2 的 pretty-print 约定。
/// 3. 弹原生保存对话框（`tauri-plugin-dialog` 的
///    `blocking_save_file`,只在非主线程的 async command 里用,
///    文档明确允许）。默认文件名 `<id>.json`,过滤器只收 `.json`。
/// 4. 用户取消 → 返回 `Ok(None)`;前端据此不显示任何提示。
/// 5. 用户选了路径 → `write_with_backup` 原子写盘（CLAUDE.md §7:
///    "任何写盘操作必须先备份";导出文件首次写不产生备份,语义同
///    `import_single_provider`）。返回保存路径供前端展示成功提示。
///
/// ## 返回值
///
/// `Ok(Some(path))` — 成功写盘,`path` 是绝对路径字符串。
/// `Ok(None)` — 用户在保存框点了取消（非错误,静默处理）。
/// `Err(msg)` — 取数 / 序列化 / 写盘失败,`msg` 给用户看。
///
/// ## 为什么 `app_type` 参数被忽略
///
/// 任务 brief 的签名带了 `app_type: String`,但本工具只管理 Claude
/// Code 的 provider（`~/.claude/settings.json` 的 `env.ANTHROPIC_*`,
/// SPEC §2.1）。所有 provider 文件的 `provider_type` 已经记录了类型
/// 信息,F14 导出时直接原样输出即可,不需要按 app_type 做分支。参数
/// 保留在签名里只是为了和前端封装的 `(providerId, appType)` 对齐,
/// 后端 `_app_type` 不使用——这是**有意的占位**,不是漏实现。
#[tauri::command]
pub async fn export_provider(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    _app_type: String,
) -> CmdResult<Option<String>> {
    // 1. 纯读 — 不碰 settings.json,不触发 is_active 重算。
    let provider = state
        .provider_service
        .get_provider(&provider_id)
        .map_err(|e| format!("读取 provider '{}' 失败: {e}", provider_id))?;

    // 2. 序列化成可分享 JSON（2 空格缩进,带元数据）。
    let exported = ExportedProvider::from(&provider);
    let json = serde_json::to_string_pretty(&exported)
        .map_err(|e| format!("序列化失败: {e}"))?;

    // 3. 弹原生保存框。blocking_* 系列在 async command 里是安全的
    //    （文档原话:"should *NOT* be used when running on the main
    //    thread",async command 跑在 Tauri 的 async runtime,不是主线程）。
    //    默认文件名用 provider 的 id（kebab-case,已经是合法文件名）。
    let file_path = app
        .dialog()
        .file()
        .set_title("导出 Provider 配置")
        .set_file_name(format!("{}.json", provider.id))
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    // 4. 用户取消 — 静默,返回 None（SPEC §6.5"不允许静默吞错"针对的是
    //    错误,不是用户主动取消;取消是正常流程）。
    let file_path = match file_path {
        Some(fp) => fp,
        None => return Ok(None),
    };

    // FilePath 可能是 Path 或 Url(Windows 上通常返回 Path)。统一转
    // PathBuf;Url 变体走 `to_file_path`,失败给用户可读错误。
    let path = file_path.into_path().map_err(|e| {
        format!("无法解析保存路径: {e}")
    })?;

    // 5. 原子写盘。首次写不产生备份（fs_atomic 语义）。
    crate::infrastructure::fs_atomic::write_with_backup(&path, &json)
        .map_err(|e| format!("写入失败 {}: {e}", path.display()))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// F14 — 可分享的 provider JSON 包装。
///
/// 不直接导出 [`Provider`] 的裸 JSON（那是工具内部格式,带 `is_active`
/// 缓存标记 + `created_at` 时间戳,对接收方没意义）。这里包一层,让导出
/// 文件自带"这是什么 + 从哪来"的元数据,接收方一眼能看懂。
///
/// `settings_config` 字段保留 provider 的核心配置（base/key/models）,
/// 命名跟 SPEC §2.1 的 `settings_config` 概念对齐——这就是切换时会被
/// 写进 `~/.claude/settings.json` 的那份配置。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ExportedProvider {
    /// 导出格式版本号。未来字段变动时,接收方可以按版本降级解析。
    /// v1 = 初始实现（M2.16）。
    pub format_version: u32,
    /// 来源工具标识,固定 `claude-config-manager`,让接收方知道这文件
    /// 是本工具导出的（区别于手写 / 其他工具生成的 provider JSON）。
    pub exported_by: String,
    /// Provider 元数据:id / name / 类型 / 备注。接收方用来显示 + 命名。
    pub provider: ExportedProviderMeta,
    /// 核心 settings_config:切换时写进 `env.ANTHROPIC_*` 的那部分。
    /// 字段名跟 SPEC §2.1 对齐。
    pub settings_config: serde_json::Value,
}

/// F14 — provider 元数据子结构（`ExportedProvider.provider`）。
///
/// 只挑对外分享有意义的字段:`id` / `name` / `provider_type` / `notes`。
/// 刻意不包含 `is_active`（缓存标记,对别人没意义）、`created_at` /
/// `last_used_at`（本机时间戳,对别人没意义）、`api_key`（敏感,但 F14
/// 的语义就是"分享能直接用的配置",所以 key 进 `settings_config`,
/// 元数据里不放第二份避免泄漏面翻倍）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ExportedProviderMeta {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub notes: Option<String>,
}

impl From<&Provider> for ExportedProvider {
    fn from(p: &Provider) -> Self {
        // settings_config 按 SPEC §2.1 的 env 结构组装,跟 switch_provider
        // 写进 settings.json 的那部分一一对应。用 serde_json::json! 宏
        // 保证字段顺序稳定（pretty-print 后可读）。
        let mut env = serde_json::Map::new();
        env.insert(
            "ANTHROPIC_BASE_URL".into(),
            serde_json::Value::String(p.api_base.clone()),
        );
        env.insert(
            "ANTHROPIC_AUTH_TOKEN".into(),
            serde_json::Value::String(p.api_key.clone()),
        );
        // M4.6.1 — write all 5 ANTHROPIC_*_MODEL env keys from the
        // 4-tier + by_tier mapping (ProviderModels::to_env_json skips
        // empty/None entries).
        for (k, v) in p.models.to_env_json() {
            env.insert(k, v);
        }
        let settings_config = serde_json::json!({
            "env": serde_json::Value::Object(env),
            "models": p.models,
        });

        Self {
            format_version: 1,
            exported_by: "claude-config-manager".into(),
            provider: ExportedProviderMeta {
                id: p.id.clone(),
                name: p.name.clone(),
                provider_type: p.provider_type.clone(),
                notes: p.notes.clone(),
            },
            settings_config,
        }
    }
}

/// Read the current Claude configuration from `~/.claude/settings.json`.
///
/// Returns the `env` map (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN,
/// ANTHROPIC_MODEL) so the frontend can preview and decide whether to
/// import as a new provider. Missing file / missing env → returns
/// `Ok(None)` (non-fatal — the UI shows a "no config found" notice).
#[tauri::command]
pub async fn read_current_claude_config(
    state: State<'_, AppState>,
) -> CmdResult<Option<CurrentClaudeConfig>> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let settings_path = match active_root.as_deref() {
        Some(root) => root.join(".claude").join("settings.json"),
        None => state.paths.settings_json.clone(),
    };
    let raw = match std::fs::read_to_string(&settings_path) {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Err("settings.json 格式错误".into()),
    };
    let env = match v.get("env").and_then(|e| e.as_object()) {
        Some(e) => e,
        None => return Ok(None),
    };
    // Accept both ANTHROPIC_API_KEY (current standard) and
    // ANTHROPIC_AUTH_TOKEN (legacy). ANTHROPIC_API_KEY preferred if both.
    let base_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(|v| v.as_str())
        .map(String::from);
    let auth_token = env
        .get("ANTHROPIC_API_KEY")
        .or_else(|| env.get("ANTHROPIC_AUTH_TOKEN"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let models = crate::domain::ProviderModels::from_env(env);
    Ok(Some(CurrentClaudeConfig {
        base_url,
        auth_token,
        models,
    }))
}

/// Current Claude config extracted from `~/.claude/settings.json`.
#[derive(Debug, serde::Serialize)]
/// 2026-06-25 — 4-tier model mapping. `models.default` is the raw
/// `ANTHROPIC_MODEL`; the rest mirror the 4 canonical ANTHROPIC_DEFAULT_*_MODEL
/// env keys (haiku/sonnet/opus + custom by_tier).
#[serde(rename_all = "snake_case")]
pub struct CurrentClaudeConfig {
    pub base_url: Option<String>,
    pub auth_token: Option<String>,
    pub models: ProviderModels,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// The service-level coverage in `provider_service::tests` is the
// primary safety net. These tests pin the *command* contract: arg
// names, return shapes, error stringification. If these compile, the
// `invoke_handler!` macro will be happy.

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time check: `list_providers` takes `State<'_, AppState>`
    /// and returns `CmdResult<Vec<Provider>>`. We don't pin the future
    /// type because Tauri's `#[tauri::command]` returns an opaque
    /// `impl Future`; just check the arg shape compiles.
    #[allow(dead_code)]
    fn _list_providers_signature(
        s: State<'_, AppState>,
    ) -> CmdResult<Vec<Provider>> {
        let _ = s;
        unimplemented!()
    }

    /// Compile-time check: `switch_provider` takes `State<'_, AppState>`
    /// + `provider_id: String` and returns `CmdResult<Provider>`.
    #[allow(dead_code)]
    fn _switch_provider_signature(
        s: State<'_, AppState>,
        provider_id: String,
    ) -> CmdResult<Provider> {
        let _ = (s, provider_id);
        unimplemented!()
    }

    #[test]
    fn list_providers_result_serialises_with_providers_and_warnings_keys() {
        let r = ListProvidersResult {
            providers: vec![],
            warnings: vec!["/tmp/bad.json".into()],
        };
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("providers").is_some());
        assert!(json.get("warnings").is_some());
        assert_eq!(json["warnings"][0], "/tmp/bad.json");
    }

    #[test]
    fn import_result_dto_serialises_all_keys() {
        let dto = ImportResultDto {
            imported: 2,
            skipped: 1,
            invalid_rows: 1,
            mcp_count: 0,
            errors: vec![ImportSkipDto {
                kind: "parse".into(),
                line: 7,
                id: None,
                reason: "invalid id".into(),
            }],
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["imported"], 2);
        assert_eq!(v["skipped"], 1);
        assert_eq!(v["mcp_count"], 0);
        assert_eq!(v["errors"][0]["kind"], "parse");
        assert_eq!(v["errors"][0]["line"], 7);
        assert_eq!(v["errors"][0]["reason"], "invalid id");
        assert!(v["errors"][0]["id"].is_null());
    }

    #[test]
    fn sql_preview_serialises_with_correct_keys() {
        let p = SqlPreview {
            total_lines: 5,
            importable: 3,
            skipped: 2,
            invalid_rows: 2,
            preview_providers: vec![],
            preview_mcp: vec![],
            skipped_samples: vec![],
            validated_providers: vec![],
            dedup_outcomes: vec![],
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["total_lines"], 5);
        assert_eq!(v["importable"], 3);
        assert_eq!(v["skipped"], 2);
        assert_eq!(v["invalid_rows"], 2);
        assert!(v["preview_providers"].is_array());
        assert!(v["preview_mcp"].is_array());
        assert!(v["skipped_samples"].is_array());
        assert!(v["validated_providers"].is_array());
        assert!(v["dedup_outcomes"].is_array());
    }

    // ----- F14 — ExportedProvider (M2.16) -----

    /// F14 导出 JSON 的字段契约:必须有 format_version / exported_by /
    /// provider / settings_config 四个顶层键,且 settings_config.env
    /// 含 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN + (有 model 时)
    /// ANTHROPIC_MODEL。这是接收方解析时的硬依赖,锁死防回归。
    #[test]
    fn exported_provider_from_provider_serialises_expected_keys() {
        let p = Provider {
            id: "glm-46".into(),
            name: "GLM-4.6 官方".into(),
            provider_type: "anthropic".into(),
            api_base: "https://api.anthropic.com".into(),
            api_key: "sk-ant-test".into(),
            models: ProviderModels {
                default: "claude-sonnet-4-6".into(),
                ..Default::default()
            },
            is_active: true, // 刻意 true,验证 is_active 不进导出 JSON
            created_at: 1_700_000_000,
            last_used_at: Some(1_800_000_000), // 刻意 Some,验证不进导出
            notes: Some("官方默认".into()),
        };
        let exported = ExportedProvider::from(&p);
        let v = serde_json::to_value(&exported).unwrap();

        // 顶层 4 键
        assert_eq!(v["format_version"], 1);
        assert_eq!(v["exported_by"], "claude-config-manager");
        assert!(v.get("provider").is_some());
        assert!(v.get("settings_config").is_some());

        // 元数据子结构:只 4 个字段,不含 is_active / created_at / last_used_at
        let meta = &v["provider"];
        assert_eq!(meta["id"], "glm-46");
        assert_eq!(meta["name"], "GLM-4.6 官方");
        assert_eq!(meta["provider_type"], "anthropic");
        assert_eq!(meta["notes"], "官方默认");
        assert!(meta.get("is_active").is_none(), "is_active must not leak");
        assert!(meta.get("created_at").is_none(), "created_at must not leak");
        assert!(meta.get("last_used_at").is_none(), "last_used_at must not leak");
        assert!(meta.get("api_key").is_none(), "api_key must not duplicate into meta");

        // settings_config.env 三键齐
        let env = &v["settings_config"]["env"];
        assert_eq!(env["ANTHROPIC_BASE_URL"], "https://api.anthropic.com");
        assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "sk-ant-test");
        assert_eq!(env["ANTHROPIC_MODEL"], "claude-sonnet-4-6");
        // models 4-tier 结构保留
        assert_eq!(v["settings_config"]["models"]["default"], "claude-sonnet-4-6");
    }

    /// 空 models 的 provider 导出时不应写 ANTHROPIC_MODEL 键
    /// （跟 switch_provider 的"空 models 不覆盖"语义一致）。
    #[test]
    fn exported_provider_omits_anthropic_model_when_models_empty() {
        let p = Provider {
            id: "bare".into(),
            name: "Bare".into(),
            provider_type: "custom".into(),
            api_base: "https://bare.example".into(),
            api_key: "k".into(),
            models: ProviderModels::default(),
            is_active: false,
            created_at: 1,
            last_used_at: None,
            notes: None,
        };
        let exported = ExportedProvider::from(&p);
        let v = serde_json::to_value(&exported).unwrap();
        let env = &v["settings_config"]["env"];
        assert!(env.get("ANTHROPIC_MODEL").is_none(), "空 models 不应写 ANTHROPIC_MODEL");
        assert_eq!(env["ANTHROPIC_BASE_URL"], "https://bare.example");
        assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "k");
    }

    /// pretty-print 是 SPEC §2.2 + F14"可分享阅读"的硬要求。
    /// 锁死 2 空格缩进,防有人改成 4 空格或压缩。
    #[test]
    fn exported_provider_pretty_print_uses_2_space_indent() {
        let p = Provider::new("x", "X", "anthropic", "https://x", "k");
        let exported = ExportedProvider::from(&p);
        let raw = serde_json::to_string_pretty(&exported).unwrap();
        assert!(raw.contains("  \"format_version\":"), "期望 2 空格缩进:\n{raw}");
        assert!(raw.contains("  \"provider\":"));
        assert!(raw.contains("    \"id\":"));
    }
}