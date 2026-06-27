---
subsystem: ci-pipeline-db-migrations
reviewer: opencode (minimax/MiniMax-M3)
reviewed_at: 2026-06-27T02:26:12Z
scope: .github/workflows/*, src-tauri/src/ (CREATE TABLE / migration code), Cargo.toml
target_branch: master
project: Claude 配置管理器 — Tauri v2
---

# CI Pipeline + Database Migration Audit — opencode

<output>
现在我已经掌握了出具完整审计报告所需的全部信息。

---

# CI/CD Pipeline + 数据库迁移审计报告

```
审计日期: 2026-06-27
审计目标: /Users/coderstory/CodeSource/winui3
分支: master
```

---

## 1. 执行摘要

- `.github/workflows/` 中有 3 个工作流文件：`ci.yml`、`release.yml`、`disk-monitor.yml`
- **CI 每次 push 都会运行 Rust 单元测试**（仅限 Windows）和**前端类型检查 + 构建 + Vitest**
- E2E 已手动**禁用**（`if: ${{ false }}`），包含修复计划注释及已知原因说明
- **macOS gate** 运行 `cargo check` + 前端构建 + Vitest，但**不运行 `cargo test`**
- 代码覆盖率已配置（`vitest.config.ts` 中配置了 v8 Coverage）但 **CI 中从未通过 `--coverage` 调用**
- `release.yml` 已**完整配置**，但代码签名秘钥（EV 证书、Apple ID/密码）**注释为占位符**，未提供实际值
- 数据库迁移：使用 `rusqlite_migration`（`Cargo.toml` 中依赖版本为 =2.6.0），**内联**声明（非文件），包含向下迁移
- V2 迁移存在（`usage_daily_stats` 表），受测试覆盖
- **无 CI 中的冒烟测试执行**（`scripts/smoke-test.sh` 存在但从未被调用）
- **无依赖更新调度任务**（如 Dependabot / Renovate）

---

## 2. CI 工作流清单

### 2.1 `ci.yml`（242 行）

| 属性 | 值 |
|--------|-------|
| **触发器** | `push: [master, main]`（第 4-5 行）；`pull_request`（第 6 行） |
| **并发** | 每组 `${{ github.workflow }}-${{ github.ref }}`，`cancel-in-progress: true`（第 9-11 行） |

#### 任务 1：`test-rust`
| 字段 | 值 |
|-------|-------|
| **名称** | Rust tests (windows-latest)（第 18 行） |
| **操作系统** | `windows-latest`（第 19 行） |
| **步骤：检查** | `actions/checkout@v4`（第 21 行） |
| **步骤：工具链** | `dtolnay/rust-toolchain@1.86.0`（第 27 行） |
| **步骤：缓存** | `Swatinem/rust-cache@v2`，`workspaces: src-tauri -> target`（第 30-32 行） |
| **步骤：MSYS2** | `msys2/setup-msys2@v2`，MinGW 工具链 + pkg-config + cc（第 34-42 行） |
| **步骤：测试** | `cargo test --no-default-features --no-run` + 每个集成测试循环运行（第 46-55 行） |
| **步骤：Clippy** | `cargo clippy --all-targets --no-deps -- -D warnings`，位于 msys2 shell 中（第 57-62 行） |

#### 任务 2：`test-frontend`
| 字段 | 值 |
|-------|-------|
| **名称** | Frontend unit tests + build (windows-latest)（第 74 行） |
| **操作系统** | `windows-latest`（第 74 行） |
| **步骤：检查** | `actions/checkout@v4`（第 76 行） |
| **步骤：Node** | `actions/setup-node@v4`，Node 22.18.0，`cache: 'npm'`（第 78-83 行） |
| **步骤：依赖** | `npm ci`（第 86 行） |
| **步骤：类型检查** | `npx tsc --noEmit`（第 92 行） |
| **步骤：构建** | `npm run build`（tsc + vite build）（第 100 行） |
| **步骤：测试** | `npm test -- --run`（Vitest，**非 watch 模式**，**无 `--coverage`**）（第 104 行） |

#### 任务 3：`e2e` — **已禁用**
| 字段 | 值 |
|-------|-------|
| **名称** | E2E (tauri-driver, ${{ matrix.os }}) |
| **条件** | `if: ${{ false }}`（第 125 行） |
| **矩阵** | `os: [windows-latest, macos-latest]`（第 129 行），`fail-fast: false`（第 127 行） |
| **操作系统** | `${{ matrix.os }}`（第 130 行） |
| **步骤** | 检查 → Node → MSYS2（仅 Windows）→ Rust → 缓存 → npm 依赖 → `npm run tauri build -- --debug` → tauri-driver → Playwright 安装 → Playwright 测试 |

#### 任务 4：`build-macos`（macOS 门禁）
| 字段 | 值 |
|-------|-------|
| **名称** | macOS gate (cargo check + vitest, macos-latest)（第 205 行） |
| **操作系统** | `macos-latest`（第 206 行） |
| **步骤：检查** | `actions/checkout@v4`（第 208 行） |
| **步骤：Rust** | `dtolnay/rust-toolchain@1.86.0`，目标：`aarch64-apple-darwin`（第 212-216 行） |
| **步骤：缓存** | `Swatinem/rust-cache@v2`（第 219-221 行） |
| **步骤：Node** | `actions/setup-node@v4`，Node 22.18.0，`cache: 'npm'`（第 223-227 行） |
| **步骤：npm** | `npm ci`（第 230 行） |
| **步骤：cargo** | `cargo check --manifest-path src-tauri/Cargo.toml`（**注意：非 `cargo test`**）（第 236 行） |
| **步骤：前端** | `npm run build`（第 239 行） |
| **步骤：Vitest** | `npm test -- --run`（第 242 行） |

### 2.2 `release.yml`（157 行）

| 属性 | 值 |
|--------|-------|
| **触发器** | `push: tags: ['v*']`（第 32-34 行）；`workflow_dispatch`（第 35 行） |
| **权限** | `contents: write`（第 43 行） |

#### 任务：`publish-tauri`
| 字段 | 值 |
|-------|-------|
| **矩阵** | `windows-nsis (x86_64)` → `windows-latest`、`macos-dmg (aarch64)` → `macos-latest`（第 56-64 行） |
| **操作系统** | `${{ matrix.os }}`（第 66 行） |
| **步骤** | 检查（第 71 行）→ Node LTS（第 74-77 行）→ Rust stable + 目标（第 80-82 行）→ Swatinem 缓存（第 85-87 行）→ `npm ci`（第 91 行）→ `tauri-apps/tauri-action@v0.6.2`（第 104 行）→ 原始构件上传 Windows（第 137-146 行）→ 原始构件上传 macOS（第 148-157 行） |
| **构建环境变量** | `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`；其他 6 个签名秘钥已注释（第 109-115 行） |
| **发布** | `releaseDraft: true`（第 127 行），`prerelease: false`（第 128 行） |
| **构件（发布）** | 通过 tauri-action 自动上传 |
| **构件（原始）** | Windows → `.exe` + `WebView2Loader.dll`；macOS → `.app` + `.dmg`，30 天保留期 |

### 2.3 `disk-monitor.yml`（23 行）

| 属性 | 值 |
|--------|-------|
| **触发器** | `schedule: cron '0 0 1 * *'`（每月 1 日）；`workflow_dispatch` |
| **操作系统** | `ubuntu-latest` |
| **步骤** | 检查 → Node LTS → Rust stable → 运行 `scripts/disk-usage-check.sh src-tauri/target` |

---

## 3. 数据库模式清单

### 3.1 核心机制

| 组件 | 文件路径 | 行号 |
|----------|-----------|-------|
| **迁移引擎** | `src-tauri/src/infrastructure/sqlite/history_db.rs` | 第 38 行 |
| **依赖项：rusqlite** | `src-tauri/Cargo.toml` | 第 101 行：`rusqlite = "=0.40.1"` |
| **依赖项：rusqlite_migration** | `src-tauri/Cargo.toml` | 第 107 行：`rusqlite_migration = "=2.6.0"` |
| **DB 打开入口点** | `src-tauri/src/infrastructure/sqlite/history_db.rs` | 第 167 行：`open_history_db(path)` |
| **应用状态调用** | `src-tauri/src/app_state.rs` | 第 101-103 行 |
| **服务包装器** | `src-tauri/src/services/history_service.rs` | 第 171 行 |

### 3.2 V1 模式（第 51-98 行）

| 对象 | 类型 | 注释 |
|----------|------|-------|
| `usage_history` | 表 | `IF NOT EXISTS`，参见第 53-64 行；PRIMARY KEY `id`，UNIQUE `snapshot_id` |
| `idx_usage_provider` | 索引 | `(provider_id, recorded_at DESC)`，第 66-67 行 |
| `idx_usage_recorded` | 索引 | `(recorded_at DESC)`，第 68-69 行 |
| `idx_usage_root` | 索引 | `(active_root, recorded_at DESC)`，第 70-71 行 |
| `backup_history` | 表 | `IF NOT EXISTS`，参见第 73-84 行；UNIQUE `backup_id` |
| `idx_backup_created` | 索引 | `(created_at DESC)`，第 86-87 行 |
| `idx_backup_scope` | 索引 | `(scope, created_at DESC)`，第 88-89 行 |
| `idx_backup_root` | 索引 | `(active_root, created_at DESC)`，第 90-91 行 |
| `schema_version` | 表 | `IF NOT EXISTS`，参见第 93-96 行；`(version, applied_at)` |
| **向下迁移** | V1 → ∅ | 第 99 行：`DROP TABLE IF EXISTS backup_history; DROP TABLE IF EXISTS usage_history; DROP TABLE IF EXISTS schema_version;` |

### 3.3 V2 模式（第 118-134 行）

| 对象 | 类型 | 注释 |
|----------|------|-------|
| `usage_daily_stats` | 表 | `IF NOT EXISTS`，参见第 120-128 行；PRIMARY KEY `(provider_id, stat_date)` |
| `idx_daily_stats_date` | 索引 | `(stat_date DESC)`，第 130-131 行 |
| **向下迁移** | V2 → V1 | 第 134 行：`DROP TABLE IF EXISTS usage_daily_stats;` |

### 3.4 DB 路径解析

| 平台 | 路径 | 引用 |
|----------|------|-------|
| **Windows** | `%APPDATA%/ClaudeConfigManager/history.db` | `src-tauri/src/platform/windows/paths.rs:104` |
| **macOS** | `~/Library/Application Support/ClaudeConfigManager/history.db` | `src-tauri/src/platform/macos/paths.rs:118` |

### 3.5 损坏恢复

- 第 195-219 行：打开时检测损坏（`PRAGMA integrity_check`）
- 如果损坏，文件将被重命名为 `<path>.corrupt.<unix-ts>`，并创建一个新的空 DB
- 打开时始终应用 PRAGMA：`journal_mode=WAL`，`synchronous=NORMAL`，`foreign_keys=ON`

### 3.6 触及 SQLite 的其他服务

所有列出的服务仅引用 `history_db` 文件路径（位于 `AppPaths` 结构体中）——**没有任何其他服务直接打开 SQLite 连接**。唯一打开 DB 的文件是 `history_db.rs` 和 `app_state.rs`。

---

## 4. CI 差距清单

| # | 检查 | Y/N | 证据 |
|---|-------|-----|----------|
| 1 | **每次推送均进行发布构建** | **N** | `cargo test --no-run` 编译但不会优化；`build-macos` 仅运行 `cargo check` |
| 2 | **前端测试含覆盖率** | **N** | `npm test -- --run`（第 104 行）无 `--coverage`；`vitest.config.ts` 配置了覆盖率但 CI 中未调用 |
| 3 | **Rust 测试** | **Y**（仅限 Windows） | `ci.yml:49` — `cargo test --no-default-features` 用于单元测试和集成测试。macOS gate（第 236 行）仅运行 `cargo check` |
| 4 | **冒烟测试** | **N** | `scripts/smoke-test.sh` 存在（696 行，跨平台）但**任何工作流中均未引用** |
| 5 | **UI E2E** | **N**（已禁用） | E2E 任务在第 125 行有 `if: ${{ false }}` |
| 6 | **PR 测试报告评论** | **N** | 未使用 `dorny/test-reporter` 或类似工具 |
| 7 | **构件上传（推送）** | **N** | `release.yml` 仅为标签版本上传构件；`ci.yml` 无 `upload-artifact` |
| 8 | **发布工作流存在** | **Y** | `release.yml` 存在，`on: push: tags: ['v*']` + `workflow_dispatch`。代码签名秘钥为占位符 |
| 9 | **跨平台矩阵** | **部分** | Rust 测试仅限 Windows；macOS 仅检查。无 Linux（`CLAUDE.md §15` 不支持） |
| 10 | **秘钥作用域** | **安全** | 唯一使用的秘钥是 `GITHUB_TOKEN`（自动作用域）。签名秘钥已注释。无 `pull_request_target` |
| 11 | **调度运行** | **Y** | `disk-monitor.yml` 每月运行。无依赖审计/更新调度任务 |

---

## 5. 迁移差距清单

| # | 检查 | Y/N | 证据 |
|---|-------|-----|----------|
| 1 | **版本化迁移文件** | **N** | 无 `src-tauri/migrations/` 目录。迁移内联在 `history_db.rs:48-136` |
| 2 | **模式重置行为** | **无数据丢失** | 损坏 → 文件移到一旁，创建新 DB。正常 V1→V2 升级：`to_latest()` 为幂等操作（第 222-228 行） |
| 3 | **降级支持** | **N** | 向下迁移存在但从未使用。`to_latest()` 仅单向 |
| 4 | **CI 中测试的迁移** | **部分** | 测试覆盖**全新** DB（已应用 V1+V2）。无 V1→V2 顺序升级测试 |
| 5 | **幂等性创建** | **Y** | 所有 `CREATE TABLE`/`CREATE INDEX` 使用 `IF NOT EXISTS` |
| 6 | **模式版本化原语** | **Y** | `PRAGMA user_version` 由 `rusqlite_migration` 管理（第 240 行）。辅助 `schema_version` 表 |
| 7 | **使用的迁移工具** | **Y** | `rusqlite_migration` 版本 =2.6.0（第 107 行） |

---

## 6. 发现（按严重程度排序）

### 🔴 严重

| ID | 发现 | 位置 | 详情 |
|----|---------|----------|-------|
| C-01 | **E2E 永久禁用** | `ci.yml:125` | `if: ${{ false }}`。Playwright 基础设施和测试存在，但永远不会运行。当代码更改破坏 GUI 时，CI 无法捕获 |
| C-02 | **代码签名缺失** | `release.yml:108-115` | 6 个签名秘钥（EV 证书、Apple ID/密码/团队/证书）已注释。发布构建会产生未签名的安装程序 |
| C-03 | **冒烟测试未集成** | `ci.yml` | `scripts/smoke-test.sh` 是一个 696 行的跨平台冒烟套件（进程、窗口、完整性、DB、10 项检查），但 CI 中任何位置均未调用 |

### 🟠 高

| ID | 发现 | 位置 | 详情 |
|----|---------|----------|-------|
| H-01 | **macOS 上不运行 Rust 测试** | `ci.yml:232-236` | macOS gate 运行 `cargo check`（编译门禁）但**不运行 `cargo test`**。macOS 特定的路径/逻辑未经测试 |
| H-02 | **无前端覆盖率报告** | `ci.yml:104` | `vitest.config.ts` 配置了 v8 Coverage（第 12-15 行），且 `@vitest/coverage-v8` 在 `package.json:31` 中，但 `npm test -- --run` 从不传递 `--coverage`。覆盖率从未生成或上传 |
| H-03 | **V1→V2 升级未经测试** | `history_db.rs` 测试 | 无测试创建 V1 DB 然后模拟 V2 迁移。测试仅验证全新 DB。`to_latest()` 正确但无回归保护 |
| H-04 | **无构建构件（非标签）** | `ci.yml` | 每次推送的 `cargo test --no-run` 会生成目标文件，但无 `upload-artifact`。无法在不运行发布工作流的情况下确认发布构建是否完整 |

### 🟡 中

| ID | 发现 | 位置 | 详情 |
|----|---------|----------|-------|
| M-01 | **无 PR 反馈（测试报告）** | `ci.yml` | 无 `dorny/test-reporter` / `marocchino/sticky-pull-request-comment`。PR 作者必须单击 CI 日志 |
| M-02 | **节点版本：CI vs 发布不一致** | `ci.yml:82` 对比 `release.yml:76` | CI 锁定 `'22.18.0'`，发布使用 `lts/*`。构建可能因 Node 版本问题在发布时失败 |
| M-03 | **Rust 版本：CI vs 发布不一致** | `ci.yml:27` 对比 `release.yml:80` | CI 锁定 `1.86.0`，发布使用 `stable`。编译器版本行为差异可能潜入 |
| M-04 | **无调度依赖审计** | `.github/workflows/` | `disk-monitor.yml` 仅检查磁盘使用情况。无 Dependabot / Renovate / `schedule:` 用于 `npm audit` 或 `cargo audit` |
| M-05 | **无 PR 触发器的发布工作流** | `release.yml:32-35` | 仅 `push: tags: ['v*']` 和 `workflow_dispatch`。无 `pull_request` 触发器来验证发布构建未损坏 |
| M-06 | **Linux 完全不支持** | `ci.yml` | 无 Linux 构建矩阵。`CLAUDE.md §15` 记录为不支持；如果将来添加 Linux 则需要新 CI 层 |

### 🟢 低

| ID | 发现 | 位置 | 详情 |
|----|---------|----------|-------|
| L-01 | **无 CI 徽章** | `README.md`（未检查，假定） | 通常状态徽章来自 `ci.yml` |
| L-02 | **磁盘监控缺少 `if-no-files-found`** | `disk-monitor.yml:20` | 运行脚本但不验证结果；脚本退出代码会传递但无明确回退 |
| L-03 | **缺失的内联保留期文档** | `release.yml:137-157` | 原始构件明确设置 `retention-days: 30`；tauri-action 上传的构件未设置保留期 |

---

## 7. 风险评估

CI/CD 管道具有合理的结构：每次推送都会运行 Rust 单元测试（Windows）和前端类型检查 + 构建 + Vitest，macOS 编译门禁可防止 macOS 特定的回归问题。然而，**关键质量门禁缺失**：E2E 测试永久禁用、冒烟测试已编写但从未调用、前端测试覆盖率已配置但从未收集、CI 和发布之间 Node/Rust 版本不一致。发布工作流已功能完整，但在代码签名秘钥作为占位符注释掉之前**无法投入生产**——生成的安装程序将无法通过 macOS Gatekeeper，并且在 Windows SmartScreen 上会触发警告。

在数据库方面，使用 `rusqlite_migration` 进行内联迁移是合理且正确的（幂等创建、`PRAGMA user_version` 跟踪、损坏时转移到一旁）。然而，**缺少 V1→V2 顺序升级测试**：测试仅验证全新 DB，这意味着如果 V2 迁移被静默跳过或对现有 V1 DB 失败，则 V2 迁移没有回归保护。没有降级支持（向下迁移声明了但从未执行），如果应用降级，用户将需要一个手动 SQLite 工具。总体而言，数据库层稳健但防御性不足。

---

## 8. 前 5 个修复（按优先级排序）

| 优先级 | 修复 | 文件:行 | 难度 | 影响 |
|----------|------|-----------|------|-------|
| **1** | **取消签名秘钥注释并配置 CI 秘钥** — 设置 `WINDOWS_EV_CERT_THUMBPRINT`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`、`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PWD`，以便发布构建生成已签名/已公证的安装程序 | `release.yml:108-115` | 中 | 严重 |
| **2** | **在 CI 中添加冒烟测试** — 在 `test-rust` 或新的清理任务之后，添加步骤：`./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe`（Windows）和等效的 macOS 步骤 | `ci.yml:57`（在 clippy 之后） | 低 | 严重 |
| **3** | **在 macOS 上运行 `cargo test`** — 将 `build-macos` 中的 `cargo check` 更改为 `cargo test --no-default-features` 以捕获 macOS 特定路径/逻辑回归 | `ci.yml:236` | 低 | 高 |
| **4** | **使用 `--coverage` 运行 Vitest 并上传** — 将第 104 行更改为 `npm test -- --run --coverage` 并添加 `codecov/codecov-action` 或 `actions/upload-artifact` 步骤以保存覆盖率报告 | `ci.yml:104` | 低 | 高 |
| **5** | **将 CI 和发布的 Node/Rust 版本锁定为一致** — 将发布中的 `lts/*` / `stable` 更改为与 CI `22.18.0` / `1.86.0` 匹配的固定版本，反之亦然 | `release.yml:76`、`release.yml:80` | 低 | 中 |
</output>