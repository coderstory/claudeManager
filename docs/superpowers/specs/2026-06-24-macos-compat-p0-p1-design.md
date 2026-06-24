# macOS 兼容性修复 (P0 + P1) — Design

> **⚠️ 已过期 (2026-06-24)**：本 spec 文档化时基于 `tmp/macos-compat-audit.md` (2026-06-21)，但实际 5 项修复在 git history 已完成（commits `0d3de69` / `645e96c` / `98bf855` / `449d659` / `c074187` 等）。**本 spec 仅作 brainstorming 过程记录归档**，下次 macOS 兼容性工作请以 git log + 当前代码为准，不要按本 spec 实施。
>
> **配套文件仍然有效**：
> - `tmp/macos-p2-backlog.md` — 17 项延后项清单，下次开发参考
> - `tmp/macos-compat-audit.md` — 历史审计依据
>
> **当前真实 P0 阻塞**（spec 没列）：`src-tauri/src/platform/macos/app_menu.rs` 的 `.about()` 调用 Tauri API 签名不对（缺 `Option<AboutMetadata>` 参数），`cargo check --target aarch64-apple-darwin` 编译失败。需要重新走 brainstorming 诊断。

> **日期**：2026-06-24
> **范围**：5 项 macOS 兼容性修复 (P0 1 项 + P1 4 项)
> **不做**：P2 5 项 + Spec B (安装/调试) + v3.0 merge conflict 业务逻辑（仅最小动作解阻塞）
> **背景**：`tmp/macos-compat-audit.md` (2026-06-21) 完整 P0-P2 清单；本 spec 只取 P0+P1
> **延后清单**：`tmp/macos-p2-backlog.md`（17 项，按 P2 / CI / Spec B / Spec C 分类）

---

## 1. 目标 (Why)

当前 **应用在 macOS 上无法启动**。`AppState::build()` 在启动时调 `MacPaths::resolve()`，方法体是 `unimplemented!()`，**启动即 panic**，窗口永不出现。release.yml 的 macos matrix 会编译通过并产出 .dmg，但产出的应用一启动就崩。

本 spec 修 P0 1 项 + P1 4 项，让 macOS 26 / Apple Silicon 上：
- ✅ 应用能启动
- ✅ 核心功能（provider 切换 / MCP / 备份 / reveal / 用量 / 优化）可用
- ✅ CI 有 mac 编译/测试门禁（防回归）
- ❌ 不修 F17 落地的 git host（`MacGitHost` 改 type alias 即可，F17 未落地不崩）

## 2. 范围 (What)

### 2.1 修复清单 (5 项)

| ID | 项 | 严重度 | 行为 | 估时 | 改法 |
|---|---|---|---|---|---|
| P0-1 | `MacPaths::resolve/ensure_dirs` | P0 启动崩溃 | 启动即 panic | 30 min | 照 `WindowsPaths` 改路径基 |
| P1-3 | `MacReveal::reveal` | P1 命令崩溃 | reveal 即 panic | 15 min | `open -R` 替换 `explorer /select,` |
| P1-4 | backup-restore `process.platform` | P1 双平台崩 | 手动备份抛 ReferenceError | 5 min | 删前端 OS 判断 + 新增 `backup_default_path` IPC |
| P1-5 | `MacGitHost` 3 方法 | P1 F17 雷 | F17 落地即崩 | 10 min | type alias `MacGitHost = GitHostCli` |
| P1-6 | ci.yml 无 mac 门禁 | P1 无 CI 拦截 | 回归无拦截 | 30 min | 加 `test-rust-mac` job |

合计 ~1.5h subagent 工作量 + 你真机验证时间。

### 2.2 不在范围 (17 项)

详见 `tmp/macos-p2-backlog.md`。摘要：
- **P2 6 项**：MacAppMenu / MacNotifier / lib.rs cfg 归位 / decorations UX 决策 / applyEffects 去重 / 死代码清理
- **CI 3 项**：release.yml mac matrix / macOS smoke test 改造 / ci.yml mac e2e
- **Spec B 4 项**：签名公证 / 调试组件 / 桌面交付 / entitlements
- **Spec C 2 项**：v3.0 merge conflict 业务收尾 / target/ 治理验证

## 3. 架构 (How)

### 3.1 核心原则

CLAUDE.md §3.2 "业务代码不散落 OS 判断" — 所有 OS 差异走 `platform/{windows,macos}` + `IPlatform*` trait。

### 3.2 改动文件总览

```
src-tauri/src/platform/macos/
├── paths.rs           P0  改 stub → 照 WindowsPaths 实现
├── reveal.rs          P1  改 stub → `open -R`
└── git.rs             P1  改 stub → type alias GitHostCli

src-tauri/src/commands/
└── backup.rs (新建)   P1  backup_default_path command

src-tauri/src/lib.rs   P1  invoke_handler 注册 backup_default_path

src/pages/backup-restore/
└── index.tsx          P1  删 process.platform 判断，调新 IPC

src/__tests__/pages/backup-restore.test.tsx
                       P1  加 mock backup_default_path 的 case

src-tauri/tests/backup.rs (新建)
                       P1  后端 backup_default_path 单测

.github/workflows/ci.yml
                       P1  新增 test-rust-mac job
```

### 3.3 接口契约（4 个 trait / 1 个 IPC）

| 接口 | 定义 | Mac 实现 | 备注 |
|---|---|---|---|
| `IPlatformPaths` | `traits.rs` | `platform/macos/paths.rs` 改 body | 签名不变 |
| `IPlatformReveal` | `traits.rs` | `platform/macos/reveal.rs` 改 body | 签名不变 |
| `IGitHost` | `traits.rs` | `platform/macos/git.rs` type alias | 零运行时 |
| `backup_default_path` | `commands/backup.rs` (新) | 跨平台通用 | 返回 `~/.claude/backups` (mac) / `%USERPROFILE%\.claude\backups` (win) |
| `ci.yml test-rust-mac` | (新 job) | macos-latest | 编译 + platform::macos 单测 |

## 4. 5 个改动详设

### 4.1 P0-1 MacPaths — 启动硬阻塞

**接口**（`IPlatformPaths` trait）：
```rust
pub trait IPlatformPaths: Send + Sync {
    fn resolve(&self) -> Result<AppPaths, PlatformError>;
    fn ensure_dirs(&self, paths: &AppPaths) -> Result<(), PlatformError>;
}
```

**路径映射**（`AppPaths` 字段）：

| 字段 | Windows | Mac（新增）|
|---|---|---|
| `home` | `dirs::home_dir()` | 同（`dirs` 跨平台，mac 返回 `~/`）|
| `app_data` | `%APPDATA%\ClaudeConfigManager` | `~/Library/Application Support/ClaudeConfigManager` |
| `settings_json` | `%USERPROFILE%\.claude\settings.json` | `~/.claude/settings.json` |
| `claude_json` | `%USERPROFILE%\.claude.json` | `~/.claude.json` |

`ensure_dirs` 用 `std::fs::create_dir_all`（跨平台），幂等。

**测试**（`platform/macos/paths.rs` `#[cfg(test)] mod tests`）：
- `test_resolve_returns_library_application_support` — 验证 `app_data` 以 `~/Library/Application Support/ClaudeConfigManager` 结尾（用 `dirs::home_dir()` 拼，**不**硬编码 `/Users/...`）
- `test_resolve_uses_dot_claude_for_settings` — 验证 `settings_json` 以 `.claude/settings.json` 结尾
- `test_ensure_dirs_creates_all_four` — 用 tempdir 跑 ensure_dirs，验证 4 个目录被创建
- `test_ensure_dirs_idempotent` — 跑两次 ensure_dirs 不报错

**风险**：`dirs::config_dir()` 在 macOS 26 / Apple Silicon / sandbox 下行为若变，单元测试抓不到。**真机验证必跑**（§6 验收）。

### 4.2 P1-3 MacReveal — reveal 命令硬阻塞

**目标**：
```rust
fn reveal(&self, path: &Path) -> Result<(), PlatformError> {
    if !path.exists() {
        return Err(PlatformError::NotFound(path.display().to_string()));
    }
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| PlatformError::Io(e))?;
    if !status.success() {
        return Err(PlatformError::CommandFailed("open -R".to_string()));
    }
    Ok(())
}
```

存在性检查、错误映射逻辑完全复用 `WindowsReveal`。

**测试**：
- `test_reveal_nonexistent_returns_not_found` — 测 NotFound 分支
- `test_reveal_calls_open_with_R_flag` — **决策点**：是否纳入（mac 上无 Windows 那种 `MockCommand` 生态）。**决策：只测 NotFound + §6 真机验 `open -R`**。

### 4.3 P1-4 backup-restore `process.platform` — 双平台 ReferenceError

**当前**（`src/pages/backup-restore/index.tsx:221-223`）：
```tsx
const defaultPath = process.platform === 'win32'
  ? `${process.env.USERPROFILE}\\.claude\\backups`
  : `${process.env.HOME}/.claude/backups`
```

**问题**：
1. `process` 在 Tauri webview 未定义（Vite 不 polyfill `process.platform`）
2. 抛 `ReferenceError`，被 try/catch 吞成"备份失败: process is not defined"
3. **业务代码做 OS 判断**（违反 §3.2）

**目标改动**（2 文件）：

**后端**（新文件 `src-tauri/src/commands/backup.rs`）：
```rust
#[tauri::command]
pub async fn backup_default_path(state: State<'_, AppState>) -> Result<String, String> {
    let paths = state.runtime.paths();
    Ok(paths.settings_json.parent()
        .map(|p| p.join("backups").display().to_string())
        .unwrap_or_default())
}
```

注册到 `lib.rs::invoke_handler`（与 `backup_now` / `backup_restore` 同区）。

**前端**（`src/pages/backup-restore/index.tsx`）：
- `handleBackupNow` 开头：`const defaultPath = await invoke<string>('backup_default_path')`
- 删 `process.platform` 三元判断
- 删 `process.env.USERPROFILE` / `HOME` 引用

**测试**：
- 前端 `__tests__/pages/backup-restore.test.tsx`：mock `invoke('backup_default_path')` 返回 mac 路径，断言 UI 用该值而非 `process.platform` 分支
- 后端 `tests/backup.rs`（新文件）：用 tempdir 模拟 `AppState`，验证返回路径以 `.claude/backups` 结尾

### 4.4 P1-5 MacGitHost — F17 落地即崩（防雷）

**当前**（`platform/macos/git.rs:13-24`）：`clone` / `ls_remote` / `current_head` 三方法全 `unimplemented!()`

**目标**：`MacGitHost` = `GitHostCli` 类型别名。`git` CLI 在 mac/win 一致，**无需 mac 专属实现**。

```rust
// platform/macos/git.rs
pub type MacGitHost = GitHostCli;
```

**验证**：
- 编译期断言：`static _: fn() = || { fn assert<T: IGitHost>() {} assert::<MacGitHost>(); };`
- 运行时零开销（type alias 编译期展开）
- `WindowsGitHost` 已是 `pub struct GitHostCli`（`platform/windows/git.rs:1` 自称 cross-platform），签名跨平台

**测试**：不需（type alias 是零运行时行为）。`cargo build` 编译通过即证明签名兼容。

### 4.5 P1-6 ci.yml mac test job — 拦截编译/测试回归

**当前**（`ci.yml`）：3 job 全 `runs-on: windows-latest`。

**目标**：新增第 4 个 job（不改现有 3 个）：

```yaml
test-rust-mac:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - uses: Swatinem/rust-cache@v2
    - name: Install Node
      uses: actions/setup-node@v4
      with:
        node-version: lts/*
        cache: 'npm'
    - name: Install npm deps
      run: npm ci
    - name: Cargo check (mac)
      run: cargo check --workspace --target aarch64-apple-darwin
    - name: Cargo test (platform::macos unit tests)
      run: cargo test -p claude_config_manager_lib --lib platform::macos
    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: test-rust-mac-results
        path: target/test-results/
```

**约束**：
- macos-latest runner 自带 Apple Silicon；用 `--target aarch64-apple-darwin` 避免交叉编译
- `cargo test` 限定到 `platform::macos` 模块，**不**跑 e2e（e2e 需 tauri-driver + GUI，超出本 spec 范围）
- 复用 `Swatinem/rust-cache@v2` 加速 CI（v2 已验证；CLAUDE.md §2.3 版本锁精神，subagent 不擅自换版本）
- Action pin 用 `@v4` / `@v2` 跟随主版本（项目现有 ci.yml 风格）；不 pin `@<sha>`

**风险**：
- macos-latest runner 首次 `cargo check` 需 5-8 min 编译 wry/tao 链
- cache 命中率预计 30-50%（与 Windows job 不可共享 cache）

## 5. 数据流 + 错误处理

### 5.1 数据流 ①：App 启动 → MacPaths.resolve → AppState 注入

```
[Tauri builder.setup()] (lib.rs:108)
  → AppState::build()
  → runtime::paths()              # 返回 Arc<dyn IPlatformPaths>
  → paths_impl.resolve()          # P0-1 修后不再 panic
  → Arc<AppPaths> 注入 AppState   # 整个进程共享

  紧接着:
  → paths_impl.ensure_dirs(...)   # P0-1 修后不再 panic
  → 创建 4 个目录（app_data / claude_home / .claude/...）
```

**错误处理契约**：
- `resolve()` 失败（极罕见，`dirs::home_dir()` 不会失败）→ `AppState::build()` 返回 `Err` → **Tauri 启动失败**，用户看到错误对话框
- `ensure_dirs()` 失败（权限/sandbox）→ 同上，**启动失败不静默**
- **理由**：路径解析失败 = 整个 app 没意义，快速失败比"启动后某功能崩"好

### 5.2 数据流 ②：用户点 reveal → MacReveal.reveal

```
[前端: 资源列表页点 "在文件管理器中显示"]
  → invoke('reveal_in_file_manager', { path: '...' })    (commands/resource.rs:62-65)
  → resource_service.reveal(path)
  → runtime::reveal()                                    # Arc<dyn IPlatformReveal>
  → MacReveal::reveal(path)                              # P1-3 修后不再 panic
  → std::process::Command::new("open").arg("-R").arg(path).status()
  → 返回 Ok(()) 或 Err(PlatformError::NotFound / Io / CommandFailed)
  → 序列化为 IPC error string 返回前端
  → UI: toast.error("reveal 失败: <错误>")
```

**错误处理契约**：
- **不吞错**：所有 Err 都序列化到前端，UI 必须显示
- **不重试**：reveal 是用户主动行为，失败让用户重试或换路径
- 错误信息**用户能看懂**（CLAUDE.md §7）—— `PlatformError` 实现 `Display` 给出可读信息

### 5.3 数据流 ③：用户点 "立即备份" → backup_default_path → backup_now

```
[前端: backup-restore 页 handleBackupNow]
  → const defaultPath = await invoke<string>('backup_default_path')    # 新增
  → invoke('backup_now', { destDir: defaultPath })
  → backup_command::backup_now(state, destDir)
  → state.runtime.paths().settings_json 读源
  → atomic copy + history db 记录
  → 返回 Ok(BackupResult { path, bytes, ts })
  → UI: toast.success(`备份到 ${path}, ${bytes} bytes`)
```

**P1-4 修后**：
- 前端**不再**做 OS 判断，统一调 `backup_default_path` 拿后端算好的路径
- 路径由后端基于 `IPlatformPaths` 解析（mac = `~/.claude/backups`，win = `%USERPROFILE%\.claude\backups`）
- `process.platform` 引用彻底删除，双平台 ReferenceError 不再发生

**理由**：让 `IPlatformPaths` 成为**唯一**路径源，业务代码不重新解析 —— CLAUDE.md §3.2 具体落地。

### 5.4 统一错误处理

| 错误类型 | 来源 | 处理 |
|---|---|---|
| `PlatformError::NotFound` | reveal | UI 提示"路径不存在" |
| `PlatformError::Io(io::Error)` | paths/reveal/backup | UI 提示底层错误信息 |
| `PlatformError::CommandFailed(cmd)` | reveal (`open -R` 失败) | UI 提示命令名 + exit code |
| `PlatformError::Unimplemented` | 不应再出现 | panic 立即（编译期 fail-fast）|
| Tauri IPC error string | `backup_default_path` 等 | UI toast.error 显示原始信息 |

**新增约束**（写入 CLAUDE.md §3.2 注释）：
> macOS trait stub 一律改为真实实现或 type alias，禁止保留 `unimplemented!()` 在 hot path（启动期 / 用户主动命令路径）。
> 死代码 trait（`single_instance` / `notifier` / `app_menu` / `window_chrome` 仍为 stub 的）需标注 `#[allow(dead_code)]` + 文档说明延后到 v1.1。

## 6. 实施 + TDD 节奏

5 wave 串行（wave 间有依赖），每 wave 一个 atomic commit。Subagent 跑完一波回主 session 决定是否进下一波。

### Wave 1：P0-1 MacPaths

**前置**：subagent 最小动作解 4 个 v3.0 merge conflict 文件（**仅当** cargo check 报这 4 个文件时；不动业务逻辑）

**TDD**：
1. **Red**：写 4 个 `#[test]`，跑 `cargo test -p claude_config_manager_lib --lib platform::macos` —— 预期 fail (panic)
2. **Green**：把 `MacPaths::resolve/ensure_dirs` 改完
3. **Refactor**：与 `WindowsPaths` 抽公共代码到 `paths_common.rs`（如开始 drift）
4. **验证**：`cargo test -p claude_config_manager_lib --lib platform::macos` 全 pass

**验收**：
- 4 测试 pass
- `cargo check --workspace` 通过
- **真机验证**（subagent 跑）：
  - `./scripts/build-mac.sh --debug` 产 `.app`
  - 启动 `.app`（`open src-tauri/target/debug/bundle/macos/ClaudeConfigManager.app`）
  - `pgrep -f ClaudeConfigManager` 启动后 5 秒内命中（进程在）
  - 启动日志（`~/Library/Logs/ClaudeConfigManager/*.log` 由 `tauri-plugin-log` 写）**无 `panicked at` / `thread 'main' panicked` 关键字**（grep 验证）
  - `pgrep -f ClaudeConfigManager` 二次命中（确认 5 秒后进程仍在，未立刻 panic 退出）

**commit**：`fix(macos): implement MacPaths (P0 launch panic)`

### Wave 2：P1-3 MacReveal

**前置**：Wave 1 完成

**TDD**：
1. **Red**：`test_reveal_nonexistent_returns_not_found`，跑 —— 预期 panic
2. **Green**：实现目标代码
3. **Refactor**：与 `WindowsReveal` 抽 `validate_path_exists` helper
4. **验证**：
   - 单元测试 pass
   - `cargo test -p claude_config_manager_lib --lib platform::macos` 全 pass

**真机验收**（subagent 跑）：
- `scripts/build-mac.sh --debug` 后启动 .app
- 调 IPC（subagent 写临时 Rust 测试）：
  - 若 `~/.claude/settings.json` 存在 → 调用 `reveal_in_file_manager` command 指向它
  - 若不存在 → 先 `touch ~/.claude/settings.json` 创建空文件（dev 环境合法），再 reveal
- 验证 Finder 弹出并选中该文件（subagent 用 `osascript -e 'tell application "Finder" to get name of front window'` 读 front window 标题）

**commit**：`fix(macos): implement MacReveal (P1 command panic)`

### Wave 3：P1-4 backup-restore

**前置**：Wave 1 完成（`backup_default_path` 依赖 MacPaths 修好）

**TDD**（后端先行）：
1. **Red 后端**：在 `src-tauri/src/commands/backup.rs` 写 `backup_default_path` + 单测，验证返回路径以 `.claude/backups` 结尾
2. **Green 后端**：注册 command 到 `lib.rs::invoke_handler`
3. **Red 前端**：在 `src/__tests__/pages/backup-restore.test.tsx` 加 case，mock `invoke('backup_default_path')` 返回 mac 路径
4. **Green 前端**：改 `src/pages/backup-restore/index.tsx`，删 `process.platform` 三元
5. **验证**：
   - `cargo test -p claude_config_manager_lib --lib` 全 pass
   - `npm run test -- backup-restore` 全 pass
   - `tsc --noEmit` 通过

**真机验收**（subagent 跑）：
- 启动 .app → 进 backup-restore 页 → 点"立即备份"（不指定路径）→ 验证文件出现在 `~/Library/Application Support/ClaudeConfigManager/.claude/backups/`

**commit**：`fix(backup): move default path resolution to backend (P1 dual-platform ReferenceError)`

### Wave 4：P1-5 MacGitHost

**前置**：无（独立 trait）

**TDD**：N/A（type alias 是零运行时）
1. **Refactor**：
   - 删 `platform/macos/git.rs` 中三个 `unimplemented!()` 方法体
   - 改为 `pub type MacGitHost = GitHostCli;`
   - 加编译期断言
2. **验证**：
   - `cargo check --workspace` 通过
   - `cargo build --workspace` 通过

**验收**：
- 编译期断言存在且通过
- `MacGitHost` 与 `WindowsGitHost` 在 `IGitHost` trait object 上下文**完全可互换**（写一行 `let _: Box<dyn IGitHost> = Box::new(MacGitHost::default());` 在 `#[cfg(test)]` 里验证）

**commit**：`refactor(macos): type alias MacGitHost → GitHostCli (P1 F17 readiness)`

### Wave 5：P1-6 ci.yml mac test job

**前置**：Wave 1-4 全部完成（mac 编译/测试先在本地通过，CI 才不会反复红）

**TDD**：N/A（CI 配置无单元测试）

**实施**：
1. 读 `.github/workflows/ci.yml` 现有结构，找合适插入点
2. 加 `test-rust-mac` job（§4.5 目标 yaml）
3. **不**改现有 3 个 Windows job
4. **不**触发（push 才触发）—— 推 feature branch 验证

**验收**：
- yaml syntax check（`actionlint` 或 `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`）
- **不**触发 push（CLAUDE.md §14.1 subagent 不擅自 push）。subagent 报告 yaml diff + 本地 `act` 或 dry-run 验证（如本地有 `act` CLI 可跑 `act -j test-rust-mac --dryrun`），由主 session 决定何时推 branch 触发 CI

**commit**：`ci: add test-rust-mac job (P1 mac compile/test gate)`

### 跨 Wave 约束

| 约束 | 来源 |
|---|---|
| 每 wave 一个 atomic commit | CLAUDE.md §2.3 / §9 |
| Subagent 不 commit / push / 改全局配置 | CLAUDE.md §14.1 |
| Subagent 完成 → 报告主 session → 主 session 列白名单 → 用户确认 | CLAUDE.md §11.5 |
| 同一问题 3 次失败暂停复盘 | CLAUDE.md §11.7 |
| 真机验证由 subagent 跑（你本次决策） | brainstorming Q1 |

## 7. 验收

### 7.1 每 wave 最小可验收

| Wave | subagent 必须产出 | 主 session 验收 |
|---|---|---|
| 1 | `cargo test platform::macos` 全 pass 截图 + 4 新 test 名 | 看截图 + diff 仅改 `platform/macos/paths.rs` |
| 2 | NotFound 单测 pass + 真机 `open -R` Finder 弹日志 | 看 .app 启动日志 + Finder 截图 |
| 3 | `npm test -- backup-restore` pass + `tsc --noEmit` 通过 + 后端单测 pass | grep 确认 `process.platform` 在 `backup-restore/index.tsx` 已无引用 |
| 4 | `cargo check --workspace` 通过 + 编译期断言存在 | `git diff platform/macos/git.rs` 是 type alias 而非复制 body |
| 5 | yaml syntax valid + push 触发 mac job green | GitHub Actions 截图（如 subagent 推了）|

### 7.2 全 spec 用户核定

- 5 wave 全部 ✅
- 你本机手动跑 `./scripts/build-mac.sh --debug` 启动 .app，5 秒内窗口出现
- 进 provider 列表 → 切换 provider → 切回 → 无 panic
- 进 backup-restore → 点"立即备份"不传路径 → 文件出现在 `~/Library/Application Support/ClaudeConfigManager/.claude/backups/`
- 资源浏览 → 点"在文件管理器中显示" → Finder 弹出选中文件

## 8. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `dirs::config_dir()` macOS 26 sandbox 行为异常 | 低 | P0-1 跑通但 app_data 错 | Wave 1 真机验证必看路径 |
| `open -R` macOS 26 行为变化 | 极低 | reveal 静默失败 | 真机验证必跑；失败回退 `open <dir>` |
| mac runner 首次 5-8 min 编译 | 高 | CI 慢 | `Swatinem/rust-cache` |
| Wave 1 解 v3.0 merge conflict 时误改业务 | 中 | 引入 v3.0 回归 | subagent 范围"仅解 cargo check 报错文件，零业务改动"；diff >10 行主 session 二次审 |
| 4 个 conflict 文件某个 cargo check 不依赖但 vitest 依赖 | 中 | vitest 还跑不通 | Wave 1 subagent 同时跑 `npm run test` 验证；fail 列在报告里，由你决定 |
| subagent 真机验 Finder 卡死 | 低 | Wave 2 验收卡住 | subagent 报告卡死后主 session 调度你手动跑 |
| P0-1 修完但 release.yml mac matrix 仍产 .dmg | 中 | 你打 tag 后 .dmg 仍能下载（但能启动）| release.yml 加注释「mac matrix 验证待 P0-1 修后跑一次」；是否 disable 由你决定（不在本 spec）|
| P1-4 后端 `backup_default_path` 路径与 Windows 现有行为不一致 | 低 | 备份位置变了 | 测试断言两平台路径；现有 `backup_now` 接受任意 destDir，不破坏 |

## 9. 回滚

每 wave 一个 atomic commit，**回滚 1 个 wave 不影响其他**：

- Wave 1 失败 → `git revert <wave1 commit>` → MacPaths 恢复 unimplemented → mac 启动崩（与现状一致）
- Wave 3 失败 → `git revert <wave3 commit>` → 前端 process.platform 恢复 → 双平台 ReferenceError（与现状一致）
- Wave 4 失败 → `git revert <wave4 commit>` → MacGitHost 恢复 stub → F17 仍崩（与现状一致，F17 未落地不触发）

**最坏情况**：5 wave 全部 revert → 回到 spec 起点，0 进展。**预期**：Wave 1-4 是"照抄 Windows 实现"，回滚概率 <5%。

## 10. 不做清单

详见 `tmp/macos-p2-backlog.md`（17 项）。摘要：

**P2 5 项**：MacAppMenu / MacNotifier / lib.rs cfg 归位 / decorations UX 决策 / applyEffects 去重

**CI 3 项**：release.yml mac matrix / macOS smoke test 改造 / ci.yml mac e2e

**Spec B 4 项**：签名公证 / 调试组件 / 桌面交付 / entitlements

**Spec C 2 项**：v3.0 merge conflict 业务收尾 / target/ 治理验证

**判定标准**：spec 完成 = P0+P1 5 项全过 + 真机验证通过。P2 任何一项**不**作为"spec 还差一项"的依据。

## 11. 跨文档引用

- 详细 mac 风险分析：`tmp/macos-compat-audit.md`（2026-06-21，只读审计）
- 不做清单（17 项详设）：`tmp/macos-p2-backlog.md`（2026-06-24）
- macOS dev 约束：CLAUDE.md §15
- 编译性能基线：CLAUDE.md §12（sccache 50x 加速，macOS 调研已做）
- 脚本能力矩阵：CLAUDE.md §15.3（mac subagent 当前限制）
- 工程纪律：CLAUDE.md §2（架构先行 + TDD + 版本锁 + 谨慎改文件 + UI/UX 头等大事）
- 评审纪律：CLAUDE.md §6（自审 + 头脑风暴 + 同行评审 + 业务流程分析）
- Subagent 派遣纪律：CLAUDE.md §8 / §11（主 session 只决策 + 接收成果）
- Subagent 行为禁区：CLAUDE.md §14（不擅自 commit / push / 改全局配置）
- 三次失败必须暂停复盘：CLAUDE.md §11.7

---

*本 spec 由 brainstorming skill 生成（2026-06-24）。设计依据来自 tmp/macos-compat-audit.md 完整 P0-P2 审计 + 用户对 5 个决策的回复。实施前需主 session 调用 writing-plans skill 生成 PLAN.md。*
