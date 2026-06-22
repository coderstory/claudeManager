# Built-in Optimizer Rules

> Claude 配置管理器内置的 16 条配置优化规则 (13 文件规则 + 3 环境变量规则)。
>
> - **来源**: `src-tauri/src/infrastructure/optimizer_rules.rs` (R001-R013) + `M3.3` 新增 (ENV001-003)
> - **风险等级**: `low` = 修复无副作用;`medium` = 改文件内容(可备份回滚);`high` = 改全局行为/性能
> - **auto-fixable**: `yes` = 工具一键修复并 F13 备份原子写盘;`no` = 需用户手动介入(跳转到对应管理页)
> - **触发扫描**: F18 配置优化页 → 13 + 3 规则全量扫描 → findings 按严重度(Error → Warning → Info)排序

---

## R001 ORPHAN_PROVIDER — 孤儿 provider 引用

- **规则 ID**: `R001` (内部 `ORPHAN_PROVIDER`)
- **名称**: 孤儿 provider 引用 / Orphan Provider Reference
- **检查目标**: `~/.claude/settings.json:env.ANTHROPIC_BASE_URL` + `<app_data>/providers/*.json`
- **修复动作**: auto-fixable **no** (跨文件决策,需用户确认)
- **风险等级**: low (信息提示,无副作用)
- **来源**: cc-switch 启发式 — `settings.env.ANTHROPIC_BASE_URL` 指向的 url 在 providers 目录里没有对应文件,通常是切换后残留。
- **手动建议**: 跳转到 Provider 列表页,删除孤儿引用,或新建对应的 provider。

## R002 UNREFERENCED_PROVIDER — 未使用的 provider

- **规则 ID**: `R002` (内部 `UNREFERENCED_PROVIDER`)
- **名称**: 未使用的 provider / Unreferenced Provider
- **检查目标**: `<app_data>/providers/*.json` (`last_used_at == None`)
- **修复动作**: auto-fixable **no**
- **风险等级**: low
- **来源**: cc-switch 启发式 — provider 从未被使用(`last_used_at` 为空)且 `api_base` 不等于当前活动 base url。
- **手动建议**: 跳转到 Provider 列表页删除。

## R003 DUPLICATE_MCP — 重复的 MCP server

- **规则 ID**: `R003` (内部 `DUPLICATE_MCP`)
- **名称**: 重复的 MCP server / Duplicate MCP Server
- **检查目标**: `~/.claude/mcp.json` (相同 `command` 或 `url`)
- **修复动作**: auto-fixable **no**
- **风险等级**: low
- **来源**: cc-switch 启发式 — 多于 1 个 MCP server 共享同一个 `stdio:<command>` 或 `http:<url>` 键。
- **手动建议**: 跳转到 MCP 管理页删除重复项。

## R004 EMPTY_FIELD — 空字段

- **规则 ID**: `R004` (内部 `EMPTY_FIELD`)
- **名称**: 空字段 / Empty Field
- **检查目标**: `<app_data>/providers/*.json:api_key` / `api_base`
- **修复动作**: auto-fixable **no**
- **风险等级**: low
- **来源**: cc-switch 启发式 — `api_key.trim().is_empty()` 或 `api_base.trim().is_empty()`。
- **手动建议**: 跳转到 Provider 详情页填写。

## R005 DEPRECATED_FIELD — 已弃用的 settings 字段

- **规则 ID**: `R005` (内部 `DEPRECATED_FIELD`)
- **名称**: 已弃用的 settings 字段 / Deprecated Field
- **检查目标**: `~/.claude/settings.json:claude_api_url` / `claude_api_key` / `claude_api_base`
- **修复动作**: auto-fixable **yes** (fs_atomic::write_with_backup)
- **风险等级**: medium (改文件内容,有 .bak 备份)
- **来源**: Claude Code 官方迁移文档 — 旧版命名 `claude_api_*` 已弃用,新版用 `env.ANTHROPIC_*`。
- **自动行为**: 从 settings.json 移除该字段,生成 `.bak.<ts>` 备份。

## R006 INSECURE_API_KEY — 不安全的 api_key

- **规则 ID**: `R006` (内部 `INSECURE_API_KEY`)
- **名称**: 不安全的 api_key / Insecure API Key
- **检查目标**: `<app_data>/providers/*.json:api_key` (长度 < 16 字符)
- **修复动作**: auto-fixable **no**
- **风险等级**: high (功能性问题,Claude Code 无法启动)
- **来源**: 社区经验值 — 合法 Anthropic API key ≥ 16 字符,短 key 必是错的。
- **手动建议**: 跳转到 Provider 详情页重新填写。

## R007 MCP_MISSING_TRANSPORT — MCP 缺 transport 字段

- **规则 ID**: `R007` (内部 `MCP_MISSING_TRANSPORT`)
- **名称**: MCP 缺 transport 字段 / MCP Missing Transport Field
- **检查目标**: `~/.claude/mcp.json` (stdio 缺 `command` / http 缺 `url`)
- **修复动作**: auto-fixable **no**
- **风险等级**: medium (Claude Code 启动时可能 panic)
- **来源**: Claude Code 官方 mcp.json schema。
- **手动建议**: 跳转到 MCP 管理页补全字段。

## R008 LONG_PROVIDER_NAME — Provider 名称过长

- **规则 ID**: `R008` (内部 `LONG_PROVIDER_NAME`)
- **名称**: Provider 名称过长 / Long Provider Name
- **检查目标**: `<app_data>/providers/*.json:name` (> 50 字符)
- **修复动作**: auto-fixable **no**
- **风险等级**: low (UI 截断影响)
- **来源**: UI 设计规范 — 侧栏卡片最多容纳 50 字符。
- **手动建议**: 跳转到 Provider 详情页改短名字。

## R009 UNUSED_BACKUP — 过期备份

- **规则 ID**: `R009` (内部 `UNUSED_BACKUP`)
- **名称**: 过期备份 / Unused Backup
- **检查目标**: `<app_data>/backups/*.bak.<ts>` (mtime > 30 天)
- **修复动作**: auto-fixable **yes** (只删 .bak 文件,不动 live 配置)
- **风险等级**: low (只删除备份文件)
- **来源**: 内部清理策略 — 备份超过 30 天未使用,可释放空间。
- **自动行为**: 删除过期的 `.bak.<ts>` 文件。

## R010 LARGE_SETTINGS — settings.json 过大

- **规则 ID**: `R010` (内部 `LARGE_SETTINGS`)
- **名称**: settings.json 过大 / Large Settings File
- **检查目标**: `~/.claude/settings.json` (> 1 MB)
- **修复动作**: auto-fixable **no**
- **风险等级**: low (性能影响,启动慢)
- **来源**: 内部启发式 — 正常 settings.json 应 < 50 KB,1 MB 以上必有冗余。
- **手动建议**: 人工检查并精简。

## R011 MISSING_ACTIVE_PROVIDER — 缺活动 provider

- **规则 ID**: `R011` (内部 `MISSING_ACTIVE_PROVIDER`)
- **名称**: 缺活动 provider / Missing Active Provider
- **检查目标**: `~/.claude/settings.json:env.ANTHROPIC_BASE_URL` (不存在)
- **修复动作**: auto-fixable **no**
- **风险等级**: high (Claude Code 无法启动)
- **来源**: Claude Code 官方要求 — 必须有 `env.ANTHROPIC_BASE_URL`。
- **手动建议**: 跳转到切换页选择一个 provider。

## R012 DANGLING_ACTIVE_PROVIDER — 活动 provider 指向不存在

- **规则 ID**: `R012` (内部 `DANGLING_ACTIVE_PROVIDER`)
- **名称**: 活动 provider 指向不存在 / Dangling Active Provider
- **检查目标**: `settings.env.ANTHROPIC_BASE_URL` vs providers 目录
- **修复动作**: auto-fixable **no**
- **风险等级**: high
- **来源**: cc-switch 启发式 — base url 指向已删除的 provider。
- **手动建议**: 跳转到切换页重选。

## R013 INCONSISTENT_PROVIDER_TYPE — provider_type 大小写不一致

- **规则 ID**: `R013` (内部 `INCONSISTENT_PROVIDER_TYPE`)
- **名称**: provider_type 大小写不一致 / Inconsistent Provider Type
- **检查目标**: `<app_data>/providers/*.json:provider_type`
- **修复动作**: auto-fixable **yes** (fs_atomic::write_with_backup)
- **风险等级**: low (统一为 lowercase "anthropic")
- **来源**: 内部规范化 — 内部按 lowercase 比较,大小写混用会导致匹配失败。
- **自动行为**: 把非 canonical 大小写的 provider_type 改成 `anthropic`,生成 .bak 备份。

---

## ENV001 CLAUDE_CODE_ATTRIBUTION_HEADER — 禁用 Claude Code 内置 attribution

- **规则 ID**: `ENV001`
- **名称**: 禁用 Claude Code 内置 attribution / Disable Attribution Header
- **检查目标**: `~/.claude/settings.json:env.CLAUDE_CODE_ATTRIBUTION_HEADER` (应为 `0`)
- **修复动作**: auto-fixable **yes** (设置 `env.CLAUDE_CODE_ATTRIBUTION_HEADER = "0"`)
- **风险等级**: low (关闭 Claude Code 自动添加到响应里的 attribution 文本,纯隐私偏好)
- **来源**: Claude Code v1.0.20+ 官方环境变量参考。
- **自动行为**: 若 settings.json `env` 缺这个字段 / 值 != "0",自动写入 `"0"`,生成 .bak 备份。

## ENV002 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC — 禁用非必要流量

- **规则 ID**: `ENV002`
- **名称**: 禁用非必要流量 / Disable Non-Essential Traffic
- **检查目标**: `~/.claude/settings.json:env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (应为 `1`)
- **修复动作**: auto-fixable **yes** (设置 `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"`)
- **风险等级**: medium (节省 token 用量,关闭 telemetry / 错误上报等非核心流量)
- **来源**: Claude Code 官方环境变量参考 — 官方文档明确"禁用非必要网络流量以节省 token"。
- **自动行为**: 若 settings.json `env` 缺这个字段 / 值 != "1",自动写入 `"1"`,生成 .bak 备份。

## ENV003 CLAUDE_CODE_EFFORT_LEVEL — 默认 effort 调到 max

- **规则 ID**: `ENV003`
- **名称**: 默认 effort 调到 max / Effort Level Max
- **检查目标**: `~/.claude/settings.json:env.CLAUDE_CODE_EFFORT_LEVEL` (应为 `max`)
- **修复动作**: auto-fixable **yes** (设置 `env.CLAUDE_CODE_EFFORT_LEVEL = "max"`)
- **风险等级**: low (默认 effort level,影响响应深度,可手动调回)
- **来源**: Claude Code 官方环境变量参考 — `max` 让模型默认做更深推理。
- **自动行为**: 若 settings.json `env` 缺这个字段 / 值 != "max",自动写入 `"max"`,生成 .bak 备份。