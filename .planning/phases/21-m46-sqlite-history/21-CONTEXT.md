# Phase 21: M4.6 SQLite 历史查询 — Context

**Gathered:** 2026-06-22
**Status:** Ready for planning（待主 session 拍板 crate 选型）

<domain>
## Phase Boundary

把当前**用量历史**（cc-switch-main JSONL，Phase 9 ship，commit `4f5df37` 测试已补）+ **备份历史**（本地 snapshot manifest）持久化到本地 SQLite，并暴露按时间/项目/provider/source 查询的 Tauri commands 给前端。

**In scope**:
- 选型 SQLite Rust crate（`rusqlite` 首选，已在 21-RESEARCH.md §3 对比）
- 设计 `usage_history` / `backup_history` schema（已初稿于 21-RESEARCH.md §4）
- 在 `platform::AppPaths` 加 `history_db` 字段（CLAUDE.md §3.2 OS 抽象层）
- 首次启动 migrate：从现有 JSONL + `.bak.<ts>` 文件 backfill 到 SQLite
- 增量同步：F7 UsageService 完成后 + F13 BackupService 完成后 → INSERT OR IGNORE
- 暴露 3 个 Rust commands：`get_usage_history` / `get_backup_history` / `get_history_stats`
- 前端 L1 `history` 页面（用量 tab + 备份 tab + filter bar）
- 单元 + 集成测试（4 个集成测试场景，21-RESEARCH.md §13.2）
- 1 个 Playwright e2e spec（history page 走 tauri-driver）

**Out of scope**:
- FTS5 全文搜索（独立 backlog，1 周估时不包含）
- SQLCipher 加密（SPEC §1.4 不需要；加密未来独立 backlog）
- 跨 process 共享 history.db（单 Tauri process 足够）
- 重新设计 F7 5min cache（不动，SQLite 是持久层）
- 删原始 JSONL / `.bak.<ts>` 文件（保留 30 天 audit）
- async 重构 services（同步 rusqlite + 当前 sync service 风格一致）
- 云备份 / 多窗口 / Telemetry（其他 backlog）

</domain>

<decisions>
## Implementation Decisions

### 1. Crate 选型（待主 session 拍板）

**推荐 `rusqlite = "=0.40.1"` + `rusqlite_migration = "=1.0.0"`**（bundled feature）。

理由（详见 21-RESEARCH.md §3）：
- 同步 API 与项目风格一致（8 个 services 都是 sync）
- MSRV 低，无额外 Rust 版本要求
- bundle 影响最小（+~600KB）
- 不引入 async runtime 重构成本
- 与 F7/F13 services 集成最自然（同一 process 内直连）

**备选**：`tauri-plugin-sql`（Tauri 官方 plugin，内部 sqlx + bundled SQLite）—— 如果未来要前端直查再切换。Phase 21 不切，因为 1 周估时不包含 IPC 重构。

**否决**：`sqlx`（async runtime 与 sync services 冲突）、`diesel`（DSL 心智与现有 service 风格差异大）。

### 2. 存储位置（待主 session 拍板）

**推荐全局 `<app_data>/history.db`**（与 `backups_dir` / `marketplaces_dir` / `logs_dir` 平级）。

理由：
- CLAUDE.md §3.2 OS 抽象层复用 `IPlatformPaths::resolve()` 的 `app_data` 字段
- SPEC §1.4 "无服务器依赖" = 本地单文件 = OK
- 跨 project 共享 = 一次 F7 切换能查所有 project 历史
- 项目级过滤用 SQL `WHERE project_id = ?`（schema 已含 `project_id` 列）

**否决**：
- 项目级 `<active_root>/.claude/history.db`：违反 M3.10 "用户/项目双模式" 设计
- 双层（全局 index + 项目 data）：1 周估时不可能

### 3. Migration 路径（已初稿于 21-RESEARCH.md §6）

- **首次启动**: `AppState::build()` 内调用 `rusqlite_migration::Migrations::new(...).to_latest(&mut conn)`，版本=0 时跑 backfill（扫 JSONL + `.bak.<ts>`）
- **增量同步**: `UsageService::compute_usage_from_jsonl` 末尾 + `BackupService::write_with_backup` 末尾各加 1 处 `INSERT OR IGNORE`
- **失败回滚**: migration 事务自动回滚 / `INSERT OR IGNORE` 单条失败不阻塞主流程 / SQLite 文件损坏 → 删 history.db 重试
- **数据保留**: 用量 1 年 + 备份 1 年；定期 cleanup `DELETE FROM ... WHERE timestamp < now - 1y`

### 4. Schema 设计（已初稿于 21-RESEARCH.md §4，待 plan 阶段细化）

- `usage_history` 表：12 列（id / provider_id / model / session_id / project_id / timestamp / 4 种 token / cost_usd / source_file / source_line / created_at）+ UNIQUE(provider_id, session_id, source_line) 去重 + 3 个索引
- `backup_history` 表：10 列（id / backup_id / project_id / created_at / source / size_bytes / path / manifest_hash / original_path / is_pre_restore / created_by）+ UNIQUE(path, manifest_hash) 去重 + 3 个索引
- `schema_version` 表（rusqlite_migration 内部使用）
- WAL 模式开启（`PRAGMA journal_mode=WAL`）

### 5. 不做的事（明确排除，详见 21-RESEARCH.md §15）

FTS5 / SQLCipher / 跨 process 共享 / 自动 sync 云 / 删原始文件 / 改 F7 cache / 前端直连 SQLite / async 重构。

### 6. Claude's Discretion

- 具体 Cargo.toml 位置 + 注释风格（仿照现有 `url = "=2.5.8"` / `uuid = "=1.23.3"` 模式）
- `rusqlite_migration` 写 inline vs 文件 include（建议 inline，3 个 migration 不多）
- 集成测试 fixture 复用 `project_service.rs:31-36` 已有的 `app_data: tmp.path().join("app_data")` 模式
- 前端 L1 page 文件路径（建议 `src/pages/history/index.tsx` + `src/pages/history/__tests__/`，与现有 pages 结构对齐）
- Playwright e2e spec 路径（建议 `tests/e2e/m4-6-history.spec.ts`，与 M1.8 spec 对齐）
- Smoke test 验证脚本（CLAUDE.md §9.4 4 项 + 1 项额外：history.db 文件创建且 schema 完整）

</decisions>

<code_context>
## Existing Code Insights

### 受影响文件（grep 核实 2026-06-22）

#### 1. `src-tauri/src/platform/traits.rs:29-49`
**当前 `AppPaths` 结构体**（7 个字段）：
- `home`, `app_data`, `settings_json`, `claude_json`, `backups_dir`, `marketplaces_dir`, `logs_dir`

**改动**: 加 `history_db: PathBuf` 字段（`<app_data>/history.db`）

#### 2. `src-tauri/src/platform/windows/paths.rs:46-93`
**当前 `WindowsPaths::resolve()` + `ensure_dirs()`**：
- resolve 返回 7 字段 AppPaths
- ensure_dirs 遍历 4 个目录 create_dir_all

**改动**: resolve 加 `let history_db = app_data.join("history.db");`；ensure_dirs 不需新加（`<app_data>` 已被创建）

#### 3. `src-tauri/src/platform/macos/paths.rs`
**当前 Mac impl**: 同样 7 字段 AppPaths 结构

**改动**: 同步加 `history_db` 字段（保持 trait 契约）

#### 4. `src-tauri/src/services/usage_service.rs:642`
**当前 `compute_usage_from_jsonl` 函数末尾**

**改动**: 函数末尾加 `for record in parsed: INSERT OR IGNORE INTO usage_history`（需 HistoryService 实例）

#### 5. `src-tauri/src/services/backup_service.rs`
**当前 `backup_now` (line 292) + `write_with_backup` (in fs_atomic.rs) 末尾**

**改动**: 加 INSERT OR IGNORE INTO backup_history（需 path / size_bytes / manifest_hash）

#### 6. `src-tauri/src/services/mod.rs` / `src-tauri/src/app_state.rs`
**当前**: `AppState` 持有 8 个 `Arc<Service>`（provider/mcp/backup/usage/optimizer/resource/marketplace/project）

**改动**: 加 `pub history_service: Arc<crate::services::history_service::HistoryService>`

#### 7. `src-tauri/src/lib.rs:98`
**当前**: `.plugin(tauri_plugin_store::Builder::default().build())`

**改动**: 不动（tauri-plugin-store 仍用作配置 KV）；可选加 `tauri-plugin-sql`（**不推荐**，理由见决策 1）

#### 8. `src-tauri/Cargo.toml:20-58`
**当前**: 12 个 tauri-plugin 锁版本

**改动**: 加 2 个 crate（version 锁，按 CLAUDE.md §2.3）：
- `rusqlite = "=0.40.1"` + features `["bundled"]`
- `rusqlite_migration = "=1.0.0"`

#### 9. `src-tauri/src/app_state.rs:81-87`
**当前 `AppState::build()`**: 调 `paths_impl.resolve()` + `ensure_dirs()`，构造 8 个 service

**改动**: 在构造 8 个 service 前，先开 SQLite 连接 + 跑 migration + 必要时 backfill

### 可复用资产

- `src-tauri/src/platform/traits.rs::AppPaths`（M1.2 引入，M3.10 加 active_root_dir 已证明扩展模式）
- `services/usage_service.rs::UsageService::with_ttl`（M3.8 测试用 TTL constructor 模式可借鉴给 HistoryService）
- `src-tauri/tests/project_service.rs:31-36` 测试 fixture 模式（`app_data: tmp.path().join("app_data")`）
- `scripts/run-e2e.sh`（M1.8 + Phase 18 验过）+ `scripts/kill-app.sh` + `scripts/build-and-ship.sh`
- `src/pages/` 现有 L1 页面结构（provider-switch / usage-query / backup-restore / ...）

### Established Patterns

- **CLAUDE.md §3.2 OS 抽象层**: 任何路径解析走 `AppPaths`（不散落 `dirs::*`）
- **CLAUDE.md §2.3 version 锁**: Cargo.toml 用 `=X.Y.Z`（已有 `url = "=2.5.8"` / `uuid = "=1.23.3"` / `tauri-plugin-* = "=X.Y.Z"`）
- **CLAUDE.md §7 备份策略**: 任何写盘操作前先 backup
- **CLAUDE.md §5.3 三层测试**: 单元（`cargo build --tests`）+ 集成 + UI e2e
- **M3.10 active_root_dir 接入模式**: service 接受 `Option<&Path>` 参数，已是 12/13 plugin 适配标准模式（v2.0-BACKLOG §A1）

### Integration Points

- `AppState::build()` → 构造 HistoryService → 注入 8 个现有 service（修改它们的 `new()` 签名加 `history: Arc<HistoryService>`，或用 `set_history(Arc<HistoryService>)` setter）
- `UsageService` 完成 JSONL 扫描 → 调 `history_service.record_usage(row)` → INSERT OR IGNORE
- `BackupService` 完成 .bak.<ts> 写入 → 调 `history_service.record_backup(entry)` → INSERT OR IGNORE
- 前端 React → invoke('get_usage_history', filter) → Rust command → HistoryService query → 返回 Vec<Row>

### 与现有 schema 兼容性

- 不动 `tauri-plugin-store`（继续用作 providers.json / projects.json 等配置）
- 不动 `providers.json` / `projects.json` 文件
- 不动 F7 in-memory 5min cache（SQLite 是持久层，cache 是加速层）
- 不动 `.bak.<ts>` 文件（30 天后清理，**保留 audit trail**）

</code_context>

<specifics>
## Specific Ideas

### Schema 设计要点（plan 阶段细化）

- **usage_history.UNIQUE(provider_id, session_id, source_line)**: 重 migrate / 增量同步都靠这个去重（INSERT OR IGNORE 幂等保证）
- **backup_history.UNIQUE(path, manifest_hash)**: 同 path 同 hash 不重复（同一 backup_now 多次重试安全）
- **WAL 模式**: `PRAGMA journal_mode=WAL` 在 `Connection::open` 后立即设置；启动时再 `PRAGMA wal_checkpoint(TRUNCATE)` 回收 WAL 文件
- **索引策略**: 时间戳 DESC 索引（timeline 倒序扫）+ (project_id, timestamp) 复合索引（按项目过滤）+ source 索引（按类型分组）

### 增量同步的关键代码点（plan 阶段实施）

```rust
// UsageService::compute_usage_from_jsonl 末尾伪代码
for parsed_line in parse_results {
    self.history_service.record_usage(UsageHistoryRecord {
        provider_id: current_provider.id.clone(),
        model: parsed_line.model,
        session_id: parsed_line.session_id,
        project_id: active_root_dir.map(|p| p.display().to_string()),
        timestamp: parsed_line.timestamp,
        input_tokens: parsed_line.input_tokens,
        output_tokens: parsed_line.output_tokens,
        cache_read_tokens: parsed_line.cache_read_tokens,
        cache_write_tokens: parsed_line.cache_write_tokens,
        cost_usd: parsed_line.cost,
        source_file: parsed_line.file_path,
        source_line: parsed_line.line_number,
    })?;
    // INSERT OR IGNORE 内部处理 UNIQUE 冲突（不报错）
}
```

### 失败回滚的关键代码点（plan 阶段实施）

```rust
// AppState::build() 内的初始化顺序
1. paths_impl.resolve() + ensure_dirs()        // 现有
2. open history.db Connection                  // 新增
3. migrations.to_latest(&mut conn)             // 新增（事务保证）
4. if schema_version = 0:                     // 新增（首次启动）
     run_backfill_jsonl_to_history(&conn)     // scan ~/.claude/projects/**/*.jsonl
     run_backfill_bakts_to_history(&conn)     // scan <app_data>/backups/** + <claude_dir>/**/*.bak.<ts>
     write_schema_version("initial-backfill")
5. construct 8 existing services               // 现有（注入 history_service）
```

### 测试 fixture 复用

仿照 `src-tauri/tests/project_service.rs:31-36` 的模式：
```rust
let tmp = tempfile::tempdir().unwrap();
let paths = AppPaths {
    app_data: tmp.path().join("app_data"),
    history_db: tmp.path().join("app_data/history.db"),
    // ... 其他字段
};
```

### Frontend 页面骨架（plan 阶段定）

`src/pages/history/index.tsx`:
- L1 page（与 `src/pages/usage-query/`, `src/pages/backup-restore/` 平级）
- 2 个 tabs（用量 / 备份）
- filter bar: 时间范围 picker + 项目 select + provider select + 类型 select
- 表格: react-table 或简单 `<table>`（与现有 pages 风格对齐，无 Tailwind）

</specifics>

<deferred>
## Deferred Ideas

- **FTS5 全文搜索**（独立 backlog）—— 当 history.db 增长到 100MB+ + 用户反馈搜索慢时启动
- **SQLCipher 加密**（独立 backlog）—— 当 SPEC §1.4 扩展允许本地加密时启动
- **history.db 自动 sync 到云**（违反 SPEC §1.4，**不做**）
- **跨 process 共享 history.db**（CLAUDE.md §2.1 反对过早复杂化，单 process 足够）
- **删除原始 JSONL / .bak.<ts>**（保留 30 天 audit）
- **重新设计 F7 5min cache**（不动）
- **加 SQL 写入到前端**（攻击 surface 增加，不值得）
- **async 重构 services**（1 周估时不包含）
- **history.db 自动 backup**（未来独立 backlog，与 F13 backup 增强 Phase 2 关联）
- **迁移到 tauri-plugin-sql**（仅当未来前端需要直查 SQL 时再切）

---

## 依赖关系

### 上游（必须先完成）
- 无（Phase 21 独立功能，可直接启动）
- **可与 Phase 19 (云备份) / Phase 20 (updater UI) 并行**（3 个都是独立 backlog）

### 下游（被 Phase 21 阻塞）
- 无（Phase 21 是叶子节点）

### 横向
- 与 Phase 19 (云备份) 有 schema 关联：未来云备份可能要把 `backup_history` 表导到云端 → Phase 19 启动时需考虑 schema 兼容
- 与 Phase 20 (updater UI) 无关联
- 与 v2.0-BACKLOG §A1 M3.10-adapter 接入完成度无关（Phase 21 不依赖 active_root_dir 接入 #9 F18 scan_optimizations）

---

## 风险与缓解（详见 21-RESEARCH.md §14）

| 风险 | 等级 | 缓解 |
|---|---|---|
| rusqlite 0.40.1 + rusqlite_migration 兼容性 | 低 | plan 阶段 spike test 验证 |
| SQLite bundled +600KB binary | 低 | release UPX 压 |
| 启动 backfill 慢 | 中 | 增量 + 必要时后台 async |
| history.db 损坏 | 中 | 自动 backup + 重置 + 重新 backfill |
| 与 F7 cache 5min TTL 冲突 | 低 | cache 保留，SQLite 是持久层 |
| WAL 文件残留 | 低 | 启动时 `wal_checkpoint(TRUNCATE)` |
| Mac 平台未实跑 | 中 | 同步 Mica fallback 教训：Mac impl 防御性 fallback |
| Cargo.toml 12 个 plugin 已锁，新增 2 个 crate 影响 lockfile | 中 | plan 阶段 `cargo update --dry-run` 验证 |

---

## 关键决策点（主 session 必须问用户）

### 决策 1: Crate 选型 — `rusqlite` vs `tauri-plugin-sql`

- **A** `rusqlite = "=0.40.1"` + `rusqlite_migration = "=1.0.0"`（推荐，同步 API + bundle 影响最小）
- **B** `tauri-plugin-sql`（如未来要前端直查）
- **C** 暂缓（不在 v3.0 主线）
- **必须问**（CLAUDE.md §11.6 必须问用户类）

### 决策 2: 存储位置 — 全局 vs 项目级

- **A** 全局 `<app_data>/history.db`（推荐，与 backups_dir 平级）
- **B** 项目级 `<active_root>/.claude/history.db`（违反 M3.10 双模式）
- **C** 双层（复杂，1 周估时不可能）
- **可主 session 自主决定**（CLAUDE.md §11.6 可自主决定类，但建议向用户确认）

### 决策 3: 启用时机 — v3.0 round 2 vs 推迟

- **A** v3.0 round 2 启动（与 Phase 19/20 同期）
- **B** 按需启动（推荐，v3.0 主线是 Wave 1+2）
- **可主 session 自主决定**

---

## 下一步（主 session 拍板后）

1. 主 session 派 `gsd-plan-phase` 写 `21-PLAN.md`（基于 21-RESEARCH.md §4 schema 初稿 + §6 migration 思路 + §16 估时分解）
2. plan-checker 验证 plan 质量
3. 主 session 派 `gsd-execute-phase` 执行（原子 commit，smoke test）

---

*本文件由 Phase 21 research 子代理生成（2026-06-22，纯文档任务，不写代码 / 不编译 / 不 ship / 不 commit — 项目内文件）。memory 沉淀已 git commit 到 `~/.claude/shared-memory/`。*
