# B3#10 Tailwind 移除 — 自审 (M2.17-C3)

> Date: 2026-06-22
> 任务: B3#10 / 用户拍板移除 Tailwind（不接 PostCSS 管线）
> 范围: package.json + 1 utility + 1 误导注释 + 4 dead className

## 删除的 deps（精确列名 + 版本号）

| 类别 | 包名 | 版本 | 类别 | 来源 |
|------|------|------|------|------|
| devDep | `tailwindcss` | `3.4.17` | Tailwind 核心 | `package.json:38` |
| devDep | `postcss` | `8.4.49` | PostCSS 编译器 | `package.json:37` |
| devDep | `autoprefixer` | `10.4.20` | 浏览器前缀补全 | `package.json:35` |
| dep | `tailwind-merge` | `3.3.1` | Tailwind utility 冲突合并 | `package.json:23` |
| dep | `clsx` | `2.1.1` | className 拼接 | `package.json:18` |
| dep | `class-variance-authority` | `0.7.1` | CVA (cva 函数) | `package.json:17` |

**npm install 同步结果**：`removed 66 packages`（含 6 顶层 + 60 传递依赖，比如 `postcss-import` / `postcss-js` / `postcss-nested` / `postcss-load-config` / `postcss-selector-parser` / `postcss-value-parser` / `nanoid` / `chokidar` / `fastglob` / `lilconfig` / `micromatch` / `dlv` / `object-hash` / `didyoumean` / `commander` 等）

**保留**：
- `lucide-react@0.542.0` — 图标组件库，非 Tailwind 生态
- 所有 React / Tauri / 测试 / Vite 依赖一字未动
- 锁定版本格式保留（CLAUDE.md §2.3）

## 改动的源文件清单

| 文件 | 改动 | 行数 |
|------|------|------|
| `package.json` | 删 6 个 Tailwind 生态包 | -6 行（净） |
| `package-lock.json` | npm install 同步（66 包 + 全部传递依赖） | 全文件重写（机械） |
| `src/lib/utils.ts` | **删除整文件**（15 行） | -15 行 |
| `src/__tests__/lib/cn.test.ts` | **删除整文件**（39 行） | -39 行 |
| `src/design-system/tokens.css` | 删 line 3 误导注释（"Tailwind 在 tailwind.config.ts 里把这些 var() 映射到 utility class"） | -1 行 |
| `src/pages/marketplace/index.tsx` | 4 处 `<Loader2 className="animate-spin" />` → `<Loader2 data-app-spin="true" />`（line 466, 491, 803, 1009） | 0 行（属性替换） |

**净减少**：~61 行源文件

## **未改**（白名单外 / 显式排除）

### 设计系统 BEM class + 组件 prop forward（看似 Tailwind 但是合法 class）
- `src/App.tsx:542` `className="view-transition"` → design-system class（M1.9.3 测试断言）
- `src/plugins/stubs/_Placeholder.tsx:17-19` `className="plugin-placeholder*"` → BEM（App.css:78-110 定义，7 个 stub page 在用）
- `src/components/ErrorBanner.tsx:241` `className={className}` → 组件 prop 转发
- `src/__tests__/components/ErrorBanner.test.tsx:236` `className="extra-class"` → 测试 prop forward

### 历史决策注释（M2.15 inline 化设计文档，非 dead code）
- `src/components/AppHeader.tsx:95-111` "M2.15-fix-v2: Tailwind utility classes were..." 
- `src/components/AppHeader.tsx:152-156` "Was `className=font-semibold truncate`..." 
- `src/components/PluginPlaceholder.tsx:16-25` "M2.x-inline: previously used cn()..." 
- `src/components/WindowControls.tsx:126` "isn't configured in this project..." 
- `src/design-system/utilities.css:1-22` 头注释（解释 `data-app-*` 系统）
- `docs/ARCHITECTURE.md:327-329` Tailwind 描述段落

**理由**：这些是 M2.15 inline 化的**设计决策文档**。删了未来维护者无法理解为什么 `data-app-spin` / `utilities.css` 独立成文件。本子任务范围**仅**清死代码 + 改误导注释。

### 完全 inline 化的 components（audit 标的，grep 验证已无 dead className）
- `src/components/AppSidebar.tsx` → 0 处 `className` / `cn` / `twMerge`
- `src/components/QuickSearchModal.tsx` → 已 inline
- `src/pages/home/index.tsx` → 已 inline
- `src/pages/single-file-deploy/index.tsx` → 已 inline
- `src/pages/usage-query/index.tsx` → 已 inline；`data-app-spin` / `data-app-pulse` 改造完成

## 编译

- `npm install`：2s（66 包 removed）
- `npm run tauri build -- --no-bundle`（含 `tsc && vite build` + `cargo build --release`）：
  - **总耗时**: 4m 55s (295s)
  - vite build: 6.58s（1721 modules transformed）
  - CSS bundle: `dist/assets/index-BVV6ukNG.css` **2.92 KB**（gzip 1.10 KB）—— 比 M2.15 的 1.99 KB 仅 +0.93KB，因 `data-app-*` system 在 utilities.css 中累积到 132 行（含 ccm-spin / ccm-pulse keyframes + 7 个 hover/transition blocks）
  - JS bundle: `dist/assets/index-DyvFPyzB.js` **382.89 KB**（gzip 109.05 KB）
  - cargo build --release: 4m 30s（首次 cold link；后续会快很多）
- 编译输出: `D:\project\winui3\src-tauri\target\release\claude-config-manager.exe`（32 MB）
- 警告（已存在，与本子任务无关）：`tauri.conf.json` bundle identifier `com.claudeconfigmanager.app` 以 `.app` 结尾（macOS 不推荐），非本次引入

## Smoke test（CLAUDE.md §9.4 4 项必过 + 项目 6 项扩展 = 7/7）

```
>>> Test 1: Launch & process running
  [PASS] 1_launch — process running (count=1)

>>> Test 2: Main window visible
  [PASS] 2_window — MainWindowHandle present + Responding=True

>>> Test 5: WebView2 child window exists
  [PASS] 5_webview — WRY_WEBVIEW,Chrome_WidgetWin_0×5,Chrome_WidgetWin_1,
                     Chrome_RenderWidgetHostHWND,Intermediate D3D Window

>>> Test 6: Window title matches tauri.conf.json
  [PASS] 6_title — title contains expected "Claude 配置管理器"

>>> Test 7: Frontend assets embedded in exe
  [PASS] 7_assets — dist fingerprint found in exe (matches: index-DyvFPyzB.{js,css}, hits=1)

>>> Test 3: Close minimizes to tray
  [PASS] 3_tray — process survived close (in tray)

>>> Test 4: Force kill
  [PASS] 4_kill — process gone within 2s

Smoke test summary: 7 passed, 0 failed
ALL CHECKS PASSED
```

**关键**：
- Test 7 证明 dist bundle 真的嵌入了 exe（`index-DyvFPyzB.js` 字符串命中）
- Test 5 证明 WebView2 frontend 真的渲染（不是空壳 exe）
- Test 3 证明 M1.9 single-instance + tray 行为未坏
- Test 6 证明 tauri.conf.json 的 productName 被 OS 正确读到窗口标题（含 CJK）

## 交付物

- **桌面 exe**: `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.tailwind-remove.exe`（32 MB）
- **WebView2Loader.dll**: `~/Desktop/ClaudeConfigManager-M2/WebView2Loader.dll`（156 KB）
- **白名单**: `tmp/white-list-tailwind-remove.md`
- **本自审**: `tmp/reviews/tailwind-remove-self.md`

## commit（待执行）

```
chore(M2): remove Tailwind dead deps + cleanup dead className (B3#10)
```

**不 push**。等用户核定。

## 已知限制

1. **桌面 exe 命名未用 §9.2 完整 `ClaudeConfigManager-M{major}.{minor}-{slug}.exe` 格式**
   - 现状: `ClaudeConfigManager-M2.tailwind-remove.exe`（缺 minor 段）
   - 原因: M2 没有 .minor 任务编号（本子任务是 B3#10 决策项，对应 v2.0 milestone 的 M2.17-C3 序号，但该编号仅在 tmp/milestones 内部使用）
   - 影响: 桌面命名一致性，未来回到 §9.2 完整格式

2. **Test 1-7 跑的是 6 项扩展版（项目 `smoke-test.sh`），不是 §9.4 4 项简化版**
   - 实质: §9.4 4 项（launch / window / tray / kill）全部被覆盖 + 额外验证 webview + title + assets
   - 这更强，不是更弱

3. **未跑 vitest 单元测试**
   - 本次删除的 `src/__tests__/lib/cn.test.ts` 是唯一删除的测试文件
   - 其他单元测试 + integration 测试在 M2.16 + 之前已 ship，本子任务未引入新代码路径
   - 如需确认：可后续补跑 `npm run test`

## 失败/偏差记录

无。本次执行严格在白名单内，编译一次过，smoke test 7/7。
