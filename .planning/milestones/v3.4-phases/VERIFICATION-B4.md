# VERIFICATION-B4 — Close 按钮 hover 看不见

**日期**: 2026-06-30
**分支**: `worktree-agent-a770ef388645feb79`
**Worktree**: `/Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-a770ef388645feb79`
**协议**: CLAUDE.md §16 五步流程
**Task 类型**: 回归验证 (不 re-fix, master 上 `2dba138` 已 ship)

---

## 1. 了解 (Problem Details)

| 维度 | 内容 |
|---|---|
| **操作路径** | 启动 app → 鼠标 hover 右上角 X 按钮 |
| **前置状态** | 已 ship `2dba138` (commit on master, 含具体 CSS 改动) |
| **期望行为** | hover 时按钮背景变红 (`var(--danger)`), X 字符白色 (`#ffffff`), 用户清楚看到 "点这个会关 app" |
| **实际行为 (master)** | 同期望 — `2dba138` 已 ship, hover 可见 (待用户截图验收) |
| **Bug 原行为 (修复前)** | hover 时背景变红, 但 X 字符颜色 = `var(--accent-fg-on)`, 在某些主题里解析为 `#0A0A0B` 近黑, 导致 X 在红背景上"消失" |
| **触发条件** | 用户在 5 主题中切到 `--accent-fg-on` 解析为深色的主题, hover 关闭按钮 |
| **出现频率** | 100% (受主题影响) |
| **影响范围** | `src/design-system/base.css` 单文件 (CSS 规则) + `src/components/WindowControls.tsx` (DOM 结构) |

---

## 2. 明确原因 (Root Cause — file:line 证据)

### 修复前代码 (`src/design-system/base.css:470-477`, commit `2dba138^`)

```css
.chrome-btn-close:hover {
  background: var(--danger);
  color: var(--accent-fg-on);   /* 罪魁: 主题 token, 某些主题解析为 #0A0A0B */
}
.chrome-btn-close:hover svg {
  color: var(--accent-fg-on);   /* 同问题 */
}
```

### 触发链

```
hover close button
  └─ :hover 触发 → CSS 规则匹配
       └─ color = var(--accent-fg-on) (CSS variable lookup)
            └─ theme 注册的 --accent-fg-on 在 light 主题 = #0A0A0B (近黑)
                 └─ X 字符 (lucide-react 渲染) 继承 currentColor
                      └─ X 在红背景上不可见 (黑 + 红 = 视觉融)
```

### 根因证据

| 文件 | 行 (修复前) | 说明 |
|---|---|---|
| `src/design-system/base.css` | 470-477 | `.chrome-btn-close:hover` 用 `var(--accent-fg-on)` |
| `src/design-system/base.css` | ~50 | `.btn-primary { color: var(--accent-fg-on); }` — 同 token 在 light 主题 = `#0A0A0B` |
| `src/design-system/themes/light.css` | (token 注册) | `--accent-fg-on: #0A0A0B` |
| `src/components/WindowControls.tsx` | 90 | className = `chrome-btn-hover chrome-btn-close` (DOM 锚点) |

### 修复内容 (commit `2dba138`)

1. **新增 selector** `.chrome-btn-hover.chrome-btn-close:hover` (class 重复 → specificity 提升) — 防止 legacy `.titlebar .chrome-btn:hover` (line 194) 在 source order 上覆盖
2. **`color: #ffffff`** — 字面 white, 不依赖任何主题 token
3. **`fill: #ffffff; stroke: #ffffff`** — child svg 双保险, 防止 future override 重设 `currentColor`
4. **保留** `background: var(--danger)` — Windows close 红色约定不动

### 文件:行 引用 (master 当前状态)

| 文件 | 行 | 说明 |
|---|---|---|
| `src/design-system/base.css` | 478-479 | `.chrome-btn-hover.chrome-btn-close:hover, .chrome-btn-close:hover { background: var(--danger); color: #ffffff; }` |
| `src/design-system/base.css` | 483-488 | child svg fill/stroke = `#ffffff` |
| `src/components/WindowControls.tsx` | 90 | className = `chrome-btn-hover chrome-btn-close` |

---

## 3. 边界 (Scope)

| 维度 | 评估 |
|---|---|
| **业务模块** | F22 窗口 chrome (M1.9.2 + M4.8 重设计) |
| **影响文件** | `src/design-system/base.css` + `src/components/WindowControls.tsx` (master 上均已 ship 修复) |
| **新增文件** | `src/__tests__/components/window-controls-hover.spec.tsx` (8 测试) + `VERIFICATION-B4.md` |
| **平台差异** | 无 (CSS 层, 跨平台一致) |
| **数据依赖** | 无 (CSS 静态契约 + DOM className 断言) |
| **§2.4 白名单** | 不需要 — 新增测试 + 文档, 不改业务代码 |
| **关联组件** | AppHeader (消费 WindowControls), 但已有 `AppHeader.test.tsx` 覆盖 drag-region, 不需要扩 |

---

## 4. 分析技术方案 (Technical Options)

**测试角度** (CLAUDE.md §16 第 4 步 — 验证方案选型):

| 方案 | 描述 | 优点 | 缺点 | 选? |
|---|---|---|---|---|
| **A** | **DOM className 断言** (jsdom + `@testing-library/react`) | 验证 specificity 锚点存在; 不依赖 CSS 引擎 | 不能直接验证 hover 视觉 | ✅ |
| **B** | **CSS source-code 静态契约** (`readFileSync(base.css)` + 正则) | 锁死字节 — bug 复现路径 (用 `var(--accent-fg-on)`) 触发即失败; 不依赖 jsdom CSS 引擎 | 不能验证浏览器级 cascade | ✅ |
| **C** | **`getComputedStyle(close).color` 断言 hover 状态** | 直接验证最终像素值 | jsdom 不支持 `:hover` 伪类 (`Element.matches(':hover')` 永远 false) + 不 cascade cross-file CSS | ❌ 不可行 |
| **D** | **Playwright + tauri-driver 真实 hover 截图** | 黄金标准 — 真实像素验证 | §17 mid-task verify 禁止 launch app (从 worktree subagent); 需主 session 验收 | ❌ 跳过 (留给主 session) |
| **E** | **jsdom inline `<style>` 注入 + `getComputedStyle`** | 部分验证 #ffffff 解析 | jsdom 不支持 `:hover` 伪类, 无法触发 hover rule | ❌ 不可行 |

**选 A + B + (E 简化版)**:
- A 锁死 className (specificity 锚点存在)
- B 锁死 base.css 字节 (bug 的复现路径 = 用错 token, 字节回归即可捕获)
- E 简化版: 仅验证 `#ffffff` 字面量解析为 RGB(255,255,255) — 防止 typo `#fffafa` 等

**不选 C/D** 的理由:
- §16.2 "硬证据" 要求可测试 bug 留 vitest 测试 → **A+B 已满足**
- §16.2 "不可测试 bug 录屏" — 这是 UI 视觉 bug, 需要主 session 验收 (留 STATE.md / Phase 后续)
- §17 mid-task 禁止 build/smoke/launch app — Playwright 路径禁止在 worktree 跑

---

## 5. 验证 (Evidence — §16.2 强证据)

### 5.1 自动化测试 (Red → Green)

**Red 阶段**: 临时 `git show 2dba138^:src/design-system/base.css > src/design-system/base.css` 还原修复前 CSS, 跑测试:

```
× WindowControls — B4 close hover: CSS source contract > base.css declares the doubled-class selector (specificity boost) 2ms
× WindowControls — B4 close hover: CSS source contract > close-hover background still uses var(--danger) (red token preserved) 0ms
× WindowControls — B4 close hover: CSS source contract > close-hover color is LITERAL #ffffff (NOT a theme token that could resolve dark) 0ms
× WindowControls — B4 close hover: CSS source contract > close-hover child svg gets explicit fill AND stroke set to #ffffff 0ms

Test Files  1 failed (1)
     Tests  4 failed | 4 passed (8)
```

4 个 CSS 契约测试全部 FAIL — 证明字节级断言准确捕获了 `2dba138^` 的 regression。DOM contract 测试 (className 存在) 仍然 PASS — 这是符合预期的: 修复前 className 已经对了 (`chrome-btn-hover chrome-btn-close`), bug 在 CSS 颜色值。

**Green 阶段**: 恢复 master base.css (`cp /tmp/base.css.bak src/design-system/base.css`), 跑测试:

```
✓ src/__tests__/components/window-controls-hover.spec.tsx (8 tests) 21ms

Test Files  1 passed (1)
     Tests  8 passed (8)
```

8/8 PASS on master (含 `2dba138`)。

### 5.2 关联测试 (无回归)

```
✓ src/__tests__/components/AppHeader.test.tsx (10 tests)
✓ src/__tests__/integration/m1-9-2.test.tsx (15 tests)
   Tests  25 passed (25)
```

AppHeader (drag-region 契约) + m1-9-2 (chrome 按钮 integration) 全 PASS — 新测试不破坏既有契约。

### 5.3 测试断言机理

测试 (`src/__tests__/components/window-controls-hover.spec.tsx`) 的关键设计:

1. **3 个 describe 块, 8 个 test**:
   - **DOM contract (2 test)**: 验证 `data-testid="app-header-close"` 渲染, className 包含 `chrome-btn-hover` + `chrome-btn-close` (specificity 锚点); 兄弟按钮 (min/max) 不带 `chrome-btn-close` (只有 close 应该走 danger 路径)
   - **CSS source contract (4 test)**: 读 `base.css` 字节, 正则匹配关键 selector + 属性:
     - `.chrome-btn-hover.chrome-btn-close:hover` selector 存在
     - background = `var(--danger)` (红 token 保留 — Windows 约定)
     - color = `#ffffff` (字面 white — NOT `var(--accent-fg-on)`)
     - child svg fill + stroke = `#ffffff`
   - **RGB sanity (2 test)**: `#ffffff` 解析为 RGB(255,255,255), testid 仍存在
2. **Mock Tauri API**: 同 m1-9-2 模式, 不依赖 runtime
3. **jsdom 限制说明**: 测试顶部 doc comment 解释为什么不能直接测 `getComputedStyle(close).color` — jsdom 不支持 `:hover` 伪类

### 5.4 不算验证 vs 算验证

| 方式 | 算? | 备注 |
|---|---|---|
| vitest Red → Green (CSS 字节契约) | ✅ | 客观、可复现、测试留 codebase |
| 关联测试 25/25 PASS | ✅ | 无回归证据 |
| DOM className 断言 (rendered JSX) | ✅ | specificity 锚点存在性 |
| 启动 app 截图验证 hover 视觉 | ❌ 跳过 | §16 + §17 mid-task verify 禁止 launch app; **留给主 session** |
| smoke test 10/10 | ❌ 跳过 | §17 同上 |

### 5.5 提交链

```
a1b0d66 sync: v3.4.4 WIP + upstream Phase 48 refactor (2026-06-29)  (master base)
e69529b docs(verification): VERIFICATION-A5.md for A5 duplicate-error-display bug
[pending] verify(b4): window controls hover style regression test
```

---

## 6. 与上游 commit 2dba138 的关系

| 维度 | master `2dba138` | 本 worktree (after rebase) |
|---|---|---|
| **commit 存在?** | 是 | 是 (rebase 后已包含) |
| **CSS diff 内容** | selector specificity + #ffffff + fill/stroke | 同 |
| **回归测试?** | 仅 smoke test 8/10 + 启动没崩 + "待用户截图" | vitest Red→Green (8 测试, 4 关键断言覆盖 bug 路径) + 25 关联测试无回归 |
| **证据强度** | 中 (§16.2 弱验证: "启动没崩" ≠ "UI 行为对") | 强 (§16.2 正例: 字节级断言 + Red→Green) |

本次工作不重复 `2dba138` 的 fix — master 已 ship。补充:
1. **回归测试** — 任何未来 revert (例如有人 "优化" CSS 改回 `var(--accent-fg-on)`) 都会触发 4 个 FAIL, 不需要等到用户截图
2. **§16 流程文档** — 5 步骤证据齐全, 可作为 M4.x 主题切换相关 bug 调查的 reference

---

## 7. 已知限制 / 后续

1. **真实 UI hover 验证未做** — §16.2 列出 "不可测试 bug (视觉/平台/时序/主观): 录屏 + DevTools log + 用户亲眼确认"。本任务范围限于回归测试; 主 session 后续需:
   - 启动 app → hover 关闭按钮 → 截图 (before/after)
   - 确认 5 主题下 X 均可见
   - 留 STATE.md 记录
2. **`getComputedStyle` 不可行** — jsdom 25 + Node 26 不支持 `:hover` 伪类, 强行 mock `:hover` 会变成 "测 mock 而非真 CSS"。用字节级断言 + DOM className 替代, 这是 B4 的"正确"测试边界。
3. **className 仍可未来 refactor** — 例如有人把 `chrome-btn-hover chrome-btn-close` 拆成不同命名 (`.close-btn`)。当前测试锁死 className, 改 className = 显式更新测试 = 显式更新 CSS selector, 这是合理的耦合。
4. **CSS Modules 化风险** — 如果未来 `base.css` 迁到 CSS Modules (`.chrome-btn-close_abc123`), selector 字面量会变, 字节级正则需更新。CLAUDE.md §3.1 没强制 CSS Modules, 当前 risk low。

---

## 8. 协议执行检查

| §16 步骤 | 完成? | 证据 |
|---|---|---|
| 1. 了解详情 | ✅ | §1 |
| 2. 明确原因 (file:line) | ✅ | §2 (CSS rule + token lookup chain + DOM 锚点) |
| 3. 边界 (§2.4 白名单) | ✅ | §3 (新增测试 + 文档, 不改业务代码) |
| 4. 方案 ≥2 | ✅ | §4 (列 5 方案, 选 A+B+E 简化) |
| 5. 验证 (Red → Green + 测试留 codebase) | ✅ | §5.1 (Red 4 FAIL → Green 8 PASS) + 25 关联测试无回归 + commit pending |

**结论**: B4 修复在 master 上有效 (`2dba138` 已 ship), 新增 8 测试覆盖字节级 CSS 契约, Red→Green 证明测试能捕获 bug 路径。视觉验收 (hover 截图) 留给主 session 后续执行, 不在本 worktree 范围。

---

**作者**: Claude Code (autonomous verification subagent)
**Worktree**: `worktree-agent-a770ef388645feb79`
**Commits**: pending (`verify(b4): window controls hover style regression test`)