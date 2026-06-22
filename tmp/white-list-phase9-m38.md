# White-list — Phase 9 M3.8 用量查询 (cc-switch JSONL)

> auto 模式 — 主 session 不在循环中,先列白名单再实施
> 修改范围 = 6 个文件 (1 new + 5 modify + 2 summary/log)

## 允许修改的文件

| # | 文件 | 操作 | 理由 |
|---|---|---|---|
| 1 | `src-tauri/src/services/usage_provider_ccswitch.rs` | NEW | cc-switch JSONL 移植主模块 |
| 2 | `src-tauri/src/services/mod.rs` | modify (+1 line) | 注册 usage_provider_ccswitch 子模块 |
| 3 | `src-tauri/src/services/usage_service.rs` | modify | 替换 read_local_usage_json → compute_usage_from_jsonl,复用 5min cache |
| 4 | `src-tauri/src/commands/usage.rs` | modify | get_current_usage + 新增 get_usage_history,返回结构化 |
| 5 | `src-tauri/src/domain/usage.rs` | modify (扩) | 加 UsageHistoryEntry/UsageBreakdown 类型 |
| 6 | `src-tauri/src/lib.rs` | modify (+1 line) | 注册 get_usage_history command |
| 7 | `src-tauri/src/app_state.rs` | modify (verify only) | 验证 usage_service wiring 不变 |
| 8 | `src/pages/usage-query/index.tsx` | modify | 重构表格 + history chart + 4 类 ErrorBanner |
| 9 | `src/lib/api/usage.ts` | modify (+1 fn) | 加 getUsageHistory API wrapper |
| 10 | `src/types/usage.ts` | modify (+types) | 加 UsageHistoryEntry / UsageBreakdown 类型 |
| 11 | `.planning/phases/09-m38-usage/09-m38-usage-SUMMARY.md` | replace | PENDING → done / partial |
| 12 | `tmp/reviews/phase9-m38-self.md` | NEW | 自审 (auto 模式跳过深度,只列事实) |
| 13 | `tmp/white-list-phase9-m38.md` | NEW | 本文件 |

## 严禁修改

- ❌ src-tauri/src/platform/* (M3.5 范围,已 ship)
- ❌ src-tauri/src/services/{marketplace,provider_service,backup_service,project_service,optimizer_service,resource_service,mcp_service}.rs (其他 phase)
- ❌ src-tauri/src/commands/{marketplace,providers,backup,project,optimizer,resource,mcp,fs,app,autostart,about}.rs (其他 phase)
- ❌ src/pages/{marketplace,resource-browser,backup-restore,about,provider-list,sql-import,provider-switch,json-editor,deeplink-import,home,import-sql,single-file-deploy}/* (其他 phase)
- ❌ src/components/* (其他 phase)
- ❌ src-tauri/Cargo.toml (已 lock)
- ❌ SPEC.md / CLAUDE.md / .planning/{PROJECT,ROADMAP,STATE,HANDOFF}.{md,json}
- ❌ .planning/phases/{01..08,10,11}-* (其他 phase 范围)
- ❌ src-tauri/tests/{marketplace,project_service,platform_paths,plugin_host,plugin_host_wiring,about,optimizer_fix}.rs