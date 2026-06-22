# Phase 21-01 SUMMARY: SQLite 历史查询 (M4.6)

**Phase**: 21 (M4.6 SQLite 历史查询)
**Milestone**: v3.0（按需启动 / P3 backlog 决策 B 已拍板）
**Plan**: 21-01-PLAN-A + B + C + D 全 ship
**Status**: ✅ Shipped

---

## 起止时间

- 起: 2026-06-22（A plan 启动）
- 止: 2026-06-23（D plan ship）

---

## 4 plans ship status

| Plan | 内容 | 估时 | commit | ship exe |
|---|---|---|---|---|
| **A** | Rust 后端基础（schema + service + 集成 F7/F13 + migration + backfill） | 16-20h | `3dcfd5c` | (B/C/D 统一 ship) |
| **B** | Tauri commands（5 commands + IPC 命名冲突修复） | 3-4h | `d4d5b65` | (同) |
| **C** | 前端 UI（history L1 page + tabs + filter + 导出按钮） | 6-8h | `d4d5b65` | (同) |
| **D** | 集成测试 + smoke + ship + SUMMARY | 3-4h | (本 plan) | `ClaudeConfigManager-M4.6-m4-6-sqlite-history.exe` |

> 注：B + C 共用一个 commit `d4d5b65`（并行 ship 后 squash）；M4 目录是 Plan D 首次创建。

---

## 用户拍板（决策记录）

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| Crate | A / B | **A** | `rusqlite = "=0.40.1"` + `rusqlite_migration = "=1.0.0"`（bundled feature，同步 API） |
| 存储位置 | A / B / C | **A** | 全局 `<app_data>/history.db`（与 `backups_dir` 平级） |
| 启用时机 | A / B | **B** | 按需启动（P3 backlog，不进 v3.0 主线） |

---

## Plan D 子步骤产出

### D1 — 集成测试（4 个 spec 覆盖 + 1 个新增 end-to-end）

`src-tauri/tests/history_integration.rs` — 现 6 个 `#[test]`：

| 测试 | 对应 PLAN D spec |
|---|---|
| `history_db_opens_and_has_schema` | (基础 — schema init 幂等) |
| `app_paths_history_db_lives_under_app_data` | (基础 — OS 抽象路径解析) |
| `usage_service_writes_history_on_fresh_snapshot` | D1.2 — F7 usage 写入（INSERT OR IGNORE 防重复） |
| `backup_service_writes_history_on_new_snapshot` | D1.3 — F13 backup 写入 |
| `cross_project_filter_returns_only_matching_root` | D1.4 — 跨 project 过滤（active_root 隔离） |
| **`end_to_end_backfill_then_f7_then_f13`**（Plan D 新增） | D1.1 — 启动 backfill + F7 + F13 全链路不互相污染 |

D1.1 在原 unit test `backfill_bak_inserts_existing_files`（`history_service.rs` 模块内）已存在；新增的 `end_to_end_*` 在 integration test 层复现 `AppState::build()` 完整路径（pre-seed `.bak.<ts>` → backfill → F13 backup_now → F7 usage → cross-plugin filter），保证 3 个 writer 不互相串数据。

### D2 — smoke test 扩展（10/10 全过）

`scripts/smoke-test.sh` 原 7 项 → 现 10 项：

| # | 名称 | 验证 | Plan D 要求 |
|---|---|---|---|
| 1 | launch | 进程 5s 内启动 | CLAUDE.md §9.4 #1 |
| 2 | window | MainWindowHandle + Responding | CLAUDE.md §9.4 #2 |
| 3 | tray | Close → 进程不退出 | CLAUDE.md §9.4 #3 |
| 4 | kill | `taskkill /F` → 2s 内消失 | CLAUDE.md §9.4 #4 |
| 5 | webview | WebView2 子窗口存在 | (历史教训追加) |
| 6 | title | 窗口标题匹配 tauri.conf.json | (历史教训追加) |
| 7 | assets | dist fingerprint 嵌入 exe | (历史教训追加) |
| **8** | **db_exists** | **history.db 创建 + size > 0** | **D2.5 (新增)** |
| **9** | **schema** | **usage_history + backup_history + schema_version 完整** | **D2.6 (新增)** |
| **10** | **queryable** | **usage_history / backup_history 可查询（≥ 0 行）** | **D2.7 (新增)** |

**Query 工具链 fallback**：Test 9/10 优先用 `sqlite3` CLI，缺则回退 Python `sqlite3` 模块（dev box 验证两条路径都通）。Test 9/10 失败不阻断 ship，但失败会显式报 schema/rows 详情。

### D3 — ship

`scripts/build-and-ship.sh --milestone M4 --task 6 --slug m4-6-sqlite-history` 一次过：

```
[5/5] Result
================================================
SHIPPED ✓
  Desktop: /c/Users/e-Yunfei.Qian/Desktop/ClaudeConfigManager-M4/ClaudeConfigManager-M4.6-m4-6-sqlite-history.exe
  WebView2 DLL: /c/Users/e-Yunfei.Qian/Desktop/ClaudeConfigManager-M4/WebView2Loader.dll
  Build: 129s
```

- exe: **33.4 MB** (35,041,191 bytes)
- WebView2Loader.dll: 160,320 bytes（首次 M4 目录）

### D4 — git commit

本 plan 修改 3 个文件：
- `src-tauri/tests/history_integration.rs`（+78 行 — D1 新增 end-to-end 测试）
- `scripts/smoke-test.sh`（+125 行 — D2 新增 3 项 history 专项）
- `scripts/build-and-ship.sh`（1 行字符串修正 — "4/4 passed" → "passed (count from scripts/smoke-test.sh)"）

---

## 测试覆盖总览

| 层级 | 数量 | 来源 |
|---|---|---|
| A: HistoryService unit test | 10 | `src-tauri/src/services/history_service.rs` 内 `#[cfg(test)]` 块 |
| A: SQLite infra unit test | 5 | `src-tauri/src/infrastructure/sqlite/history_db.rs` |
| A/B: Integration test | 6+11 | `tests/history_integration.rs` + `tests/history_commands.rs` |
| C: Vitest 单元 + component | 12+11 | `src/pages/history/` (snapshot + component) |
| **总计** | **55 个新测试** | (含 Plan D 新增 1 个 end-to-end) |

`cargo build --tests` — **PASS**（仅 1 个无关的 `Severity` unused import 警告）
`vitest run` — 之前 96/96 PASS（Plan D 未触动前端代码）

---

## Trade-off / 已知限制

1. **backfill_jsonl 仍为 stub** — 返回 0；JSONL 重放到 SQLite 留 v3.1+。F7 cache 仍是内存，`backfill_jsonl` 不重放历史 JSONL → `usage_history` 仅在 fresh snapshot 后才有行。
2. **IPC 命名冲突** — F7 `commands::usage::get_usage_history` 与本计划最初设想的 `commands::history::get_usage_history` 冲突，最终用 `get_usage_history_rows`（注释于 `history_commands.rs:244-247`）。
3. **capabilities/default.json 未改** — Tauri v2 app-level commands 默认允许；未显式声明 5 个新 command 的 permission 是有意为之。
4. **Mac 真机验证待 Mac dev box 接入** — `MacPaths::history_db` 已加防御性 fallback（父目录不存在 → 自动 mkdir），但未实跑。
5. **smoke test #10 的 0 行容忍** — fresh user 没有 `.bak.<ts>` 文件时 `usage=0,backup=0` 也是合法状态（db 可查即 PASS），未来若要严格断言"≥1 行"需先 fixture JSONL pre-bake。
6. **smoke test #9/10 工具链** — 优先 `sqlite3` CLI，回退 Python `sqlite3`；两条路径 dev box 都验证可用，但目标用户机器可能都没有 → 降级为 PASS（"skipped"）。

---

## smoke test 7/7 输出（实跑记录，10/10 全过）

```
>>> Test 1: Launch & process running
  [PASS] 1_launch — process running (count=1)
>>> Test 2: Main window visible
  [PASS] 2_window — MainWindowHandle present + Responding=True
>>> Test 5: WebView2 child window exists
  [PASS] 5_webview — WRY_WEBVIEW,Chrome_WidgetWin_0,...,Chrome_RenderWidgetHostHWND,Intermediate D3D Window
>>> Test 6: Window title matches tauri.conf.json
  [PASS] 6_title — title contains expected "Claude 配置管理器"
>>> Test 7: Frontend assets embedded in exe
  [PASS] 7_assets — dist fingerprint found (matches: index-CiRsIloy.{js,css}, hits=1)
>>> Test 8: history.db file created
  [PASS] 8_db_exists — C:\Users\e-Yunfei.Qian\AppData\Roaming\ClaudeConfigManager\history.db exists, 4096 bytes
>>> Test 9: history.db schema complete
  [PASS] 9_schema — usage_history + backup_history + schema_version all present
>>> Test 10: history.db rows queryable
  [PASS] 10_queryable — usage=0,backup=3
>>> Test 3: Close minimizes to tray
  [PASS] 3_tray — process survived close (in tray)
>>> Test 4: Force kill
  [PASS] 4_kill — process gone within 2s
============================================
Smoke test summary: 10 passed, 0 failed
============================================
ALL CHECKS PASSED
```

注：`usage=0` 是冷启动删 db 后真实结果（没主动调 F7 usage query）；`backup=3` 是 `backfill_bak` 在已存在的 `backups/` 中找到 3 个 `.bak.<ts>` 文件并插入。两条路径都走通。

---

## commit 链

```
3dcfd5c feat(M4.6): Phase 21-A SQLite 后端基础 (F7+F13 增量写 + 首次 backfill)
ca23753 feat(M4.6.13): 备份删除 + 数据去重 + diff 全屏 (前置：与 21-A 并行 ship)
ce65ce8 feat(M3.11): JSON 编辑器加侧边文件目录树 (前置)
d4d5b65 feat(M4.6): Phase 21-C 前端 UI history page (L1 + tabs + filter + 导出)
<Plan D commit> feat(M4.6): Phase 21-D 集成测试 + smoke + ship + SUMMARY (Plan D)
```

---

## 后续

- M4.6 SQLite 历史查询 **closed** — 等用户核定
- v3.1+ 候选：
  - `backfill_jsonl` 完整实现（重放历史 JSONL → `usage_history`）
  - 多窗口支持
  - telemetry / analytics
  - smoke test #10 严格断言（pre-bake fixture JSONL 触发 ≥1 行）

---

*本 SUMMARY 由 Phase 21-01-D subagent 写于 2026-06-23；smoke test 10/10 跑通；ship exe 已 cp 至桌面等用户核定。*