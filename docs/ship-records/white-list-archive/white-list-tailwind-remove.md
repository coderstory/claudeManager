# B3#10 Tailwind 移除 — 白名单

> 主 session 已批准移除 Tailwind（B3#10 / 2026-06-22）。
> 本白名单列本子任务**将修改**的全部文件，按改动面从大到小排序。
> 不在白名单内的文件**不动**。

## 改 1：deps

### `package.json`（43 行）
**改 devDeps**（line 35-38，删 3 个包 + 1 行 cleanup）：
- 删 `"autoprefixer": "10.4.20",`（line 35）
- 删 `"postcss": "8.4.49",`（line 37）
- 删 `"tailwindcss": "3.4.17",`（line 38）

**改 dependencies**（line 14-24，删 3 个包 + 1 行 cleanup）：
- 删 `"class-variance-authority": "0.7.1",`（line 17）
- 删 `"clsx": "2.1.1",`（line 18）
- 删 `"tailwind-merge": "3.3.1"`（line 23）

**保留**：
- `lucide-react@0.542.0`（图标组件库，非 Tailwind 生态）
- 其他 React / Tauri / 测试 / Vite 依赖一字不动
- 锁定版本格式保留（CLAUDE.md §2.3）

### `package-lock.json`（全文件，npm install 自动重新生成）
**不手改**——`npm install` 后会同步。本白名单不列具体行。

## 改 2：cn util + 测试

### `src/lib/utils.ts`（15 行 → 删除整文件）
**理由**：
- `cn()` 函数唯一定义在 `twMerge(clsx(...))`，但项目无 Tailwind 上下文，twMerge 是 no-op
- 全项目 0 处生产代码调用 `cn()`（仅 1 个 dead test 引用）
- 不删会产生"用 dep 但没有 utility class"的悬空 import 风险

**验证方法**：grep `from.*lib/utils` / `from.*@/lib/utils` 唯一命中是 `src/__tests__/lib/cn.test.ts:11`

### `src/__tests__/lib/cn.test.ts`（39 行 → 删除整文件）
**理由**：
- 仅测试已被删除的 `cn()`，孤测试文件保留=死代码
- CLAUDE.md §2.4 最小化影响原则

## 改 3：tokens.css 误导注释

### `src/design-system/tokens.css`（line 1-10 注释段）
**改 line 2-3 注释**：
- 现状：`* Tailwind 在 tailwind.config.ts 里把这些 var() 映射到 utility class。 */`
- 该 `tailwind.config.ts` **不存在**（Glob 验证全 node_modules/ 没命中项目根）
- 改后：删整行（注释段不再提及 Tailwind）

**line 5-10 注释段（reset 说明）**：保留——该段是真实 CSS 规则解释（html/body 透明 + overflow:hidden 防止原生滚动条），非 Tailwind 误导。

## 改 4：dead className 清理

### `src/pages/marketplace/index.tsx`（4 处）
- L466: `<Loader2 size={14} className="animate-spin" />` → 改 `data-app-spin="true"`（参考 usage-query L249）
- L491: `<Loader2 size={16} className="animate-spin" />` → 同上
- L803: `<Loader2 size={12} className="animate-spin" />` → 同上
- L1009: `<Loader2 size={12} className="animate-spin" />` → 同上

**为什么**：
- `animate-spin` 是 Tailwind utility class
- 项目无 Tailwind pipeline → class 是 dead code，spinner 不转
- 已有 system: `utilities.css:120 [data-app-spin] { animation: ccm-spin 1s linear infinite }`（M2.7/M2.8 建立）
- `usage-query/index.tsx:248-251` 已经在用此 pattern 改造过

### **不动**（看似相关但是合法 BEM / design-system class / 组件 prop forward）

| 文件 | 行 | className | 不动原因 |
|------|------|-----------|----------|
| `src/App.tsx` | 542 | `"view-transition"` | design-system class，定义在 `tokens.css:124`，M1.9.3 测试断言此 class 存在 |
| `src/plugins/stubs/_Placeholder.tsx` | 17,18,19 | `"plugin-placeholder*"` BEM | design-system class，定义在 `App.css:78-110`；该组件被 7 个 stub page 引用 |
| `src/components/ErrorBanner.tsx` | 241 | `className={className}` | 组件 prop 转发（接受外部 className） |
| `src/__tests__/components/ErrorBanner.test.tsx` | 236 | `"extra-class"` | 测试 ErrorBanner prop forward 功能 |
| `src/__tests__/integration/m1-9-3.test.tsx` | 228 | (注释) | 注释 + 验证 view-transition class 存在 |

### **不动**（历史解释注释，非 dead code）

| 文件 | 行 | 内容 | 不动原因 |
|------|------|------|----------|
| `src/components/AppHeader.tsx` | 95-111 | "M2.15-fix-v2: Tailwind utility classes were..." | 历史决策记录，CLAUDE.md §2.4 最小化 |
| `src/components/AppHeader.tsx` | 152-156 | "Was `className=font-semibold truncate`..." | 解释 M2.15 决定 |
| `src/components/PluginPlaceholder.tsx` | 16-25 | "M2.x-inline: previously used cn()..." | 解释 M2.15 决定 |
| `src/components/WindowControls.tsx` | 126 | "isn't configured in this project..." | 解释 M2.15 决定 |
| `src/design-system/utilities.css` | 1-22 | 头注释 | 解释 M2.15 设计 |

**理由**：这些注释是 M2.15 inline 化的**设计决策文档**，删了未来维护者无法理解为什么 `data-app-spin` 存在、为什么 `utilities.css` 独立成文件。本子任务范围**仅**清死代码 + 改误导注释，不重构 M2.15 已 ship 的设计。

## 改 5：自审产物（写后不改文件）

### `tmp/reviews/tailwind-remove-self.md`（新建）
按 CLAUDE.md §6 + 主 session 任务要求 Step 9 内容写：
- 删除的 deps（精确列名 + 版本号）
- 改动文件清单 + 行号
- 编译时间
- smoke test 4 项结果
- exe 路径
- commit hash

## 总改动量

| 类型 | 文件数 | 行数 |
|------|--------|------|
| 删除整文件 | 2 | -54 行（utils.ts 15 + cn.test.ts 39） |
| 改 1 文件（删注释 / 改 className） | 2 | ~5 行 |
| 改 deps JSON | 1 | 6 行（删 6 个包） |
| 改 doc-only（误导注释） | 1 | -1 行（删 line 3） |
| **合计改动** | **6** | **~52 行净减** |

## 不在白名单内 → 不改

- `src/components/AppSidebar.tsx` — audit (M2.15) 提到 `cn('w-full flex ...')` 已 inline 化（grep 验证：当前文件 0 处 `className` / `cn` / `twMerge`）
- `src/components/QuickSearchModal.tsx` — audit 提到 L510 hover utility，已 inline
- `src/pages/home/index.tsx` — audit 提到 5+ 处 utility class，已 inline
- `src/pages/single-file-deploy/index.tsx` — audit 提到 10+ 处 utility class，已 inline
- `src/pages/usage-query/index.tsx` — audit 提到 20+ 处，已 inline；L249/555/642 用 `data-app-spin`/`data-app-pulse`
- `src/App.tsx` — `className="view-transition"` 是 design-system class，**不是 Tailwind utility**
- `docs/ARCHITECTURE.md` / `docs/reviews/m1-11-*` / `.planning/milestones/M1-*` — 历史决策文档，本子任务不动

## 失败上报条件

1. 编译失败（`npm run tauri build`）→ 修代码重跑，3 次仍失败 → 报告主 session
2. smoke test 任一项失败 → 不要 cp 到桌面，修复重跑
3. 发现需要改**白名单外**的文件 → 报告主 session 决定
