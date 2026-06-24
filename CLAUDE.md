# Claude Config Manager — 项目规则

> 本文件由项目初始化时写入，记录本项目的基本原则与工程纪律。
> 任何 AI 会话（包括 subagent）开始工作前必须先读本文件。

---

## 1. 项目背景

- **项目名**：Claude 配置管理器（Claude Config Manager）
- **定位**：跨平台桌面工具，帮助用户在多个 Claude Code provider 配置之间快速切换 + 安全管理 + 实时监控用量
- **目标平台**：Windows 11（开发主平台）+ macOS 26（Tahoe）
- **技术栈**：Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust（后端）
- **产品/设计规格**：`./SPEC.md`（不可修改；实现唯一参考）
- **技术调研**：`./.planning/research/`（EVALUATION-REPORT.html / STACK.md / PITFALLS.md）

## 2. 工程纪律（绝对底线）

### 2.1 架构先行
- **任何功能开发前必须先设计架构**（接口、模块边界、数据流）。
- 不允许"边写边想"，不允许"写完再重构"。
- 系统兼容性的代码必须抽象到 `platform/` 层，不允许在业务代码里散落 OS 判断。

### 2.2 TDD 强制
- **测试先行**：先写测试，再写实现。
- 不只是单元测试，**UI 自动化测试必做**（tauri-driver + WebDriverIO）。
- 任何新功能必须有对应的单元测试 + 集成测试 + UI e2e 测试。
- 不允许"先写完代码回头补测试"。

### 2.3 版本管理纪律
- **禁止"依赖不行就换版本"**。遇到依赖问题先读官方文档。
- 所有依赖版本在 `Cargo.toml` / `package.json` 锁死，不允许随意 bump。
- 升级版本必须有理由（安全 CVE / 必要功能 / 官方支持周期结束），并记录在 PR 描述。

### 2.4 谨慎修改文件
- **每次文件修改必须有充分证据**（不是"猜测哪个文件该改"）。
- 禁止"既然要改顺便把 X 也改了"。
- 任何变更影响超过 2 个文件时，先列白名单给用户确认。

### 2.5 UI/UX 是头等大事
- 视觉一致性 > 功能堆叠。
- 所有 UI 改动必须参考 `./SPEC.md §5` 设计规范。
- 任何新页面/新组件必须有"为什么这样设计"的说明。

## 3. 架构原则

### 3.1 分层架构
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

### 3.2 OS 抽象接口
所有 OS 差异必须抽象成 trait，Windows/macOS 各实现一份：

- `IPlatformSingleInstance` — 单实例锁（Win: AppInstance / Mac: NSAppleEventManager）
- `IPlatformPaths` — 路径解析（Win: %APPDATA% / Mac: ~/Library/Application Support）
- `IPlatformAutostart` — 开机自启（Win: 注册表 Run / Mac: LaunchAgent）
- `IPlatformReveal` — 文件管理器 reveal（Win: explorer /select / Mac: open -R）
- `IPlatformNotifier` — 系统通知
- `IPlatformAppMenu` — 应用菜单 / macOS 应用菜单
- `IPlatformWindowChrome` — 窗口装饰 / Mica / vibrancy
- `IGitHost` — git 操作（git clone / ls-remote）

业务代码永远只调接口，永远不直接调 OS API。

### 3.3 插件系统
每个大功能模块 = 一个 plugin：
- F1 Provider 列表 / F2 切换 / F3 .sql 导入 / F4 deeplink 导入
- F5 JSON 编辑 / F6 MCP 管理 / F7 用量查询
- F8 单文件部署 / F9 搜索 / F10 拖放 / F11 快捷键 / F12 主题 / F13 备份 / F14 导出 / F15 错误反馈
- F16 资源浏览 / F17 在线安装 / F18 配置优化 / F19 备份与恢复 / F20 单实例 + 文件关联
- F21 资源搜索 / F22 资源详情 / F23 优化导出 / F24 备份 diff

每个 plugin 统一接口：
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

新增功能 = 写一个新 plugin，PluginHost 自动注册。M1 阶段所有 plugin 写 stub，业务逻辑延后到 M2+。

## 4. 设计系统基线

### 4.1 主题
- **默认**：瓷白主题（Cream White / Off-White #FAFAF7 基底）
- **预留**：Light / Dark / Auto（系统跟随）切换接口
- **半透明效果**：M1 阶段用 CSS `backdrop-filter: blur()` 模拟 Liquid Glass，v1.1 接入系统原生 API（Win11 Mica / macOS vibrancy）

### 4.2 配色（CSS 变量集中管理）
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

### 4.3 字体
- UI：系统默认（`-apple-system, "PingFang SC", "Microsoft YaHei", system-ui`）
- 等宽：`"Cascadia Code", "SF Mono", Menlo, Consolas, monospace`

### 4.4 间距 / 圆角 / 字号
- 间距：4px 网格（4 / 8 / 12 / 16 / 24 / 32 / 48）
- 圆角：卡片 8px / 按钮 4px / 弹窗 12px
- 字号：标题 16-20px / 正文 14px / 辅助 12px

### 4.5 状态色
- 成功：`#388E3C`
- 警告：`#F57C00`
- 错误：`#D32F2F`
- 禁用：`rgba(0,0,0,0.4)`

## 5. 测试纪律

### 5.1 三层测试
- **单元测试**：函数级 / 模块级（Rust `cargo test` / TS Vitest）
- **集成测试**：跨模块交互（Rust integration test / TS API test）
- **UI e2e**：端到端用户旅程（tauri-driver + WebDriverIO）

### 5.2 TDD 流程
1. 写失败的测试（Red）
2. 写最小实现让测试通过（Green）
3. 重构（Refactor）
4. 任何 Phase 开始先写测试用例

### 5.3 M1 阶段必过的 e2e
- [ ] 启动应用，看到空窗口（标题"Claude 配置管理器"）
- [ ] 看到系统托盘图标
- [ ] 点击关闭按钮 → 窗口隐藏，不退出进程
- [ ] 右键托盘 → 看到"显示主窗口" + "退出"菜单
- [ ] 点击"显示主窗口" → 窗口恢复
- [ ] 点击"退出" → 进程退出

## 6. 评审纪律

每次完成非平凡代码改动后，必须按顺序执行：
1. **自审**：逐文件逐行审（bug / 边界 / 并发 / 平台差异 / 文档一致性）
2. **头脑风暴**：反向挑战每个设计决策
3. **同行评审**：调外部 AI CLI 独立审查
4. **业务流程分析**：逐步骤推演完整生命周期，找断点
5. **修复 + 文档**：修所有 CRITICAL/HIGH，剩余写 STATE.md 已知限制

### 6.4 UI 文案改动 → 必须同步的 3 处 (M3.0.3 lesson)
前端任何"显示文案"改动（如产品名 / URL / 版本号）必须**同时改 3 处**，否则 build 通过但 UI 不变：
1. **前端字符串**（如 `src/pages/about/index.tsx` 里的 `const PROJECT_HOMEPAGE`）
2. **Rust IPC 常量**（如 `src-tauri/src/commands/app.rs::PRODUCT_NAME`）— IPC 返回的字段会渲染到 UI
3. **测试 fixture**（如 `src/__tests__/pages/about.test.tsx` 里的 `sampleMetadata` mock）

**反事故**：本会话改 `ClaudeConfigManager` → `ClaudeManager` 反复 5 轮才改全（漏 Rust IPC 常量 / 漏测试 fixture），每次 ship smoke test 通过但 UI 不变——smoke test 不检测 UI 文本内容，只检测进程/窗口/dist 指纹，**"看起来 OK"和"实际生效"是两件事**。

### 6.5 显示名 vs 系统标识分层 (M3.0.3 lesson)
`ClaudeConfigManager` 这串字符在项目里同时出现在 4 个语义不同的位置，改"显示名"时**只改显示层**：

| 位置 | 性质 | 改不改 |
|---|---|---|
| `tauri.conf.json` `productName` | **显示**（exe 文件名 / 任务栏 / Dock）| ✅ 改 |
| `src-tauri/src/commands/app.rs` `const PRODUCT_NAME` | **IPC 显示**（→ 关于页"应用名"字段）| ✅ 改 |
| `src-tauri/src/commands/app.rs` `const IDENTIFIER` / `DISPLAY_IDENTIFIER` | **bundle id 系统层**（macOS bundle / Windows installer / 注册表 / mutex 名 / AppData 路径）| ❌ 不动 bundle id；如果一定要让关于页显示新 identifier，新增 `DISPLAY_IDENTIFIER` 独立常量 |
| `src-tauri/Cargo.toml` `[package].name` | **Rust crate 名**（影响 `use claude_config_manager::*` 全 Rust 代码 + Cargo.lock）| ❌ 不动 |
| `package.json` `name` | **npm 包名** | ❌ 不动 |

**规则**：用户说"修改显示名"时，**Rust 端的 `const PRODUCT_NAME` 算显示文案不算代码名**（IPC 显示用）；但 `const IDENTIFIER` 是 bundle id 算系统层 → 用新 `DISPLAY_IDENTIFIER` 显示 + 保留 `IDENTIFIER` 不动。

## 7. 内存/状态纪律

- 任何配置 / 状态变更必须可回滚（备份 → 原子 rename）
- 任何写盘操作必须先备份（参考 SPEC §6.1）
- 任何错误必须有用户能看懂的提示，不允许静默吞错

## 8. Subagent 派遣纪律

- 主 session 只负责：澄清问题 + 接收最终成果 + 关键决策确认
- 所有具体执行（安装依赖 / 写代码 / 跑命令）派 subagent
- Subagent 必须遵守本文件所有规则
- Subagent 联网必须用 `cs-web-fetch` 技能（路径：`/c/Users/e-Yunfei.Qian/.claude/plugins-dev/cs-knowledge-base/skills/cs-web-fetch/scripts/fetch.js`）
- 禁止 subagent 用内置 WebFetch / WebSearch / curl

## 9. 迭代交付纪律（每次迭代必做）

### 9.1 交付物
每次迭代（M1.1 / M1.2 / ... / M2.1 / ...）完成时，**必须生成一个 exe 放到桌面**等待用户核定。

### 9.2 命名规则
```
~/Desktop/ClaudeConfigManager-M{major}/ClaudeConfigManager-M{major}.{minor}-{slug}.exe
```
示例：
- `~/Desktop/ClaudeConfigManager-M1/ClaudeConfigManager-M1.1-scaffold.exe`
- `~/Desktop/ClaudeConfigManager-M1/ClaudeConfigManager-M1.2-platform-abstractions.exe`
- `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.1-provider-list.exe`

slug 用 kebab-case 短描述本次任务（如 `scaffold` / `platform-abstractions` / `provider-list`）。

### 9.3 Build 类型
- **M1.x（架构期）**：Dev build（快，5-10 分钟），含调试信息
- **M2.x 及以后**：Dev build（功能迭代期）+ 里程碑结束额外做 1 次 Release build（验证打包链路）

### 9.4 Smoke Test（cp 到桌面之前必过）
subagent 生成 exe 后必须跑 4 项验证，全部通过才 cp：
1. ✅ 启动 exe → 进程在 5 秒内运行
2. ✅ 检测到主窗口（用 PowerShell `Get-Process` + 窗口标题判断）
3. ✅ 检测到托盘图标（用 `[System.Windows.Forms.SystemInformation]::UserInteractive` 或枚举 NotifyIcon）
4. ✅ 进程清理：`taskkill /F /IM ClaudeConfigManager.exe` 后 2 秒内进程消失

如果 4 项任一失败 → **不要 cp 到桌面**，回到任务修复后重跑。

### 9.5 用户核定
- cp 到桌面后，**等待用户明确"完成"或"未完成：<原因>"**
- 未经核定不能进下一个迭代
- 核定记录写入 `STATE.md`（迭代号 / 日期 / 用户反馈 / 下一步）

### 9.6 实现位置
- **统一脚本**（在 `scripts/` 目录）：
  - `scripts/build-only.sh` — 仅编译（debug/release/check/clean）
  - `scripts/smoke-test.sh` — 单独 smoke test
  - `scripts/kill-app.sh` — 关闭进程（优雅或 force）
  - `scripts/build-and-ship.sh` — 完整 build + smoke + cp 到桌面
- **build-and-ship.sh 接收参数**：`--milestone M1 --task 1.1 --slug scaffold`
- **build-and-ship.sh 职责**：build → copy exe + WebView2Loader.dll → smoke test → 输出报告
- **WebView2Loader.dll 必须跟 exe 一同 cp**：Tauri debug build 不会自动放置，bundler 才处理

### 9.7 脚本使用流程
```bash
# 1. 关闭可能残留的旧进程
./scripts/kill-app.sh

# 2. 编译（dev 周期内迭代用）
./scripts/build-only.sh

# 3. smoke test（手动验证某个已存在的 exe）
./scripts/smoke-test.sh src-tauri/target/debug/claude-config-manager.exe

# 4. 一键 build + smoke + cp 到桌面（每次迭代完成用）
./scripts/build-and-ship.sh --milestone M1 --task 1.1 --slug scaffold
```

## 10. 不要做

- ❌ 不要修改 `./SPEC.md`（实现唯一参考）
- ❌ 不要在业务代码里散落 OS 判断
- ❌ 不要"边写边想"——架构设计先行
- ❌ 不要"先写完代码回头补测试"——TDD 强制
- ❌ 不要"依赖不行就换版本"——读文档先
- ❌ 不要修改 `.planning/research/` 下的研究产物（决策依据）
- ❌ 不要超过 1 小时不 commit——M1 必须原子提交
- ❌ 不要在没确认的情况下删除文件——尤其是 .planning/ 和 src/
- ❌ 不要跳过 smoke test 直接 cp exe 到桌面
- ❌ 不要在用户没核定前进入下一迭代
- ❌ **不要主 session 亲自执行开发任务**（编译 / 安装依赖 / 写代码 / 跑命令）—— 全部派 subagent

## 11. 主 session 工作流约束

### 11.1 角色分工
- **主 session**：只做决策 + 任务分配 + 接收 subagent 成果
- **Subagent**：执行具体开发任务（编译 / 安装依赖 / 写代码 / 跑命令 / 改文件）

### 11.2 并发上限
- **最多同时开 4 个 subagent**
- 超过 4 个时主 session 必须等其中一个完成再派新的

### 11.3 增量派单（流式）
- 不要等所有 subagent 全部完成才重新分配
- **每收到一个 subagent 完成通知**，立即评估：
  1. 该 subagent 的产出是否成功？
  2. 有没有阻塞下游任务？
  3. 能否派下一个 subagent？
- 如果 subagent 失败 → 决定是修复重派 / 换方案 / 跳过
- 流式派单的目标：**最大化 4 槽利用率，减少主 session 空等时间**

### 11.4 派单前检查
每次派 subagent 前，主 session 评估：
- [ ] 任务边界清晰（不是模糊的"做这个功能"）
- [ ] subagent 类型匹配（general-purpose / Explore / gsd-* 等）
- [ ] 上下文已塞进 prompt（不依赖主 session 私有信息）
- [ ] 不违反本 CLAUDE.md 的任何规则

### 11.5 派单后行为
派完 subagent 后：
- 主 session **不要亲自执行任何 shell / file 操作**
- 等 subagent 完成（可能数分钟，silence is normal）
- 收到完成通知后立即分析 + 决定下一步

### 11.6 决策门槛
主 session 的决策分为两类：
- **必须问用户**：技术栈选型 / 架构重大分歧 / 是否进入下一迭代 / SPEC 冲突解决 / 大范围返工
- **可自主决定**：单文件命名 / 单函数签名 / 局部重构 / 单条命令 / 单元测试细节

### 11.7 用户核定未到 → 不派 ship 类 subagent (M3.0.3 lesson)
§9.5 要求"未经核定不能进下一迭代"。主 session 必须 enforce：
- 收到 ship subagent 完成回报后 → **不要立即派下一个 build/ship/dist-touching subagent**
- 等用户明确 "完成" 或 "未完成：<原因>" 后再决定下一步
- 即使是"修复已知 bug"也属于下一迭代（如本会话 M3.0.3 → M3.0.3-fix-v2）

**反事故**：本会话主 session 在 M3.0.3 未核定时就派了 M3.0.3-fix-v2 build subagent，违反了 §9.5 精神。

## 12. 编译性能 (M3.0.3 调研产出，2026-06-24)

### 12.1 当前基线
- `cargo build --release`: ~3m30s (Tauri v2 + 30+ Rust crate + windows-gnu toolchain 是瓶颈)
- `vite build`: ~4s (TSC check + Vite bundle)
- `cp + smoke test`: ~5s
- **合计: ~3m40s**
- 调研报告: `tmp/build-perf-investigation.md`

### 12.2 加速方案 A — sccache (推荐，已实施)
**原理**：rustc-wrapper 把每次 cargo 编译的 .rlib 输出 hash 到磁盘缓存，重复 crate 链直接命中。

**步骤**：
```bash
cargo install sccache --locked
# ~/.cargo/config.toml 追加（用户级，不污染项目）
cat >> ~/.cargo/config.toml << 'EOF'

[build]
rustc-wrapper = "sccache"
EOF
```

**预期收益**：
- 首次 build (cold cache)：不变（需预热）
- 二次起 build (warm cache)：**-50~70%**（3m30s → 90-120s）
- 改 1-2 行 Rust 后的增量 build：**-80%+**（只重编译变更 crate + 下游）

**回滚**（30 秒回原状）：
```bash
# 编辑 ~/.cargo/config.toml，注释 [build] 块，或设 RUSTC_WRAPPER=""
RUSTC_WRAPPER="" cargo build --release
```

**风险**：低（用户级配置，零项目污染；Windows 兼容 sccache 0.7+）。

### 12.3 加速方案 B — lld linker (中期评估中，未实施)
**原理**：用 lld 替换默认 link.exe，跳过 MSVC 链接器瓶颈。
**收益**：link 阶段再砍 50~70%。
**成本**：装 LLVM ~300MB + 改 `.cargo/config.toml`（项目级，需用户白名单）。
**状态**：本会话调研完成，未实施；待评估。

### 12.4 加速禁忌
- ❌ **不要 cargo profile 调优**（`Cargo.toml` `[profile.release]` 改 codegen-units / LTO）— 违反 §2.3 版本锁纪律精神，且收益小
- ❌ **不要在 ship 流程切 dev build** — 违反 §9.3，dev build 有 conhost 黑窗（M1.1 时代 user 已反馈）
- ❌ **不要并行跑 cargo build** — webview2-com 静态链接 + 进程内 mutex 锁会冲突，cargo 自带 -j 调度足够
- ❌ **不要用 cargo-zigbuild / cross** — 本项目不是交叉编译场景，徒增工具链复杂度

## 13. Build Pipeline Regression Classes (smoke test 10 项的 why)

### 13.1 4 项 → 10 项的演进 (M1.3 lesson)
**原 4 项 smoke test**（进程运行 / 主窗口 / 托盘 / kill 干净）能通过但**实际页面是空白**：
- M1.3 era：用户报告 exe 启动后白屏 / ERR_CONNECTION_REFUSED，smoke test 仍 PASS
- **根因**：`cargo build --release` 没加 `--features tauri/custom-protocol`，`tauri::generate_context!()` 退化为 `EmbeddedAssets::default()`，webview 加载 vite dev server (1420 端口) → dev server 没起 → ERR_CONNECTION_REFUSED

**修复 + 扩展**：
1. `cargo build --release --features tauri/custom-protocol` (M1.3-fix-v2)
2. M2.17-C3 切到 `tauri build --no-bundle`（自动跑 beforeBuildCommand = `npm run build` + 自动 enable custom-protocol，根除 stale-dist / dist-not-embedded 失败模式）
3. smoke test 从 4 项扩到 **10 项**，覆盖 4 类 build regression：
   - launch / window / webview / title (进程 + UI 可达)
   - **assets** (dist fingerprint grep PE) — 抓 stale dist
   - **db_exists / schema / queryable** (SQLite 状态) — 抓迁移失败
   - tray / kill (生命周期)

**反事故**：smoke test PASS ≠ exe 可用。任何 ship 前 subagent 必须跑完 10 项。

### 13.2 手工 cargo build 时的隐藏陷阱
如果你手动跑 `cargo build --release`（不通过 `tauri build`）：
- 必须加 `--features tauri/custom-protocol`，否则 dist 不嵌入 PE，webview 加载 vite dev server → ERR_CONNECTION_REFUSED
- 不要 `cargo build --release -p claude-config-manager` 单包编译 — Tauri build.rs 需要 workspace 信息，单包编译会 break

**正确做法**：本项目所有 release build 都走 `scripts/build-and-ship.sh`（内部 `tauri build --no-bundle`），不直接 cargo build。

## 14. Subagent 行为禁区 (M3.0.3 sccache subagent 违反案例)

### 14.1 禁止擅自 commit / push / tag / 改全局配置
subagent 完成任务后**不得**：
- ❌ `git add` + `git commit`（即使只是 `tmp/` 下的报告文件）
- ❌ `git push` / `git tag` / `git branch`
- ❌ 改 `~/.cargo/config.toml` / `~/.bashrc` / 任何用户级配置（即使是"加速"用途）
- ❌ 装全局工具 `cargo install xxx` / `npm install -g xxx`

**正确流程**：subagent 完成 → 回报主 session → 主 session 列白名单 → 用户确认 → 主 session 自己 commit / 自己改全局配置，**或**显式批准 subagent 执行并指定精确命令。

**反事故**：本会话 sccache subagent 自行 `git add tmp/sccache-install-verify.md && git commit`（commit `645680b`）— 违反本条。回滚命令：`git reset --soft HEAD~1`（保留工作区）或 `git reset --hard HEAD~1`（彻底回滚）。

### 14.2 用户核定未到 → 不派 ship 类 subagent
见 §11.7。ship 类 subagent 定义：任何会修改 `dist/` / `target/release/` / 桌面 exe / `Cargo.lock` / `package-lock.json` 的 subagent。

---

*本文件由 Claude Code 在 M1 启动时自动写入。修改需要明确理由并记录在 commit message。*