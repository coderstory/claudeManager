---
title: M3.8 用量查询修 bug (清单 19) [D14 = D 选 cc-switch JSONL]
type: plan
phase: 9
goal: |
  D14 用户拍板 D 选 (cc-switch-main JSONL 读法)。基于 cc-switch-main session_manager 路径移植,
  数据源: ~/.claude/projects/<encoded-path>/*.jsonl (Claude Code session 缓存, JSONL 格式)。
  复用 M2.7 ship 的 5-min Mutex<HashMap> cache + ErrorBanner, 改 1 service (新增 usage_provider_ccswitch.rs)。
depends_on: M3.7 ship + D14 user decision (D = cc-switch JSONL)
---

# Phase 9 Plan — M3.8 用量查询 (D14 = D 选)

**Status**: not_started
**D14 决策**: D 选 (cc-switch-main JSONL 读法)
**Goal**: 实现用量查询, 读 Claude Code session JSONL 历史, 计算 token 用量

## Sub-tasks

### 1. 新增 usage_provider_ccswitch.rs
- 数据源: ~/.claude/projects/<encoded-path>/*.jsonl
- 复用 cc-switch-main session_manager sync_claude_session_logs 逻辑
- 提取字段: `message.usage.{input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens}` + `message.model` + `timestamp`
- 去重: `messageId` (避免 double-count)
- 增量扫描: mtime + last_offset (避免每次全量扫描)
- 内存聚合: per-model, per-day, per-window (5min/1h/1d)

### 2. 改 usage_service.rs
- 替换 read_local_usage_json → compute_usage_from_jsonl
- 复用 5-min cache
- 错误处理: NotFound / PermissionDenied / JsonParse / EncodingError
- 5 场景单测: 合法 / 空 / 编码错误 / 权限 / 性能 (1MB+ JSONL)

### 3. 改 commands/usage.rs
- `get_current_usage` 返回结构化 (current_period + history)
- 新增 `get_usage_history(provider_id, range)` command

### 4. UI 重构 (src/pages/usage-query/index.tsx)
- 表格: provider × model × current_period × history chart
- 价格表 (CLAUDE.md §4.2 配色)
- ErrorBanner 4 类本地化

### 5. 价格表 (constants.rs)
- Claude Sonnet 4: $3 / $15 / $0.30 / $3.75 per M tokens
- 其他 model 暂时 hardcode
- 不暴露用户编辑 (M4+ 加 PricingConfigPanel)

## TDD
- 单测先于实现
- Rust: 5 场景 (合法 / 空 / 编码 / 权限 / 性能)
- TS: 表格渲染 + 错误本地化 + chart

## Ship
- `scripts/build-and-ship.sh --milestone M3 --task 8 --slug usage-query-ccswitch`
- 产物: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.8-usage-query-ccswitch.exe`

## 估时
- 1.5d JSONL 解析移植 (sync_claude_session_logs + parser)
- 0.5d 价格表 constants
- 0.5d service 改造 (read_local_usage_json → compute_usage_from_jsonl)
- 0.5d command 改造
- 0.5d UI 重构
- 1d Rust 单测
- 0.5d vitest
- 0.5d playwright
- 0.5d ship
- **总计 5d** (与 D-槽4 调研推荐一致)

## 输入源
1. cc-switch-main/src-tauri/src/services/session_usage.rs:61-108 sync_claude_session_logs
2. cc-switch-main/src-tauri/src/services/session_usage.rs:121-167 collect_jsonl_files
3. cc-switch-main/src-tauri/src/services/session_usage.rs:46-58 ParsedAssistantUsage
4. cc-switch-main/src-tauri/src/services/session_usage.rs:182-260 sync_single_file (增量)
5. cc-switch-main/proxy/usage/calculator.rs (价格表参考)
6. D-槽4 调研文档 docs/investigations/m3-8-usage-bug.md + docs/design/cc-switch-usage-pattern.md
7. M2.7 ship 的 src-tauri/src/services/usage_service.rs:78-251 (cache + UI 复用)
8. M2.7 ship 的 src-tauri/src/domain/usage.rs:32-89 (UsageSnapshot + UsageWindow 复用)

## 已知限制
- 不引入 SQLite (M3.8 用内存聚合; cc-switch 走 SQLite 是因为需要持久化, 本项目用量查询 ship 一个能用的功能即可)
- 价格表内置常量, 不暴露用户编辑 (M4+ 再加 PricingConfigPanel)
- macOS 真实环境验证留 M4 (D6 决策)
