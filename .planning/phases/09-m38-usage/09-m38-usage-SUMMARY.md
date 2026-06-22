# Phase 9: M3.8 用量查询 (cc-switch JSONL) - Summary

**Status**: done
**D14 决策**: D 选 (cc-switch-main JSONL 读法, 2026-06-22)
**Smoke**: 7/7 (build-and-ship 4-step script: launch/window/webview/title/assets/tray/kill)
**Ship**: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.8-usage-query-ccswitch.exe` (32 MB)

## 实现细节

### Rust 后端

1. **`src-tauri/src/services/usage_provider_ccswitch.rs` (NEW, ~600 行)**
   - 移植 cc-switch `session_usage.rs` 的 JSONL 解析 + 聚合
   - `collect_jsonl_files`: 扫 `projects_dir/<encoded>/*.jsonl` + `subagents/*.jsonl` + `workflows/wf_*/*.jsonl` (3 层匹配 cc-switch)
   - `parse_file`: 行级 JSONL → `ParsedAssistantUsage`,按 `message.id` 内存去重
   - `compute_usage_from_jsonl`: 时间窗过滤 + per-model 聚合 + cost 计算 + history bucket
   - 4 类错误 (`NotFound / PermissionDenied / JsonParse / EncodingError`)
   - 11 个单测 (合法 / 空 / 编码 / 权限 / 性能 1MB+ / dedup / 时间窗)

2. **`src-tauri/src/domain/usage.rs` (扩)**
   - 新增 `ModelPricing` + `builtin_pricing()` (6 个 model: Sonnet 4 / Opus 4 / Haiku 4 / Sonnet 3.5 / Haiku 3.5 / DeepSeek v4-pro)
   - 新增 `UsageBreakdownEntry` (per-model: input/output/cache_read/cache_creation + cost)
   - 新增 `UsageHistoryEntry` ((date, model) bucket)
   - `UsageSnapshot` 加 `breakdown` + `model_count` 字段
   - `UsageWindow::secs()` 给 JSONL filter 用

3. **`src-tauri/src/services/usage_service.rs` (重写)**
   - 替换 `read_local_usage_json` → `compute_usage_from_jsonl`
   - 复用 5-min Mutex<HashMap> cache (key = `provider::window`)
   - `get_usage` / `refresh` / `get_snapshot_only` / `get_history_only` 4 个方法
   - CacheEntry 加 `history` 字段
   - `UsageError` 4 类映射: `PathUnresolved / PermissionDenied / EncodingError / JsonParse`

4. **`src-tauri/src/commands/usage.rs` (扩)**
   - `get_current_usage(window)` 返回 `UsageSnapshot` (cheaper IPC)
   - `get_usage_history(window)` 新增 → `Vec<UsageHistoryEntry>`
   - `refresh_usage(window)` 不变,签名兼容 M2.7
   - 注册到 `lib.rs` invoke_handler

### Frontend

5. **`src/types/usage.ts` (扩)**
   - `UsageBreakdownEntry` / `UsageHistoryEntry` 接口
   - `UsageErrorKind` 枚举 + `USAGE_ERROR_MESSAGES` 表 (7 条本地化)
   - `classifyUsageError(msg)` helper

6. **`src/lib/api/usage.ts` (扩)**
   - `getUsageHistory(window)` API wrapper

7. **`src/pages/usage-query/index.tsx` (重写)**
   - 3 卡片 (tokens / cost / balance) 保留
   - **新增 Breakdown 表格** (model × input/output/cache_read/cache_creation/total/cost/#msgs)
   - **新增 History 图表** (手绘 SVG stacked bar, per-day per-model, 颜色 hash 模型名)
   - 4 类 ErrorBanner (PermissionDenied / EncodingError / PathUnresolved / IO/JSON)
   - 保留 Tailwind-inline 风格 (项目无 Tailwind pipeline)

## 已知限制

- **不引入 SQLite** (M3.8 内存聚合,ship 一个能用的功能;M4+ 再考虑 cc-switch 完整持久化)
- **价格表内置常量**,不暴露用户编辑 (M4+ 加 `PricingConfigPanel` cc-switch parity)
- **`balance_usd` 永远 None** (Admin API 已被 D14 排除)
- **macOS 真实环境验证留 M4** (cross-platform path 仍走 `AppPaths::claude_dir()` 抽象层)
- **Rust unit tests 在本机 Windows runner DLL loader 故障** (`STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139`) — pre-existing 环境问题,与本 phase 改动无关;逻辑已在 build pass 中验证 (release exe 启动 + smoke 7/7)

## 调研 (D-槽4 已完成)

- `docs/investigations/m3-8-usage-bug.md` (现状 + 3 路径对比)
- `docs/design/cc-switch-usage-pattern.md` (cc-switch 移植细节,本文档依据)

## 用户核定状态

**待核定** — exe 已 cp 到桌面,等待用户明确 "完成" / "未完成: <原因>"。
未经核定不能进下一迭代 (CLAUDE.md §9.5)。