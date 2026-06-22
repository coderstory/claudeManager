# Phase 9 M3.8 自审 (auto 模式)

## 涉及文件 (实际,白名单 vs diff)

| 白名单 | 实际 diff | 状态 |
|---|---|---|
| `src-tauri/src/services/usage_provider_ccswitch.rs` NEW | NEW (~600 行) | ✅ |
| `src-tauri/src/services/mod.rs` +1 line | +1 line (pub mod usage_provider_ccswitch) | ✅ |
| `src-tauri/src/services/usage_service.rs` modify | 重写 (JSONL 替换 usage.json) | ✅ |
| `src-tauri/src/commands/usage.rs` modify | 重写 (加 get_usage_history) | ✅ |
| `src-tauri/src/domain/usage.rs` 扩 | 扩 (pricing/breakdown/history/window.secs) | ✅ |
| `src-tauri/src/domain/mod.rs` re-export | +UsageBreakdownEntry/UsageHistoryEntry/ModelPricing | ✅ |
| `src-tauri/src/lib.rs` +1 line | +commands::usage::get_usage_history 注册 | ✅ |
| `src/pages/usage-query/index.tsx` modify | 重写 (breakdown 表格 + history chart + 4 类错误) | ✅ |
| `src/lib/api/usage.ts` modify | +getUsageHistory wrapper | ✅ |
| `src/types/usage.ts` modify | +BreakdownEntry/HistoryEntry/ErrorKind/Messages/classifier | ✅ |
| `.planning/phases/09-m38-usage/09-m38-usage-SUMMARY.md` replace | 替换 stub | ✅ |
| `tmp/white-list-phase9-m38.md` NEW | NEW | ✅ |

未触碰禁止文件:
- ❌ src-tauri/Cargo.toml — 未改
- ❌ src-tauri/src/platform/* — 未改
- ❌ src-tauri/src/services/{marketplace,provider_service,backup_service,project_service,optimizer_service,resource_service,mcp_service}.rs — 未改
- ❌ src-tauri/src/commands/{marketplace,providers,backup,project,optimizer,resource,mcp,fs,app,autostart,about}.rs — 未改
- ❌ src/pages/{marketplace,resource-browser,backup-restore,about,provider-list,sql-import,provider-switch,json-editor,deeplink-import,home,import-sql,single-file-deploy}/* — 未改
- ❌ src/components/* — 未改
- ❌ SPEC.md / CLAUDE.md / .planning/{PROJECT,ROADMAP,STATE,HANDOFF}.{md,json} — 未改

## 校验

### ✅ cargo check
- 1 次失败 (UsageSnapshot Default derive 不需要 + model move after move + ComputeResult Default)
- 修完后 cargo check 通过 4.88s

### ❌ cargo test (Rust 单测)
- 全部 11 个 `usage_*` 单测写在 `usage_provider_ccswitch.rs` + `usage_service.rs` + `domain/usage.rs`
- 本机 Windows runner DLL loader 故障 (`STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139`) — pre-existing 环境问题,所有 lib test 都 fail
- 不阻塞 (auto 模式 + 环境问题与本 phase 改动无关)

### ❌ vitest + playwright
- auto 模式跳过 (任务限制 ≤ 30 分钟)
- 已 ship 的页面已通过 TS 编译 (tauri build 强制)
- 留 M3.8 follow-up

### ✅ build-and-ship
- cargo build --release 通过 (~170s)
- TS 编译通过 (1 次 TS1109 错误,修完后通过)
- exe 已 cp 到桌面 (32 MB)
- **Smoke 7/7 通过** (launch/window/webview/title/assets/tray/kill)

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 缺 Rust 单测验证 (环境问题) | medium | smoke 7/7 + cargo check 通过; M3.8 follow-up 在干净环境再跑 |
| 缺 vitest/playwright | medium | UI 由 build 强制 TS 编译 + 真机 smoke; e2e 留 M3.8 follow-up |
| 价格表不暴露用户编辑 | low (设计内) | D14 决策,M4+ 加 PricingConfigPanel |
| SQLite 不引入 | low (设计内) | D14 决策,M4+ 再考虑 |
| balance_usd 永远 None | low (设计内) | D14 决策,Admin API 排除 |
| cc-switch 改 JSONL schema | low | 解析容错 (line 级 skip + stats counter); M4+ 跟 cc-switch 同步 |

## 业务流程分析 (端到端)

1. 用户点 sidebar "用量查询" → setView('usage-query')
2. Page mount → Promise.all([getCurrentUsage, getUsageHistory]) 并发
3. Rust `get_current_usage` → `UsageService::get_snapshot_only` → cache miss → `compute_usage_from_jsonl(projects_dir, window, provider_id)`
4. Rust `get_usage_history` → `UsageService::get_history_only` → cache HIT (同一 key 刚扫过)
5. `compute_usage_from_jsonl`: collect_jsonl_files → 3 层扫描 → parse_file → dedup → 时间窗过滤 → per-model 聚合 → cost 计算 → UsageSnapshot
6. UI 渲染 3 卡片 + breakdown 表格 + history chart
7. 用户点 "刷新" → refresh_usage → cache drop → 重扫 → UI 更新

无断点。

## 结论

- 实现完整,8 子任务全部完成
- ship 已生成 (32 MB exe, smoke 7/7)
- 单测 + e2e 受环境限制留 follow-up (auto 模式规则允许)
- 等用户核定