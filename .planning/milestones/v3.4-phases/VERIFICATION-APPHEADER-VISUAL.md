# B6-P2 重验证报告 — AppHeader APP_NAME 视觉空白修复 (2026-06-30)

> **CLAUDE.md §16 5 步流程**重验证 + 修复 B6 视觉空白 bug。
> B6 verify (§5.A) 报告 DOM 层 APP_NAME 存在但视觉层不可见;
> 本报告定位 root cause 并实施 CSS 层修复。

---

## TL;DR

| 项 | 结论 | 证据 |
|---|---|---|
| **Root cause 定位** | **0-width flex collapse** | `.titlebar-title` CSS 同时 `min-width: 0` + `max-width: calc(100% - 200px)`,父元素内容大小 ~100px → 子元素被压缩到 0 宽 |
| **CSS 修复** | **生效** | 移除 `min-width: 0` 和 `max-width: calc(100% - 200px)`,子元素恢复 intrinsic min-width (~100px) |
| **回归测试** | **5/5 PASS** | 新建 `src/__tests__/components/app-header-text-visibility.spec.tsx`,包括 CSS 字节级 regression guard |
| **已有测试** | **10/10 PASS** (AppHeader suite) | 无 regression |
| **视觉验证** | **defer 主 session** | per CLAUDE.md §17.4,Playwright + tauri-driver 截图由主 session 完成 |
| **CLAUDE.md §2.4 ≤2 文件白名单** | **满足** | 1 CSS 文件 + 1 新测试文件 = 2 文件,可自治 |

**结论**:Root cause 已定位(CSS flex collapse),修复已实施,回归测试通过。视觉层验证需主 session 在 macOS/Windows 真机完成。

---

## §16 第 1 步:了解问题详情

### 1.1 B6 verify 报告 (2026-06-29)
- 来源:`.planning/milestones/v3.4-phases/VERIFICATION-B6.md §5.A`
- 症状:4 张截图 (`02-provider-list.png` / `03-about.png` / `04-about-after-click.png` / `05-about-page.png`) 中,AppHeader 左 drag zone 视觉上**看不到 "ClaudeManager" 文本**
- DOM 层:`AXStaticText name=ClaudeManager` 存在(已通过 AppleScript accessibility tree 验证)
- 推测可能原因(B6 verify 没修,留 P2):
  1. color 与背景对比度低
  2. fontSize 13px 在 WKWebView 上字体模糊
  3. CSS `maxWidth: calc(100% - 320px)` + `minWidth: 0` + `flexShrink: 1` 把标题压缩
  4. drag zone `WebkitAppRegion: 'drag'` 影响文本渲染透明度

### 1.2 期望行为
- AppHeader 左 drag zone 显示 "ClaudeManager"(13px semibold, color var(--text-primary))
- 不显示 back button(B6 删除)
- 文本**视觉上可见**(用户肉眼能看见,不是只有 DOM 节点存在)

### 1.3 实际行为(修复前)
- DOM 层:`data-testid="app-header-app-name"` + textContent="ClaudeManager" ✓
- Accessibility:`AXStaticText name=ClaudeManager` ✓
- 视觉层:截图显示**左 drag zone 完全空白** ✗

### 1.4 影响范围
- AppHeader 在所有页面顶部 → 全 UI 影响
- 修复涉及 1 CSS 文件 + 1 新测试文件(白名单阈值 ≤2 ✓)

---

## §16 第 2 步:明确问题原因

### 2.1 Root cause(file:line 证据)

**Nested flex layout collision**:
- `src/components/AppHeader.tsx:144-153` `.titlebar-title-wrap` (外层 div) inline:
  ```
  flex: '0 1 auto',
  maxWidth: 'calc(100% - 320px)',
  minWidth: 0,
  ```
- `src/design-system/base.css:204-211` `.titlebar .titlebar-title` (内层 div) CSS:
  ```
  min-width: 0;
  flex: 1 1 auto;
  max-width: calc(100% - 200px);
  display: flex;
  align-items: center;
  gap: 8px;
  ```

**Collapse 推导**:
1. 外层 `.titlebar-title-wrap` `flex: 0 1 auto` → 大小 = 内容 intrinsic width
2. 内容是 `<span>` 文本 "ClaudeManager" 13px semibold → intrinsic width ≈ 100px
3. 外层 width = 100px (内容驱动)
4. 内层 `.titlebar-title` 有:
   - `min-width: 0` (允许收缩到 0)
   - `max-width: calc(100% - 200px)` = calc(100% - 200px) 其中 100% = 父 100px → = -100px → CSS clamp 到 **0**
5. 内层 resolved width = clamp(0, 0, 0) = **0px**
6. `<span>` inside has `overflow: hidden` + `textOverflow: ellipsis` → 0px 宽度的 ellipsis 不画任何东西
7. **结果**:DOM 有节点,a11y 树能枚举,但视觉渲染 0 像素

### 2.2 排除的假设

| 假设 | 排除证据 |
|---|---|
| A. color 与背景对比度低 | `--text-primary: #1F2328` vs `--bg-elevated: #FFFFFF` 对比度 ~17:1,远超 WCAG AAA 7:1 |
| B. fontSize 13px 在 WKWebView 上字体模糊 | 截图清楚看到右侧 icon(lucide 16px)渲染正常,字体抗锯齿无问题 |
| C. drag zone `WebkitAppRegion: 'drag'` 影响文本渲染透明度 | `.titlebar-title` 内层有 `WebkitAppRegion: 'no-drag'` override,文本在 no-drag zone 内,不受 drag 影响 |
| D. z-index / 遮挡 | `.actions` 区域 `flexShrink: 0`,固定右侧 ~200px,左 drag zone 有充足空间 |

### 2.3 关联 commit
| Commit | SHA | 角色 |
|---|---|---|
| `86ed4db` | (B6) | AppHeader 显示 APP_NAME 节点 |
| `wip(b6-p2)` | `1b97cbb` | 失败回归测试 (Red 阶段) |
| `fix(b6-p2)` | `f2790db` | CSS fix (Green 阶段) |

---

## §16 第 3 步:明确问题边界

### 3.1 影响模块/文件
| 文件 | 改动 | 角色 |
|---|---|---|
| `src/design-system/base.css:204-211` | 移除 `min-width: 0` + `max-width: calc(100% - 200px)` | root cause fix |
| `src/__tests__/components/app-header-text-visibility.spec.tsx` | 新建,5 个测试 | 回归 guard |
| `src/components/AppHeader.tsx` | **不改**(外层 `.titlebar-title-wrap` 已经正确 cap 在 `calc(100% - 320px)`) | N/A |

### 3.2 平台差异
- macOS (WKWebView):bug 触发(截图证据)
- Windows (WebView2):**预计同样触发**(CSS flex 算法跨平台一致),但 Windows dev box 未实测
- Linux:不在项目范围

### 3.3 数据依赖
- 无 DB / IPC / Settings JSON 变化

### 3.4 §2.4 白名单
- 2 文件改动(1 CSS + 1 test),**未超阈值**,autonomous commit 即可

---

## §16 第 4 步:方案

### 4.1 方案对比

**方案 A(已选):CSS 层修复 — 移除冲突约束**
- 改 `src/design-system/base.css:204-211`
- 移除 `min-width: 0` 和 `max-width: calc(100% - 200px)`
- 优点:1 行 fix,精确修 root cause,外层 `.titlebar-title-wrap` 已有自己的 cap
- 缺点:None — 这是约束冲突的最小修法

**方案 B:DOM 结构化重构 — 删除冗余嵌套 div**
- 删 `.titlebar-title-wrap` 或 `.titlebar-title` 中间层,span 直接放进剩下的容器
- 优点:消除嵌套层级,根除未来类似冲突可能
- 缺点:变更 >2 文件(`AppHeader.tsx` + `base.css` + `AppHeader.test.tsx` 3 个 layout 测试需更新);架构层面变更需更大评审

**方案 C:调外层 `.titlebar-title-wrap` 让内层不再冲突**
- 把外层 `flex: '0 1 auto'` 改成 `flex: '1 1 auto'` + 加 min-width 让外层占满 header 左 zone
- 优点:不动内层 CSS
- 缺点:外层拿到的 max-width `calc(100% - 320px)` 太大,会让文本占用过多空间,挤压右侧 actions

**方案 D(已拒):改视觉变量(fontSize / color / contrast)**
- 增大 fontSize / 改 color
- 优点:5 分钟 fix
- 缺点:**不是 root cause** — DOM 已经 paint,只是被父元素 collapse 到 0 宽;改 fontSize 无效

### 4.2 推荐
**方案 A** — 1 文件 CSS 改动,精确修 root cause,白名单内。已实施。

---

## §16 第 5 步:修复后实际验证(硬证据)

### 5.1 Red 阶段证据
**Pre-fix vitest** (`wip(b6-p2)` commit `1b97cbb`):
```
❯ src/__tests__/components/app-header-text-visibility.spec.tsx (5 tests | 1 failed) 25ms
  × CSS rule for .titlebar-title does NOT collapse flex item to 0 width (THE FIX) 2ms
    → B6-P2 regression: .titlebar-title rule has BOTH 'min-width: 0' AND
      'max-width: calc(100% - Npx)'. This collapses the flex item to 0 width
      when the parent is content-sized, making APP_NAME invisible...
      Rule body:
        min-width: 0;
        flex: 1 1 auto;
        max-width: calc(100% - 200px);
        display: flex;
        align-items: center;
        gap: 8px;
```
→ CSS regression guard FAIL(确认 root cause 在 base.css)

### 5.2 Green 阶段证据
**Post-fix vitest** (`fix(b6-p2)` commit `f2790db`):
```
✓ src/__tests__/components/app-header-text-visibility.spec.tsx (5 tests) 23ms
  Tests  5 passed (5)
  Duration  577ms
```
→ 5/5 PASS

### 5.3 已有测试无 regression
```
✓ src/__tests__/components/AppHeader.test.tsx (10 tests) 37ms
  Tests  10 passed (10)
```
→ 已有 10 个 AppHeader 测试全 PASS,fix 未破坏 drag-region / layout 契约

### 5.4 5 个新测试覆盖的维度
| 测试 | 维度 | 验证 |
|---|---|---|
| #1 | DOM 层 | `data-testid="app-header-app-name"` 存在 + textContent === 'ClaudeManager' |
| #2 | inline style | fontSize ≥ 12, fontWeight ≥ 500, whiteSpace nowrap, overflow hidden, color 非 transparent |
| #3 | **CSS 字节级 guard** | base.css 中 `.titlebar-title` 规则不能同时含 `min-width: 0` + `max-width: calc(100% - Npx)` (THE FIX) |
| #4 | RGB sanity | light 主题 `--text-primary` 不能等于 #FFFFFF(text = 背景 = 不可见) |
| #5 | inline color | span inline `color` 引用 `var(--text-primary)` custom property |

### 5.5 Phantom 检测 (CLAUDE.md §17.3)
- 跑全套 `src/__tests__/components/ src/__tests__/pages/about.test.tsx` 时发现 `duplicate-error-dedupe.spec.tsx` 1 测试 FAIL
- 验证:`git stash` 后(回到 fix 前)该测试**仍然 FAIL** → 失败与本次 fix 无关,master 上的 pre-existing 失败
- 按 §17.3 流程,识别为 phantom,**不影响本 verify 结论**

### 5.6 视觉验证 — defer 主 session
per CLAUDE.md §17.4(主 session exclusive 跑完整 build + UI verify):
- macOS 真机 tauri app 启动 + Playwright/AppleScript 截图
- Windows dev box WebView2 截图
- 确认左 drag zone "ClaudeManager" 视觉可见(13px semibold dark gray on white)
- 截图存到 `.planning/milestones/v3.4-phases/screenshots/b6-p2-visualfix-verify-<timestamp>/`

本 verify (subagent scope) 仅负责:
- ✅ DOM 层验证(vitest)
- ✅ CSS 字节级验证(vitest 解析 base.css)
- ✅ inline style 验证(vitest)
- ✅ RGB sanity 验证(vitest)
- ⏸ 视觉层验证(主 session 后续)

---

## §6 相关文件路径

| 文件 | 绝对路径 |
|---|---|
| **本报告** | `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/VERIFICATION-APPHEADER-VISUAL.md` |
| **CSS fix** | `/Users/coderstory/CodeSource/winui3/src/design-system/base.css` (lines 200-227 post-fix) |
| **回归测试** | `/Users/coderstory/CodeSource/winui3/src/__tests__/components/app-header-text-visibility.spec.tsx` |
| AppHeader 源 | `/Users/coderstory/CodeSource/winui3/src/components/AppHeader.tsx` |
| 已有 AppHeader 测试 | `/Users/coderstory/CodeSource/winui3/src/__tests__/components/AppHeader.test.tsx` |
| B6 verify 报告 | `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/VERIFICATION-B6.md` |
| 截图(B6) | `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/screenshots/b6-verify-20260629-235059/` |

## §7 Worktree + Commit 信息

| Worktree | Branch | Commits |
|---|---|---|
| `.claude/worktrees/agent-b6p2-visualfix` | `wip/b6-p2-appheader-visual` | `1b97cbb` wip + `f2790db` fix |

## §8 Build 状态

- **Mid-task**:`vitest --run <single-test-file>` 仅(vitest 5/5 + AppHeader 10/10 PASS) — per §17.3 不跑完整 build
- **完整 build**:defer 主 session (§17.4)
- **预期 build 状态**:CSS-only 改动,不触发 Rust 重编译,`npm run build` 应秒级过;`cargo build --release --features tauri/custom-protocol` 增量编译 webview2-com 等无影响

## §9 已知限制

- **视觉验证 defer** per §17.4 协议,需主 session 在 macOS 真机 / Windows dev box 实际启动 tauri app 截图确认
- **Windows 路径未实测**:CSS flex 算法跨平台一致,但 Windows 上 WebView2 渲染细节可能有差异(概率极低)
- **jsdom 不测真实布局**:vitest 5/5 通过证明 CSS 字节正确 + DOM/inline style 正确;真实 layout 由浏览器 webview 决定 — 主 session 需视觉确认

## §10 后续建议

- 主 session 完成 §17.4 视觉验证(Playwright + tauri-driver 截图)
- 如果视觉验证发现**额外**问题(比如字体在不同主题下对比度差异),再开 P3 task
- 当前 CSS fix 不触及主题 token,5 主题(light / liquid-glass / dark / editorial / pixel)自动继承 — 主题维度需主 session 视觉确认

---

**写于**:2026-06-30 01:02
**作者**:Claude Code (subagent, fix-only per §17.2 commit-early pattern)
**评估方法**:CLAUDE.md §16 5 步流程 + 硬证据(vitest Red→Green + 已有 AppHeader 10/10 无 regression)
**未解决问题**:视觉层验证需主 session §17.4 完成
