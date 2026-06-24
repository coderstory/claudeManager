# 前端 + 构建链 macOS 审计 (2026-06-24)

> 审计范围: `D:/project/winui3/src/` (React/TS 前端), `package.json`,
> `vite.config.ts`, `tsconfig.json`, `.npmrc/.nvmrc`, `index.html`,
> `src-tauri/tauri.conf.json`, `.github/workflows/release.yml` + `ci.yml`,
> `src-tauri/icons/`.
> 仅产出报告, 未修改任何文件。

---

## 1. OS 判断点 (前端代码)

### 1.1 JS-side 检测

| 模式 | 命中数 | 位置 | 备注 |
|---|---:|---|---|
| `navigator.platform` | 0 | — | 无 |
| `navigator.userAgent` | 0 | — | 无 |
| `navigator.userAgentData` | 0 | — | 无 |
| `navigator.vendor` | 0 | — | 无 |
| `process.platform` | 0 | — | 前端业务代码无 (仅 `vite.config.ts:5` 读 `process.env.TAURI_DEV_HOST`, build 期) |
| `process.env.PLATFORM*` | 0 | — | 无 |
| `os.platform()` | 0 | — | 无 (Node API 在 webview 内无意义, 正确) |
| `window.__TAURI_INTERNALS__` 检测 | 1 | `src/main.tsx:30-50` | 用于 webview 启动期 IPC shim, **不是 OS 判断** |

**结论**: 前端业务代码**零 OS 探测** —— 跨平台契约主要由 Rust
`platform/traits.rs` 抽象, JS 通过 `@tauri-apps/api/core::invoke`
调后端命令, 不直接做平台分支。

### 1.2 CSS @supports 隔离

| 位置 | 内容 | 影响范围 |
|---|---|---|
| `src/design-system/base.css:282` | `@supports (-webkit-touch-callout: none)` 块 | 仅 Safari/WKWebView (macOS) 启用 macOS 字体抗锯齿 / 触摸板惯性滚动 / 40px hit area; WebView2 / Linux Chrome 跳过 ✓ 跨平台安全 |
| `src/design-system/base.css:17-20` | `::-webkit-scrollbar` 美化 | 双平台都有 WebKit 内核或 WebView2 (Chromium) 都识别 |
| `src/design-system/base.css:35` | `-webkit-font-smoothing: antialiased` (App.css) | Win 11 WebView2 已兼容, Mac Safari/WKWebView 兼容 |

### 1.3 键盘修饰键

`src/hooks/useKeyboardShortcuts.ts:78` 用 `e.ctrlKey || e.metaKey` 同时识别
Ctrl (Win/Linux) 与 Cmd (Mac) —— **不区分**。注释明确说明
"M2 不区分两个". 跨平台正确。

`src/pages/json-editor/index.tsx:363-380` 同样用 `ctrlKey || metaKey`,
跨平台正确。

### 1.4 拖放 / 文件选择

| 位置 | 内容 |
|---|---|
| `src/pages/home/index.tsx:79-82` | `webkitRelativePath?.split('/')[0]` —— Chromium 内核 (WebView2 + WKWebView) 都支持, 跨平台 OK |
| `src/pages/home/index.tsx:533` | `<input webkitdirectory>` —— 同样跨平台 OK |

---

## 2. Tauri API 跨平台

### 2.1 前端 import 的 Tauri 包

| 包 | 来源 | macOS 支持 | 备注 |
|---|---|---|---|
| `@tauri-apps/api` (^2) | `package.json:15` | ✓ | Tauri v2 官方 API |
| `@tauri-apps/api/event::listen` | `App.tsx:47`, `useDeeplinkUrl.ts:38` | ✓ | 跨平台 |
| `@tauri-apps/api/window::getCurrentWindow` | `App.tsx:48`, `WindowControls.tsx:35` | ✓ | 跨平台 |
| `@tauri-apps/api/core::invoke` | 全 `lib/api/*.ts` | ✓ | 跨平台 |
| `@tauri-apps/plugin-opener` | `package.json:16` | ✓ | 跨平台 |
| `@tauri-apps/plugin-deep-link` (JS 端) | **未在前端 import** | (N/A) | 由后端 Rust `tauri-plugin-deep-link` 处理, 前端仅 `listen('deep-link://new-url')` |
| `@tauri-apps/plugin-dialog` (JS 端) | **未在前端 import** | (N/A) | 由后端 Rust `tauri-plugin-dialog::blocking_open/save_file` 处理 (`lib/api/optimizer.ts:33-35` 注释) |
| `@tauri-apps/plugin-fs` (JS 端) | **未在前端 import** | (N/A) | 同上, 前端不走 FS plugin JS wrapper |

**结论**: 前端**只依赖 `@tauri-apps/api` + `plugin-opener`**, 不直接 import
任何 macOS 不支持的 plugin. 所有 OS 差异都被推到 Rust `platform/` 层
(`providers.ts:132-135` 等注释明确锁定这条规则).

### 2.2 后端 plugin (来自 `src-tauri/Cargo.toml` 由 Rust 团队维护, 不在本审计改动范围)

- `tauri-plugin-deep-link` —— macOS 通过 `Info.plist` + Apple Events,
  `tauri.conf.json:59-63` 已配 `schemes: ["ccswitch"]`. 需**双击 `.sql` 关联**在 Mac 上工作必须配 `CFBundleURLTypes`.
- `tauri-plugin-single-instance` —— macOS 通过 `NSApplication.shared.delegate`, 已工作.
- `tauri-plugin-dialog` —— 跨平台.

### 2.3 macOS Private API 开关

`src-tauri/tauri.conf.json:13` `macOSPrivateApi: true` —— **开启**.
macOS WKWebView 私有 API (e.g. `-webkit-app-region`) 才生效. 若以后
考虑 Mac App Store 分发需关闭.

---

## 3. 前端依赖跨平台

| Dep | 版本 | 跨平台? | 备注 |
|---|---|---|---|
| `@tauri-apps/api` | ^2 | ✓ | 官方, 全平台 |
| `@tauri-apps/plugin-opener` | ^2 | ✓ | 官方, 全平台 |
| `react` / `react-dom` | ^19.1.0 | ✓ |  |
| `react-router-dom` | ^6.30.0 | ✓ | 实际仅 `useState` 路由, react-router 是 deps 但**未实际使用** (见 §6 隐患) |
| `lucide-react` | 0.542.0 | ✓ | pure SVG |
| `@tauri-apps/cli` (dev) | ^2 | ✓ | 官方, 跨平台 |
| `vite` / `@vitejs/plugin-react` | ^7.0.4 / ^4.6.0 | ✓ |  |
| `vitest` / `@vitest/coverage-v8` | ^2.1.9 | ✓ |  |
| `jsdom` | ^25.0.1 | ✓ |  |
| `typescript` | ~5.8.3 | ✓ |  |
| `@playwright/test` | ^1.49.1 | ✓ |  |
| `@testing-library/*` | (最新) | ✓ |  |
| `@types/node` | ^25.9.3 | ✓ | 仅用于 vite.config.ts 编译期 |

**缺失的"通常会出现"的 native 依赖**:
- ❌ `better-sqlite3` —— **无**, 历史 audit 提到但本项目**未使用**. SQLite 工作全走后端 Rust `rusqlite`.
- ❌ `keytar` / `node-mac-auth` / `node-windows-security` —— **无**, 项目没用密钥链.
- ❌ `fsevents` —— **无**, 不在前端 deps.
- ❌ `chokidar` —— **无**, fs watcher 不在前端.
- ❌ `node-gyp` / native binding —— **无任何** prebuilt 跨平台 ABI 风险.

**结论**: 前端 deps **天然跨平台**, 无需重编 native binding.

---

## 4. Vite / TS / Node 配置

| 配置 | 平台风险 |
|---|---|
| `vite.config.ts` | `process.env.TAURI_DEV_HOST` (build 期) + `server.port: 1420` + `host: host \|\| false`. 无 Windows-only deps, 无硬编码路径. |
| `vite.config.ts:29` | `watch.ignored: ["**/src-tauri/**"]` —— 通用 glob, 跨平台. |
| `vite.config.ts` | **没有** `optimizeDeps.exclude` —— 无 Windows-only dep 需排除. |
| `vite.config.ts` | **没有** `define` —— 无 Windows 路径硬编码. |
| `tsconfig.json` | `target: ES2020`, `lib: ["ES2020", "DOM", "DOM.Iterable"]`. macOS WKWebView (Safari 16+/17) 支持 ES2020 全集. |
| `.npmrc` | **缺失**. |
| `.nvmrc` | **缺失** (但 `ci.yml:82` 锁死 `node-version: '22.18.0'`, release.yml 用 `lts/*`). 建议补 `.nvmrc` 保证本地/CLI/CI 统一. |

---

## 5. CI 跨平台覆盖

### 5.1 `release.yml` (M1.10 release pipeline)

**matrix (line 56-64)**:
- ✓ `windows-nsis (x86_64)` —— `windows-latest`, `--bundles nsis`
- ✓ `macos-dmg (aarch64)` —— `macos-latest`, `--bundles app,dmg`

**只覆盖 ARM64 Mac**, **未覆盖 `x86_64-apple-darwin`** (Intel Mac).
如需给 Intel Mac 出包, 要补 `x86_64-apple-darwin` target.

**cache key**:
- `actions/setup-node@v4 cache: 'npm'` —— npm cache 跨平台共用 ✓
- `swatinem/rust-cache@v2` —— 自动按平台分 key (内部基于 `runner.os` + target triple) ✓

### 5.2 `ci.yml` (PR/push gate)

**jobs**:
1. `test-rust` —— **仅 windows-latest** (`runs-on: windows-latest` line 19)
2. `test-frontend` —— **仅 windows-latest** (line 73)
3. `e2e` —— matrix `[windows-latest, macos-latest]` 但 `if: ${{ false }}` **整体禁用** (line 125)
4. `build-macos` —— **macos-latest** (line 206), 跑 `cargo check` + `npm run build` + vitest

**Mac 编译门禁 ✓** (`build-macos` 已在 P1-6 修复时加入, line 197-242 注释说明).

**E2E 缺口**: e2e 整套 skip, **无论 Win 还是 Mac 都没真跑**. Mac tauri-driver
需要 codesign + helper bundle, 推迟 M2.x.

### 5.3 总结

| 维度 | Windows | macOS |
|---|---|---|
| Frontend type-check (`tsc --noEmit`) | ✓ (ci.yml:92) | ✓ (ci.yml:239 `npm run build`) |
| Frontend prod build | ✓ (ci.yml:100) | ✓ (ci.yml:239) |
| Vitest | ✓ (ci.yml:104) | ✓ (ci.yml:242) |
| Rust `cargo test` | ✓ (ci.yml:49-55) | ✗ (只跑 `cargo check`) |
| Rust `cargo clippy` | ✓ (ci.yml:62) | ✗ |
| Tauri release bundle | ✓ (release.yml) | ✓ (release.yml, **仅 aarch64**) |
| tauri-driver e2e | ✗ (skip) | ✗ (skip) |

---

## 6. CSS / 设计

### 6.1 Mac 专属覆写 (正确做法)

`src/design-system/base.css:282-302` 用 `@supports (-webkit-touch-callout: none)`
隔离 macOS (CLAUDE.md §4 已知契约), 不污染 WebView2 路径.

`src/design-system/base.css:5-11` 头部注释明确说明:
> macOS WKWebView (Tauri 默认) + WebKit 私有前缀 (`-webkit-backdrop-filter`,
> `-webkit-app-region`, `::-webkit-scrollbar`).
> 全部用 `@supports` 隔离, 不影响 Win11 WebView2.

### 6.2 跨平台 CSS 前缀

| 元素 | 用法 | 跨平台 |
|---|---|---|
| `WebkitBackdropFilter` (`PluginPlaceholder.tsx:66`, `QuickSearchModal.tsx:440`) | React inline style 对象 | Chromium 内核 (WebView2) **也识别** WebKit 前缀的 React CamelCase 写法 ✓ |
| `WebkitAppRegion: 'drag'` / `'no-drag'` (AppHeader, AppSidebar, QuickSearchModal, WindowControls) | 同上 | Tauri v2 在 Windows 用 `data-tauri-drag-region`, Mac 用 `-webkit-app-region`. React inline 写法通过 Vite/style 序列化后变 `-webkit-app-region: drag`. **两边都生效** ✓ |
| `-webkit-font-smoothing: antialiased` (App.css:35, base.css:285) | 标准 | 跨平台 |
| `-webkit-overflow-scrolling: touch` (base.css:291, @supports 隔离内) | Mac only | 正确隔离 |
| `-webkit-appearance: none` (base.css:404, 429) | 用于 `.btn-modal-*` 禁用 button 原生背景 | 跨平台 |

### 6.3 字体栈

`src/design-system/tokens.css:115`:
```
--font-ui:   -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-mono: "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
```
Mac 会优先用 `-apple-system` (San Francisco) + `SF Mono`; Win 会回退到
`Segoe UI` + `Cascadia Code`. 跨平台正确.

`anime.css` 主题额外要求 `'Fredoka', 'Nunito', sans-serif` —— **Mac/Win
都不内置 Fredoka/Nunito**, **需要 web 字体**, 但本项目**未在 HTML 或
CSS 中 `@import` Fredoka/Nunito** (全局搜索 `@import` / `font-family`
仅命中本地 fallback 列表). 这是**视觉回退隐患** (见 §7).

---

## 7. 图标 / 资源

| 文件 | 平台 | 状态 |
|---|---|---|
| `src-tauri/icons/icon.icns` (98451 B) | macOS | ✓ 存在 |
| `src-tauri/icons/icon.ico` (86642 B) | Windows | ✓ 存在 |
| `src-tauri/icons/icon.png` (14183 B) | Linux 备用 | ✓ |
| `src-tauri/icons/32x32.png` / `128x128.png` / `128x128@2x.png` | 通用 PNG | ✓ |
| `src-tauri/icons/Square*.png` (10 个) | MS Store (Windows) | ✓ (Win-only) |
| `src-tauri/icons/StoreLogo.png` | MS Store | ✓ (Win-only) |

`tauri.conf.json:37-43` `bundle.icon` 数组同时含 `.icns` + `.ico`:
```
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",     ← macOS
  "icons/icon.ico"       ← Windows
]
```
**齐全 ✓**. macOS bundler 自动挑 `.icns`, Windows NSIS 挑 `.ico`.

`public/` 仅 `tauri.svg` + `vite.svg` —— 非平台特定, 跨平台 OK.

---

## 8. 其他隐患 (顺带发现)

1. **`react-router-dom` 是 deps 但未实际使用**: `App.tsx:5-43` 注释
   明确说"我们不用 react-router, 用 useState + localStorage".
   `react-router-dom` 在 `package.json:20` 仍锁定. M2+ 才会真用上.
   影响: deps 体积, **不构成 macOS 风险**.
2. **`.nvmrc` 缺失**: CI 锁 `node 22.18.0`, 本地 dev box 未锁,
   不同 Node 小版本可能在 macOS 上跑出不同结果.
3. **Fredoka / Nunito webfont 未引入**: anime 主题靠 `'Fredoka',
   'Nunito', sans-serif` fallback, 但没 `@font-face` 或
   `<link href="https://fonts.googleapis.com/...">`. **Mac/Win
   都看不到 Fredoka/Nunito**, 会回退到 `sans-serif`. 不影响
   跨平台**运行**, 但**视觉一致性**在 Mac 上尤其差 (San
   Francisco 没了, 退回系统 sans).
4. **`react-router-dom` 等前端跨平台无差异**, 不影响 macOS 兼容性.

---

## 9. 推荐改造 (按优先级)

### 9.1 高优先级 (影响 macOS 用户体验)

1. **补 Fredoka/Nunito webfont** —— 在 `index.html` 加
   `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&family=Fredoka:wght@400;500;600&display=swap">`
   或本地 `@font-face` + `public/fonts/`. Mac 上 anime 主题目前
   实际渲染成 San Francisco, 与设计稿不一致.
2. **补 `.nvmrc`** —— `echo "22.18.0" > .nvmrc` (与 CI 锁一致),
   本地 `nvm use` 自动对齐.
3. **`release.yml` 矩阵补 Intel Mac** —— 增加
   `x86_64-apple-darwin` entry (如需).

### 9.2 中优先级 (工程纪律)

4. **`react-router-dom` 是否真要保留** —— M2 之前建议移出
   `dependencies` (避免 deps 体积 + 误导新人), 等 M2+ 真用时再加回.
5. **`.npmrc`** —— 写 `engine-strict=true` 锁 Node 版本,
   与 `.nvmrc` + CI 三处对齐.

### 9.3 低优先级 (已合规, 仅记录)

6. macOS Private API 已开 (`macOSPrivateApi: true`) —— 上 Mac App
   Store 时记得关.
7. WebView2/WKWebView 桥的 React `WebkitAppRegion` inline style 已正确;
   无需改.
8. `tauri.conf.json` 的 `bundle.icon` 已含 `.icns + .ico`, 满足
   Mac/Win 各自 bundler.

---

## 10. 一句话结论

**前端代码 macOS 兼容性: 优秀**。零 OS 探测, 全部走 Tauri invoke
抽象层 + Rust `platform/traits.rs`, CSS 用 `@supports (-webkit-touch-callout)`
隔离 macOS, 图标 `.icns + .ico` 齐全, CI 已覆盖 `build-macos` 编译门禁.
剩余工作集中在 (1) Fredoka/Nunito webfont 引入 (2) `.nvmrc` 补齐
(3) `release.yml` Intel Mac matrix (可选).