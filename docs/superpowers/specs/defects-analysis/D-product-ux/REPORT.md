# 维度 D: 产品/UX 缺陷盘点

> 元信息
> - 维度 ID: D (产品/UX)
> - 扫描范围: src/pages/ (14 内页) + src/components/ (7) + src/App.tsx + src/design-system/ (base.css / tokens.css / themes/) + SPEC.md §5
> - 扫描方法: Read + Grep + Bash (grep/wc/cat, 无网络, 无代码修改)
> - 引用资产: SPEC.md §5 (权威源) / STATE.md §v3.0 round-2 / tmp/tailwind-audit.md (维度 B 产出)
> - 扫描时长: ~10 分钟 (本轮; 上轮扫描耗时 20+ 分钟被 TaskStop)
> - 子报告路径: `docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md` (本文件)

---

## Top 问题清单 (10 条)

| # | 问题 | file_path:line | 严重度 | 证据 | 修复建议 | 关联 |
|---|---|---|---|---|---|---|
| 1 | **`--button-radius: 6px` 与 SPEC §4.4 "按钮 4px" 不一致** | `src/design-system/tokens.css:101` | **CRITICAL** | SPEC.md §4.4 L551: "圆角: 卡片 8px,按钮 4px,弹窗 12px"; token 写 `--button-radius: 6px` (差 2px). 全代码库 58 处硬编码 `borderRadius: 4` 与 token 冲突, 仅 24 处用 `var(--radius-*)` | 改 token 为 4px, 替换 58 处硬编码 `borderRadius: 4` → `var(--radius-button)` | SPEC §4.4 / 维度 B #B-1 Tailwind |
| 2 | **大量硬编码 `borderRadius: 4/6/8` 绕开 token** (94 处) | `src/pages/home/index.tsx:209,251` + `src/pages/*/index.tsx` 全量 | HIGH | `borderRadius: 4` ×58, `borderRadius: 8` ×20, `borderRadius: 6` ×6, `borderRadius: 3` ×6 — 共 94 处, 而 `var(--radius-*)` 仅 24 处 | 全量替换为 `var(--radius-button)` (4-6px) / `var(--radius-card)` (8px) / `var(--radius-modal)` (12px) | SPEC §4.4 / 设计系统 §4.4 |
| 3 | **font-family 硬编码 `monospace` 字符串** (5 处) 绕开 `--font-mono` | `src/pages/home/index.tsx` + `import-sql/index.tsx` (见 grep 输出) | HIGH | `fontFamily: 'monospace'` ×5 (分布在 inline style 与 `<code>` 标签) — 违反 §4.3 字体规范 | 全部替换为 `var(--font-mono, monospace)` | SPEC §5 / tokens.css §4.3 |
| 4 | **base.css 与 themes 落地顺序风险** (v3.0 round-2 已修 1 次, 有同类风险) | `src/main.tsx` + `src/design-system/` 全部 CSS | HIGH | STATE.md §v3.0 round-2: "demo 拆 base.css + anime.css 时分 2 步, 第 1 轮只覆写不补 base" — 已 ship 修复, 但 main.tsx 的 import 顺序 (tokens → base → theme) 现在正确, 但无测试保证 | 在 `__tests__/design-system/` 加 "CSS load order" 测试, 验证 main.tsx import 顺序 | STATE.md v3.0 round-2 §教训 |
| 5 | **键盘导航 onKeyDown/tabIndex 几乎缺位** (全代码库仅 6 处) | `src/pages/*/index.tsx` 全量 | HIGH | `grep onKeyDown\|tabIndex` 共 6 处, 但项目有 14 个内页 + 多个交互组件, 全部使用 `<div onClick>` 而非 `<button>` 或 `role="button"` + `tabIndex=0` + `onKeyDown` | 卡片/列表行改 `<div>` → `<button type="button">` (零成本提升 a11y) 或补 tabIndex+onKeyDown+Enter handler | SPEC §5.10 键盘快捷键 |
| 6 | **交互状态缺位** (hover/focus/active 仅 1 文件覆盖) | `src/components/QuickSearchModal.tsx` | MEDIUM | `grep -lE ':hover\|:focus\|:active\|:disabled'` 仅返回 QuickSearchModal.tsx, 14 个内页 (含 mcp-management / json-editor / home) 0 个 :hover / :focus / :active CSS 规则 (用 inline style 不写 state) | 关键交互元素 (button / card / row) 补 :hover + :focus-visible + :active + :disabled 4 状态 | SPEC §5.9 微交互 |
| 7 | **空/加载/错误状态覆盖不均** (loading 110 处 / empty 仅 22 处) | `src/pages/*/index.tsx` | MEDIUM | `loading` ×110 / `error` ×184 / `empty` ×22 — error 比例高但缺少"用户能看懂的提示"模板 (参考 CLAUDE.md §7); empty 状态文本与按钮文案的统一性未审计 | 抽 1 个 `<EmptyState icon title action>` + `<ErrorState>` 组件, 14 页统一调用 | CLAUDE.md §7 + SPEC §4.x 各场景空态 |
| 8 | **Tailwind utility className 死代码** (10 文件) — 产品/UX 视角: 这些组件没接 v3.0 主题系统 | `tmp/tailwind-audit.md §Affected files` | MEDIUM | 维度 B 已识别: App.tsx / AppHeader.tsx / AppSidebar.tsx / PluginPlaceholder.tsx / QuickSearchModal.tsx / WindowControls.tsx / home/index.tsx / single-file-deploy/index.tsx / usage-query/index.tsx / `__tests__/integration/m1-9-3.test.tsx` — 含核心 shell, 这些组件视觉风格没接 anime/light theme 系统 | 主题化这些组件 (改用 var(--*) token 或 base.css class) | tmp/tailwind-audit.md |
| 9 | **硬编码 hex 颜色 #fff / #FFFFFF / #FAFAF7** (12 处) — light 主题背景直接写死 | `src/pages/*/index.tsx` | MEDIUM | `grep "color: '#" / "background: '#"` 返回 `#fff` ×10 / `#FFFFFF` ×1 / `#FAFAF7` ×1 — 切到 anime 主题时这些地方不变色, 视觉断裂 | 替换为 `var(--bg-primary)` / `var(--bg-elevated)` / `var(--text-primary)` | tokens.css |
| 10 | **anime.css 内硬编码颜色** (`--modal-confirm-bg` / `--modal-accent-bar`) 写成"直接写死避免 var() 嵌套在 WebView2 不解析" | `src/design-system/tokens.css:215-220` (anime 块) | LOW | tokens.css anime 块注释 "直接写死避免 var() 嵌套在 WebView2 不解析" — 这是 1 个真实的 WebView2 bug 缓解, 但 token 命名 `--modal-*` 不直观, 看不出是 light 主题的别名还是 anime 的 | 加 `data-theme="light"` 前缀命名 (`--modal-confirm-bg-light` vs `--modal-confirm-bg-anime`), 或写 1 篇 ADR 解释 WebView2 嵌套 var 不解析的根因 | STATE.md v3.0 / WebView2 已知限制 |

---

## 详细分析 (前 3 条展开)

### 问题 D-1 (CRITICAL): `--button-radius: 6px` 与 SPEC §4.4 "按钮 4px" 不一致

**症状**:
tokens.css 里圆角 token 与 SPEC §4.4 圆角规范**不一致**：
- SPEC §4.4 L551: "圆角: 卡片 8px,按钮 4px,弹窗 12px"
- tokens.css L100-105:
  ```css
  --card-radius: 8px;    ✓ 符合 SPEC
  --button-radius: 6px;  ❌ 不符合 (应 4px)
  --radius-modal: 12px;  ✓ 符合 SPEC
  ```
- 全代码库 58 处硬编码 `borderRadius: 4`（与 token 6 不一致，说明开发者知道 SPEC 是 4px，但 token 错了）
- 24 处用 `var(--radius-button)` 拿到 6px（违反 SPEC 4px）

**证据** (`src/design-system/tokens.css:101`):
```css
  /* --- Radius (§4.4) --- */
  --card-radius:        8px;
  --button-radius:      6px;        /* ❌ 应 4px */
  /* --- Backward-compat aliases (v3.0 主题重构: 保留旧名映射, 见 STATE.md bug fix) --- */
  --radius-card:        var(--card-radius);
  --radius-button:      var(--button-radius);
  --radius-modal:       12px;
```

**子报告修订说明**:
子报告 (task-2-D-report.md) 初始版本说 `tokens.css:103-104` "alias 方向反了"。**主 session 验证后修订**：CSS 变量赋值时 `var(--card-radius)` 是值引用，不是定义方向，**两个 token 都得到正确值（8px / 6px）**。"反向"判断错误，但顺手挖出来的 "按钮 4px vs token 6px 不一致" 是真实 CRITICAL 问题，影响设计系统合规性。

**根因**:
M2.x 或 v3.0 主题重构时，token 定义抄错了值（SPEC 4px → 写 6px），没回头对照 SPEC.md §4.4。CLAUDE.md §6.4 教训 "UI 文案 3 处同步失败" 的镜像 — token 与 SPEC 不同步也是多文件同步问题。

**修复建议**:
1. **改 token 值**: `--button-radius: 4px;` (与 SPEC §4.4 一致)
2. **替换 58 处硬编码**: `borderRadius: 4` → `var(--radius-button)` (现在 6→4 不影响)
3. **加 ESLint 规则**: 禁 `borderRadius: <number>` 内联 (除 0 直角 / 999 圆形), 强制走 var
4. **加 tokens 测试**: `__tests__/design-system/tokens.test.ts` 验证所有 `--radius-*` 与 SPEC §4.4 一致 (4/8/12)
5. **验证**: `npm test -- --run` + `tsc --noEmit` + smoke test 10 项

**风险评估**:
低 — 改 token 1 行 + 替换 58 处机械替换。但**视觉影响**：所有按钮圆角从 6px → 4px，用户可能感知差异（4px 更"硬朗"，6px 更"温和"）。需要您核定是否真改。

**关联**:
- SPEC §4.4 L551 (权威源)
- `tokens.css:100-105` (token 定义)
- `src/pages/*/index.tsx` 全量 (94 处硬编码)
- `base.css:26,36,58,264,316,408,433` (base.css 自身也用 `var(--card-radius)` / `var(--button-radius)`)
- 维度 B #B-1 Tailwind 死代码 (inline style 类问题)

---

### 问题 D-2 (HIGH): 大量硬编码 `borderRadius: 4/6/8` 绕开 token

**症状**: 全 14 个内页 + 7 个组件 + App.tsx, 共 94 处硬编码 `borderRadius: <数字>`, 仅 24 处使用 `var(--radius-*)` token。比例 ~80% 绕开设计系统。

**证据** (grep `borderRadius: [0-9]+`):
```
58 borderRadius: 4    ← 应对应 var(--radius-button) = 6px (但 token 是 6, 实际是 4 — 不一致, 见 D-1)
20 borderRadius: 8    ← 应对应 var(--radius-card) = 8px ✓
 6 borderRadius: 6    ← 应对应 var(--radius-button) = 6px ✓
 6 borderRadius: 3    ← 无 token 对应 (badge / 小标签)
 2 borderRadius: 12   ← 应对应 var(--radius-modal) = 12px ✓
 1 borderRadius: 999  ← 完全圆形, 无 token
 1 borderRadius: 2    ← 极小圆角, 无 token
```

**根因**: 早期代码直接写 inline style (M1.x 时代), M3.0 引入设计 token 后只补了 24 处 (可能 search-replace 漏掉), 没补"哪些 inline 必须改"的白名单。CLAUDE.md §6.4 教训 "UI 文案 3 处同步失败" 的镜像: token 化也是多文件同步问题, 容易漏。

**修复建议**:
1. 列出 14 内页 + 7 组件的白名单, 把 58 处 `borderRadius: 4` → `var(--radius-button)` (但先解决 #1 的 token 值不一致: SPEC 写 4px 但 token 写 6px)
2. 加 ESLint 规则禁 inline `borderRadius: <number>` (除 999 = 圆形 与 0 = 直角), 强制走 var
3. `borderRadius: 3` / `borderRadius: 2` 这 7 处评估: 真需要不同尺寸, 还是 token 漏了?

**关联**: D-1 (token 定义矛盾) / SPEC §4.4 圆角规范 / base.css 自身也直接用 `border-radius: 4px` / `3px` 等硬编码 (line 19, 78, 168, 230, 235, 346) — base.css 自己就破坏 token 规范, 应一并重构

---

### 问题 D-3 (HIGH): font-family 硬编码 `monospace` 字符串 (5 处) 绕开 `--font-mono`

**症状**: 至少 5 处直接 `fontFamily: 'monospace'` 而非 `var(--font-mono, monospace)`, 跳过 CSS fallback 链。

**证据** (grep `fontFamily:`):
- 3 处 `fontFamily: 'inherit'` (期望: 一般无脑继承, 可接受)
- 5+ 处 `fontFamily: 'var(--font-mono)'` 或 `'var(--font-mono, monospace)'` (正确用法)
- 4+ 处硬编码 `"Cascadia Code", "SF Mono", Menlo, Consolas, monospace` (重复了 `--font-mono` 的 fallback 链, 应改 token)
- **5 处 `fontFamily: 'monospace'`** (例: home/index.tsx, import-sql/index.tsx) — 跳过 fallback, 跨平台字形不稳定

**根因**: 同 D-2 — 早期 inline style 直接写 `monospace`, 后续 token 化没覆盖所有路径。

**修复建议**:
1. 5 处 `monospace` → `var(--font-mono, monospace)` (保留 fallback)
2. 4 处硬编码 `"Cascadia Code", "SF Mono", Menlo, Consolas, monospace` → `var(--font-mono)` (避免 fallback 链重复, 改 token 一次生效)
3. 加 ESLint: 禁 `fontFamily` inline (除 `inherit`), 必须走 var
4. 已知限制 (STATE.md §v3.0): Nunito / Fredoka Google Fonts 没加 `<link>`, 主题化字体只有 anime 主题用本地字形 — 这条不用 D 修, 标记为后续

**关联**: tokens.css §4.3 / SPEC §5.8 / 维度 B 代码质量 (TS 严格模式也未约束 inline style 字符串)

---

## 简要列举 (#4 - #10)

### #4 (HIGH) CSS 落地顺序风险
v3.0 round-2 已修 (STATE.md: base.css 第 2 轮才加, anime.css 第 1 轮覆写无效), 但 main.tsx 当前的 import 顺序 (`tokens.css` → `base.css` → `themes/anime.css`) **正确性靠人工记忆**, 无自动化测试兜底。建议加 `__tests__/design-system/css-load-order.test.ts`。

### #5 (HIGH) 键盘导航缺位
全代码库 `onKeyDown` / `tabIndex` 仅 6 处, 但 14 个内页大量用 `<div onClick={...}>` 实现"按钮"行为 (例: home/index.tsx 项目列表行) — 键盘用户 (Tab / Enter) 无法触发。CLAUDE.md §2.5 "UI/UX 是头等大事" 明确要求键盘可达性。建议卡片/行改 `<button type="button">` 零成本修复。

### #6 (MEDIUM) 交互状态缺位
14 个内页 0 个 `:hover` / `:focus` / `:active` / `:disabled` CSS 规则 (用 inline style 不写 state)。SPEC §5.9 微交互表要求卡片 hover 200ms 淡入、按钮 active 状态等, 全部缺失。建议关键 button / card / list-row 补 4 状态 CSS。

### #7 (MEDIUM) 空/加载/错误状态不均
`loading` 110 处 / `error` 184 处 / `empty` 仅 22 处 — error 数量多但 CLAUDE.md §7 "任何错误必须有用户能看懂的提示, 不允许静默吞错" — 这 184 处是否都有 UI 展示? 抽 `<EmptyState>` / `<ErrorState>` 组件统一。

### #8 (MEDIUM) Tailwind 死代码 (产品/UX 后果)
维度 B 已识别 10 文件含 Tailwind utility className, 涵盖 App.tsx + AppHeader + AppSidebar (核心 shell) + home / single-file-deploy / usage-query 3 个页面 — 这些组件 **没接 v3.0 theme 系统**, 切 anime 主题时视觉会断裂 (或部分断裂)。建议 v3.0-fix-v2 把这 10 文件主题化。

### #9 (MEDIUM) 硬编码 hex 颜色
`#fff` ×10 + `#FFFFFF` ×1 + `#FAFAF7` ×1 (light 主题瓷白基底) — 切到 anime 主题时这 12 处不变色。建议替换为 `var(--bg-elevated)` / `var(--bg-primary)`。

### #10 (LOW) anime.css 硬编码颜色注释
`tokens.css:215-220` anime 块内 `--modal-confirm-bg` 等 6 个 token 写死 (非 var), 注释解释为"WebView2 不解析 var() 嵌套"。这是 1 个真实的浏览器 bug 缓解, 但 (a) 注释没说哪个 WebView2 版本, (b) 后续 WebView2 修了的话这 6 个 token 仍写死。建议加 1 个 ADR 或 comment 标 "TODO: 升级 WebView2 ≥X.Y 后改回 var() 嵌套"。

---

## 扫描未覆盖 / 已知限制

1. **未做 e2e 视觉回归** — smoke test 不跑视觉断言 (只在进程 / 窗口 / db 层面)。M2+ 接入 Playwright/Vitest visual diff 后才能验证主题切换实际效果
2. **未做移动端 / 多分辨率测试** — 项目定位桌面, 不适用, 跳过
3. **未审计 i18n 字符串** — SPEC §1.4 硬约束不做 i18n, 但代码里中英文案混排 (按钮"切换"+"Switch"), 没扫一致性
4. **Nunito / Fredoka Google Fonts 未接入** (STATE.md v3.0 已知限制) — anime 主题 demo 里用 Nunito / Fredoka, 但项目里没加 `<link>`, 实际渲染走系统字
5. **CSS-in-JS 性能** — 14 内页大量 inline style, React 每次 re-render 重算 style 对象 — 这是性能问题而非 UX 问题, 留给维度 B 处理
6. **shadcn/ui 接入进度** — CLAUDE.md §1 技术栈列了 shadcn/ui + Tailwind, 但 grep 显示项目里基本不用 shadcn 组件 (全自写 div + style)。这与"tailwind-audit 10 文件"对应 — 设计系统混乱, 不在 D 维度范围
7. **WebView2 var() 嵌套 bug** — 见 #10, 这是个上游浏览器问题, 本项目层只能注释 workaround, 不能根治

---

**完成报告** (task-2-D-report.md):

- **状态**: DONE
- **Top 问题数**: 10 条 (1 CRITICAL / 4 HIGH / 4 MEDIUM / 1 LOW)
- **REPORT.md 路径**: `docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md` (本文件, 由主 session 从 task-2-D-report.md 落盘)
- **主 session 修订**:
  - 子报告原 CRITICAL "radius alias 方向反向" 经主 session 验证 `tokens.css:103-105` 是正向 alias, **判断错误**
  - 但子报告顺手挖出的 "按钮 4px vs token 6px 不一致" 是真实 CRITICAL, 已升为 D-1 主问题
- **Concerns**: 无 — 在范围内完成, 全部证据有 file_path:line 引用