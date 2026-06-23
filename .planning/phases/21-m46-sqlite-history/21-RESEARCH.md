# Phase 21: M4.6 SQLite 历史查询 — Research

> **生成日期**: 2026-06-22
> **类型**: research（pre-plan，零代码）
> **目标**: 在写 plan/impl 前先调研 SQLite 接入路径 + crate 选型 + 兼容性
>
> 联网用 `cs-web-fetch` 技能（CLAUDE.md §8 / memory `feedback/cs-web-fetch-for-internet.md`）。
> 本文件**不写任何实现代码**——只放 crate 对比 + schema 初稿 + migration 思路。
> 主 session 拍板 crate 选型后，才会另外派 subagent 走 `plan-phase` → `execute-phase`。

---

## 1. 目标回顾

把当前**用量历史**（cc-switch-main JSONL，Phase 9 ship，commit `4f5df37` 测试已补）+ **备份历史**（本地 snapshot manifest）持久化到 SQLite，并提供按时间/项目/类型查 SQL API。

- **估时**: 1 周（v2.0-BACKLOG §A3）
- **数据源**:
  1. **用量历史**: `<claude_dir>/projects/<encoded-path>/*.jsonl`（每次 claude-code 会话结束追加）
  2. **备份历史**: `<app_data>/backups/**/*.bak.<ts>` + `<claude_dir>/**/*.bak.<ts>`（每次写盘前 `fs_atomic::write_with_backup` 自动产生）
- **SPEC §1.4 硬约束**: 无服务器依赖 → SQLite 文件 = 本地 = 不违反
- **CLAUDE.md §3.2 OS 抽象**: 文件位置必须走 `IPlatformPaths`（不散落 OS 判断）

---

## 2. 现有 Tauri v2 storage 抽象 — 评估 `tauri-plugin-store` 能否替代 SQLite

### 2.1 现状

- 项目已锁 `tauri-plugin-store = "=2.4.3"`（M1.6 ship，Cargo.toml:54）
- `tauri-plugin-store` 是 **key-value JSON store**：每个 store = 一个 JSON 文件，所有值都是 `serde_json::Value`
- 已在 `lib.rs:98` 注册为 plugin（仅注册，无业务使用）
- 文档：https://v2.tauri.app/plugin/store/

### 2.2 `tauri-plugin-store` vs SQLite — 关键差异

| 维度 | tauri-plugin-store | SQLite |
|---|---|---|
| 数据模型 | K-V JSON（嵌套对象） | 关系型表 + 索引 |
| 容量上限 | 整个 JSON 一次性 load/save → 内存爆 | 流式 query，1 GB+ OK |
| 查询能力 | 必须全量拉 + 内存 filter | SQL: WHERE / GROUP BY / ORDER BY / 聚合 |
| 并发写 | 整个文件 lock + 整篇序列化 | 行级 lock + WAL |
| 时间序列 | 自己排序 + 分页 | 索引扫，O(log n) |
| backup 备份迁移 | 简单（cp 1 个文件） | 简单（cp 1 个文件，但需 SQLite 格式兼容） |
| Tauri 集成成本 | 零（plugin 已注册） | 需 `tauri-plugin-sql` 或直接 `rusqlite` |

### 2.3 为什么不能只用 `tauri-plugin-store`

F7 用量 + F13/F19 备份需要：

1. **按时间窗聚合**（5h / 1w / 1m）→ 需要 `WHERE timestamp > now - interval` + `GROUP BY day`
2. **按 provider / project 过滤** → 需要 `WHERE provider_id = ? AND project_id = ?`
3. **按 backup 类型分组**（settings / claude / provider / manual）→ 需要 `WHERE source = ? ORDER BY created_at DESC`
4. **跨 N 个月的历史数据** → 用量 JSONL 一个月可能 100MB+ JSONL 数据；备份 timeline 可能 50+ 个快照

**结论**：`tauri-plugin-store` 是为配置（`settings.json` / `projects.json` / `providers.json`）设计的，不是为历史时间序列设计的。**必须 SQLite**。

`tauri-plugin-store` 保留为 settings KV 用（已有 `providers.json` 等配置），不与 Phase 21 冲突。

---

## 3. SQLite Rust crate 选型对比

### 3.1 候选清单

| Crate | 最新版（2026-06-22） | 月下载量 | 维护活跃度 | License |
|---|---|---|---|---|
| **rusqlite** | 0.40.1（2026-06-06） | 8.89M / 月 | 高（97 contributors, 73 releases） | MIT |
| **sqlx** | 0.9.0（2026-05 发布） | — | 高（LaunchBadge 团队维护） | MIT / Apache-2.0 |
| **diesel** | 2.3.10（2026-06-05） | — | 高（diesel-rs/Core） | MIT / Apache-2.0 |

### 3.2 详细对比

| 维度 | rusqlite | sqlx | diesel |
|---|---|---|---|
| **类型** | FFI 同步绑定 + 包装 | async + compile-time checked queries | ORM + Query Builder |
| **底层** | 直接 `libsqlite3-sys` → C SQLite | `libsqlite3-sys` 同 | 独立 SQLite driver |
| **MSRV** | 最新 stable（无需特殊） | **v1.94.0** | v1.86.0 |
| **async 支持** | 同步（需自己 wrap `tokio::task::spawn_blocking`） | **原生 async / await** | 同步（无 async 支持） |
| **compile-time SQL check** | 无（运行时 prepare 失败） | **有**（`query!` / `query_as!` 宏，需 DATABASE_URL 或 offline cache） | 有（DSL 类型驱动） |
| **migration 工具** | 手动写 SQL（`rusqlite_migration` 第三方） | 官方 `sqlx::migrate!` 宏 + `sqlx-cli` | 官方 `diesel migration` CLI |
| **Tauri v2 兼容** | 兼容（最常用） | 通过 `tauri-plugin-sql` 暴露给 JS（plugin 内部用 sqlx） | 兼容（同步 ORM） |
| **Bundle size 影响** | `bundled` feature 把 SQLite C 源编进 → **+ ~600KB binary**（Windows 静态链接） | 同 rusqlite（plugin 也用 bundled） | 同上 |
| **学习曲线** | 低（直接调 SQL） | 中（async runtime + macro） | 高（DSL + schema 文件 + ORM 心智） |
| **deadline / 风险** | 无 | async runtime 与项目当前 tokio 用法需协调 | ORM 心智与现有 services 风格差异大 |

### 3.3 Tauri 生态现成方案：`tauri-plugin-sql`

- 官方 plugin（**M4.6 backlog 候选**之一）
- 内部用 `sqlx`（async + sqlite）
- 文档：https://v2.tauri.app/plugin/sql/
- 注册后 JS 端 `import Database from '@tauri-apps/plugin-sql'; await Database.load('sqlite:history.db')`
- **优点**: 与 Tauri v2 完美集成；migration 工具内置；JS 端可直接 query
- **缺点**:
  1. 必须**版本锁**（CLAUDE.md §2.3），需要查 `tauri-plugin-sql` 最新稳定版
  2. 前端用 SQL（暴露 SQL 给 webview）→ **增加 attack surface**，但本项目 webview 内有 React + 大量 IPC，SQL 也只在 Rust commands 内部用
  3. **不能在 Rust services 内部直接用** — 需经 plugin 暴露的 command（IPC 开销）— 或者仍然在 Rust 侧直接 `sqlx::SqlitePool`（绕开 plugin），同时 plugin 仅供 JS fallback

### 3.4 选型建议

**首选 `rusqlite`（bundled feature）+ 第三方 `rusqlite_migration` 写 migration 脚本**，原因：

1. **同步 API 与项目风格一致**: 项目目前所有 services 是同步（`ProviderService` / `BackupService` / `UsageService` 都是 sync），加 async 重构所有 services 得不偿失
2. **MSRV 低**: 无需额外 Rust 版本要求
3. **学习曲线低**: 直接 `Connection::open` + `prepare` + `query_map`，不引入 DSL 心智
4. **bundle 影响可控**: `bundled` feature 把 SQLite C 源编进 binary，~600KB 增长（vs 当前 4MB debug exe，~15% 增长）
5. **migration 工具**: `rusqlite_migration` crate 是 stdlib-only，version 锁定
6. **与 F7 / F13 services 集成最自然**: `UsageService` 的 5-min cache + `BackupService` 的 timeline 扫描 → 在 SQL 写完时同步插入 history 表
7. **CLAUDE.md §2.3 version 锁**: `rusqlite = "=0.40.1"` 即可锁定（已有 `url = "=2.5.8"` / `uuid = "=1.23.3"` 先例）

**备选 `tauri-plugin-sql`**: 如果未来要**前端直接 query**（如 React 内画图表直接拉 SQLite 而不绕 Rust），再切 plugin。现在不切是因为：
- 现有 commands 都在 Rust 侧（`get_usage_history` / `get_backup_history`）
- 引入 plugin = 多一层 IPC + 多一个 plugin 依赖
- 1 周估时不包含 IPC 重构

**否决 `sqlx` / `diesel`**:
- `sqlx` 的 compile-time check 优势对本项目价值有限（schema 简单，10 几个表，不是 100+ 表的 SaaS）
- `sqlx` 的 async runtime 与本项目 `tauri` 同步命令风格冲突
- `diesel` 的 DSL 心智与现有 8 个 service（直接调 `std::fs::*`）的风格差异大

### 3.5 版本锁定计划

```toml
# Cargo.toml
[dependencies]
# M4.6 Phase 21 — SQLite 本地历史查询
rusqlite          = "=0.40.1"  # F7 用量历史 + F13/F19 备份历史持久化
rusqlite-migration = "=1.0.0"   # 第三方 migration runner（stdlib-only）
```

> `rusqlite-migration` 选 1.0.0 是因为它在 2024 进入 stable；如果用旧版需查 lockfile 兼容性（CLAUDE.md §2.3 读文档先）。

---

## 4. Schema 设计初稿

> 暂不放完整 SQL（plan 阶段才定），只放表结构 + 索引 + 关键约束。

### 4.1 `usage_history` 表 — F7 用量历史

```text
usage_history
├── id                INTEGER PRIMARY KEY  (autoincrement)
├── provider_id       TEXT NOT NULL         (e.g. "anthropic-official")
├── model             TEXT NOT NULL         (e.g. "claude-3-5-sonnet-20241022")
├── session_id        TEXT NOT NULL         (e.g. cc-switch JSONL file basename)
├── project_id        TEXT                  (NULL = user-level, 关联 projects.id)
├── timestamp         INTEGER NOT NULL      (Unix epoch seconds, indexed)
├── input_tokens      INTEGER NOT NULL      (default 0)
├── output_tokens     INTEGER NOT NULL      (default 0)
├── cache_read_tokens INTEGER NOT NULL      (default 0)
├── cache_write_tokens INTEGER NOT NULL     (default 0)
├── cost_usd          REAL NOT NULL         (lookup_pricing 后)
├── source_file       TEXT NOT NULL         (原始 JSONL 路径，便于 trace)
├── source_line       INTEGER NOT NULL      (JSONL 内行号)
├── created_at        INTEGER NOT NULL      (写入 SQLite 的时间，audit)
└── UNIQUE(provider_id, session_id, source_line)  -- 去重，重 migrate 不重复
```

**索引**:
- `idx_usage_timestamp (timestamp)` — 时间窗查询
- `idx_usage_provider_timestamp (provider_id, timestamp)` — 按 provider + 时间
- `idx_usage_project (project_id, timestamp)` — 按 project 聚合

### 4.2 `backup_history` 表 — F13/F19 备份历史

```text
backup_history
├── id                INTEGER PRIMARY KEY  (autoincrement)
├── backup_id         TEXT NOT NULL UNIQUE (UUID v4, generated at backup_now)
├── project_id        TEXT                  (NULL = user-level)
├── created_at        INTEGER NOT NULL      (Unix epoch seconds, indexed)
├── source            TEXT NOT NULL         ('settings' | 'claude' | 'provider' | 'manual' | 'unknown')
├── size_bytes        INTEGER NOT NULL
├── path              TEXT NOT NULL         (绝对路径，参考 backup_scanner::BackupEntry)
├── manifest_hash     TEXT NOT NULL         (SHA-256 hex of file content, 64 char)
├── original_path     TEXT NOT NULL         (备份前的源文件路径)
├── is_pre_restore    INTEGER NOT NULL DEFAULT 0  (bool, .pre-restore 标记)
├── created_by        TEXT                  (NULL = fs_atomic 自动; 'manual' = 手动; 'restore' = 还原前双备份)
└── UNIQUE(path, manifest_hash)  -- 同 path 同内容不重复
```

**索引**:
- `idx_backup_created_at (created_at DESC)` — 时间线倒序
- `idx_backup_project_created (project_id, created_at DESC)` — 按项目 timeline
- `idx_backup_source (source, created_at)` — 按类型分组

### 4.3 `schema_version` 表 — migration tracking

```text
schema_version
├── version    INTEGER PRIMARY KEY
├── applied_at INTEGER NOT NULL
└── description TEXT NOT NULL
```

`rusqlite_migration` 内部就是这模式，遵其约定即可。

### 4.4 关键设计选择

| 选择 | 决定 | 理由 |
|---|---|---|
| **去重** | UNIQUE(provider_id, session_id, source_line) / UNIQUE(path, manifest_hash) | 重 migrate 不重复插入 |
| **软删除** | 不做（直接 DELETE + 定期 VACUUM） | 1 周估时不做；如未来需要 → 加 `deleted_at` 列 |
| **JSON 全文存** | 不存（拆列存） | 查询效率 + 不依赖 SQLite JSON1 extension |
| **分区** | 不做（单文件） | 1 GB 内的 SQLite 不需要分区；CLAUDE.md §2.1 反对过早复杂化 |
| **FTS5 全文搜索** | 不做 | 1 周估时不包含；如未来需要 → SQLite FTS5（memory `reference/sqlite-fts5-bm25-score-direction.md`） |
| **WAL 模式** | 开启（`PRAGMA journal_mode=WAL`） | 写不阻塞读，单 process 够用 |
| **encryption** | 不做 | SPEC §1.4 "无服务器依赖" 包含数据明文；SQLCipher 是未来独立 backlog |

---

## 5. 存储位置

### 5.1 选项 A（推荐）: 全局 history.db

```text
Windows: %APPDATA%\ClaudeConfigManager\history.db
macOS:   ~/Library/Application Support/ClaudeConfigManager/history.db
Linux:   $XDG_DATA_HOME/ClaudeConfigManager/history.db
```

- 与 `backups_dir` / `marketplaces_dir` / `logs_dir` 平级
- 单文件 = 简单备份（CLAUDE.md §7）
- 跨 project 共享 = 一次 F7 切换能查所有 project 历史
- 估时：1 周范围可实现

### 5.2 选项 B: 项目级 history.db

```text
<active_root>/.claude/history.db
```

- 与 active_root_dir 绑定，project 隔离
- 缺点：用户切换 project = 看不到其他 project 历史（违反 F7 §4.5 跨项目对比需求）
- 估时同上，但**违反 M3.10 "用户/项目双模式" 设计**

### 5.3 选项 C: 双层（全局 index + 项目 data）

- 复杂度爆炸
- 1 周估时内不可能

### 5.4 决定

**选项 A：全局 `<app_data>/history.db`**。理由：

1. **CLAUDE.md §3.2 OS 抽象层** 复用 `IPlatformPaths::resolve()` 的 `app_data` 字段（在 `platform/traits.rs:33-35` 已定义）
2. SPEC §1.4 "无服务器依赖" = 本地单文件 = OK
3. 项目级过滤用 SQL `WHERE project_id = ?` 即可（schema 4.1 / 4.2 已含 `project_id` 列）
4. 备份策略简单：`history.db` 与 `backups_dir` 平级，定期备份

需在 `platform/traits.rs::AppPaths` 加 `history_db: PathBuf` 字段（**plan 阶段改 OS 抽象层**，非 research）。

### 5.5 与现有 storage 的关系

| 数据 | 现有 | 迁移到 SQLite？ |
|---|---|---|
| `providers.json` | `tauri-plugin-store` / serde JSON | 不迁（配置类，KV 合适） |
| `projects.json` | 同上 | 不迁 |
| `usage.json` | 用量缓存（5min TTL） | **不迁**（缓存不入库） |
| cc-switch JSONL | `<claude_dir>/projects/.../*.jsonl` | **migrate 到 `usage_history`**（migrate 完保留 JSONL 30 天备份，30 天后删） |
| `*.bak.<ts>` 文件 | `<app_data>/backups/` + `<claude_dir>/` | **migrate 到 `backup_history`**（migrate 完保留 .bak.<ts> 文件 30 天） |
| Settings.json 备份时序 | backup_scanner 扫描 | **同时**走 SQLite（list_backups 加 SQL query 优先 + JSON 扫描兜底） |

---

## 6. Migration 路径（从 JSONL + .bak.<ts> → SQLite）

### 6.1 首次启动检测

```text
AppState::build()  (在 lib.rs:run 启动时)
  → sqlite_open(history_db)
  → rusqlite_migration::Migrations::new(...).to_latest(&mut conn)
     (内部: 读 schema_version 表 → 若 version=0 跑全部 migration)
  → if schema_version = 0:  (即全新数据库, 第一次启动)
       → "migrate from JSONL" job:
         scan <claude_dir>/projects/**/*.jsonl
         for each line: insert into usage_history
         (用 INSERT OR IGNORE + UNIQUE 约束去重)
       → "migrate from .bak.<ts>" job:
         scan <app_data>/backups/ + <claude_dir>/**/*.bak.<ts>
         for each: compute SHA-256, insert into backup_history
       → write schema_version with "initial-backfill" marker
```

### 6.2 增量同步（migrate 完成后）

- **F7 UsageService**: `compute_usage_from_jsonl` 完成后，**额外**把每条记录 `INSERT OR IGNORE INTO usage_history`（UNIQUE 去重保证幂等）
- **F13 BackupService**: `write_with_backup` 完成后，**额外**把新 .bak.<ts> 记录 `INSERT OR IGNORE INTO backup_history`
- 这样**既保留原有逻辑**（cache 5min、文件扫描），**又**持久化到 SQLite

### 6.3 失败回滚策略

| 失败点 | 回滚 |
|---|---|
| migration 脚本执行失败 | `rusqlite_migration` 自动 rollback（事务） |
| 初次 backfill 失败 | SQLite 文件损坏 → 删 history.db，下次启动重试（JSONL 仍在） |
| 增量同步失败（单条 insert 失败） | `INSERT OR IGNORE` + 写 log（不阻塞主流程） |
| history.db 文件 lock 失败 | 返回错误，UI 提示"另一进程占用"（CLAUDE.md §7 错误必须可见） |

### 6.4 数据保留策略

- **用量历史**: 保留 1 年（估算单条 ~100B × 365 天 × 1000 次/天 = 36MB/年，可接受）
- **备份历史**: 保留 1 年（与现有 10 个 backup 上限对齐）
- 定期 cleanup: `DELETE FROM usage_history WHERE timestamp < now - 1y` （**plan 阶段定 cron / 启动时执行**）

---

## 7. CLAUDE.md §3.2 OS 抽象层 — 接口改动

### 7.1 改 `platform/traits.rs::AppPaths`

```rust
pub struct AppPaths {
    // ... 现有 7 个字段
    pub history_db: PathBuf,  // <app_data>/history.db
}
```

### 7.2 改 `platform/windows/paths.rs::resolve()`

```rust
let history_db = app_data.join("history.db");

AppPaths {
    // ... 现有 7 个字段
    history_db,
}
```

### 7.3 改 `platform/windows/paths.rs::ensure_dirs()`

`history_db` 本身**不需要 `create_dir_all`**（`<app_data>` 已被创建）。但 `ensure_dirs` 应该 verify `<app_data>/history.db` 父目录存在（实际是 `<app_data>` 本身，OK）。

### 7.4 Mac 平台

`platform/macos/paths.rs` 必须同步加 `history_db` 字段（**plan 阶段改**，**research 不动 mac impl**）。

---

## 8. SPEC §1.4 硬约束检查

| 约束 | 检查 |
|---|---|
| 无服务器依赖 | SQLite = 本地文件 = OK |
| 无云同步 | history.db 在 `<app_data>/`，不上传 = OK |
| 单 client (Claude Code) | F7/F13 都是本 client 的数据，跨 client 是未来 backlog = OK |
| 无插件市场 | N/A（history 是内部 service，不暴露 plugin API） |
| 无远程遥测 | 不发任何网络 = OK |

**结论**: Phase 21 不违反任何 SPEC §1.4 硬约束。

---

## 9. Tauri v2 bundle size 影响

| 选型 | binary 大小影响 | cold start 影响 |
|---|---|---|
| `rusqlite` + `bundled` | **+ ~600KB**（SQLite C 源静态链接） | + ~50ms（启动时 init Connection） |
| `tauri-plugin-sql` (sqlx) | **+ ~1MB**（plugin + sqlx + bundled） | + ~100ms |
| `diesel` + `sqlite` | **+ ~700KB** | + ~80ms |
| `tauri-plugin-store` 替代 | 0（已在 bundle 内） | 0（但功能不够） |

`rusqlite` + bundled 是**性价比最高**的选型：
- 600KB / 4MB debug exe = 15%（release 用 UPX 压）
- 50ms cold start = 可接受（F7 query 本身 200-500ms 扫描 JSONL）

---

## 10. 与现有 services 的集成点

### 10.1 UsageService (F7)

```text
现有: compute_usage_from_jsonl → in-memory cache → return
改后: compute_usage_from_jsonl
  → 同时: for each parsed record → INSERT OR IGNORE INTO usage_history
  → in-memory cache (5min TTL, 保留)
  → return
```

**集成位置**: `services/usage_service.rs:642` 末尾的 `compute_usage_from_jsonl` 函数（grep 实际定位）

### 10.2 BackupService (F13/F19)

```text
现有: write_with_backup 写 .bak.<ts> 文件
       ↓
改后: write_with_backup → 同时 INSERT OR IGNORE INTO backup_history
      (含 path / size / manifest_hash / source / created_at)
```

**集成位置**: `infrastructure/fs_atomic.rs`（**plan 阶段定位**）或 `services/backup_service.rs:292 backup_now` 末尾

### 10.3 不动的服务

- ProviderService / McpService / OptimizerService / ResourceService / MarketplaceService / ProjectService → **Phase 21 不动**
- PluginHost → 不动

---

## 11. 命令（commands）层接口

新增 3 个 Rust commands（前端 invoke 入口）：

```text
get_usage_history(filter: UsageHistoryFilter) -> Vec<UsageHistoryRow>
  filter: { provider_id?, project_id?, from_ts?, to_ts?, limit? }
  
get_backup_history(filter: BackupHistoryFilter) -> Vec<BackupHistoryRow>
  filter: { project_id?, source?, from_ts?, to_ts?, limit? }
  
get_history_stats() -> HistoryStats
  { total_usage_rows, total_backup_rows, db_size_bytes, last_migrated_at }
```

（实际命令签名 plan 阶段定，**research 不写 Rust 代码**。）

---

## 12. 前端 UI（占位）

`src/pages/history/` (L1 新页面，待设计)：

```text
History
├── Tabs: [用量历史] [备份历史]
├── Filter bar: 时间范围 / 项目 / provider / 类型
├── Usage history table: timestamp, provider, model, in/out tokens, cost
└── Backup history table: created_at, source, size, project, hash prefix
```

（UI 设计走 §5 主题 + §5.7 卡片风格，**plan 阶段由 designer / gsd-ui-phase 定**）

---

## 13. 测试策略

### 13.1 单元测试

```text
- migration 脚本幂等性: 跑两遍 = 不报错
- INSERT OR IGNORE 去重: 同一 source_line 跑两遍 = 行数不增
- 索引命中: EXPLAIN QUERY PLAN WHERE timestamp > ? = uses idx
- SHA-256 计算: 已知输入 → 已知 hash
- WAL 模式: PRAGMA journal_mode → "wal"
```

### 13.2 集成测试

```text
- 启动时 backfill: 预放 3 个 JSONL + 5 个 .bak.<ts> → 启动后 history.db 有 8 行
- F7 query + 写入: get_current_usage → 完成后 → get_usage_history 能查到
- F13 backup_now + 写入: backup_now → 完成后 → get_backup_history 能查到
- 跨 project 过滤: active_root_dir = Some(root) → WHERE project_id = ? 过滤正确
```

### 13.3 e2e（Playwright / tauri-driver）

- 6 个 e2e spec（M1.8 已存在）加 1 个 history page spec = 7 个
- 走 `scripts/run-e2e.sh` 同 M1.8 流程

### 13.4 Tauri cargo test 本机限制

- 按 memory `feedback/tauri-cargo-test-status-entrypoint-not-found.md`，**不能用 `cargo test`**
- 用 `cargo build --tests` 编译验证 + ship + smoke test 替代
- SQLite 测试本身可在 `cargo build --tests` 内编入（不依赖 Tauri runtime）

---

## 14. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| `rusqlite` 0.40.1 + `rusqlite_migration` 兼容性 | 低 | plan 阶段先写 spike test 验证 |
| SQLite bundled 增加 600KB binary | 低 | release 用 UPX 压；M2 已用 inline style，bundle size 已有控制 |
| 启动时 backfill 慢（100MB JSONL → 几十秒） | 中 | 增量 backfill + 后台 async 跑（**plan 阶段定**） |
| history.db 损坏 | 中 | 检测到 schema_version 异常 → 自动 backup → 重置 → 重新 backfill |
| 与 F7/F13 cache 5min TTL 冲突 | 低 | cache 保留（不变），SQLite 是持久层；cache hit 时不写 SQLite（避免重复） |
| 跨 project 历史 vs 隐私 | 低 | user-level + project-level 都用同一 db；SQL 过滤即可 |
| WAL 文件残留（crash 后） | 低 | WAL 模式自动 checkpoint；`PRAGMA wal_checkpoint(TRUNCATE)` 启动时调一次 |
| Mac 平台未实跑 | 中 | 同步 memory `project/reference-tauri-mica-fallback-deployed.md` 的 Mica 教训：Mac impl 必须同样"防御性 fallback" |
| Cargo.toml 12 个 plugin 已锁，新增 rusqlite 是否触发重 lock | 中 | plan 阶段用 `cargo update --dry-run` 验证 lockfile 影响范围（CLAUDE.md §2.3） |

---

## 15. 不做的项（明确排除）

| 排除项 | 理由 |
|---|---|
| **FTS5 全文搜索** | 1 周估时不够；如未来需要 → 独立 backlog |
| **SQLCipher 加密** | SPEC §1.4 "无服务器依赖" 包含明文 OK；加密是未来独立 backlog |
| **跨 process 共享 history.db** | 单 Tauri process 即可；CLAUDE.md §2.1 反对过早复杂化 |
| **history.db 自动 sync 到云** | SPEC §1.4 硬约束排除 |
| **删除原始 JSONL / .bak.<ts> 文件** | 保留 30 天作 audit（migrate 完不删，给用户回退窗口） |
| **重新设计 F7 5min cache** | Phase 21 不动 cache，只加 SQLite 持久层 |
| **加 SQL 写入到前端** | 走 Rust commands，前端不直连 DB（避免 attack surface） |
| **async 重构 services** | 1 周估时不够；用同步 rusqlite + `spawn_blocking` 即可（不需要） |

---

## 16. 估时分解

| 任务 | 估时 | 备注 |
|---|---|---|
| Cargo.toml 加 rusqlite + rusqlite_migration | 1h | version lock + cargo update verify |
| AppPaths 加 history_db 字段（Win + Mac） | 1h | 改 traits.rs + windows/paths.rs + macos/paths.rs + ensure_dirs + tests |
| schema.sql 写 + rusqlite_migration script | 2h | 2 个表 + 索引 + schema_version |
| HistoryService 写（init / migrate / query / insert） | 6h | 含 unit test |
| UsageService 集成 (INSERT OR IGNORE) | 1h | 1 处函数末尾加 |
| BackupService 集成 (INSERT OR IGNORE) | 1h | 1 处函数末尾加 |
| 3 个 commands (get_usage_history / get_backup_history / get_history_stats) | 2h | |
| 集成测试 (4 个) | 3h | 启动 backfill / F7 写入 / F13 写入 / 跨 project 过滤 |
| Playwright e2e spec (1 个) | 1h | history page |
| 前端 L1 page (history) | 8h | 含 UI design（§5 主题） |
| 文档 (21-CONTEXT 续 + 21-SUMMARY) | 1h | |
| Smoke test + 修 bug | 2h | 4 项验证 |
| **总计** | **~29h = 3-4 工作日** | 与 v2.0-BACKLOG §A3 "1 周" 估时吻合（1 周 = 5 工作日，留 buffer） |

---

## 17. 给主 session 的下一步建议（≤ 200 字）

**拍板 3 个决策**:

1. **Crate 选型**: 建议 `rusqlite = "=0.40.1"` + `rusqlite_migration = "=1.0.0"`（bundled feature）。理由：同步 API 与项目一致 / MSRV 低 / bundle 影响最小（+600KB） / 不引入 async runtime 重构。`tauri-plugin-sql` 备选（如未来要前端直查）。

2. **存储位置**: 全局 `<app_data>/history.db`（与 `backups_dir` 平级）。理由：跨 project 共享 + 单文件备份简单 + 不动 `active_root_dir` 架构。项目级过滤用 SQL `WHERE project_id = ?`。

3. **是否启用 v3.0 round 2**: 与 Phase 19 (云备份) / Phase 20 (updater UI) 同期还是按需启动？建议**按需**（P3 backlog，非 v3.0 主线）。

**资源路径**:
- RESEARCH: `D:\project\winui3\.planning\phases\21-m46-sqlite-history\21-RESEARCH.md`
- CONTEXT: `D:\project\winui3\.planning\phases\21-m46-sqlite-history\21-CONTEXT.md`

主 session 拍板后另派 `gsd-plan-phase` 写 21-PLAN.md → `gsd-execute-phase` 执行。
