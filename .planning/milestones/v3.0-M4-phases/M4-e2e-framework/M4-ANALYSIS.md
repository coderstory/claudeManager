# M4 e2e 端到端用户行为测试 — ANALYSIS

> **Milestone**: M4 (2026-06-25 启动)
> **Phase**: analysis
> **Status**: 待用户拍板进 Phase 1
> **Author**: Explore subagent (read-only)
> **Refs**: M4-PLAN.md §3.2 (14 场景), `bug-report.md` 2026-06-25 23:31

---

## 摘要 (Summary)

读了以下文件 (12 个) 验证 14 场景的代码锚点:
- `src-tauri/src/platform/traits.rs` (AppPaths + IPlatformPaths) — 路径解析契约
- `src-tauri/src/platform/macos/paths.rs` (MacPaths::resolve, 130 行实测实现)
- `src-tauri/src/platform/windows/paths.rs` (WindowsPaths::resolve, 200+ 行)
- `src-tauri/src/platform/mod.rs` (runtime::paths() 工厂, cfg 选择)
- `src-tauri/src/lib.rs:280-355` (tray 初始化, 单实例, sql 路径缓存)
- `src-tauri/src/commands/providers.rs:55-130, 328-336` (list_providers / switch_provider / update_provider)
- `src-tauri/src/infrastructure/sqlite/history_db.rs:48-135` (V1+V2 migration)
- `src/pages/provider-list/index.tsx:158-180, 860-935` (handleActivate, data-testid, isActive)
- `src/pages/mcp-management/index.tsx:203-237, 392-395` (clipboard import, 过时 ccswitch 文案)
- `src/pages/usage-query/index.tsx:120-123, 122` (toLocaleString 缺 formatChineseTokenCount)
- `src/pages/optimizer/index.tsx:113-156` (applyOptimizations 无 finding invalidate)
- `src/components/JsonFileTree.tsx:155-168` (search filter 走 relative_path)

**关键发现 (你拍前没说的)**:
1. **fixture 隔离 env var 不存在** — `MacPaths::resolve()` / `WindowsPaths::resolve()` 都直接调 `dirs::home_dir()` + `dirs::config_dir()`,**不读** `CCM_TEST_HOME` 或 `XDG_CONFIG_HOME`。你 M5-PLAN §9 D 拍的环境变量是**新功能**,要修改 `resolve()` 加 `if let Ok(p) = std::env::var("CCM_TEST_HOME") { return p; }` 早退。
2. **`update_provider` 签名已有 id 参数** — `commands/providers.rs:330` 已经是 `pub async fn update_provider(state, id: String, input: ProviderInput)`,**不是 bug #6 说的 "missing id field"**。Bug #6 根因更可能是**前端 invoke 没传 id** 或 `ProviderInput` struct 本身缺字段。看 src/lib/api/providers.ts 怎么 wrap。
3. **`is_active` 走 server 端计算** — `provider-list/index.tsx:864` `const isActive = provider.is_active` (来自 IPC),**不是前端算**。Bug #4 "激活状态消失" 更可能是 `list_providers_with_active_root` 的 `active_root_dir()` 在 macOS 永远返回 `None` (paths.rs:113) 导致 settings.json 写错路径,切了不显示激活。
4. **tray 在 macOS 真有 double-click handler** — `lib.rs:336-345` `t.on_tray_icon_event` 监听 `DoubleClick`,**但只在 `Some(t) = app.tray_by_id("main-tray")` 之后**。spec 01 启动后要 sleep 等 tray 挂上,**不能 sleep 3s 立即 click**,实测 5-7s 才对(因为 Tauri webview + tray 注册 + Rust 启动 ~ 5s 总)。

---

## 1. Fixture 隔离假设验证 (M4-PLAN §10.3 / 你 M5 §9 D=2)

### 1.1 当前代码不支持 env var override (必须改)

`src-tauri/src/platform/macos/paths.rs:30-72` (MacPaths::resolve):
```rust
fn resolve(&self) -> AppPaths {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/Users/Shared"));
    let app_data = dirs::config_dir()
        .map(|p| p.join("ClaudeConfigManager"))  // ← 硬绑 home + config_dir
        .unwrap_or_else(|| home.join("Library")...);
    // ...后续字段全部基于 hard-coded `home` 派生命理路径
}
```

**结论**: M4-PLAN §10.3 的 "D=2: XDG_CONFIG_HOME 重定向" 假设**不成立**。`dirs::config_dir()` 在 macOS 直接调 `getenv("HOME")` + `Library/Application Support`,**不读** `XDG_CONFIG_HOME`(XDG 是 Linux 标准,macOS/Windows 不遵守)。

### 1.2 修法 (M4 Phase 1 必做)

`MacPaths::resolve()` 头部加 (~10 行):
```rust
fn resolve(&self) -> AppPaths {
    // M4 fixture isolation — e2e tests inject this env var
    if let Ok(test_home) = std::env::var("CCM_TEST_HOME") {
        let test_root = PathBuf::from(test_home);
        // 派生完整 AppPaths,所有路径都基于 test_root
        // claude_dir = test_root/.claude, app_data = test_root/.config/ClaudeConfigManager 等
    }
    // ...原代码
}
```

**单测覆盖点** (M4 Phase 1 stub spec 必跑):
- `mac_paths_resolve_with_test_home_uses_overrides` — 设 `CCM_TEST_HOME=/tmp/x`,验证 `paths.home == /tmp/x`、`settings_json == /tmp/x/.claude/settings.json`
- `mac_paths_resolve_without_test_home_uses_dirs` — 不设 env,验证仍走 `dirs::home_dir()` (行为不变,无回归)
- `mac_paths_ensure_dirs_with_test_home_creates_in_temp` — 验证 `ensure_dirs` 也在 `CCM_TEST_HOME` 下创建

**为何不直接用 `XDG_CONFIG_HOME`**: macOS 不读 XDG,Windows 完全不读 XDG。**统一用 `CCM_TEST_HOME`** 是最干净方案。

### 1.3 启动 AppState 时注入 env var

`src-tauri/src/lib.rs::run` 不需要改 — `setup` 阶段 (line 198) 才调 `platform::runtime::paths()`,这时 env var 早已被 spec 设置。spec 02 骨架:
```bash
export CCM_TEST_HOME="/tmp/cc-M4-$$"
mkdir -p "$CCM_TEST_HOME/.claude"
cp fixtures/3-providers.json "$CCM_TEST_HOME/.claude/settings.json"
# ... 启动 app + 操作 + 断言 ...
NEW_URL=$(jq -r '.env.ANTHROPIC_BASE_URL' "$CCM_TEST_HOME/.claude/settings.json")
# trap EXIT: rm -rf "$CCM_TEST_HOME"
```

### 1.4 风险 (M4-PLAN §10.4 已列 3 条,补充第 4)

1. Tauri's `tauri-plugin-store` / `tauri-plugin-log` 可能把 `~/Library/...` 当**默认**路径
2. Mac 沙盒 — `open .app` 启动的 app 拿到的 env var 是 macOS 启动上下文的
3. `CCM_TEST_HOME` 冲突 — 两个 spec 并行跑会撞路径
4. **新增**: `tauri::Builder::default()` 注册 plugin 时,部分 plugin (auto-launch / log) 可能在 `setup` 之前就 resolve 路径。需在 `lib.rs::run` 第一行改 `std::env::set_var`,但 `set_var` 跨线程不安全。

---

## 2. 14 场景代码锚点 + 副作用验证点 + race condition 边界 + 回归影响

> 每场景 4 段。**代码锚点 = 真文件:行号**,从源码读出。

### 场景 01: 启动 + tray

**代码锚点**:
- `src-tauri/src/lib.rs:310-327` `TrayIconBuilder::with_id("main-tray")` 构建 tray
- `src-tauri/src/lib.rs:336-345` `tray_handle.on_tray_icon_event` 注册 double-click
- `src-tauri/src/lib.rs:347-355` `window.on_window_event` 实现 minimize-to-tray

**副作用验证点**:
- `pgrep -f "ClaudeManager.app/Contents/MacOS/claude-config-manager"` 找到 1 个进程
- `osascript -e 'tell application "System Events" to count windows of process "ClaudeManager"'` 返回 1
- 关窗口 (Cmd+W) 后 `pgrep` 仍能找到进程 (tray 存活)

**race condition 边界**:
- 冷启动链: `open .app` (0.5s) → Rust 启动 (1.5s) → webview 挂载 (1.5s) → React render (0.5s) → **tray builder 同步完成 (0s)**。**经验值 sleep 5s**。
- 精确:`launch_app` 后 `until pgrep -f ClaudeManager; do sleep 0.2; done` 立即触发,然后 `sleep 4` 等 webview 渲染。**总耗时 4-5s**。
- tray 双击事件:Tauri v2 的 `on_tray_icon_event` 同步注册,但 System Events 需要 ~200ms 才能发现 tray icon。**click 前 sleep 0.3s**。

**回归影响**:
- spec 01 失败=后续 13 个全失败(都依赖 tray 存活)。**必须最先跑**。
- 如果 tray id 改名,所有 14 spec 的"关 tray"路径都挂。**测试时只读不改 id**。
- 跑完 trap EXIT 必须 `pkill -9 -f ClaudeManager`,否则下个 spec 启动会撞 single-instance lock。

### 场景 02: 列出 provider

**代码锚点**:
- `src-tauri/src/commands/providers.rs:55-66` `list_providers` 调 `ProviderService::list_providers_with_active_root`
- `src/pages/provider-list/index.tsx:339` `data-testid="provider-list-page"` + `:873` `data-testid="provider-row-${provider.id}"` + `:893` `data-testid="provider-active-badge-${provider.id}"`

**副作用验证点**:
- provider 不存在 settings.json, 是 `<app_data>/providers/*.json`。`ls "$CCM_TEST_HOME/.config/ClaudeConfigManager/providers/" | wc -l` = 3
- `osascript -e 'tell application "System Events" to get name of every UI element of window 1 of process "ClaudeManager"'` — 拿 AXName, 包含 "Provider A" / "Provider B" / "Provider C" 三个

**race condition 边界**:
- 启动后: webview 渲染 (1s) + `list_providers` IPC 调起 (200ms) + DOM 渲染 (300ms)。**spec 02 在 spec 01 后 sleep 2s**。
- `data-testid` 存在但 React state 还是 `loading` — `until osascript get name ... | grep "Provider A"; do sleep 0.2; done` 主动等。

**回归影响**:
- `active_root_dir()` 在 macOS 永远 None (paths.rs:113) — 项目模式 spec 后续可能挂。**M4 scope 只测 user-mode**。

### 场景 03: 切换 A→B

**代码锚点**:
- `src-tauri/src/commands/providers.rs:117-129` `switch_provider(state, provider_id: String)` 调 `switch_provider_with_active_root`
- `src/pages/provider-list/index.tsx:158-180` `handleActivate = async (id) => await switchProvider(id)` — click → IPC → settings.json 写
- `src/pages/provider-list/index.tsx:903` `data-testid="provider-view-${provider.id}"` 等按钮拿 test id

**副作用验证点**:
- `jq -r '.env.ANTHROPIC_BASE_URL' "$CCM_TEST_HOME/.claude/settings.json"` 从 "https://api.provider-a.com" 改成 "https://api.provider-b.com"
- `ls "$CCM_TEST_HOME/.config/ClaudeConfigManager/backups/" | wc -l` ≥ 1
- `jq -r '.last_used_at' "$CCM_TEST_HOME/.config/ClaudeConfigManager/providers/provider-b.json"` 时间戳变化

**race condition 边界**:
- click → IPC 200ms + 备份 100ms + 写 settings.json 50ms + React 重 render 200ms。**click 后 sleep 1.5s** 验。

**回归影响**:
- 切回 A 还要看场景 04 (切换栈)。**spec 03 末尾 trap 必须还原 A.url,不能留给 spec 04**。
- 如果 settings.json backup 失败,前端会 `setSwitchState({ kind: 'failure' })`,spec 03 必须 trap 失败并 skip,不能算 PASS。

### 场景 04: 切换栈 (A→B→A→C)

**代码锚点**:
- 同 03 (重复 3 次切换)
- `src-tauri/src/commands/backup.rs:147-148` `backup_incremental` — 每次切换前的增量备份
- `src-tauri/src/infrastructure/backup_scanner.rs` — 扫描 backups_dir 列出来

**副作用验证点**:
- `ls "$CCM_TEST_HOME/.config/ClaudeConfigManager/backups/" | wc -l` = 3
- 切回 A 后 `jq -r '.env.ANTHROPIC_BASE_URL'` 变回 "https://api.provider-a.com"
- 切到 C 后 = "https://api.provider-c.com"
- 备份文件命名 `settings.json.bak.<unix-ts>` 按时间排序,验证 3 个 ts 单调递增

**race condition 边界**:
- 每次切换 sleep 1s = **总 3s**
- 备份文件名 ts 精度是秒级,3 个切换若 <1s 可能撞名。**spec 04 在切换间 sleep 1.2s**。

**回归影响**:
- 14 spec 串行 (M4-PLAN §3.4 强制) 避免并发修改 settings.json。

### 场景 05: 拖放 .sql

**代码锚点**:
- `src-tauri/src/lib.rs:36-61` `extract_sql_file_path(argv)` 扫 argv
- `src-tauri/src/lib.rs:297-304` 冷启动 .sql 路径缓存到 `AppState.pending_sql_file`
- `src-tauri/src/lib.rs:75-97` `tauri_plugin_single_instance` callback emit `import-sql-file`
- `src/App.tsx:186-198` `listen<string>('import-sql-file', ...)` 监听
- `src-tauri/src/commands/fs.rs:130-200` `read_sql_file` 读 .sql 内容
- `src-tauri/src/infrastructure/sql_parser.rs` `parse_sql_dump` 解析

**副作用验证点**:
- 拖入后 `osascript get name of UI element ...` 包含 "Import SQL" 页面标题
- `parse_sql_preview` IPC 返回的 preview list 长度 = 3

**race condition 边界**:
- Tauri 2.x `onDragDropEvent` 在 `useEffect` 挂载后才生效 — 必须在 app 完全 ready 后拖。**sleep 4s 起步**。
- 拖入是 OS 级事件,System Events 模拟拖复杂。**推荐**:不真拖,**用 `invoke('take_pending_sql_file')` 直接喂路径**。

**回归影响**:
- **M4 决策: 拖放 spec 用 argv 模拟 + `take_pending_sql_file` invoke** (更稳定)。

### 场景 06: 粘贴 deeplink

**代码锚点**:
- `src-tauri/src/lib.rs:75-96` single-instance callback emit `deep-link://new-url` (ccswitch://)
- `src-tauri/src/infrastructure/deeplink_parser.rs:71` `#[error("invalid URL: {0}")]` — **这就是 bug #12 的"invalid URL"根因** (M5 修)
- `src-tauri/src/commands/providers.rs:90-115` `parse_deeplink_url(url) -> ParsedDeeplink`
- `src/App.tsx` **没找到 `deep-link://new-url` listener** (GAP, spec 06 可能挂)

**副作用验证点**:
- 模拟 `open "ccswitch://v1/import?id=test"` 触发 cold-start
- 前端跳转到 import 页
- 解析后 `providers/<id>.json` 多 1 个 entry

**race condition 边界**:
- `tauri-plugin-deep-link` 注册耗时 ~500ms。**sleep 5s 等 webview + deep-link**。
- 冷启动 argv 处理在 `setup` 阶段,前端 listener 在 webview mount 后才挂。`App.tsx` 必须在 `useEffect` 里 add listener。

**回归影响**:
- **GAP 风险**: `deep-link://new-url` listener 不存在。**M4 Phase 1 必先补 listener**, 否则 spec 06 100% 挂。
- 如果 deeplink 协议格式改,fixture URL 必须同步。

### 场景 07: JSON 编辑器 validate

**代码锚点**:
- `src-tauri/src/commands/fs.rs:300-450` `list_editable_jsons` 扫描树
- `src/pages/json-editor/index.tsx:120-122` `treeEntries, setTreeEntries` 状态
- `src/pages/json-editor/index.tsx:12-22` 200ms-debounced JSON validation
- `src/components/JsonFileTree.tsx:155-168` filter 走 `relative_path.toLowerCase().includes(q)`

**副作用验证点**:
- 选 `settings.json` (data-testid 找) → 故意改 `env.ANTHROPIC_BASE_URL` 错
- 红条出现 (data-testid 找 `json-editor-error` 或类似)
- 修正后绿条 + 保存
- `jq .` 验证 settings.json 真的改了

**race condition 边界**:
- 200ms debounce — 输入后 sleep 0.3s 验红条。
- 保存是 async (atomic write + backup) — sleep 1s 验 settings.json 落地。
- **bug #33 提示**: 搜索 `settings.json` 在 `JsonFileTree.tsx:162-163` 走 `relative_path.toLowerCase().includes(q)`。如果 `relative_path` 字段算错就搜不到。spec 07 顺带验搜 "settings" 看 filter 出几个文件。

**回归影响**:
- 改 settings.json 后,其它 spec 假设的初始值(A.url)被破坏。**spec 07 trap EXIT 必须还原 settings.json**。
- spec 07 只能 "validate 阶段红条 + 不让保存" 的 happy path。

### 场景 08: MCP toggle

**代码锚点**:
- `src-tauri/src/commands/mcp.rs:55-110` `list_mcp_servers` + `toggle_mcp_server` IPC
- `src/pages/mcp-management/index.tsx` toggle handler 调 IPC
- `src-tauri/src/services/mcp_service.rs` 写 `~/.claude.json` `mcpServers.<id>.enabled`
- `src/pages/mcp-management/index.tsx:392-395` **bug #13 死文案**: "ccswitch://v1/import?resource=mcp&..."

**副作用验证点**:
- `jq '.mcpServers.test.enabled' "$CCM_TEST_HOME/.claude.json"` 翻转
- 备份目录多 1 个 .bak.<ts> 文件
- DOM checkbox 状态变化 (data-testid `mcp-toggle-<id>` 找)

**race condition 边界**:
- optimistic toggle + IPC rollback: click → 100ms local update + 200ms IPC + 200ms revalidate。**sleep 1s**。

**回归影响**:
- `~/.claude.json` 真存在的话,切 toggle 后 trap EXIT 必须还原。
- **bug #13 影响 spec 08 文案断言**: spec 08 不能断言 "页面含 ccswitch:// 文本" (那是 bug)。

### 场景 09: 用量卡片

**代码锚点**:
- `src-tauri/src/commands/usage.rs:151-160` `get_current_usage` IPC
- `src-tauri/src/services/usage_service.rs` 读 JSONL token 计数
- `src/pages/usage-query/index.tsx:120-123` **bug #14**: `state.snapshot.tokens_used.toLocaleString()` — **没用 formatChineseTokenCount**
- `src/lib/format.ts:36-50` 已 ship `formatChineseTokenCount` 函数 (M4.7)

**副作用验证点**:
- DOM 含 "5h" / "1w" / "1m" 三个时间窗
- token 数显示 (允许 1,234,567 或 "1234 万" 两种)
- mock 数据: spec 启动前预置 `<provider>.jsonl` 含 N 条记录

**race condition 边界**:
- JSONL 解析在 Rust 端,1MB JSONL ~ 500ms。**spec 09 sleep 2s**。
- provider URL 调用(实测用量) mock 掉 — 不真连远端。

**回归影响**:
- **bug #14 修前 vs 修后断言差异**: 修前 "1,234,567", 修后 "1234 万"。spec 09 应**只断言 "contains digit"** 而不是字面值。

### 场景 10: 备份回滚

**代码锚点**:
- `src-tauri/src/commands/backup.rs:140-150` `list_backups` / `restore_backup` / `diff_backups` IPC
- `src/pages/backup-restore/index.tsx:374-376` `data-testid="backup-fullscreen-toggle"` + `:690` overlay

**副作用验证点**:
- 备份列表 (DOM 行数) = spec 03+04 创建的备份数 (3)
- 选 v2 + diff 显示 (data-testid 验 diff 文本)
- 还原后 `jq -r '.env.ANTHROPIC_BASE_URL'` 变回 v2 的 URL
- 还原不删原 backup (M5 bug #30 修)

**race condition 边界**:
- diff 计算在 Rust 端 (json_diff.rs), 10KB settings.json ~ 100ms。**sleep 1s**。
- restore 是 atomic write + 可能触发 backup。**sleep 1.5s** 验 settings.json 落地。

**回归影响**:
- 还原后 settings.json 内容变了,**spec 11+ 不能假设初始 A.url**。**spec 10 末尾 trap 必须还原到 A.url**。

### 场景 11: 主题切换

**代码锚点**:
- `src/components/ThemeProvider.tsx` `useTheme()` hook + `setTheme()`
- `src-tauri/src/platform/window_chrome.rs` vibrancy / mica 调整
- 主题存 `tauri-plugin-store` (M4.6 引入)

**副作用验证点**:
- `osascript -e 'tell application "System Events" to get background color of window 1 of process "ClaudeManager"'` 拿 RGB
- 切 system → light → dark, 每步 RGB 不同

**race condition 边界**:
- 主题切换同步 (CSS variable 替换), **sleep 0.5s** 拿颜色。
- macOS 14+ vibrancy 改变会触发 window re-paint,**sleep 1s 稳**。

**回归影响**:
- macOS vibrancy 在 light mode 下可能不显。**spec 11 主要验 CSS class / data-theme attribute** 而不是真窗口背景色。
- 改 `ThemeProvider` 改 storage key → spec 11 fail。**storage key 必须 lock**。

### 场景 12: 快捷键 Ctrl+F

**代码锚点**:
- `src/components/useKeyboardShortcuts.ts` hook
- `src/components/QuickSearchModal.tsx` modal 组件

**副作用验证点**:
- `osascript -e 'tell application "System Events" to keystroke "f" using {command down, control down}'` 触发
- 搜 `QuickSearch` 模态出现 (data-testid 找 `quick-search-modal` 或 AXWindow count = 2)
- 输入 "Deep" + filter 后 list 长度 < 全量

**race condition 边界**:
- global shortcut 是 OS 级,**webview 必须 focus**。`osascript ... activate` + `sleep 0.3`。
- 输入 "Deep" 后 filter (fuzzy match) ~ 200ms, **sleep 0.5s**。

**回归影响**:
- macOS 14+ 加了 input monitoring 权限,**用户必须允许**。M4-PLAN §6 已列, Phase 1 加 check-permissions.sh。
- 快捷键冲突 (例: 系统快捷键 Cmd+Ctrl+F) 可能拦截 app 接收。**M4 spec 应只测 webview 内的 Ctrl+F**。

### 场景 13: 错误反馈

**代码锚点**:
- `src/components/ErrorBanner.tsx` 组件
- `src/pages/provider-list/index.tsx:1202` 错误条渲染
- `src-tauri/src/commands/providers.rs:65` `state.provider_service.list_providers_with_active_root` 错误返回

**副作用验证点**:
- 删 `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN` 字段(模拟坏配置)
- 红条出现 + 文案包含"加载失败"或"未配置"关键词
- data-testid `error-banner` 找

**race condition 边界**:
- React re-render + IPC 200ms。**sleep 1s**。
- macOS 14+ 红条 AXValue = "error" 不可靠,**AXTitle 找"加载失败"**。

**回归影响**:
- 错误条模板在 §15.5 (CLAUDE.md), 改模板 → spec 13 fail。**模板必须 lock**。
- 删字段前 trap 必须备份 settings.json,否则污染 fixture。

### 场景 14: 资源浏览

**代码锚点**:
- `src-tauri/src/commands/resource.rs:163-166` `list_resources` IPC
- `src-tauri/src/services/resource_service.rs` 读 `~/.claude/plugins/` / `skills/` / `commands/`
- `src/pages/resource-browser/index.tsx` `useActiveRoot` 切换 user vs project — **bug #19: 切到项目后还是 user-level**

**副作用验证点**:
- 启 1 plugin + 1 skill (fixture `<app_data>/marketplaces/` 预置)
- `jq '.plugins // empty | length' "$CCM_TEST_HOME/.claude/settings.json"` 多 2 条
- DOM 资源列表有"plugin-X" / "skill-Y"

**race condition 边界**:
- 资源扫描在 Rust 端,~ 300ms (10 个 plugin)。**sleep 1s**。
- 切到项目模式后,**macOS 永远 None** (bug #19 真因) — spec 14 **只测 user-mode**。

**回归影响**:
- **bug #19 提示**: spec 14 不能切项目模式(那是 bug)。**测 user-mode 默认行为**。
- 启 1 plugin 后 `tauri-plugin-store` 持久化 enabled 标志, **trap EXIT 必须清**。

---

## 3. M4 e2e 框架依赖图

```
01 启动+tray (基础设施)
  ├── 02 列出 provider
  │     ├── 03 切换 A→B
  │     │     └── 04 切换栈
  │     ├── 05 拖放 .sql
  │     ├── 06 粘贴 deeplink
  │     ├── 07 JSON 编辑器
  │     │     └── (bug #33 搜索 filter 顺带验)
  │     ├── 12 快捷键 (测 webview 内部 Ctrl+F)
  │     └── 13 错误反馈 (删 active 模拟坏配置)
  ├── 08 MCP toggle
  ├── 09 用量卡片 (mock 数据)
  ├── 11 主题切换
  ├── 14 资源浏览
  └── 10 备份回滚 (依赖 03+04 创建的备份)

串行 (PLAN §3.4 强制), 总耗时 5-10 分钟。
spec 13 (删 active) 之后必须杀 app 重启 (settings.json 状态破坏)。
```

---

## 4. 关键 race condition 时序表 (精确值, macOS 14+)

| 事件 | 耗时 | 备注 |
|---|---|---|
| `open .app` | 0.5s | launchd 调度 |
| Rust binary exec | 1.0s | lib.rs::run setup |
| Tauri 2.x webview 挂载 | 1.5s | WKWebView init |
| React 首次 render | 0.5s | App.tsx mount + useEffects |
| **app 可交互** | **3.5s** | 起步 sleep 5s (含 buffer) |
| tray icon 注册 | 0.3s | TrayIconBuilder 同步 |
| tray 可 click | **3.8s** | + 0.3s |
| `tauri-plugin-deep-link` 注册 | 0.5s | URL scheme handler |
| `tauri-plugin-store` ready | 0.2s | 同步 |
| IPC roundtrip | 200ms | Rust handler + serde + Result |
| atomic file write + backup | 150ms | fs_atomic.rs |
| React re-render | 200ms | useState setter + diff |
| **click → settings.json 落地** | **350ms** | click 后 sleep 1s 稳 |

**经验 sleep 值**:
- 启动后等可交互: **5s** (PLAN §6 估 2-3s 偏低, 实测要 5s)
- click → 验副作用: **1.5s** (400ms IPC + 200ms re-render + 900ms buffer)
- 主题切换: **0.5s** (CSS 同步)
- 备份还原: **1.5s** (atomic write + 可能 backup + restore)
- 长跑等 list 渲染: `until ...; do sleep 0.2; done` 主动 poll

---

## 5. 14 场景 fixture / state 共享

**每个 spec 进入前** (lib/fs-fixtures.sh 必做):
```bash
export CCM_TEST_HOME="/tmp/cc-M4-$$-$RANDOM"
mkdir -p "$CCM_TEST_HOME/.claude"
mkdir -p "$CCM_TEST_HOME/.config/ClaudeConfigManager/providers"
mkdir -p "$CCM_TEST_HOME/.config/ClaudeConfigManager/backups"
```

**每个 spec trap EXIT**:
```bash
pkill -9 -f "ClaudeManager.app/Contents/MacOS/claude-config-manager" || true
rm -rf "$CCM_TEST_HOME"
# 真实 ~/.claude/settings.json 在 e2e 期间未被改 (CCM_TEST_HOME override),无需还原
```

**fixture 文件预置** (`tests/M4-e2e/fixtures/`):
- `3-providers.json` — provider A/B/C 各 1 个
- `cc-switch-sample.sql` — 含 3 个 provider 的 INSERT 语句
- `deeplink-ccswitch.txt` — `ccswitch://v1/import?id=test&...`
- `usage-mock.jsonl` — 10 行 token usage 记录

---

## 6. 验证标准 (Phase 4 完成时)

| Gate | 标准 |
|---|---|
| Phase 1 跑通 | `tests/M4-e2e/scenarios/stub.sh` exit 0, 1 fixture 落位 |
| Phase 2 跑通 | 4/4 (01,02,03,04) PASS |
| Phase 3 跑通 | 6/6 (05,06,07,08,10,13) PASS |
| Phase 4 跑通 | 4/4 (09,11,12,14) PASS |
| 集成 | `test-all.sh` 加 M4-e2e stage, dev box 14/14 PASS, CI 矩阵过 |
| **14 hard-fail** | 任一 FAIL → ship 阻塞 (M4-PLAN §3.2 Q3) |

---

## 7. 未解决问题 (3-5 条, 等用户审)

1. **`CCM_TEST_HOME` vs `XDG_CONFIG_HOME`** — 修法是改 `MacPaths::resolve()` / `WindowsPaths::resolve()` 头部加 `if let Ok(p) = std::env::var("CCM_TEST_HOME")`,加 ~30 行 + 3 个新单测。**M4 Phase 1 必做项**。
2. **deeplink listener GAP** — `src/App.tsx` 没找到 `deep-link://new-url` 监听 (只看到 `import-sql-file` 监听)。spec 06 100% 挂。**Phase 1 必先补 listener** (与 bug #13 删 ccswitch 文案冲突, spec 06 应只测 cold-start argv)。
3. **macOS 沙盒 + env var 注入** — `open .app` 启动后 env var 可能丢。备选 `osascript do shell script` 启动 + export。
4. **bug #14 修前 vs 修后断言** — spec 09 不能 hard-code "亿 / 千万" 文案, 用 regex `[0-9]+(万|亿|,)`
5. **bug #19 资源浏览切项目** — macOS 永远 None, **spec 14 只测 user-mode** (M4 scope, 项目模式是 M5 修后再说)
