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

## 9. 迭代交付纪律

> 已迁移到 [CLAUDE-WORKFLOW.md](./CLAUDE-WORKFLOW.md).

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

> 已迁移到 [CLAUDE-WORKFLOW.md](./CLAUDE-WORKFLOW.md).

## 12. 编译性能 (M3.0.3 调研产出，2026-06-24；macOS 适配 2026-06-25)

### 12.1 当前基线 (跨平台)

**冷启动 (无 sccache)**：

| 步骤 | Windows | macOS |
|---|---|---|
| `cargo build --release` | ~3m30s (windows-gnu toolchain + 30+ Rust crate) | ~2m30s (apple-darwin clang + wry/wkwebview 链略轻) |
| `vite build` | ~4s | ~4s |
| `cp + smoke test` | ~5s (10/10) | N/A (smoke test 待 M4 改造) |
| **合计** | **~3m40s** | **~2m40s** |

**sccache 启用后实测** (macOS dev box, 2026-06-25)：

| 场景 | 耗时 | vs 冷启动 |
|---|---|---|
| Cold cache（清缓存首次 build） | 51.0s | 基线 |
| Warm cache（复用缓存二次 build） | 40.4s | **-21%** |
| 增量 build（改 1-2 行 Rust） | 1.82s | **-96%** |

> 注：实测是 `cargo check` 而非 `cargo build --release`（避免 link 阶段混入噪音），trend 与调研报告预测的 -50~70% 一致方向但更保守——WIP 仍把调研报告数字作为"理想上限"参考。Windows / Linux 实测待补。

**跨平台 sccache 配置**（统一走项目级，macOS / Windows 行为一致）：见 §12.2 + CLAUDE-MACOS.md §15.9。

### 12.2 加速方案 A — sccache (推荐，已实施)
**原理**：rustc-wrapper 把每次 cargo 编译的 .rlib 输出 hash 到磁盘缓存，重复 crate 链直接命中。

**配置**（项目级，跨平台统一路径）：
- `src-tauri/.cargo/config.toml` 配 `[build] rustc-wrapper = "sccache"`（项目级 → merge / override 全局 `~/.cargo/config.toml` 同名段，不污染其他项目）
- 缓存目录：`$SCCACHE_DIR = ~/Library/Caches/sccache-claude-config-manager`（macOS 默认 `~/Library/Caches/sccache`；项目专属避免跨项目混淆 + 体积叠加）
- 容量上限：`SCCACHE_CACHE_SIZE=5G`（sccache 默认 10G 容易把磁盘撑爆，主动限；当前实测缓存 ~155 MiB / 5 GiB 上限）
- `scripts/build-mac.sh` 顶部 self-check：装了 sccache 则 export env + echo INFO 行；未装 echo WARN 行 + 跳过（**不阻断 build**，跟 `scripts/clean-cache.sh` 容忍 `cargo-sweep` 缺失的哲学一致）
- 手动跑 `cargo check` / `cargo build` 也走相同 wrapper（环境变量在脚本顶部 export，shell session 内全程生效）

**步骤**（跨平台，首次启用）：
```bash
# 1. 装 sccache (sccache 0.16.0+)
cargo install sccache --locked
# 或 macOS: brew install sccache

# 2. 项目级 config 已就位 (src-tauri/.cargo/config.toml),
#    不用再动 ~/.cargo/config.toml。

# 3. 预热缓存 (首次 cargo build 即写入,无需手动预热)
cd src-tauri && cargo build --release

# 4. 验证 (Cache hits rate (Rust) 应接近 100%)
sccache --show-stats
```

**实测收益** (macOS, 2026-06-25)：
- 首次 build (cold cache)：51.0s（基线无加速）
- 二次 build (warm cache)：40.4s（**-21%**）
- 改 1-2 行 Rust 后的增量 build：1.82s（**-96%**，仅重编译变更 crate + 下游）

**回滚**（10 秒回原状）：
```bash
# 删项目级 config 即停用 wrapper,不动全局 ~/.cargo/config.toml,
# 本机其他项目不受影响。
rm src-tauri/.cargo/config.toml
# 或临时绕过 (单次 build):
RUSTC_WRAPPER="" cargo build --release
```

**风险**：低
- 项目级 config 不污染全局；本机其他项目可独立配自己的 `~/.cargo/config.toml` wrapper
- sccache 0.7+ 跨 Windows / macOS / Linux 兼容（macOS Apple Silicon 注意用 sccache 0.7+ 解决 sandbox 缓存路径问题）
- 未装 sccache 也能 build（wrapper 不存在 → cargo 退化为普通编译，self-check 容忍缺失）

**反事故**：sccache 启用后，**改 sccache 配置前需 `pkill sccache`**——server 启动时读 `SCCACHE_DIR` / `SCCACHE_CACHE_SIZE`，运行中改 env 不会被旧 server 拾取（详见 §12.4 末条 + CLAUDE-MACOS.md §15.9）。

### 12.3 加速方案 B — lld linker (Windows link.exe / macOS ld64 替换)
**原理**：用 lld 替换默认 link.exe（Win）或 ld64（mac），跳过 OS 自带链接器瓶颈。

| 平台 | 替换目标 | 成本 |
|---|---|---|
| Windows | `link.exe` → `lld-link.exe` (LLVM) | 装 LLVM ~300MB + 改项目 `.cargo/config.toml`（项目级，需白名单）|
| macOS | `ld64` → `zld` 或 `mold` | `brew install mold` ~10MB；改 `~/.cargo/config.toml` 用户级 OK |

**收益**：link 阶段再砍 50~70%。
**状态**：本会话调研完成，未实施；待评估。

### 12.4 加速禁忌 (跨平台)
- ❌ **不要 cargo profile 调优**（`Cargo.toml` `[profile.release]` 改 codegen-units / LTO）— 违反 §2.3 版本锁纪律精神，且收益小
  - **例外**：长期治理场景（target/ 缩体积）允许 dev/release profile 调优（见 §15.5），但需用户白名单
- ❌ **不要在 ship 流程切 dev build** — 违反 §9.3，dev build 有 conhost 黑窗（M1.1 时代 user 已反馈）
- ❌ **不要并行跑 cargo build** — webview2-com 静态链接 + 进程内 mutex 锁会冲突（Win）；macOS wry+WKWebView 也类似（WKWebView 进程内 IPC），cargo 自带 -j 调度足够
- ❌ **不要用 cargo-zigbuild / cross** — 本项目不是交叉编译场景，徒增工具链复杂度
- ⚠️ **macOS 专属禁忌**：
  - ❌ 不要用 `sudo xcode-select` 改 CLT 默认值，会破坏其他项目
  - ❌ 不要在 macOS 跑 cargo build 时手动 `RUST_LOG=trace`（性能掉 50%，仅 debug 用）
  - ✅ macOS 上 `cargo build --release` 默认用 Apple clang，不需额外装 gcc/clang
  - ❌ **不要在 sccache server 已在跑时改 `SCCACHE_DIR` / `SCCACHE_CACHE_SIZE` env** — server 启动时一次性读 env，运行时改不会被旧 server 拾取，导致新配置"看似生效"但实际仍写旧路径。要么改前 `pkill sccache` 重启 server，要么确认新 build 触发了 server 重启（详见 CLAUDE-MACOS.md §15.9）

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

**macOS smoke test**（M4 阶段补）：目前仅 Windows 上跑 10/10 项。macOS 上的 WKWebView child window 枚举无 CLI 等价，需 Rust IPC 加 `get_webview_children_count` 命令（详见 §15.4）。

### 13.2 手工 cargo build 时的隐藏陷阱 (跨平台)

**Windows**：
- 必须加 `--features tauri/custom-protocol`，否则 dist 不嵌入 PE，webview 加载 vite dev server → ERR_CONNECTION_REFUSED
- 不要 `cargo build --release -p claude-config-manager` 单包编译 — Tauri build.rs 需要 workspace 信息，单包编译会 break

**macOS**：
- 必须用 Xcode Command Line Tools（`xcode-select --install`），否则 rustc 找不到 clang
- 第一次 cargo build 链 `wry` / `tao` 时会**重新编译 objc / cocoa / core-foundation** 等 macOS-only crate（来自 wry 传递依赖），耗时 ~5-8 分钟（仅首次）
- `tauri build --no-bundle` 在 macOS 上同样适用，会自动跑 `beforeBuildCommand`
- **不要** `cargo build --target x86_64-apple-darwin` 从 Windows 跨编译 macOS（缺 macOS SDK + codesign 工具链，**不可行**）；如需在 mac 上构建，必须真机跑

**正确做法**：本项目所有 release build 都走 `scripts/build-and-ship.sh`（内部 `tauri build --no-bundle`），不直接 cargo build。

## 14. Subagent 行为禁区

> 已迁移到 [CLAUDE-WORKFLOW.md](./CLAUDE-WORKFLOW.md).

## 15. macOS 开发约束

> 已迁移到 [CLAUDE-MACOS.md](./CLAUDE-MACOS.md).

---

*本文件由 Claude Code 在 M1 启动时自动写入。修改需要明确理由并记录在 commit message。*
