# M1 架构期总览（Architecture Milestone Summary）

> 范围：M1.1 → M1.9.2（含子修复）。
> 周期：2026-06-18（fa02b41 M1.1 起）→ 2026-06-20（04395dd M1.9.2-test-refine 收尾）。
> 状态：架构期主线完成；M1.10/M1.11/M1.12 待启动（见末尾 TODO 列表与 M2 路线图草案）。

---

## 1. 关键数字

| 指标 | 值 | 说明 |
|---|---|---|
| 总 commit 数 | 47（master HEAD 04395dd） | 包含 12 个里程碑子任务 + 7 个修复 / smoke 改进 / pipeline fix |
| M1 主题 commit（`M1.*` 前缀） | 43 | 余 4 个为 pipeline / smoke / kill-app fix |
| 总 ship exe（桌面） | 13 个 | `~/Desktop/ClaudeConfigManager-M1/`，最新 `ClaudeConfigManager-M1.9.2-chrome-and-glass.exe` |
| Vitest 用例 | 61（8 文件全绿） | 见 §6 测试明细 |
| Playwright e2e 用例 | 6（3 文件） | launch / tray / close-minimize |
| Rust `#[test]` 函数 | 60（unit + integration） | DLL load 限制，本机 `cargo test` 走不通，CI 走 MSYS2 跑通 |
| TS / TSX 代码行数 | 3,025 | `find src -name "*.ts*" | xargs wc -l` |
| Rust 代码行数 | 2,832 | `find src-tauri/src -name "*.rs" | xargs wc -l` |
| 设计系统 CSS 行数 | 126 | `src/design-system/tokens.css` |
| 集成测试行数 | 415 | `src-tauri/tests/` |
| Shell 脚本行数 | 716 | `scripts/` (4 个：build-only / smoke-test / kill-app / build-and-ship) |
| SPEC.md 行数 | 1,434 | 实现唯一参考 |

---

## 2. M1.1 — M1.9.2 子任务时间线

| # | 子任务 | 关键 commit | Ship exe | 用户核定 |
|---|---|---|---|---|
| M1.1 | Tauri v2 scaffold + tray + minimize-to-tray | `fa02b41` (init), `e0e9efe` (scripts), `2914342` (release) | `ClaudeConfigManager-M1.1-scaffold-release.exe` | ✅ 2026-06-19 00:26:16 |
| M1.1-fix | release build 切换（去 console 窗口） | `503f5c2` | `ClaudeConfigManager-M1.1-scaffold-release.exe` | 已合入 M1.1 |
| M1.2 | OS 抽象层（8 traits × Win + Mac stubs） | `13290b3` | `ClaudeConfigManager-M1.1.2-platform-abstractions.exe` | ⏳ 待审 |
| M1.3 | Plugin host + 12 stubs（前端 + 后端） | `77e070a` | `ClaudeConfigManager-M1.1.3-plugin-host.exe` | ⏳ 待审 |
| M1.3-fix | stale dist 重新嵌入（touch lib.rs） | `050eac8` | `ClaudeConfigManager-M1.1.3-plugin-host-fix.exe` | ✅ 已 fix |
| M1.3-fix-v2 | `--features tauri/custom-protocol` | `50abbe6` | `ClaudeConfigManager-M1.1.3-plugin-host-fix-v2.exe` | ✅ 已 fix |
| M1.3-fix-v3 | viewport meta + CSS reset（去滚动条） | `038aa4f` | `ClaudeConfigManager-M1.1.3-plugin-host-fix-v3.exe` | ⏳ 待审 |
| M1.4 | Tauri capabilities + WHY 注释 | `cc47b7d` | `ClaudeConfigManager-M1.1.4-platform-plugins-capabilities.exe` | ⏳ 待审 |
| M1.8 | TDD + Playwright + CI | `6814a7a` | `ClaudeConfigManager-M1.1.8-tdd-scaffold.exe` | ⏳ 待审 |
| smoke-test 升级 | WebView2 child window 检查 + 标题验证 | `b53693f` | (并入 M1.3 fix-v3) | ✅ |
| kill-app fix | `-F` 而非 `/F` | `dd4456b` | (脚本层修复) | ✅ |
| M1.5 | 前端 deps + 设计系统基线（瓷白主题） | `5b46d51` (deps), `3343db5` (tokens import), `e44972e` (cn util), `16c90ae` (ThemeProvider), `be955c3` (wire) | (无独立 exe，与 M1.9 合并 ship) | ⏳ 待审 |
| M1.6 | Rust deps 版本锁（10 个 tauri-plugin-*） | `0397b43` (deps), `875b300` (register), `6beeff8` (caps), `92a80b3` (lock) | (无独立 exe) | ⏳ 待审 |
| M1.7 | 自启动集成（tauri-plugin-autostart） | `bb8e873` (err), `de8fffa` (platform rewrite), `8a1f48a` (commands), `bda412f` (updater pubkey) | `ClaudeConfigManager-M1.1.7-chrome-with-autostart.exe` | ⏳ 待审 |
| M1.9 | 主窗口框架 + 12 路由占位 | `13ff10a` (useViewState), `cb586a7` (placeholder + 12 pages), `6e27b71` (header + sidebar), `0de4713` (App route), `3186043` (framer-motion), `67cb23f` (TS fix) | (并入 M1.9.x 序列) | ⏳ 待审 |
| M1.9.1 | 滚动布局修复（html/body reset + min-h-0） | `56f716f` (test), `cf0f8b6` (refine), `f98f45a` (fixA), `e3533ff` (fixB) | `ClaudeConfigManager-M1.9.1-scroll-layout-fix.exe` | ⏳ 待审 |
| M1.9.2 | 自定义 chrome + Liquid Glass | `13076bc` (test), `6737fd3` (scroll), `e5b0d92` (window controls), `63a096c` (tauri.conf), `f4bffca` (tokens), `ac94f11` (apply), `b716b01` (effects), `28abeed` (caps), `04395dd` (refine) | `ClaudeConfigManager-M1.9.2-chrome-and-glass.exe` | ⏳ 待审 |

> M1.5 / M1.6 / M1.7 / M1.9 / M1.9.1 / M1.9.2 全部已落地代码 + commit，但用户尚未逐个核定 exe。架构层变更无独立"产品差异"展示面，建议由主 session 一次性 batch approve 后再启动 M2。

---

## 3. 关键决策（从 `.planning/HANDOFF.json` decisions 段摘录）

| # | 决策 | 阶段 |
|---|---|---|
| 1 | Tauri v2 > Electron / Flutter Desktop / MAUI / Avalonia / Wails / Qt | M1-pre |
| 2 | M1.x ship 用 release build（PE subsystem = GUI，无 console 残留） | M1.1-fix |
| 3 | `cargo build --release --features tauri/custom-protocol` 替代 `tauri build` | M1.3-fix-v2 |
| 4 | smoke test 必须有结构性标记（WebView2 child window + dist fingerprint grep），不能只看 process alive | M1.3-fix |
| 5 | CLAUDE.md 放项目根（非全局 memory） | M1-pre |
| 6 | M1.4 capabilities 的 WHY 注释用顶层 description 字段（JSON 无注释语法） | M1.4 |
| 7 | macOS impls 编译期 stub + Windows impl 真实跑（无 cross-compile） | M1.2 |
| 8 | 12 plugin stubs 渲染"该功能将在 M2+ 开发 (plugin: {id})"占位 | M1.3 |
| 9 | Subagent 并发上限 4（CLAUDE.md §11.2） | M1-cross |
| 10 | M1.9 视图路由用 `useViewState` + localStorage 而非 react-router（单窗格 + 不需要 URL 状态） | M1.9 |

> 完整 10 条 + 每条 rationale 见 `.planning/HANDOFF.json::decisions`。

---

## 4. 关键教训（M1 范围内的反复与修正）

| 教训 | 触发 commit | 复用条目 |
|---|---|---|
| **Tauri release build 必须显式 `--features tauri/custom-protocol`** —— 否则 `tauri::generate_context!()` 嵌入空 dist，runtime 走 devUrl → ERR_CONNECTION_REFUSED | `50abbe6` | `feedback/tauri-v2-custom-protocol-required` |
| **Release build 跳过 relink if Rust source 未变** —— dist 改了但 cargo 看 `src-tauri/**` mtime 没变就不重链 | `050eac8` | M1.10 计划：beforeBuildCommand 原子化（npm run build + cargo build --release） |
| **html/body/#root 没 reset → 浏览器默认 8px margin + 高度塌陷 → 滚动条** | `038aa4f`, `f98f45a` | 设计系统 tokens.css 顶部内置 reset，注释里写明副作用 |
| **framer-motion AnimatePresence + Tailwind 必须锁定到 patch 版本**（CLAUDE.md §2.3） | `3186043` | `framer-motion 12.23.25` 精确锁 |
| **Git Bash `taskkill /F` → msys 把 `/F` 转 `F:/`** —— 必须 `-F` | `dd4456b` | `feedback/taskkill-dash-flags-not-slash` |
| **Tauri single-instance plugin 必须开 `deep-link` feature** 才能与 F4 联动 | `0397b43` | `tauri-plugin-single-instance = { version = "=2.4.2", features = ["deep-link"] }` |
| **macOS impls 不上 CI（无 mac runner）** —— 用 `#[cfg(target_os)]` stub 满足 trait object-safe | `13290b3` | 业务代码永远 `Box<dyn IPlatformXxx>`，不直接 `#[cfg]` |
| **滚动布局**：`<main>` 必须 `overflow:auto`（不是 `hidden`），同时外层 `overflow:hidden` 才能把滚动条关进窗格内部 | `13076bc`, `6737fd3` | `src/__tests__/integration/m1-9-2.test.tsx` 锁住契约 |
| **Custom chrome + Mica**：M1 阶段 CSS `backdrop-filter` + `setEffects(Mica)` 优雅降级（旧 Win10 / 旧 macOS 静默 no-op） | `b716b01`, `ac94f11` | `src/design-system/applyEffects.ts` fire-and-forget |
| **Tailwind 未接** —— M1.9 直接用 framer-motion + CSS var()，没走 Tailwind utility class，tokens.css 集中管理颜色 / 间距 / 字体 | （M1.9 选型决定） | M2 评估：是否补 Tailwind config / shadcn/ui 接入 |

---

## 5. 架构落地清单（CLAUDE.md §3 对照）

### 5.1 分层（src-tauri/src）

```
lib.rs                        # 入口：plugin 注册 + tray + close handler + platform init
main.rs                       # tauri::Builder 启动
commands/autostart.rs         # M1.7 Tauri command 表面（get/set）
platform/
  traits.rs                   # 8 个 IPlatform* trait + AppPaths/WindowChromeOptions
  mod.rs                      # runtime::paths() / single_instance() / autostart() / ... 工厂
  windows/                    # WindowsPaths / SingleInstance / Autostart / Reveal / Notifier / AppMenu / WindowChrome / Git
  macos/                      # MacPaths / ... 编译期 stub（unimplemented!()）
plugins/
  traits.rs                   # IPlugin + PluginRoute + PluginService + PluginContext
  host.rs                     # PluginHost：register / unregister / init_all / shutdown_all
  stubs/                      # 12 个 stub（provider_list / switch / import_sql / deeplink / json_editor / mcp / usage / single_file / resource_browser / marketplace / optimizer / backup_restore）
```

### 5.2 插件系统（IPlugin trait）

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

- 后端注册：`src-tauri/src/plugins/mod.rs::init_all`（尚未实现 — plugin stubs 只导出结构体，等 M2 接入 PluginHost）
- 前端注册：`src/plugins/registry.ts::ALL_PLUGINS`（12 个，已接 App.tsx）

### 5.3 前端结构（src/）

```
main.tsx                      # React 入口 + ThemeProvider 包裹
App.tsx                       # 根布局 + useViewState 路由 + AnimatePresence 转场
design-system/
  tokens.css                  # 瓷白主题 + reset + Liquid Glass token
  ThemeProvider.tsx           # light/dark/auto + localStorage
  applyEffects.ts             # Tauri setEffects(Mica) bootstrap
components/
  AppHeader.tsx               # 拖拽区 + 标题 + WindowControls
  AppSidebar.tsx              # 12 项导航
  PluginPlaceholder.tsx       # 占位组件（"该功能将在 M2+ 开发"）
  WindowControls.tsx          # minimize/maximize/close 按钮
hooks/
  useViewState.ts             # view 状态 + localStorage 持久化
lib/
  utils.ts                    # cn() = clsx + tailwind-merge
plugins/
  registry.ts                 # 12 plugin 注册入口
  types.ts                    # FrontendPlugin / RouteDef / NavItem
  stubs/                      # 12 个 stub（mod.ts barrel）
pages/                        # 13 个页面（home + F1..F12 占位）
__tests__/                    # 8 文件 61 用例
```

---

## 6. 测试覆盖明细

### 6.1 Vitest（61 用例 / 8 文件 / 全绿）

| 文件 | 用例 | 覆盖目标 |
|---|---|---|
| `design-tokens.test.ts` | 2 | tokens.css 包含 §4.2 配色 / 状态色 |
| `lib/cn.test.ts` | 5 | `cn()` clsx + tailwind-merge |
| `hooks/useViewState.test.ts` | 10 | view 状态 + localStorage + 边界 |
| `design-system/ThemeProvider.test.tsx` | 7 | light/dark/auto + system 跟随 |
| `plugin-registry.test.ts` | 5 | 12 plugin 注册一致性 |
| `integration/scroll-layout.test.tsx` | 7 | M1.9.1 滚动布局（Bug A/B 回归） |
| `integration/m1-9-2.test.tsx` | 14 | M1.9.2 chrome + glass + scroll + effects 契约 |
| `integration/App.test.tsx` | 11 | App 路由 + 12 sidebar + home tile grid + 持久化 |

> 实测命令：`npx vitest run` → `Test Files 8 passed (8) / Tests 61 passed (61) / Duration 13.98s`

### 6.2 Playwright e2e（6 用例 / 3 文件）

| 文件 | 用例 | 覆盖路径 |
|---|---|---|
| `tests/e2e/launch.spec.ts` | 2 | 启动 → 主窗口标题 + heading 可见 |
| `tests/e2e/tray.spec.ts` | 2 | 托盘存在 + 菜单项 |
| `tests/e2e/close-minimize.spec.ts` | 2 | 关闭按钮 → 隐藏到托盘；进程不退出 |

> e2e 跑通需 `tauri-driver` + 实际启动 exe，CI 矩阵跑（`windows-latest` + 未来 `macos-latest`）。本机 dev box 未实际跑过 e2e。

### 6.3 Rust 测试（60 #[test] / unit + integration）

| 模块 | 用例 |
|---|---|
| `src-tauri/src/platform/traits.rs` | 14（trait object-safe + mockall dispatch） |
| `src-tauri/src/plugins/host.rs` | 10（register / unregister / init order / shutdown order） |
| `src-tauri/src/platform/windows/*.rs` | 17（每个 impl 1-5 个） |
| `src-tauri/src/commands/autostart.rs` | 2（compile-time signature check） |
| `src-tauri/tests/platform_paths.rs` | 7（integration：resolve + ensure_dirs） |
| `src-tauri/tests/plugin_host.rs` | 11（integration：host lifecycle + error paths） |

> **环境注意**：本机 `cargo test` 走 lib-test 时遇到 `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)` —— Windows DLL forwarding 问题。CI 用 MSYS2/MINGW64 跑通（`.github/workflows/ci.yml` 步骤 "Run integration tests directly"），dev box 跑不通是已知环境限制，不是代码缺陷。

---

## 7. CI / 构建矩阵

`.github/workflows/ci.yml` 已配：
- **Rust 单元 + 集成测试**：`windows-latest`，MSYS2 + MinGW64 toolchain + `cargo test --no-default-features --no-run` + 逐个 integration test
- **TS 类型检查 + Vitest**：未在 ci.yml 中（M1.10 TODO）—— 应加 `npm run build` + `npm test`
- **Playwright e2e**：未在 ci.yml 中（M1.10 TODO）—— 应加 `npm run test:e2e` + tauri-driver setup
- **macOS runner**：暂未启用（CLAUDE.md §3.2 要求 macOS 实现 + 真机 CI；待 mac dev box 接入）
- **签名 + 公证**：未启用（M3 阶段）

构建脚本（`scripts/`）：
- `build-only.sh`（89 行）：debug / release / check / clean
- `build-and-ship.sh`（164 行）：build → smoke → cp to desktop（参数 `--milestone / --task / --slug`）
- `kill-app.sh`（75 行）：优雅 + force 关闭
- `smoke-test.sh`（388 行）：7 项断言（process / 主窗口 / 托盘 / cleanup / WebView2 child window class / 标题验证 / dist fingerprint grep）

---

## 8. 文档清单

| 文档 | 位置 | 行数 | 状态 |
|---|---|---|---|
| CLAUDE.md（项目规则） | `CLAUDE.md` | 305 | ✅ 与 M1.11 同步 |
| SPEC.md（产品/设计规格） | `SPEC.md` | 1,434 | 🔒 不可修改 |
| STATE.md（里程碑进度） | `.planning/STATE.md` | 75 | ✅ 持续更新 |
| HANDOFF.json（任务历史 + decisions） | `.planning/HANDOFF.json` | 62 | ⚠️ 已 stale（未跟踪 M1.5~1.9.2 子任务；M1.12 待补） |
| ARCHITECTURE.md | `docs/ARCHITECTURE.md` | — | ❌ M1.11 待启动（M1.11 任务描述要求产出） |
| AGENTS.md | `AGENTS.md` | — | ❌ M1.11 待启动 |
| tokens.css（设计系统基线 + 注释） | `src/design-system/tokens.css` | 126 | ✅ 含 §4 + Liquid Glass + reset 注释 |

---

## 9. 待办（M1.10 / M1.11 / M1.12 + M2 启动）

- [ ] **M1.10**：构建 / 打包 / 签名 / CI 矩阵完善（加 npm test + npm run test:e2e 到 ci.yml；macOS runner；beforeBuildCommand 原子化）
- [ ] **M1.11**：CI 完善 + 框架不变量文档（ARCHITECTURE.md / AGENTS.md / 三阶段评审）
- [ ] **M1.12（本任务已完成总结部分）**：最终复审 + STATE.md 收尾 + M2 路线图草案
- [ ] **M2 启动候选**：F1 Provider 列表 / F2 切换 / F5 JSON 编辑 / F6 MCP 管理（详见 `docs/milestones/M2-roadmap-draft.md`）
- [ ] **batch 核定**：M1.2 / M1.3 v3 / M1.4 / M1.5~1.9.2 全部 exe 待用户一次性 batch approve

---

*本文件由 M1.12 子代理在 worktree `agent-a31f4ddce79088ee7` 生成，主 session 决策后再合并入 master。*