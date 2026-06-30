# FEATURE-DEV-SPEC.md — 功能开发规范 (2026-06-30 重构写入)

> **本文件是项目根 `/FEATURE-DEV-SPEC.md` 的唯一权威 spec**,吸收原 `CLAUDE.md §3/§4/§5/§6/§7/§8/§12/§13` + `CLAUDE-WORKFLOW.md §9/§11/§14` + `CLAUDE-MACOS.md §15.1-§15.9` 的全部内容。
>
> 任何 feature dev 任务(subagent 派单 / 主 session 实施),**必含** "必读 `docs/FEATURE-DEV-SPEC.md` 全部章节"。
>
> 关联:`docs/BUG-FIX-SPEC.md`(问题修复规范,本 spec 的姊妹篇)。

---

## §0. 文档结构

| 章节 | 内容 | 行数 |
|---|---|---|
| §1 | 架构与分层(后端 Rust / 前端 React / Plugin 系统) | ~80 |
| §2 | 设计系统基线(主题 / 配色 / 字体 / 间距 / 状态色) | ~55 |
| §3 | 三层测试 + TDD 流程 + Build Pipeline Regression | ~50 |
| §4 | 评审纪律 + UI 文案同步 + 显示名 vs 系统标识 | ~30 |
| §5 | 内存/状态纪律 + Subagent 派遣纪律 | ~30 |
| §6 | 迭代交付纪律(交付物 / 命名 / Build / Smoke / 用户核定) | ~75 |
| §7 | 主 session 工作流约束(角色 / 并发 / 派单 / 决策门槛) | ~70 |
| §8 | Subagent 行为禁区(禁止擅自 commit / push / tag) | ~15 |
| §9 | macOS 开发约束(编译 / 产物 / 权限 / 不做发布 / sccache) | ~70 |
| §10 | FEATURE DEV WORKFLOW(4 步闭环,新增) | ~75 |

**总计 ~550 行**。

---

## §1. 架构与分层

### §1.1 分层架构

```
src-tauri/src/
├── main.rs               # 入口
├── lib.rs                # Tauri builder + plugin registration
├── domain/               # 业务模型（Provider / McpServer / UsageSnapshot 等）
├── services/             # 业务逻辑（ProviderService / McpService / UsageService）
├── infrastructure/       # 基础设施（文件读写 / HTTP 客户端 / git 客户端）
├── platform/             # OS 抽象层（所有 OS 差异都进这里）
│   ├── windows/          # Windows 实现
│   ├── macos/            # macOS 实现
│   └── traits.rs         # 接口定义
└── plugins/              # 插件系统
    ├── host.rs           # PluginHost（注册 / 加载 / 生命周期）
    ├── traits.rs         # IPlugin trait
    └── stubs/            # 12 个功能模块的 stub

src/
├── main.tsx              # React 入口
├── App.tsx               # 根组件 + Router
├── design-system/        # 设计系统基线（颜色 / 字体 / 间距 / 主题）
├── components/           # 通用组件
├── pages/                # 页面（每个 L1 一个）
├── plugins/              # 前端 plugin（对应后端 plugin stub）
├── hooks/                # 自定义 hooks
├── stores/               # Zustand 状态管理
└── lib/                  # 工具函数
```

### §1.2 OS 抽象接口

所有 OS 差异必须抽象成 trait,Windows/macOS 各实现一份。业务代码永远只调接口,永远不直接调 OS API:

- `IPlatformSingleInstance` — 单实例锁(Win: AppInstance / Mac: NSAppleEventManager)
- `IPlatformPaths` — 路径解析(Win: `%APPDATA%` / Mac: `~/Library/Application Support`)
- `IPlatformAutostart` — 开机自启(Win: 注册表 Run / Mac: LaunchAgent)
- `IPlatformReveal` — 文件管理器 reveal(Win: `explorer /select` / Mac: `open -R`)
- `IPlatformNotifier` — 系统通知
- `IPlatformAppMenu` — 应用菜单 / macOS 应用菜单
- `IPlatformWindowChrome` — 窗口装饰 / Mica / vibrancy
- `IGitHost` — git 操作(`git clone` / `ls-remote`)

### §1.3 插件系统

每个大功能模块 = 一个 plugin:
- F1 Provider 列表 / F2 切换 / F3 .sql 导入 / F4 deeplink 导入
- F5 JSON 编辑 / F6 MCP 管理 / F7 用量查询
- F8 单文件部署 / F9 搜索 / F10 拖放 / F11 快捷键 / F12 主题 / F13 备份 / F14 导出 / F15 错误反馈
- F16 资源浏览 / F17 在线安装 / F18 配置优化 / F19 备份与恢复 / F20 单实例 + 文件关联
- F21 资源搜索 / F22 资源详情 / F23 优化导出 / F24 备份 diff

每个 plugin 统一接口:

```rust
trait IPlugin {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn routes(&self) -> Vec<Route>;        // 前端路由
    fn services(&self) -> Vec<Service>;    // 后端 service
    fn init(&mut self, ctx: &PluginContext) -> Result<()>;
    fn shutdown(&mut self) -> Result<()>;
}
```

新增功能 = 写一个新 plugin,PluginHost 自动注册。M1 阶段所有 plugin 写 stub,业务逻辑延后到 M2+。

### §1.4 反事故:不要在业务代码里散落 OS 判断

- ❌ 业务代码直接调 `Win32` API / `Cocoa` API
- ❌ `if (process.platform === 'win32')` 散落在 src/pages 或 src/components
- ✅ 所有 OS 差异 → `platform/` trait → 业务代码调接口

---

## §2. 设计系统基线

### §2.1 主题
- **默认**:瓷白主题(Cream White / Off-White `#FAFAF7` 基底)
- **预留**:Light / Dark / Auto(系统跟随)切换接口
- **半透明效果**:M1 阶段用 CSS `backdrop-filter: blur()` 模拟 Liquid Glass,v1.1 接入系统原生 API(Win11 Mica / macOS vibrancy)

### §2.2 配色(CSS 变量集中管理)

```css
--bg-primary: #FAFAF7;       /* 瓷白基底 */
--bg-elevated: #FFFFFF;       /* 卡片背景 */
--bg-overlay: rgba(255,255,255,0.7);  /* 半透明遮罩 */
--text-primary: #1F2328;
--text-secondary: #656D76;
--text-muted: #8B949E;
--accent: #0969DA;            /* 操作强调色 */
--success: #388E3C;
--warning: #F57C00;
--danger: #D32F2F;
--border: #E1E4E8;
--shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
--shadow-md: 0 4px 12px rgba(0,0,0,0.08);
```

### §2.3 字体
- UI:系统默认(`-apple-system, "PingFang SC", "Microsoft YaHei", system-ui`)
- 等宽:`"Cascadia Code", "SF Mono", Menlo, Consolas, monospace`

### §2.4 间距 / 圆角 / 字号
- 间距:4px 网格(4 / 8 / 12 / 16 / 24 / 32 / 48)
- 圆角:卡片 8px / 按钮 4px / 弹窗 12px
- 字号:标题 16-20px / 正文 14px / 辅助 12px

### §2.5 状态色
- 成功:`#388E3C`
- 警告:`#F57C00`
- 错误:`#D32F2F`
- 禁用:`rgba(0,0,0,0.4)`

---

## §3. 三层测试 + TDD 流程 + Build Pipeline Regression

### §3.1 三层测试

- **单元测试**:函数级 / 模块级(Rust `cargo test` / TS Vitest)
- **集成测试**:跨模块交互(Rust integration test / TS API test)
- **UI e2e**:端到端用户旅程(tauri-driver + WebDriverIO)

### §3.2 TDD 流程

1. **写失败的测试(Red)** — 测试必暴露 bug 或未实现的行为
2. **写最小实现让测试通过(Green)** — 不超实现,只让红变绿
3. **重构(Refactor)** — 测试仍绿的条件下整理代码
4. **任何 Phase 开始先写测试用例** — 测试先于实现

### §3.3 M1 阶段必过的 e2e

- [ ] 启动应用,看到空窗口(标题"Claude 配置管理器")
- [ ] 看到系统托盘图标
- [ ] 点击关闭按钮 → 窗口隐藏,不退出进程
- [ ] 右键托盘 → 看到"显示主窗口" + "退出"菜单
- [ ] 点击"显示主窗口" → 窗口恢复
- [ ] 点击"退出" → 进程退出

### §3.4 Build Pipeline Regression Classes

**原 4 项 smoke test**(进程运行 / 主窗口 / 托盘 / kill 干净)能通过但**实际页面是空白**:
- M1.3 era:用户报告 exe 启动后白屏 / ERR_CONNECTION_REFUSED,smoke test 仍 PASS
- **根因**:`cargo build --release` 没加 `--features tauri/custom-protocol`,`tauri::generate_context!()` 退化为 `EmbeddedAssets::default()`,webview 加载 vite dev server (1420 端口) → dev server 没起 → ERR_CONNECTION_REFUSED

**修复 + 扩展**(smoke test 从 4 项扩到 10 项,覆盖 4 类 build regression):
1. `cargo build --release --features tauri/custom-protocol`(M1.3-fix-v2)
2. M2.17-C3 切到 `tauri build --no-bundle`(自动跑 `beforeBuildCommand = npm run build` + 自动 enable custom-protocol,根除 stale-dist / dist-not-embedded 失败模式)
3. smoke test 从 4 项扩到 **10 项**,覆盖 4 类 build regression:
   - launch / window / webview / title(进程 + UI 可达)
   - **assets**(dist fingerprint grep PE)— 抓 stale dist
   - **db_exists / schema / queryable**(SQLite 状态)— 抓迁移失败
   - tray / kill(生命周期)

**反事故**:smoke test PASS ≠ exe 可用。任何 ship 前 subagent 必须跑完 10 项。

### §3.5 手工 cargo build 时的隐藏陷阱(跨平台)

**Windows**:
- 必须加 `--features tauri/custom-protocol`,否则 dist 不嵌入 PE,webview 加载 vite dev server → ERR_CONNECTION_REFUSED
- 不要 `cargo build --release -p claude-config-manager` 单包编译 — Tauri build.rs 需要 workspace 信息,单包编译会 break

**macOS**:
- 必须用 Xcode Command Line Tools(`xcode-select --install`),否则 rustc 找不到 clang
- 第一次 cargo build 链 `wry` / `tao` 时会**重新编译 objc / cocoa / core-foundation** 等 macOS-only crate(来自 wry 传递依赖),耗时 ~5-8 分钟(仅首次)
- `tauri build --no-bundle` 在 macOS 上同样适用,会自动跑 `beforeBuildCommand`
- **不要** `cargo build --target x86_64-apple-darwin` 从 Windows 跨编译 macOS(缺 macOS SDK + codesign 工具链,**不可行**);如需在 mac 上构建,必须真机跑

**正确做法**:本项目所有 release build 都走 `scripts/build-and-ship.sh`(内部 `tauri build --no-bundle`),不直接 cargo build。

---

## §4. 评审纪律 + UI 文案同步

### §4.1 评审纪律

每次完成非平凡代码改动后,必须按顺序执行:

1. **自审**:逐文件逐行审(bug / 边界 / 并发 / 平台差异 / 文档一致性)
2. **头脑风暴**:反向挑战每个设计决策
3. **同行评审**:调外部 AI CLI 独立审查
4. **业务流程分析**:逐步骤推演完整生命周期,找断点
5. **修复 + 文档**:修所有 CRITICAL/HIGH,剩余写 STATE.md 已知限制

### §4.2 UI 文案改动 → 必须同步的 3 处(M3.0.3 lesson)

前端任何"显示文案"改动(如产品名 / URL / 版本号)必须**同时改 3 处**,否则 build 通过但 UI 不变:

1. **前端字符串**(如 `src/pages/about/index.tsx` 里的 `const PROJECT_HOMEPAGE`)
2. **Rust IPC 常量**(如 `src-tauri/src/commands/app.rs::PRODUCT_NAME`)— IPC 返回的字段会渲染到 UI
3. **测试 fixture**(如 `src/__tests__/pages/about.test.tsx` 里的 `sampleMetadata` mock)

**反事故**:本会话改 `ClaudeConfigManager` → `ClaudeManager` 反复 5 轮才改全(漏 Rust IPC 常量 / 漏测试 fixture),每次 ship smoke test 通过但 UI 不变——smoke test 不检测 UI 文本内容,只检测进程/窗口/dist 指纹,**"看起来 OK"和"实际生效"是两件事"**。

### §4.3 显示名 vs 系统标识分层(M3.0.3 lesson)

`ClaudeConfigManager` 这串字符在项目里同时出现在 4 个语义不同的位置,改"显示名"时**只改显示层**:

| 位置 | 性质 | 改不改 |
|---|---|---|
| `tauri.conf.json` `productName` | **显示**(exe 文件名 / 任务栏 / Dock)| ✅ 改 |
| `src-tauri/src/commands/app.rs` `const PRODUCT_NAME` | **IPC 显示**(→ 关于页"应用名"字段)| ✅ 改 |
| `src-tauri/src/commands/app.rs` `const IDENTIFIER` / `DISPLAY_IDENTIFIER` | **bundle id 系统层**(macOS bundle / Windows installer / 注册表 / mutex 名 / AppData 路径)| ❌ 不动 bundle id;如果一定要让关于页显示新 identifier,新增 `DISPLAY_IDENTIFIER` 独立常量 |
| `src-tauri/Cargo.toml` `[package].name` | **Rust crate 名**(影响 `use claude_config_manager::*` 全 Rust 代码 + Cargo.lock)| ❌ 不动 |
| `package.json` `name` | **npm 包名** | ❌ 不动 |

**规则**:用户说"修改显示名"时,**Rust 端的 `const PRODUCT_NAME` 算显示文案不算代码名**(IPC 显示用);但 `const IDENTIFIER` 是 bundle id 算系统层 → 用新 `DISPLAY_IDENTIFIER` 显示 + 保留 `IDENTIFIER` 不动。

---

## §5. 内存/状态纪律 + Subagent 派遣纪律

### §5.1 内存/状态纪律

- 任何配置 / 状态变更必须可回滚(备份 → 原子 rename)
- 任何写盘操作必须先备份(参考 SPEC §6.1)
- 任何错误必须有用户能看懂的提示,**不允许静默吞错**

### §5.2 Subagent 派遣纪律

- **主 session 只负责**:澄清问题 + 接收最终成果 + 关键决策确认
- **所有具体执行**(安装依赖 / 写代码 / 跑命令)派 subagent
- Subagent 必须遵守 `docs/BUG-FIX-SPEC.md` + `docs/FEATURE-DEV-SPEC.md` 全部规则
- Subagent 联网**优先级顺序 (2026-06-27 更新)**:
  1. `cs-web-fetch` 技能(Windows 主路径:`/c/Users/e-Yunfei.Qian/.claude/plugins-dev/cs-knowledge-base/skills/cs-web-fetch/scripts/fetch.js`)
  2. 内置 `WebFetch` / `WebSearch`(快路径,静态文档/找入口优先)
  3. **`render-url` skill**(联网搜索失败时的 fallback;用 msedge headless 渲染动态网页/SPA/JS 重定向,支持 text/png/html 输出;适配 macOS / Windows / Linux)
  4. 全部失败 → 标记 `RESOURCE_UNAVAILABLE`,继续推进不依赖该资源的部分
- 禁止 subagent 用 `curl` / `wget` 直接抓网页(绕过审计)
- 并行 dispatch 多个 subagent **必须**遵守 `BUG-FIX-SPEC.md §7`(Concurrent Subagent Compounding Failure Prevention):隔离 / 文件级依赖图 / verify 收窄到单元测试

---

## §6. 迭代交付纪律(每次迭代必做)

### §6.1 交付物

每次迭代(M1.1 / M1.2 / ... / M2.1 / ...)完成时,**必须生成一个 exe 放到桌面**等待用户核定。

### §6.2 命名规则(跨平台)

| 平台 | exe 名 | Desktop 目录 |
|---|---|---|
| Windows | `ClaudeConfigManager-M{major}.{minor}-{slug}.exe` | `~/Desktop/ClaudeConfigManager-M{major}/` |
| macOS | `ClaudeConfigManager-M{major}.{minor}-{slug}.app` | `~/Desktop/ClaudeConfigManager-M{major}/` |

**`{major}` = M1/M2/M3/M4**;**`{minor}` = 1.1/1.2/.../3.0.3**;**`{slug}` = kebab-case 短描述**(如 `scaffold` / `platform-abstractions` / `ui-text-cleanup`)。

### §6.3 Build 类型

- **M1.x(架构期)**:Dev build(快,5-10 分钟),含调试信息
- **M2.x 及以后**:Dev build(功能迭代期)+ 里程碑结束额外做 1 次 Release build(验证打包链路)

### §6.4 Smoke Test(跨平台)

**当前实跑 10 项**(见 `scripts/smoke-test.sh`,M1.3 时代从 4 项扩到 10 项覆盖 build regression classes)。

**Windows**(当前实跑命令):
1. ✅ 启动 exe → 进程在 5 秒内运行
2. ✅ 检测到主窗口(`Get-Process` + `MainWindowHandle` + `Responding`)
3. ✅ 检测到 WebView2 子窗口(`EnumChildWindows` + `Chrome_WidgetWin_*` 类名匹配 → 证明前端 bundle 真的加载)
4. ✅ 窗口标题 = tauri.conf.json 中的 productName
5. ✅ dist fingerprint (`index-*.js`) 嵌入到 exe PE 资源(`strings` 命令)
6. ✅ history.db 在 `%APPDATA%\ClaudeConfigManager\` 创建且非空
7. ✅ history.db schema 含 `usage_history` + `backup_history` + `schema_version` 3 个对象
8. ✅ history.db 可查询(usage_history 或 backup_history 至少 1 行 OR 0 行但 schema 有效)
9. ✅ 关闭窗口 → 进程仍在(最小化到托盘)
10. ✅ 强制 kill → 2 秒内进程消失

**macOS**(不进 CI,需 Rust IPC 改造):
- 第 1-2 项:`pgrep -f ClaudeConfigManager` + `osascript` 查 NSWindow 存在性
- 第 3 项:WKWebView 子窗口枚举(无 CLI 等价;需 Rust IPC 加 `get_webview_children_count` 命令,参考 audit-rust.md)
- 第 4-8 项:相同概念(标题 / dist / db / schema / queryable — 路径改为 `~/Library/Application Support/ClaudeConfigManager/`)
- 第 9-10 项:`osascript quit` + `kill -9`

**禁止 subagent 跳过 smoke test 直接 cp exe 到桌面**(违反 §6.4)。

### §6.5 用户核定
- cp 到桌面后,**等待用户明确"完成"或"未完成:<原因>"**
- 未经核定不能进下一个迭代
- 核定记录写入 `STATE.md`(迭代号 / 日期 / 用户反馈 / 下一步)

### §6.6 实现位置(跨平台)

**统一脚本**(在 `scripts/` 目录):

| 脚本 | Windows | macOS | 职责 |
|---|---|---|---|
| `scripts/build-only.sh` | ✅ | ⚠️ 部分 | 仅编译(debug/release/check/clean)|
| `scripts/smoke-test.sh` | ✅ 10/10 | ❌ 不进 CI | 单独 smoke test |
| `scripts/kill-app.sh` | ✅ | ❌ 不进 CI | 关闭进程(优雅或 force)|
| `scripts/build-and-ship.sh` | ✅ | ⚠️ 部分 | 完整 build + smoke + cp 到桌面 |
| `scripts/build-locked.sh` | ✅ | ✅ | flock 串行 cargo build(详 §9.5)|
| `scripts/disk-usage-check.sh` | ✅ | ✅ | target/ 磁盘监控 |

- **build-and-ship.sh 接收参数**:`--milestone M1 --task 1.1 --slug scaffold`
- **build-and-ship.sh 职责**:build → copy exe + WebView2Loader.dll → smoke test → 输出报告
- **WebView2Loader.dll 必须跟 exe 一同 cp**(仅 Windows):Tauri debug build 不会自动放置,bundler 才处理
- **scripts 互相依赖**:
  - `build-and-ship.sh` → `smoke-test.sh`(内部调做 ship 前验证)
  - `smoke-test.sh` → `kill-app.sh`(内部调做 pre-cleanup)
  - `build-only.sh` 和 `kill-app.sh` 是独立工具,可单独调

### §6.7 脚本使用流程(跨平台)

**决策树**(什么场景用什么脚本):

| 场景 | 用哪个 | 命令 |
|---|---|---|
| **迭代完成,准备 ship 给用户核定** | `build-and-ship.sh` | `./scripts/build-and-ship.sh --milestone M3 --task 0.3 --slug ui-text-cleanup` |
| **dev 循环内只改 Rust,想验证编译通过** | `build-only.sh` | `./scripts/build-only.sh` (默认 release; --check 更快; --clean 全量重建) |
| **改了 src/ 前端** | `npm run build`(不走 build-only) | `npm run build` — build-only 不跑 beforeBuildCommand |
| **想看 vite HMR 实时预览** | `npm run tauri dev` | dev server + dev build;**不 ship** |
| **已 ship 后想复跑 smoke test** | `smoke-test.sh <exe>` | `./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe` |
| **dev 中残留进程卡死 / smoke 前清理** | `kill-app.sh` | `./scripts/kill-app.sh` (优雅 + force fallback) |
| **进程僵死无法优雅关** | `kill-app.sh --force` | `./scripts/kill-app.sh --force` |

**速查表**(3 个最常见 flow):

```bash
# Flow 1: dev 循环 (只改 Rust)
./scripts/kill-app.sh
./scripts/build-only.sh
./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe

# Flow 2: 改前端 (src/ 下任何文件)
npm run build                           # 必须! build-only 不跑 beforeBuildCommand
./scripts/kill-app.sh
./scripts/build-and-ship.sh --milestone M3 --task 0.3 --slug my-feature

# Flow 3: 迭代 ship 给用户核定
./scripts/build-and-ship.sh --milestone M2 --task 2.3 --slug provider-list
# 内部全流程: kill residue → tauri build --no-bundle → cp exe + WebView2Loader.dll → smoke 10 项
# smoke PASS → 输出 "SHIPPED ✓" + 桌面路径
# smoke FAIL → 自动 rm 桌面 exe, exit 1 (不回桌面)
# 等用户回 "完成" 或 "未完成: <原因>" (§11.7 不核定不派下一个 ship 类 subagent)
```

**平台注意**:
- **macOS subagent 当前限制**:smoke-test / kill-app / build-and-ship 仅 Windows 部分能用;mac subagent 可用 `build-only.sh --check` + `disk-usage-check.sh` + `npm run tauri dev`

### §6.8 临时命令合并为脚本(M3.0.3 lesson)

**规则**:subagent(或主 session)执行 ≥ 3 个**相关联的临时命令**时(如 `sccache --show-stats` + `cargo check` + `grep cfg(windows)`),必须评估是否合并成一个可复用脚本,写入 `scripts/` 目录。

**判断标准**:
- ✅ **合并场景**:命令序列有明确目的(如"诊断 sccache 是否坏"),下次还可能用上
- ❌ **不合并场景**:命令彼此无关 + 一次性探索 + 命令输出仅当前 session 看

**反事故**:
- 本会话派了 3 个 subagent 跑 sccache 诊断,每个都跑 `sccache --show-stats` + `cargo check 2>&1 | tail -30`。**正确做法**:第 1 次跑时就该写 `scripts/sccache-diag.sh`,把命令序列固化

**合并步骤**:
1. 收集命令序列 + 输出格式
2. 抽函数(参数化路径 / crate 名 / 输出格式)
3. 写入 `scripts/<purpose>-<target>.sh`(如 `scripts/sccache-diag.sh`)
4. `chmod +x` + `bash -n` 验证
5. 加到 §6.6 实现位置表(如果项目级)
6. 下次同类任务调脚本,不重复 inline

---

## §7. 主 session 工作流约束

### §7.1 角色分工
- **主 session**:只做决策 + 任务分配 + 接收 subagent 成果
- **Subagent**:执行具体开发任务(编译 / 安装依赖 / 写代码 / 跑命令 / 改文件)

### §7.2 并发上限

> **本节是 Subagent fan-out 上限的权威源**(原 `CLAUDE-WORKFLOW.md §11.2` 上限 4 与 `CLAUDE.md §20.3` 上限 2 冲突,**统一为 2**)。

- **最多同时开 2 个 subagent**
- 超过 2 个时主 session 必须等其中一个完成再派新的
- 4 是历史 D11 4 槽上限,**实战 2 是 sweet spot**(`docs/BUG-FIX-SPEC.md §1.9` 大 fan-out = 全军覆没)

### §7.3 增量派单(流式)
- 不要等所有 subagent 全部完成才重新分配
- **每收到一个 subagent 完成通知**,立即评估:
  1. 该 subagent 的产出是否成功?
  2. 有没有阻塞下游任务?
  3. 能否派下一个 subagent?
- 如果 subagent 失败 → 决定是修复重派 / 换方案 / 跳过
- 流式派单的目标:**最大化 2 槽利用率,减少主 session 空等时间**

### §7.4 派单前检查
每次派 subagent 前,主 session 评估:
- [ ] 任务边界清晰(不是模糊的"做这个功能")
- [ ] subagent 类型匹配(general-purpose / Explore / gsd-* 等)
- [ ] 上下文已塞进 prompt(不依赖主 session 私有信息)
- [ ] 不违反 `docs/BUG-FIX-SPEC.md` + 本 spec 任何规则
- [ ] prompt header 含 "必读 `docs/BUG-FIX-SPEC.md` + `docs/FEATURE-DEV-SPEC.md`"

### §7.5 派单后行为
派完 subagent 后:
- 主 session **不要亲自执行任何 shell / file 操作**
- 等 subagent 完成(可能数分钟,silence is normal)
- 收到完成通知后立即分析 + 决定下一步

### §7.6 macOS 开发 subagent 的额外约束
- ❌ **mac subagent 不能跑** `scripts/{kill-app,smoke-test,build-and-ship}.sh` 当前版本(含 powershell 调用)— 必须先 audit-scripts 改造
- ✅ mac subagent 可以跑:`scripts/build-only.sh --check`(纯 cargo check)+ `scripts/disk-usage-check.sh`(跨平台)+ `npm run tauri dev`(Vite + Tauri CLI 跨平台)
- ⚠️  macOS 编译产物 = `.app` bundle(不是 `.exe`),命名约定见 §6.2
- ⚠️  macOS 用户数据路径 = `~/Library/Application Support/ClaudeConfigManager/`(不是 `%APPDATA%\ClaudeConfigManager\`)

### §7.7 决策门槛
主 session 的决策分为两类:
- **必须问用户**:技术栈选型 / 架构重大分歧 / 是否进入下一迭代 / SPEC 冲突解决 / 大范围返工
- **可自主决定**:单文件命名 / 单函数签名 / 局部重构 / 单条命令 / 单元测试细节

### §7.8 三次失败必须暂停复盘(M3.0.3 lesson)
**规则**:同一个问题(同一文件 / 同一错误 / 同一目标)尝试修复 **3 次仍失败** 时:
1. ❌ **禁止** 派第 4 次 subagent / 第 4 轮 Edit / 继续猜
2. ⏸️ **必须** 暂停,进入复盘流程:
   - 重新读 §4.1 评审纪律(自审 / 头脑风暴 / 同行评审 / 业务流程分析)
   - **重审前提假设**:之前 3 次失败是不是方向错了?该方案是不是压根不可行?
   - 列证据:3 次分别改了什么?每次具体报什么错?错在哪个调用栈?
   - 列可能根因:≥ 3 个候选根因
3. 🛑 **必须** 要么:
   - 改换方案(重新设计,不在原路径上继续试)
   - 或要求用户介入(提供更多上下文 / 授权大改 / 决定是否回滚)

**根因诊断流程**(暂停后必走):
1. 收集所有错误日志(`cargo check 2>&1 | tee build.log` + `sccache --show-stats` + 浏览器 console 等)
2. 按"调用栈分类":是 A 处错、B 处错、还是 A → B 链式错?
3. 按"假设 vs 证据":列出过去 3 次的**前提假设**,哪些假设没被验证?
4. 按"已知 vs 未知":哪些事实已知(可验证)?哪些未知(需用户确认)?
5. 写"暂停复盘报告"到 `tmp/issue-retro-<date>.md`,包含以上 4 项

### §7.9 用户核定未到 → 不派 ship 类 subagent(M3.0.3 lesson)

§6.5 要求"未经核定不能进下一迭代"。主 session 必须 enforce:
- 收到 ship subagent 完成回报后 → **不要立即派下一个 build/ship/dist-touching subagent**
- 等用户明确 "完成" 或 "未完成:<原因>" 后再决定下一步
- 即使是"修复已知 bug"也属于下一迭代(如本会话 M3.0.3 → M3.0.3-fix-v2)

---

## §8. Subagent 行为禁区(M3.0.3 sccache subagent 违反案例)

### §8.1 禁止擅自 commit / push / tag / 改全局配置

subagent 完成任务后**不得**:
- ❌ `git add` + `git commit`(即使是 `tmp/` 下的报告文件)
- ❌ `git push` / `git tag` / `git branch`
- ❌ 改 `~/.cargo/config.toml` / `~/.bashrc` / `~/.zshrc` / 任何用户级配置(即使是"加速"用途)
- ❌ 装全局工具 `cargo install xxx` / `npm install -g xxx` / `brew install xxx`

**正确流程**:subagent 完成 → 回报主 session → 主 session 列白名单 → 用户确认 → 主 session 自己 commit / 自己改全局配置,**或**显式批准 subagent 执行并指定精确命令。

**反事故**:本会话 sccache subagent 自行 `git add tmp/sccache-install-verify.md && git commit`(commit `645680b`)— 违反本条。回滚命令:`git reset --soft HEAD~1`(保留工作区)或 `git reset --hard HEAD~1`(彻底回滚)。

### §8.2 用户核定未到 → 不派 ship 类 subagent

见 §7.9。ship 类 subagent 定义:任何会修改 `dist/` / `target/release/` / 桌面 exe / `Cargo.lock` / `package-lock.json` 的 subagent。

---

## §9. macOS 开发约束

### §9.1 编译环境前置
- ✅ **必须装 Xcode Command Line Tools**(`xcode-select --install`,约 200 MB)
- ✅ **必须装 Rust toolchain apple-darwin**(`rustup target add aarch64-apple-darwin` + `x86_64-apple-darwin` 二选一,跟主机 CPU 走)
- ⚠️  Apple Silicon (M1/M2/M3) 默认 target = `aarch64-apple-darwin`;Intel Mac = `x86_64-apple-darwin`
- ❌ **不要从 Windows 跨编译 macOS**(缺 SDK + codesign 工具链,必失败)
- ⚠️  **本机是 Windows**,macOS 验证必须由用户在 Mac dev box 上跑

### §9.2 编译产物与路径
- 编译产物 = `target/release/bundle/macos/Claude Manager.app`(不是 `.exe`)
- 调试用裸二进制 = `target/release/claude-config-manager`(无后缀)
- 用户数据路径:
  - Windows: `%APPDATA%\ClaudeConfigManager\`
  - macOS: `~/Library/Application Support/ClaudeConfigManager\`
  - **`~/.claude/`** 是 Claude CLI 自己的目录,**跨平台都用这个路径**(不要改)

### §9.3 macOS 脚本能力

| 脚本 | Windows | macOS 替代 |
|---|---|---|
| `kill-app.sh` | powershell + taskkill | `osascript` + `pgrep -f` + `kill -9`(M4 阶段补)|
| `smoke-test.sh` | 10 项实跑 | 需 Rust IPC 加 `get_webview_children_count` + `get_window_state` 命令(详 §9.6)|
| `build-and-ship.sh` | ✅ 全流程 | 部分(缺 smoke test 跨平台)|
| `build-only.sh --check` | ✅ | ✅ |
| `disk-usage-check.sh` | ✅ | ✅ |
| `npm run tauri dev` | ✅ | ✅(Vite + Tauri CLI 跨平台)|

**当前 mac subagent 可用命令**:`build-only.sh --check` + `disk-usage-check.sh` + `npm run tauri dev` + 直接 `cargo build` + `cargo test`。

### §9.4 Rust IPC 需补充的 macOS-only 命令

smoke test 在 macOS 上无法用 `EnumChildWindows` 枚举 WKWebView 子窗口,需 Rust 加 3 个 IPC:
- `get_webview_children_count() -> u32` — 返回主窗口下 webview 子窗口数
- `get_window_state() -> { handle: u64, responding: bool, title: String }`
- `get_app_metadata()` 已存在(display name 等),无需新增

### §9.5 sccache 共享编译缓存(dev 加速)

重复 build 时复用上一次编译的 crate `.rlib` 输出,避免 `wry` / `tao` / `tauri` 等 C/C++ 重链。**dev 工具,非硬依赖**——未装 sccache 也能 build(fallback 到普通 cargo 编译,build 不会失败)。

- ✅ **wrapper**:项目级 `src-tauri/.cargo/config.toml` 已加 `[build] rustc-wrapper = "sccache"`(覆盖全局 `~/.cargo/config.toml` 同名段;只影响本 crate,不污染其他项目)
- ✅ **缓存目录**:`$SCCACHE_DIR = ~/Library/Caches/sccache-claude-config-manager`(`scripts/build-mac.sh` 顶部 export,项目专属,不与其他项目共享)
- ✅ **容量上限**:`SCCACHE_CACHE_SIZE=5G`(sccache 默认 10G 容易把磁盘撑爆,主动限)
- ⚠️ **范围**:`scripts/build-mac.sh` 顶部 self-check 检测 sccache 是否安装;装了则 echo INFO 行 + 设环境变量;未装则 echo WARN 行 + 跳过(不阻断 build)

**验证方法**:
```bash
cd src-tauri
cargo check                # 第一次:Cache writes > 0(冷启)
cargo check                # 第二次:Cache hits  > 0(暖启,证明 wrapper 真生效)
sccache --show-stats        # 看 Cache hits rate (Rust) 是否 100%
```
注意:仅看 `Compile requests executed = 0` 不够——若 cargo incremental 命中 `target/`,sccache 可能不介入。**用 `cargo clean` 后再 build** 才能完整触发 sccache 写入。

**回滚**:删 `src-tauri/.cargo/config.toml` 即停用 sccache wrapper(全局 `~/.cargo/config.toml` 不动;本机其他项目不受影响)。

**反事故**:sccache 启用后,**改 sccache 配置前需 `pkill sccache`**——server 启动时读 `SCCACHE_DIR` / `SCCACHE_CACHE_SIZE`,运行中改 env 不会被旧 server 拾取(详 §9.7)。

### §9.6 长期治理场景的 Cargo.toml profile 调优(允许)

§9.7 写明"禁 cargo profile 调优",但**target/ 长期治理**场景例外:
- 修改前必须列白名单给用户
- 只改 `[profile.dev]` / `[profile.release]` 的 `codegen-units` / `lto` / `strip` / `debug` 字段
- **不改** crate 版本 / 依赖 / 其他字段
- 改动记录在 commit message,说明为什么豁免 §9.7

**当前生效的豁免**(M3.0.3 cleanup):`src-tauri/Cargo.toml` 已加 `[profile.dev]` + `[profile.release]`,预期 target/ 从 9.6GB 降到 ~4.5GB(-53%)。

### §9.7 加速禁忌(跨平台)
- ❌ **不要 cargo profile 调优**(`Cargo.toml` `[profile.release]` 改 codegen-units / LTO)— 违反 §2.3 版本锁纪律精神,且收益小
  - **例外**:长期治理场景(target/ 缩体积)允许 dev/release profile 调优(见 §9.6),但需用户白名单
- ❌ **不要在 ship 流程切 dev build** — 违反 §6.3,dev build 有 conhost 黑窗(M1.1 时代 user 已反馈)
- ❌ **不要并行跑 cargo build** — webview2-com 静态链接 + 进程内 mutex 锁会冲突(Win);macOS wry+WKWebView 也类似(WKWebView 进程内 IPC),cargo 自带 -j 调度足够
- ❌ **不要用 cargo-zigbuild / cross** — 本项目不是交叉编译场景,徒增工具链复杂度
- ⚠️ **macOS 专属禁忌**:
  - ❌ 不要用 `sudo xcode-select` 改 CLT 默认值,会破坏其他项目
  - ❌ 不要在 macOS 跑 cargo build 时手动 `RUST_LOG=trace`(性能掉 50%,仅 debug 用)
  - ✅ macOS 上 `cargo build --release` 默认用 Apple clang,不需额外装 gcc/clang
  - ❌ **不要在 sccache server 已在跑时改 `SCCACHE_DIR` / `SCCACHE_CACHE_SIZE` env** — server 启动时一次性读 env,运行时改不会被旧 server 拾取。要么改前 `pkill sccache` 重启 server,要么确认新 build 触发了 server 重启(详 §9.5)

### §9.8 macOS 权限与 entitlements

需创建 `src-tauri/<name>.entitlements` 含必要权限(app sandbox / 文件 / 网络 / Apple Events);Tauri 自动生成的 `Info.plist` 已含 ccswitch URL scheme 注册(来自 `tauri.conf.json::plugins.deep-link.desktop.schemes`)。详见 `tmp/path-permission-audit.md`(待产出)。

**状态(2026-06-24)**:✅ dev 阶段 entitlements 已 ship 于 commit `2b621ab`。**不开** app-sandbox(仅 dev 调试用)。生产 release 不开 — 详见 §9.9。

### §9.9 🚫 本项目不做发布(2026-06-24 user 决定)

**全局约束**:本项目是 dev / 个人工具,**不**做公开发布 / 上 Apple App Store / 公开分发 .dmg。

**永久砍掉**(不再复活):
- ❌ macOS 代码签名(`codesign --sign "Developer ID Application: ..."`)— 不需 Apple Developer 账号
- ❌ macOS 公证(`notarytool` / `xcrun altool`)— 不需 `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` secrets
- ❌ Hardened Runtime 配置 — 不需要
- ❌ `.dmg` 分发 / 桌面交付 cp 脚本(`scripts/cp-to-desktop-mac.sh`)— 无桌面交付需求
- ❌ macOS smoke test 改造(`get_webview_children_count` / `get_window_state` Rust IPC + `scripts/smoke-test-mac.sh`)— **不进 release CI 链路**
- ❌ release.yml mac matrix `continue-on-error` 调优 — 不做 release 链路
- ❌ `docs/SIGNING.md` 维护 — 整文件相关

**dev 阶段**(仍做):
- ✅ `./scripts/build-mac.sh --debug` — 本地 build + 手验
- ✅ mac 真机验证(`pgrep` + 日志 + GUI 打开)
- ✅ dev 阶段 entitlements(`src-tauri/ClaudeConfigManager.entitlements`)— 已 ship
- ✅ macOS 调试组件(`scripts/debug-mac.sh` + `docs/DEBUG-MAC.md`)— 已 ship
- ✅ `tauri.conf.json` 仍可产 unsigned `.app` + `.dmg`(仅 dev 用,不上传)

**影响**:
- §9.4 smoke test 改造:可仅做 dev 工具(不强制),不进 CI
- §9.8 entitlements:dev 阶段照常;不开 sandbox
- §6.6 build-and-ship.sh 仍是 Windows-only(M1.x 桌面交付流程)
- §6.7 "桌面交付" flow:仅 Windows 适用;mac dev 走 `scripts/build-mac.sh --debug` 自取

**详细 reasoning**:`docs/macos-p2-backlog.md` §「🚫 已砍清单」段。

---

## §10. FEATURE DEV WORKFLOW(4 步闭环,新增)

> **新增于 2026-06-30 重构**。基于 `superpowers:brainstorming` skill + `superpowers:writing-plans` skill + GSD `/gsd-execute-phase` workflow + subagent-driven-development 派生。

### §10.1 4 步闭环

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: IDEA → SPEC (需求澄清 + 架构设计)                  │
│  - 主 session 或 brainstorming skill                        │
│  - 输出: SPEC 文档 (功能边界 / 接口 / 数据流 / 反事故)     │
│  - 参考 SPEC.md §X(实现唯一参考)                          │
│  - 不写代码,只写文档                                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: SPEC → PLAN (落地计划)                             │
│  - writing-plans skill                                     │
│  - 输出: PLAN.md (任务分解 / 依赖 / goal-backward verify) │
│  - atomic commit 计划                                      │
│  - subagent 派单图 (哪个 subagent 负责哪个 task)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 3: PLAN → CODE (派 subagent 实施)                    │
│  - 主 session 派 ≤2 subagent (§7.2)                        │
│  - subagent 工作在 worktree isolation                      │
│  - 中途 verify 走 cargo check / vitest 单测                 │
│  - 完整 build + smoke test 走 BUG-FIX-SPEC §4 七步          │
│  - subagent commit 后 main session cherry-pick              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 4: CODE → SHIP (cp + 核定 + 下迭代)                  │
│  - ./scripts/build-and-ship.sh --milestone M3 --task 0.3   │
│  - smoke test 10/10 PASS → cp 桌面 → 等用户核定             │
│  - 用户回 "完成" → 写 SESSION-SUMMARY.md + 进下迭代          │
│  - 用户回 "未完成: <原因>" → 回到 Step 2 / Step 3            │
└─────────────────────────────────────────────────────────────┘
```

### §10.2 关键决策点

| 决策 | 触发条件 | 处理 |
|---|---|---|
| brainstorming skill vs 直接规划 | 需求不清晰 / 多解 | 调 brainstorming skill |
| writing-plans skill vs 直接派 subagent | task 数 ≥ 3 或依赖复杂 | 调 writing-plans skill |
| 主 session 修 vs 派 subagent | 单文件 ≤ 50 行 + 不跨 IPC | 主 session 修 |
| 派 1 vs 派 2 subagent | 看 blast radius(详 BUG-FIX-SPEC §7 Rule 1) | 0 重叠 → 2,有交集 → 1 |
| Ship 自动 commit vs 等 user | §6.5 核定规则 | 等 user 回 "完成" 才进下迭代 |

### §10.3 与 BUG-FIX-SPEC §12 关系

`BUG-FIX-SPEC.md §12`(BUG FIX WORKFLOW)是 "从 bug 报到 root cause 修完" 的反向 6 步流程。
本节 `§10`(FEATURE DEV WORKFLOW)是 "从 idea 到 ship" 的正向 4 步流程。
两者互补:
- 本 spec §10:新功能开发("做新东西")
- BUG-FIX-SPEC §12:bug 修复("修旧东西")

### §10.4 反事故:本 spec §10 是新增章节,本身可能成为"虚假体系"

- 不引用未验证的 superpowers skill — 必须实测过才能写入
- 不引用未在本项目跑过的 workflow — 必须在 doc 加 `(未经实测,需 2026-07-XX 首次跑)` 标记
- 不写空话("注重质量" / "做好测试") — 每条规则附具体 file:line 或命令

### §10.5 联网 fallback(详 §5.2 Subagent 派遣纪律)

subagent 联网的优先级顺序:
1. `cs-web-fetch` 技能(Windows 主路径)
2. 内置 `WebFetch` / `WebSearch`(快路径,静态文档/找入口优先)
3. **`render-url` skill**(联网搜索失败时的 fallback;用 msedge headless 渲染动态网页/SPA/JS 重定向)
4. 全部失败 → 标记 `RESOURCE_UNAVAILABLE`,继续推进不依赖该资源的部分

---

## 写于 / 删除 trigger

**写于**: 2026-06-30(用户强约束"虚假开发 / 虚假修复" 严重,要求重构方法论文档)
**写者**: Claude Code(autonomous session)
**下次 session 启动必读**: 本文件全部章节
**派任何 feature dev subagent 必含**: "必读 `docs/FEATURE-DEV-SPEC.md` 全部章节,遵守 §1.4 OS 抽象 + §2 设计系统 + §3.2 TDD + §4 评审 + §5.1 内存纪律 + §6 迭代交付 + §7 主 session 工作流 + §8 subagent 禁区 + §9 macOS 约束"

**删除 trigger**: `Never (invariant)` — 用户强约束写入。