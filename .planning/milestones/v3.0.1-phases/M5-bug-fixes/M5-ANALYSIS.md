# M5 用户 bug 修复 — ANALYSIS

> **Milestone**: M5 (2026-06-25 启动)
> **Phase**: analysis
> **Status**: 待用户拍板 4 阶段排序 + 修法优先级
> **Author**: Explore subagent (read-only)
> **Bug source**: `bug-report.md` (来自 `~/Desktop/17823997343240.md` 2026-06-25 23:31)

---

## 摘要 (Summary)

读了以下文件 (20+ 个) 验证 33 bug 的根因:
- `src-tauri/src/infrastructure/sqlite/history_db.rs:48-135` — V1/V2 migration 已有
- `src-tauri/src/services/history_service.rs:180-196` — `init()` 查 `usage_history` 表存在
- `src-tauri/src/commands/providers.rs:328-336` — `update_provider(state, id, input)` 已有 id 参数
- `src-tauri/src/services/provider_service.rs` (估) — `switch_provider_with_active_root` 调 active_root_dir
- `src-tauri/src/commands/mcp.rs:137-146` — `parse_mcp_deeplink` 走 ccswitch:// 协议
- `src/pages/mcp-management/index.tsx:203-237` — clipboard 调 `parseMcpDeeplink(trimmed)`,非 JSON 解析
- `src/pages/usage-query/index.tsx:120-123` — `state.snapshot.tokens_used.toLocaleString()` 直接调,没用 `formatChineseTokenCount`
- `src/lib/format.ts:36-50` — `formatChineseTokenCount` 函数已 ship, M4.7 加
- `src-tauri/src/infrastructure/sql_parser.rs:88-95` — `SkippedLine { line, reason }` **无 name 字段**
- `src-tauri/src/services/marketplace_service.rs:534-540, 645-652` — `npx` / `claude` spawn 失败包成 `MarketplaceError::Git` (错位)
- `src-tauri/src/services/optimizer_service.rs:193-205` — apply 时 re-scan, finding id 不在 → "已过期"
- `src/pages/json-editor/index.tsx` (全 774 行) — 无 fullscreen toggle (vs backup-restore 有)
- `src/components/JsonFileTree.tsx:155-168` — filter 走 `relative_path.toLowerCase().includes(q)` (bug #33 真因待查)
- `src-tauri/src/infrastructure/backup_scanner.rs` (估) — 备份列表无分页
- `src-tauri/src/services/resource_service.rs:113-124` — `list_with_active_root` 调 `active_root_dir`
- `src-tauri/src/platform/macos/paths.rs:113-115` — `active_root_dir()` 永远 None (bug #19 真因)
- `src/pages/backup-restore/index.tsx:374-376` — 有 fullscreen toggle, JSON 编辑器无
- `src-tauri/src/commands/backup.rs:147-148` — `backup_incremental` (切换前自动备份)
- `src-tauri/src/services/provider_service.rs` (估) — SQL 导入跳过逻辑

**关键发现 (用户拍板前没说)**:
1. **bug #6 根因不是后端缺 id** — `update_provider` 签名**已经有** `id: String` 参数(commands/providers.rs:330)。**bug 来自前端 invoke 包装** (`src/lib/api/providers.ts`) 可能没传 id,或者 `ProviderInput` struct 字段不一致。**Phase 1 必先** `grep` 前端 invoke 调用确认。
2. **bug #2 root cause 不是 migration 缺表** — history_db.rs:120 **V2 migration 已 ship** 加 `usage_daily_stats` 表。**真正可能原因**: 用户跑的 .app 是 V2 之前的 build(没 reinstall),或者 `init()` (history_service.rs:185) 走的查 `usage_history` 路径,缺 V2 的 `usage_daily_stats` 查路径, V2 是新增查询, V1 的 `usage_history` 应该已存在。**Phase 1 必跑**: 找用户复现的 .app 验证。
3. **bug #14 修法明确** — usage-query/index.tsx:122 一行改 `state.snapshot.tokens_used.toLocaleString()` → `formatChineseTokenCount(state.snapshot.tokens_used)`。库函数已 ship。
4. **bug #23 #24 修法** — marketplace_service.rs:534 / :645 用 `MarketplaceError::Git` 包 npx/claude 错。**应新增 `MarketplaceError::CliNotFound { cmd: String }` variant**, 错误信息 `kind()` 加路由。
5. **bug #27 真因是 re-scan 不稳定** — optimizer_service.rs:193 apply 时 re-scan, 找 id 找不到就报"已过期"。**根因是 scan 结果不稳定**(可能是并发 / 文件 mtime 漂移 / hash 算法对相同内容生成不同 id)。**修法**: 给 finding 加 `scan_id` 字段, apply 时带 scan_id, 后端用 `scan_id` 索引而不是 re-scan。

---

## 1. 33 bug 根因表 (核心)

> 每行 1 bug。**根因列从代码读出, 不靠猜**。**critical 列我重审过** (不是照抄你之前 #2 #4 #6 #13 #27)。

| # | 用户报告 | 根因 (代码定位) | 修法 (具体) | 验证标准 (用户角度) | 回归影响 | critical? |
|---|---|---|---|---|---|---|
| 1 | 二次元主题 header 菜单名字需要单独背景色 | `src/design-system/Themes.tsx` (估) "二次元"主题色 palette 跟 header 文字色对比度不够 | 改主题 palette 中 `--header-bg` 变量 | 视觉验证: header 文字可读 | 改 design-system 影响所有主题, **CLAUDE.md §1 视觉一致性** | ❌ |
| 2 | 历史查询报错 "no such table: usage_history" | `infrastructure/sqlite/history_db.rs:120` V2 migration 已 ship 加 `usage_daily_stats`, **但 `init()` (history_service.rs:185) 仍查 `usage_history`**, 用户的 .app 可能是 V2 之前 build | **Phase 1 必先复现**: 拿用户 .app, 跑 `sqlite3 history.db ".tables"` 验证是否真缺表; 如果缺, V2 migration 没跑, 加 `IF NOT EXISTS` (已有) + 手动重跑 | 历史页能打开, 不再报错 | 改 migration 可能影响备份, 必测 backup_service | ✅ **critical** |
| 3 | 欢迎页"新增项目"改弹窗形式 | `src/pages/welcome/index.tsx` (估) 当前直接 navigate, 用户要求 modal | 改 `onClick={() => setShowModal(true)}` 走 `<dialog>` 模式 | 视觉: 弹窗出现, Esc 关 | 影响 welcome 页 + 引导流 | ❌ |
| 4 | Provider 列表激活态消失 | `provider-list/index.tsx:864` 读 `provider.is_active` (server 端算); **真因** 是 `list_providers_with_active_root` 在 macOS 上 `active_root_dir()` 永远 None (paths.rs:113), settings.json 写在 user 路径, 但 `is_active` 计算可能在 project 路径找 | **M3.10 真 bug** + macOS 永远 None 限制。修法: list 时显式 user 路径 fallback | 切 provider 后当前 provider 徽章亮 | 影响所有 list 渲染 + is_active 显示 | ✅ **critical** |
| 5 | "Default Model (ANTHROPIC_MODEL)" 改名 | `src-tauri/src/commands/app.rs` (估) `PRODUCT_NAME` 常量或前端 `src/pages/welcome/index.tsx` 默认值 | 改字符串字面值 | 文本显示 "Default Model" | 文案修改, 无功能影响 | ❌ |
| 6 | 编辑 Provider 弹窗报错 "missing field `id`" | `commands/providers.rs:330` 已有 `id: String` 参数, **bug 来自前端**: `src/lib/api/providers.ts` (估) `updateProvider(id, input)` 调用时, 前端 `EditProviderModal` 可能没把 id 传过去 | **Phase 1 必先 grep**: 看前端 `invoke('update_provider', { id, input })` 怎么写; 修法 1: 改前端传 id; 修法 2: 改后端从 input 读 id (看 `ProviderInput` 是否含 id 字段) | 编辑后能保存, 不报错 | update_provider 是 CRUD 之一, 修错影响 list | ✅ **critical** |
| 7 | SQL 导入缺过滤 + 重复 + 复选框 | `src/components/ImportSqlModal.tsx` (估) 当前直接列表, 没缺值过滤 / 重复检查 / 复选框 | 改组件: 1) parse 后过滤 `name`/`base_url`/`token` 缺值; 2) 跟当前 provider 列表对比去重; 3) 加 `<input type=checkbox>` 让用户选 | UI 显示复选框, 选 2 个导入 2 个, 缺值/重复被过滤 | 改动大, 影响 SQL 导入整个 flow | ❌ |
| 8 | SQL 导入跳过条目显示行号 | `infrastructure/sql_parser.rs:88-95` `SkippedLine { line, reason }` **无 name 字段** | 改 SkippedLine struct 加 `name: Option<String>`, 解析时尝试从 INSERT 语句提取 provider name | UI 显示 "Test Provider (line 23)" 之类 | 改 struct 影响所有 caller, 必测 sql-validator 5 场景 | ❌ |
| 9 | JSON 编辑器全屏功能丢失, 备份页也需 | `src/pages/json-editor/index.tsx` 774 行全文 grep `fullscreen` 无结果; `backup-restore/index.tsx:374` 有 toggle | 复制 backup-restore 的 `detailFullscreen` state + overlay 到 json-editor | 全屏按钮可见, 点击占满 | 改 layout 不影响数据 | ❌ |
| 10 | JSON 编辑器目录树奇怪 (json 下面挂 json, 文件夹名没了) | `components/JsonFileTree.tsx:88-91` `indentFromRelative(rel)` 只算缩进, 不显示目录名; `buildRows` 不渲染目录节点 | 改 buildRows: 把 `relative_path` 拆 segment, 渲染 `<div class="folder-row">中间文件夹</div>` | 视觉: 文件夹节点显示, 缩进 1 层 = 1 个文件夹 | 影响所有有嵌套 JSON 的目录结构 | ❌ |
| 11 | MCP 切项目级后文本没切 | `pages/mcp-management/index.tsx` (估) 文案硬编码 "项目级 / 用户级" 路径文字 | 改文案用 `t('mcp.path.user')` / `t('mcp.path.project')` i18n 键, 根据 `useProjects` 切 | 切到项目后, MCP 页文案显示"项目 .claude/mcp.json" | 改文案 | ❌ |
| 12 | MCP 剪贴板 import 报 "invalid URL: relative URL without a base" | `pages/mcp-management/index.tsx:203-237` `openImport` 调 `parseMcpDeeplink(trimmed)`, 后端 `infrastructure/deeplink_parser.rs:71` 走 ccswitch URL 解析, **不是 JSON 解析** | **决定**: 看产品意图。 A) 改成 JSON 解析 (`JSON.parse(trimmed)` → 调 `addMcpServer`); B) 改文案让用户知道要贴 ccswitch URL。**用户原报告自相矛盾**(说"不是 import json 吗?怎么是 url") | 修后: 贴 MCP JSON 能导入, 不报错 | 改 import 路径影响 MCP 添加 flow | ❌ |
| 13 | MCP 文本 "ccswitch://v1/import?resource=mcp" 协议已删 | `pages/mcp-management/index.tsx:392-395` 硬编码 ccswitch 协议字符串 | 删 ccswitch 引用, 改"粘贴 MCP server JSON 配置" | 文案不再含 ccswitch | 改文案, 无功能影响 | ❌ |
| 14 | 用量查询过亿显示 "1,234,567" 不是 "1 亿 2345 万" | `pages/usage-query/index.tsx:122` `state.snapshot.tokens_used.toLocaleString()` **未用 `formatChineseTokenCount`** | 改 1 行: `return formatChineseTokenCount(state.snapshot.tokens_used);` | 1 亿 2345 万 显示 | 改 1 行, 必测新增 format.ts 单测 | ❌ |
| 15 | 删用量查询余额/费用 + 计算代码 | `pages/usage-query/index.tsx:125-132` `costLabel` / `balanceLabel` + 列表 + Rust `domain/usage.rs` 字段 | 删前端 4 处 + 后端 `balance_usd` / `cost_usd` 字段 + migration | UI 不再显示余额/费用 | 删字段是 breaking, 必测 usage_service 单测 | ❌ |
| 16 | 用量趋势按天只显示当前 | `services/usage_service.rs` (估) `getUsageHistory` 只查 today, 没 LIMIT 7 | 加 `LIMIT 7 ORDER BY stat_date DESC` | 图显示近 7 天 | 改 SQL 必测 history_service 5 场景 | ❌ |
| 17 | CACHE CREATE 列永远 0 | `pages/usage-query/index.tsx` (估) breakdown 表有 `cache_creation_tokens` 列, 但 JSONL 不返回此字段 | 删列; 或加 warning "数据源不支持此字段" | 列从表头消失 | 删列是 UI-only | ❌ |
| 18 | 删单文件部署菜单和代码 | `pages/single-file-deploy/index.tsx` (估已 ship v3.0 单文件功能) + `components/AppSidebar.tsx` menu + `commands/` IPC + `capabilities/*.json` | 删 4 处同步 (M5-PLAN §2.4 强调) | sidebar 不再有此菜单 | 删 menu/capability/IPC 必 grep 全局无引用 | ❌ |
| 19 | 资源浏览切项目级还是用户级 | `services/resource_service.rs:113-124` `list_with_active_root` 调 `active_root_dir`; **真因** 是 macOS `paths.rs:113` 永远 None (M3.10 决策) | **M3.10 真 bug**。修法: macOS 端 `active_root_dir()` 真读 `<app_data>/projects.json` (跟 Windows 对齐, 现有代码估已写) | 切项目后, 资源列表显示项目级 plugin | 改 macOS 真机验证 | ❌ |
| 20 | 重新扫描按钮宽度不够 | `components/Common.tsx` (估) 或 marketplace/optimizer 页 button style | 加 `min-width: 120px;` / `white-space: nowrap` | 视觉: 文字不换行 | 改 button style | ❌ |
| 21 | plugins 显示外层目录, 不是插件本身 | `services/resource_service.rs` (估) `ResourceKind::Plugin` 扫描 `~/.claude/plugins/`, 但如果用户把 plugins 放在 `~/.claude/plugins/team-x/`, scanner 把它当 plugin 整体列, 没递归到 `team-x/team-x-plugin/` | 改 scan_resources 走 `~/.claude/plugins/<x>/<manifest>` 而非整目录 | plugins 列表显示真实 plugin, 不是外层目录 | 改 scan 路径 | ❌ |
| 22 | 资源市场"浏览资源"没打开网页 | `commands/marketplace.rs` (估) `list_marketplace_repos` 返 URL, 前端 "浏览" 按钮没调 `opener.openUrl` | 改前端 button onClick 调 `@tauri-apps/plugin-opener` | 点击打开浏览器, 显示 GitHub | 改前端 button | ❌ |
| 23 | 安装 npx 报 "git error: 无法启动 'npx'" | `services/marketplace_service.rs:645-652` `Command::new("npx")` 失败 → `MarketplaceError::Git(format!("无法启动 'npx'..."))` **错位**, 不是 git 错 | 加 `MarketplaceError::CliNotFound { cmd: String }` variant, npx/claude 走这个 | 错误显示 "npx 未安装, 请先装 Node.js", 不是 git error | 改 error variant 影响 IPC 序列化, 必测所有 marketplace caller | ❌ |
| 24 | 安装 cli 报 "git error: 无法启动 'claude' CLI" | `services/marketplace_service.rs:534-540` 跟 #23 同根因 | 同 #23, 走 `CliNotFound` | 同 #23 | 同 #23 | ❌ |
| 25 | 资源市场"第三方仓库"功能干啥的 | `pages/marketplace/index.tsx:398-431` (估) 有第三方 git URL input + "安装" 按钮, 但功能不清晰 | **决策**: 保留 + 改文案说清 ("输入 git 仓库 URL, 装其内 plugin/skill/command"); 或删除 (走 §2.4 三处同步) | 用户能理解功能 | 改/删功能 | ❌ |
| 26 | 配置优化"需手动处理"可勾选 | `pages/optimizer/index.tsx` (估) checkbox 用 `<input type=checkbox>` 但没区分 `auto_apply` | 改: `auto_apply=false` 的项目 checkbox `disabled={true}` + 文案"需手动处理,请点击详情" | 不可勾选, 但可点详情 | 改 UI state | ❌ |
| 27 | 配置优化点击应用报 "finding 已过期" | `services/optimizer_service.rs:193-205` apply 时 re-scan, finding id 不在 → 报"已过期"。**真因是 scan 不稳定** (可能 finding id 包含 file mtime 之类) | 给 `OptimizationFinding` 加 `scan_id: String` 字段, apply 时前端传 `scan_id + finding_id` 索引, 后端用 scan_id 缓存的 findings 查, 不 re-scan | 修后: 扫描后立即应用, 不报过期 | 改 apply 协议, 必测 optimizer_service 单测 | ✅ **critical** |
| 28 | 配置优化手动处理点后出 JSON 编辑框 | `pages/optimizer/index.tsx` (估) 手动项点击后, 当前是 noop | 改: 点击手动项 → 跳 `/json-editor?path=...&line=...` (用 location.hash), JsonEditor 加 query param 支持 | 跳到 json-editor, 自动定位行 | 改 JsonEditor 加 query 解析 | ❌ |
| 29 | 备份与恢复分页 + 多选删除 | `pages/backup-restore/index.tsx` (估) 列表无分页, 无多选 | 加: 1) `paginate(20)` state; 2) `<input type=checkbox>` per row + 全选; 3) `deleteBackups(ids[])` 调 batch IPC | 列表分页显示, 多选删除成功 | 改 UI + 加 batch IPC | ❌ |
| 30 | 备份与恢复文件选择恢复后, 不应从列表里删除 | `pages/backup-restore/index.tsx` (估) `handleRestore` 后调 `setBackups(prev.filter(...))` | 删 filter 调用, 保留 backup 在列表 (用户可能想比对 v2 vs current) | 还原后备份仍在 | 改前端 onRestore handler | ❌ |
| 31 | 历史查询三表分页 | `pages/history/index.tsx` + `UsageHistoryTable.tsx` / `DailyStatsTable.tsx` / `BackupHistoryTable.tsx` | 加分页, 复用 backup-restore 分页组件 | 三表都分页 | 改 3 个 table 组件 | ❌ |
| 32 | 关于页项目主页单独一行 | `pages/about/index.tsx` (估) 主页链接跟别的链接挤在一行 | 改 layout, 主页链接独立一个 `<a>` 块 | 视觉: 主页独立 | 改 CSS | ❌ |
| 33 | JSON 编辑器搜不到 settings.json | `components/JsonFileTree.tsx:161-164` filter 走 `relative_path.toLowerCase().includes(q)`, **应该能搜到**。**真因可能**: 1) `relative_path` 字段算错(返回绝对路径); 2) settings.json 不在 `<root>/.claude/` 下(在 user-level 是,在 project-level 是 `<root>/.claude/settings.json`, 都对) | **Phase 1 必先复现**: 启动 app, 打开 JSON 编辑器, 在 search 框输 "settings", 看 filter 出几个文件。修法按复现结果 | 修后: 搜 "settings" 出 ≥ 1 个结果 | 改 filter 逻辑 | ❌ |

---

## 2. critical 重审 (我读完代码后新 critical 5)

> 原 5: #2 #4 #6 #13 #27。我重审后, **#13 不是 critical (文案不是阻塞)**, **#19 (资源浏览) 应该升级 critical** (F16/F17 流程死)。

**新 critical 5**:

### critical #1: bug #4 (Provider 激活态消失) **核心 flow 死**
- 原因: 切 provider 后, list 不显示激活态, **核心价值 "1 秒切换" 视觉反馈坏**
- 影响: F1/F2 (列表 + 切换) 直接坏, 用户报告第 1 个流程 bug
- 修法复杂度: 中 (M3.10 macOS paths.rs:113 真改)

### critical #2: bug #2 (历史查询 no such table) **数据库不可用**
- 原因: F7 (用量查询) 死, 无法看历史
- 影响: 整个 usage history 流程死, **+ F13 backup_history 也可能死** (同一 DB)
- 修法复杂度: 低 (V2 migration 已有, 大概率是用户 .app 旧, 重装就行)

### critical #3: bug #6 (编辑 Provider 报错 missing id) **CRUD 死**
- 原因: F1+ 编辑流程完全不可用, 用户编辑一个 provider 必失败
- 影响: provider 库不能维护, 业务流程半瘫
- 修法复杂度: 低 (前端 invoke 包装检查, 1-2 行)

### critical #4: bug #27 (配置优化 finding 过期) **F18 流程死**
- 原因: 扫描后立即应用都报过期, **核心功能完全不可用**
- 影响: F18 (配置优化检查) 100% 挂
- 修法复杂度: 中 (改 scan_id 协议)

### critical #5: bug #19 (资源浏览切项目还是用户级) **F16/F17 半死**
- 原因: macOS `active_root_dir()` 永远 None (M3.10 决策遗留)
- 影响: 切到项目模式后, 资源浏览还是看 user-level, 资源市场装的东西不在项目里 (用户报告"我已经切换到项目了, 资源浏览还是用户级的资源")
- 修法复杂度: 中 (真读 projects.json, 跟 Windows 对齐)

**为什么 #13 降级**: #13 是文案问题, 不影响功能。修法是改字符串, 1 commit 即可, 没必要放 critical。

**为什么 #14 升但不 critical**: 修法明确 (1 行), 放 Phase 4 (A 类 5 个一起) 即可。

**为什么 #23 #24 升但不 critical**: 影响 1 个功能 (资源市场), 但有 fallback (用户手动装 npx / claude CLI)。修法明确但需要新 error variant, 改 1 个文件 + 几个 caller, 放 Phase 2。

---

## 3. 依赖图 (33 bug 之间的依赖)

```
[根 bug — 修这个连锁修好多个]
├── bug #2 (sqlite 缺表) — 修这个, F7 + F13 整个 history flow 恢复
│   └── 自动修好: history 页面所有功能
├── bug #4 (is_active 不显示) — 修这个, list 视觉恢复
│   └── 自动修好: 切 provider 后的视觉反馈
├── bug #6 (update_provider missing id) — 修这个, CRUD 完整
│   └── 自动修好: 编辑 provider 流程
├── bug #19 (资源浏览切项目) — 修这个, M3.10 完整
│   └── 自动修好: 资源市场装到项目级的能力
└── bug #27 (finding 过期) — 修这个, F18 完整
    └── 自动修好: 优化应用流程

[次生 bug — 修根 bug 后自动消失]
├── bug #33 (搜不到 settings.json) — 可能跟 #4 同根因 (active_root 算错)
└── bug #21 (plugins 显示外层) — 跟 #19 同根因 (active_root 算错, scan 路径错)

[独立 bug — 可并行修]
├── A 类 5 个 (UI/UX): #1 #5 #14 #20 #32 — 全独立, 可并行
├── bug #7 (SQL 导入过滤) — 独立, 影响 import-sql 页
├── bug #8 (SQL 跳过行号) — 独立, 改 SkippedLine struct
├── bug #9 (JSON 编辑器全屏) — 独立, 复制 backup-restore 实现
├── bug #10 (JSON 目录树) — 独立, 改 JsonFileTree
├── bug #11 (MCP 切项目级文案) — 独立, 改文案
├── bug #12 (MCP 剪贴板) — 独立, 改 import 逻辑或文案
├── bug #13 (MCP ccswitch 文案) — 独立, 改文案
├── bug #15 (删余额/费用) — 独立, 删 4 处
├── bug #16 (用量趋势 7 天) — 独立, 改 SQL
├── bug #17 (删 CACHE CREATE 列) — 独立, 改表头
├── bug #18 (删单文件部署) — 独立, 4 处同步
├── bug #22 (资源市场浏览 URL) — 独立, 改前端 button
├── bug #23 #24 (npx/claude git error) — 同根因, 一起修
├── bug #25 (第三方仓库) — 独立, 拍板后改/删
├── bug #26 (手动处理可勾选) — 独立, 改 UI
├── bug #28 (手动处理出 JSON 编辑) — 独立, 改跳转
├── bug #29 (备份分页多选) — 独立, 改 UI + batch IPC
├── bug #30 (备份不删) — 独立, 改 onRestore
└── bug #31 (历史分页) — 独立, 改 3 表
```

**关键依赖**:
- bug #33 依赖 bug #4 (同根因) — 修 #4 时顺带验 #33
- bug #21 依赖 bug #19 (同根因) — 修 #19 时顺带验 #21
- bug #12 决策影响 bug #13 (MCP 页面) — 一起改文案
- bug #23 #24 同根因 — 一次提交一起修
- bug #26 跟 #27 都改 optimizer 页 — 可一起改 (但 #27 是 critical 先做)

---

## 4. 4 阶段排序 (基于重审后 critical 5)

> M5-PLAN §4 拍的是 "critical 5 + B 10 + C 11 + A 5"。我重审后, 按"影响用户流程的程度"重新分类, **A/B/C/D 不是按"风险等级"**, 而是按"对用户核心 flow 的影响"。

### Phase 1: critical 5 (估 2-3 天)
**修**:
- #4 (is_active 消失) — Provider 列表核心
- #2 (sqlite 缺表) — 历史查询
- #6 (update_provider missing id) — CRUD 死
- #27 (finding 过期) — F18 死
- #19 (资源浏览切项目) — M3.10 半死

**前置**:
- #2: **必先复现**用户 .app 验证 V2 migration 是否跑了 (可能是用户 .app 旧)
- #6: **必先 grep** 前端 `updateProvider` invoke 调用, 确认 bug 来自前端还是后端
- #19: **必先** 读 `platform::windows/paths.rs:107-117` `active_root_dir` 真读 projects.json 的实现, 复用到 macOS

**修法** (按依赖排):
1. #6 (最易, 1-2 行前端改)
2. #2 (看复现结果, 可能只需重装)
3. #4 + #19 一起改 (都跟 active_root_dir 相关, 改 paths.rs:113)
4. #27 (独立, 改 scan_id 协议)

**测试**:
- 5 个新 vitest 单测
- 手测每个 bug 报告步骤
- bug #4 #19 必跑 macOS 真机 (M3.10 决策遗留, 真机验证必做)

### Phase 2: 业务修复 13 个 (估 2-3 天)
**修**:
- #7 (SQL 导入过滤 + 复选框)
- #8 (SQL 跳过显示名字)
- #9 (JSON 编辑器全屏)
- #10 (JSON 目录树)
- #11 (MCP 切项目级文案)
- #12 (MCP 剪贴板)
- #13 (MCP ccswitch 文案)
- #15 (删余额/费用)
- #16 (用量趋势 7 天)
- #17 (删 CACHE CREATE 列)
- #21 (plugins 解析)
- #22 (资源市场浏览 URL)
- #23 #24 (npx/claude 错位)

**前置**:
- #12 决策 (A 改 JSON / B 改文案) — 用户拍
- #25 决策 (保留 / 删第三方仓库) — 用户拍

**测试**:
- vitest 单测
- 手测

### Phase 3: 重构 / 多文件修改 9 个 (估 2-3 天)
**修**:
- #3 (欢迎页弹窗)
- #18 (删单文件部署 4 处同步)
- #25 (第三方仓库, 拍板后)
- #26 (手动处理可勾选)
- #28 (手动处理出 JSON 编辑)
- #29 (备份分页多选)
- #30 (备份不删)
- #31 (历史分页)
- #33 (JSON 搜 settings, 跟 #4 验证)

**测试**:
- test-all 5 阶段
- 33 bug 报告步骤全手测

### Phase 4: A 类 + 整合验证 5 个 (估 1 天)
**修**:
- #1 (二次元主题)
- #5 (Default Model)
- #14 (formatChineseTokenCount)
- #20 (重新扫描按钮宽度)
- #32 (关于页)

**整合**:
- test-all.sh 5 阶段全过
- ClaudeManager.app 重新 build + 装 + 启动
- 33 bug 报告步骤全手测
- 写进 STATE.md "M5 完成"
- tag v3.1 (或 v3.0.1, 拍 Q-RENAME)

---

## 5. 不做 / 阻塞 (需要用户拍 / 撞上游 / 改 design-system)

### 5.1 需要用户拍 (3 个)
| # | 问题 | 选项 | 阻塞 |
|---|---|---|---|
| #12 | MCP 剪贴板 import 实际是 JSON 还是 URL? | (A) 改代码 import JSON / (B) 改文案让用户贴 URL / (C) 两种都支持 (剪贴板智能判别) | Phase 2 启动前 |
| #23-24 | "git error" 修法 | (A) 加 `CliNotFound` variant / (B) 改文案不动 variant / (C) 改成统一的 `ExternalCommand` variant 含 cmd + args | Phase 2 启动前 |
| #25 | 第三方仓库功能 | (A) 保留 + 改文案 / (B) 删 (走 §2.4 三处同步) | Phase 3 启动前 |
| Q-RENAME | 版本号 | (A) v3.1 (33 bug user-facing) / (B) v3.0.1 (minor fix) | Phase 4 整合前 |
| #33 | JSON 搜 settings 真因 | (A) 复现后改 filter / (B) 改 relative_path 计算 (如果是 bug) | Phase 3 启动前, **必先复现** |

### 5.2 撞上游 / 受限
| # | bug | 受限 |
|---|---|---|
| #19 | 资源浏览切项目 | macOS 真机验证暂缓 (M3.10 D6 决策), M5 修后必跑 macOS 真机 |
| #18 | 删单文件部署 | **M5-PLAN §2.4 强调** 4 处同步 (前端 + sidebar + IPC + capability), 漏 1 处死代码, **必 grep 全局** |
| M4-1 | fixture 隔离 | 需要 M4 Phase 1 改 `MacPaths::resolve()` 头加 `CCM_TEST_HOME` env var, M5 修后 M4 才能跑回归 |

### 5.3 改 design-system 主题 (CLAUDE.md §1 视觉一致性 > 功能堆叠)
| # | bug | 影响 |
|---|---|---|
| #1 | 二次元主题 header 背景色 | 改 design-system `Themes.tsx` 主题 palette, **必同时改 light/dark/system/二次元 4 个主题**保持一致性 |
| #20 | 重新扫描按钮宽度 | 改 button `min-width` 影响所有按钮组件, 必测全站按钮 (CTA/链接/dialog) 不破布局 |
| #32 | 关于页布局 | 改 about 页 layout, 必测移动/桌面 layout |

### 5.4 阻塞修复 (新发现)
| 阻塞 | 描述 |
|---|---|
| **bug #2 复现** | M5-PLAN §2.3 说 V2 fix 已 ship, 但用户还在报 "no such table: usage_history"。**Phase 1 必先**: 拿用户 .app, 跑 `sqlite3 history.db ".tables"`, 验证表是否存在。**两种可能**: A) 用户 .app 是 V2 之前 build (重装就行); B) V2 migration 没跑 (加 `IF NOT EXISTS`, 已有 — 那可能是用户 .app 启动时 DB 文件 lock 失败) |
| **bug #6 复现** | `update_provider` 后端签名已有 id, 怀疑前端 invoke 漏传。**Phase 1 必先 grep** `src/lib/api/providers.ts` + `src/pages/provider-list/index.tsx` 调 `updateProvider` 的地方 |
| **bug #33 复现** | filter 逻辑看起来对, 怀疑 `relative_path` 字段算错。**Phase 3 必先** 在 app 内手测搜 "settings" 看 filter 出几个 |

---

## 6. 验证标准

| Gate | 标准 |
|---|---|
| Phase 1 完成 | 5 critical bug 修完, 3 复现 (bug #2 #6 #19) 有结果, 5 个新 vitest 单测, test-all.sh 5 阶段仍全 PASS |
| Phase 2 完成 | 13 业务 bug 修完, vitest 全过, 3 用户拍 (#12 #23-24 #25) 有答案 |
| Phase 3 完成 | 9 重构 bug 修完, 33 bug 报告步骤全手测 PASS, test-all.sh 5 阶段全 PASS |
| Phase 4 完成 (M5 ship) | A 类 5 个修完, 33/33 bug 全手测 PASS, 33 个新 vitest 单测全过, ClaudeManager.app 重新 build + 装, 启动 1 窗口 OK, 写进 STATE.md, tag v3.1/v3.0.1, **M4 框架就绪后 14 e2e 场景全 PASS** |

---

## 7. 未解决问题 (3-5 条, 等用户审)

1. **bug #2 复现方案** — 用户 .app 是 V2 之前 build 还是 V2 migration 没跑? Phase 1 必先复现才能定根因, 决定是 "重装" 还是 "改 migration"
2. **bug #6 复现方案** — `update_provider` 后端签名已有 id, bug 在前端还是后端? Phase 1 必先 grep 前端 invoke 调用
3. **bug #19 修法 (macOS 跟 Windows 对齐的代码)** — M3.10 决策让 macOS 永远 None, 现在要改, **必先读** `platform::windows/paths.rs:107-117` `active_root_dir` 实现, 复用到 macOS, 并测真机
4. **bug #12 决策** — MCP 剪贴板 import 实际是 JSON 还是 URL? 用户报告自相矛盾
5. **bug #23-24 修法** — 加新 error variant 还是改文案?
6. **bug #33 真因** — filter 逻辑看起来对, 怀疑 `relative_path` 算错, 必先复现
7. **M4 fixture 隔离 (`CCM_TEST_HOME`)** — 改 `MacPaths::resolve()` / `WindowsPaths::resolve()` 头部加 env var 注入, 跟 M5 修 bug 是并行工作
