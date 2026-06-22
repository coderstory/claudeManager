# M2.16 三阶段评审 — 第一阶段：自审

## 评审范围
- 29 个 M2.16 原子 commit（4a1fdb5..5de839f），覆盖 9 大新功能 + 8 个 Mac impl + 主题重构 + F15 错误反馈横切 + splash + CI
- 重点审：F3 sql_parser 重构、F10 drag-drop、F14/F14+ export、F17 marketplace clone+install、F20 single-instance、F21 source-repo、F22 manifest、8 个 macos platform impl、ErrorBanner 横切、splash 时序、CI macos gate

## CRITICAL（必须修）

### C1. F20 冷启动 .sql 文件关联事件丢失（race condition）
- 位置：`src-tauri/src/lib.rs:213` `app.emit("import-sql-file", sql_path)` 在 `setup()` 内同步触发
- 影响：双击 .sql 冷启动应用时，`setup` 在 Tauri builder 同步阶段执行，webview 尚未挂载、前端 React 还未调用 `listen('import-sql-file', ...)`。Tauri v2 的 broadcast emit **不会**缓存给晚注册的 listener。冷启动 .sql 文件 → 前端永远收不到事件 → 用户双击 .sql 后看到主窗口但 import-sql 页未自动加载该文件。
- 同类风险：`lib.rs:193, 201` 的冷启动 deeplink emit 也有相同 race（影响小，deeplink 不是主流程）
- 修复建议：把冷启动 sql_path 缓存在 `AppState.pending_sql_file` 里（用 Mutex<String>），新增 `commands::fs::take_pending_sql_file()` 命令；前端在 App.tsx mount 后立即调一次该命令，若有路径则 setPendingSqlFile + setView。或者：用 `on_webview_ready` 钩子延后 emit 到 webview 真正就绪之后。

### C2. F22 manifest 解析对"无 frontmatter"场景的描述提取策略不健壮
- 位置：`src-tauri/src/infrastructure/resource_detail.rs:209-223` `read_markdown_manifest` 无 frontmatter 分支
- 影响：当前实现"取首行非空非 `#` 的行"。但很多 SKILL.md / command .md 的结构是 `# Title\n\nDescription text...`，首行非空但又是 `#` 开头 → 返回 `None` → 详情面板显示"暂无描述"。常见 markdown 文件描述都拿不到。
- 修复建议：取首个非空非 `#` 的行（不限"首行"），或扫描到第一个 markdown 段落（空行分隔）。同时对没有 frontmatter 但有合理内容的 md 文件，至少返回首段 80 字符截断。

### C3. F3 sql_parser `parse_mcp_row` 死代码 + 错误信息误导
- 位置：`src-tauri/src/infrastructure/sql_parser.rs:843-856` `parse_mcp_row` 的 server_config 解析
- 影响：代码注释写"Try string-encoded (cc-switch sometimes does this)"，但第二次 `serde_json::from_str` 跟第一次完全一样（line 851 vs 846），**没有去引号 / 二次解码**。这就是复制粘贴的占位代码，导致实际遇到 double-encoded JSON 时仍报 `server_config invalid JSON`。但因为 cc-switch 实际不是 double-encoded，目前只是死代码 + 错误信息不准。
- 修复建议：要么删除第二次调用 + 注释，要么实现真正的"unquote once"逻辑（`if let Some(s) = serde_json::from_str::<String>(&server_config)` 然后再 `from_str::<ServerConfigJson>(&s)`）。

## HIGH（应该修）

### H1. F20 `read_sql_file` 无大小限制 + 无字节数预检
- 位置：`src-tauri/src/commands/fs.rs:88-120`
- 影响：用户双击 / 拖入一个 5GB 假 .sql（恶意或误操作），`std::fs::read_to_string` 一次性读入内存 → 5GB UTF-8 校验 + 1s+ parse 阻塞 webview。攻击向量小但影响严重。
- 修复建议：先 `std::fs::metadata` 查 size，超过 50MB 直接 Err("文件过大（>50MB），请用 sqlite3 工具预处理")。50MB 已远超真实 cc-switch 14MB dump 的 3.5 倍。

### H2. F10 drag-drop 拖入非 .sql 后遮罩"静默消失"
- 位置：`src/App.tsx:235-244` `drop` 分支
- 影响：用户拖入 `report.pdf` + `data.json`（无 .sql）→ enter 阶段遮罩不显示（OK）→ drop 后 `find()` 返回 undefined → **setDragOverlayVisible(false) 已无意义**（已经是 false），但 setView 不触发。问题是：用户拖入**纯 .sql** 时 enter 显示遮罩，drop 后松手**不松手直接拖走**（drop 在窗口外），tao 发 leave 事件 → 遮罩消失。OK。但如果用户拖入混合（enter 显示遮罩）然后 drop 时**所有文件都被某种 OS 路径截断**（少见）→ setView 不触发但遮罩消失 → 用户困惑"我明明看到遮罩，咋没反应？"
- 修复建议：drop 时若无 .sql 命中但 enter 阶段有 .sql，显示行内红条提示"未检测到 .sql 文件"。当前 0 反馈。

### H3. F17 marketplace `MarketplaceService::install_resource` 无 `--no-overwrite` 二次确认
- 位置：`src-tauri/src/services/marketplace_service.rs:208-273`
- 影响：用户从 marketplace 安装一个**已存在**的 plugin/skill/command/lsp（同名）时，后端返回 `DestExists` 错误（OK）。但前端 `MarketplacePage` 没有"覆盖/跳过"选项，只显示红条。SPEC F17 应允许"替换"。M2.16 范围里不阻塞，但写到 STATE.md 已知限制。
- 修复建议：M3 加"覆盖"按钮 + 二次确认对话框；M2.16 在 STATE.md 写明。

### H4. ErrorBanner autoDismiss 计时器在父组件每次重渲时重置
- 位置：`src/components/ErrorBanner.tsx:111` `useEffect` deps `[hasDismiss, autoDismissMs, onDismiss, message, kind]`
- 影响：如果父组件传 `onDismiss={() => setX(null)}`（内联新引用），每次父组件 render 都生成新 onDismiss → useEffect 依赖变 → clear 旧 timer + 新 timer → autoDismiss 实际倒计时从父组件最后一次 render 算起。极端情况下父组件持续 re-render（unrelated state 变），banner 永远不消失。
- 修复建议：在使用 ErrorBanner 的页面（marketplace / backup-restore / provider-list / optimizer）用 `useCallback` 包裹 onDismiss；或在 ErrorBanner 内部用 `useRef` 存最新 onDismiss + 只 deps 一次。
- 文档一致：错误反馈的 autoDismiss 设计意图（"5s 后自动消失"）依赖调用方传稳定回调，但**没在 ErrorBanner JSDoc 写明**。

### H5. Mac 上 `setup()` 同步调 `apply_vibrancy` 可能过早
- 位置：`src-tauri/src/lib.rs:268-285`
- 影响：Tauri v2 文档建议 backdrop 效果在 `on_webview_ready` 钩子里应用（webview 完全就绪）。当前 setup 内同步调可能因为 native NSWindow/HWND 未完全 realized 而失败。Win11 Mica 真机验证说"成功"（commit fc1fb55），但 macOS 真机未验证（STATE.md 提到"macOS 真机验证留给用户"）。可能存在 macOS 启动时 vibrancy 不显示。
- 修复建议：把 `apply_mica` / `apply_vibrancy` 移到 `on_webview_ready(window)` 钩子里。

### H6. F21 source_repo 命名误导
- 位置：`src-tauri/src/infrastructure/resource_scanner.rs:285-294` `infer_source_repo`
- 影响：`infer_source_repo` 对 Plugin/Skill 返回 `Some(name.to_string())`，其中 name 是资源**自身**名字（如 "code-review"），不是外部仓库 URL。STATE.md 描述"按来源仓库过滤"，前端 UI 标签如果显示"按仓库"会误导用户以为能选 "anthropics/awesome"。
- 修复建议：要么改名为 `infer_resource_group`（资源分组），要么实现真正的 git remote 解析（`git config --get remote.origin.url` for plugins/skills installed via marketplace）。

## MEDIUM（建议修）

### M1. F20 `extract_sql_file_path` 不校验文件存在性
- 位置：`src-tauri/src/lib.rs:34-59`
- 影响：传入不存在的路径也通过校验。后续 `read_sql_file` 报错，但用户已经看到"已跳到 import-sql 页" → 看到"读取失败"红条。体验上可接受。
- 修复建议：可选加 `std::path::Path::try_exists` 预检（best-effort），不通过则不 emit。

### M2. F17 `slug_from_url` 重复去除 .git
- 位置：`src-tauri/src/services/marketplace_service.rs:308`
- 影响：`trim_end_matches(".git")` 用 `.matches` 反复剥离末尾的 `.git` 序列（如 `foo.git.git` → `foo`），可能误伤合法仓库名（少见但可能）。`foo..git` → `foo.`，然后 rsplit → `.` → 被显式拒绝（OK）。
- 修复建议：显式用 `strip_suffix(".git").unwrap_or(trimmed)` 替代。

### M3. 主题切换时 `localStorage` 旧值（`dark` / `auto`）未清理
- 位置：`src/design-system/ThemeProvider.tsx`（未深读，仅在 commit 2deceaa 中看到 3 档 light/glass-clear/glass-tinted）
- 影响：M2 早期版本可能写过 `dark` / `auto` 到 localStorage。M2.16 改成 3 档后，旧 localStorage 值（`dark`）被 fallback 到 `light`，但没显式清除。多次切换后 localStorage 残留旧 key。
- 修复建议：在 ThemeProvider mount 时清掉 `dark` / `auto` 这两个 key（一次性迁移）。

### M4. Splash 2s 时序在弱网/RAM 慢机器上可能不够
- 位置：`src/App.tsx:270-280` + `index.html` 内联 splash
- 影响：splash 至少展示 2.2s（2200ms timer），但 6s failsafe 是 index.html 独立计时器。如果 React 挂载超过 6s（极慢机器 / WebView2 初始化异常），failsafe 触发但 React 还没 ready，splash 隐藏后用户看到白屏。
- 修复建议：增加 8-10s 失败兜底（保留 React 不可用时的 splash 可见性）。

### M5. F10 drag-drop 多次连续 enter 事件不去重
- 位置：`src/App.tsx:221-257`
- 影响：OS 在 enter 后持续发 over 事件（已处理，不变状态）。但 enter 状态本身如果用户拖出再拖入（leave → enter），每次 enter 都重新计算 paths 集合。`payload.paths.some(...)` 是 O(n)，n 通常很小（< 10），性能不是问题。
- 修复建议：无需修，仅记录。

### M6. F17 marketplace 多个 repo 并发 clone 同一 URL 竞争
- 位置：`src-tauri/src/services/marketplace_service.rs:162-172`
- 影响：Tauri 命令默认串行派发（per docs），所以同一 URL 的两次并发 `clone_and_scan` 不会真正并发。但注释里说"无内部 Mutex"，如果未来改成并发派发，两个并发调用都先 `remove_dir_all` 然后 `git.clone()` → 第二个的 `dest.exists()` 检查在 MacGitHost 里失败。Windows 侧 WindowsGitHost 的行为需独立审计（本次未深读）。
- 修复建议：保持当前 Tauri 串行派发即可；如未来需并发，在 service 内加 `Mutex<HashMap<String, JoinHandle>>` 复用 in-flight clone。

### M7. F22 `parse_frontmatter` 描述提取不识别 `#` 之后的内容
- 位置：`src-tauri/src/infrastructure/resource_detail.rs:209-223`
- 影响：见 C2。这里是同一个文件，不重复列。

### M8. F3 sql_parser `now_unix_secs()` 在 Provider 重复解析时漂移
- 位置：`src-tauri/src/infrastructure/sql_parser.rs:807` 每个 Provider 调一次 `now_unix_secs`
- 影响：同一 .sql dump 解析出的 4 个 provider 的 `created_at` 各不相同（间隔 1-100ms）。import_providers_from_sql 时会落盘 4 个不同的 created_at。不可预测但功能上不影响。
- 修复建议：外层循环前算一次 `let now = now_unix_secs();`，传给 parse_provider_row 作为参数。

### M9. F17 marketplace `installStates` 不清空，跨 clone 持久
- 位置：`src/pages/marketplace/index.tsx:82-84` `installStates` state
- 影响：用户成功安装 plugin A → 红/绿条显示。再次 clone 同一 repo → `setScanResult` 新值，但 `installStates` 保留旧状态。表格重新渲染时显示陈旧的"已安装"标记。
- 修复建议：clone 成功（`setScanResult`）时同时 `setInstallStates({})`。

### M10. F15 ErrorBanner 替换后 provider-list/backup-restore 测试覆盖度需重测
- 位置：3 个 commit (ebdf52e, d8e5728, 5de839f)
- 影响：本次未深读 provider-list / backup-restore / optimizer 旧 InfoBar 的所有路径，确保 ErrorBanner 行为完全兼容旧 InfoBar 的 testid（`provider-export-{kind}-bar`, `backup-message` + `data-message-kind`）。reviewer 提请下一阶段（头脑风暴 / 同行评审）专审此处。
- 修复建议：第二阶段重点审 F15 改造的 testid / data-attr 兼容。

## LOW（可选）

### L1. `src-tauri/src/lib.rs:200` deeplink 冷启动 argv 扫描冗余
- 位置：line 199-203 + 195-197 + 189-194 + 180-185
- 影响：4 处不同来源都尝试 emit `deep-link://new-url`（plugin `get_current` + cold argv scan + 兜底 argv scan + single_instance），逻辑重叠。可能造成冷启动收到多次 deeplink 事件。
- 修复建议：合并到一处，前端用 `once()` 或 dedupe。

### L2. MacPaths fallback `/Users/Shared` 可能在 sandboxed Mac 上无写权限
- 位置：`src-tauri/src/platform/macos/paths.rs:34-35`
- 影响：极少见（`dirs::home_dir()` 在 macOS 几乎不会失败），但 sandbox 场景下确实可能失败。
- 修复建议：fallback 用 `dirs::config_dir()`（同样可能失败）或返回 AppError。

### L3. F20 `read_sql_file` 错误信息含绝对路径，可能泄漏给前端
- 位置：`src-tauri/src/commands/fs.rs:119`
- 影响：用户双击 `/home/alice/private/secrets.sql`，前端红条显示完整路径。轻微隐私顾虑（如果屏幕被录屏）。
- 修复建议：错误信息只显示 basename，完整路径写日志。

### L4. ErrorBanner 默认 `data-testid` 命名规则不一致
- 位置：`src/components/ErrorBanner.tsx:115, 141`
- 影响：默认 testid 是 `error-banner-{kind}`，但 marketplace / backup-restore 都用 `ErrorBanner` + 显式 `testId="..."` 覆盖。如果某天调用方忘了传 testId，自动降级到 `error-banner-error` — 跨页面 e2e 容易冲突。
- 修复建议：要求 testId 必填（去掉 `?`），调用方必须传。

### L5. STATE.md "M2.16 候选启动" 章节未清理
- 位置：`.planning/STATE.md:598-606`
- 影响：候选启动标题 + 实际进度补丁并存，老内容未删除，新内容追加。读者需手动跳到 line 608。
- 修复建议：合并 / 删除 "候选启动" 章节（一次性清理）。

### L6. F15 ErrorBanner 4 kind 字体大小未在 tokens.css 集中
- 位置：ErrorBanner.tsx 内联 `fontSize: 13`
- 影响：与项目"设计变量集中"原则（SPEC §5）略有不一致。其它卡片用 `--fs-body` / `--fs-heading`。
- 修复建议：加 `--fs-banner: 13px` 到 tokens.css。

### L7. F22 manifest `MAX_FILES = 200` 截断对用户不透明
- 位置：`src-tauri/src/infrastructure/resource_detail.rs:32`
- 影响：超过 200 项时直接 `break`，前端列表收不到任何"还有 N 项"提示。
- 修复建议：返回 `ResourceDetail.files_truncated: u32` 字段，前端展示。

## 已确认 OK
- **F3 sql_parser 主路径**（含显式列名 / 无列名 / app_type 分派）单测覆盖完整（22+ cases），性能在 14MB dump 上 1.1s 可接受
- **F20 single_instance callback emit**（line 86, 93，2nd instance 触发）：主进程已在跑，前端 listener 已注册，**不**有 race condition
- **F14 export_provider 走 `blocking_save_file`**：在 `#[tauri::command] async fn` 里调用，async command 跑在 tokio runtime，文档允许
- **MacPaths / MacReveal / MacGitHost / MacNotifier / MacAppMenu**：5 个真实实现 + 2 个 no-op 守卫（single_instance / window_chrome），全部有单测或真机验证（M2.16 ship exe 记录显示）
- **ErrorBanner API 设计**：4 kind + role aria + autoDismiss cleanup，组件本身没有 bug
- **F22 file listing** 深度上限 2 + 数量上限 200 + 跳 noise dirs，**安全**（不读 git 历史 / node_modules 等）
- **F17 clone path safety**：`slug_from_url` + `repo_dest` 双重校验 `..` / 路径分隔符
- **F20 `extract_sql_file_path` 单测**（lib.rs:317+）覆盖 7 个 case（绝对 / 相对 / `..` / 大小写 / 混合 argv）
- **M2.16 ci macos gate**（c18d267）：双平台 cargo check + vitest
- **App.tsx F10 拖放遮罩**：enter 阶段正确显示，drop / leave 正确隐藏（tested by f10-drag-drop.test.tsx 8 cases）
- **App.tsx splash 时序**：2200ms + 300ms fade + 6s failsafe（index.html 独立计时器），正常路径合理
- **M2.16 真机验证脚本**（cdp-f3-import-verify.cjs / cdp-backup-verify.cjs）：WebView2 remote-debugging 端到端，可信度高

---

**评审时间**：M2.16 末（commit 5de839f）
**下一阶段**：头脑风暴（反向挑战 C1/C2/C3 设计决策）+ 同行评审（调外部 AI 独立审 H1-H6）
**建议立即修**：C1（C1 阻塞 F20 主流程）、C3（数据正确性）、H1（安全/资源耗尽）
