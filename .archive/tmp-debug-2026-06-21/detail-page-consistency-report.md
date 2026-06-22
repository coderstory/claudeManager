# Detail Page 一致性诊断报告 (3 bugs)

> 任务: G. 详情页一致性诊断 (back / 样式 / 命名)
> 模式: **只诊断不修**,等用户拍板
> probe: `tmp/probe_detail_consistency.cjs` + `tmp/probe_deep2.cjs` (CDP 实测 release exe)
> 原始数据: `tmp/detail-page-probe-raw.json` + `tmp/detail-page-probe-deep.json`

---

## Bug A — Back 按钮不一致

### 用户报告
> "Provider 列表 + SQL 导入页面多了个后退按钮,其他详情页没有"

### 实测数据 (13 views, release exe via CDP)

| view | back 按钮存在? |
|---|---|
| home | false (基线) |
| provider-list | **true** |
| provider-switch | true |
| import-sql | **true** |
| deeplink-import | true |
| json-editor | true |
| mcp-management | true |
| usage-query | true |
| single-file-deploy | true |
| backup-restore | true |
| optimizer | true |
| resource-browser | true |
| marketplace | true |

**结论**: 用户报告是**错的**。**所有 12 个非 home 页面都有 back 按钮**,provider-list 和 import-sql 并不特殊。

### 源码根因 (文件:行号 + 逻辑)

- `src/components/AppHeader.tsx:L70` `const isHome = currentView === HOME_VIEW;`
- `src/components/AppHeader.tsx:L128` `{!isHome && <button data-testid="app-header-back" .../>}`
- `src/hooks/useViewState.ts:L51` `export const HOME_VIEW = 'home' as const;`
- `src/hooks/useViewState.ts:L71-84` ViewId 联合类型包含 13 个值,只有 `'home'` 是 home

→ 任何 `currentView !== 'home'` 都显示 back,**没有例外**。

### 设计意图 vs 实际

`AppHeader.tsx:17-22` 注释明确说:
> "M1.9 keeps the header lean: just a back button (when not on 'home')"

→ **这是 by design**。没有 "view 是否是 home 的子页面" 概念,所有 view 都是 root-level (L1),sidebar 13 个并列。
- `useViewState.ts:84-110` ALL_VIEWS 就是 13 个 root-level view 列表,无父子关系
- `SPEC.md §5.1` 也是 13 个 L1 页面

### 修复建议 (等用户拍板)

- **方案 1 (推荐)**: **不改**。**用户报告与实际不符,无 bug**。需要回用户确认"是不是你把 back 按钮误认为是 detail page 自带的?"
- **方案 2 (如果用户坚持要"detail page 不要 back")**: 改 `AppHeader.tsx:128`,把 `{!isHome}` 改成白名单 `{['provider-list', 'import-sql'].includes(currentView) && <button.../>}`。**不推荐**:会让 home 跟其他页面有 2 套行为,SPEC §5.1 不支持。
- **方案 3 (如果用户想要"全局不要 back")**: 改 `AppHeader.tsx:128` 永远不渲染 back 按钮,回到 home 用 sidebar 导航。**不推荐**:SPEC.md §5 没说要删 back。

---

## Bug B — 详情页样式不统一

### 实测数据 (13 views × computed style)

| view | wrapper.padding | max-width | h1.text | h1.fontSize | h1.tag | h1.marginTop |
|---|---|---|---|---|---|---|
| home | `32px` | none | "欢迎使用 Claude 配置管理器" | 20px | h1 | 13.4px |
| provider-list | `24px` | none | "Provider 列表" | 18px | h1 | 0 |
| provider-switch | `24px` (var(--space-6)) | none | (无 h1,stub) | — | — | — |
| import-sql | `24px` | none | "导入 .sql" | 18px | h1 | 0 |
| deeplink-import | `32px 40px` | 720px | "Deeplink 导入" | 20px | h1 | 13.4px |
| json-editor | `32px 40px` | 960px | "JSON 编辑器" | 20px | h1 | 13.4px |
| mcp-management | `32px 40px` | 1080px | "MCP 管理" | 20px | h1 | 13.4px |
| usage-query | `24px` | 896px | "用量查询" | 24px | h1 | 16.08px |
| single-file-deploy | `24px` | 896px | "单文件部署" | 24px | h1 | 16.08px |
| backup-restore | `32px 40px` | 1280px | "备份与恢复" | 20px | h1 | 13.4px |
| optimizer | `24px` | 1100px | "配置优化检查" | 18px | **h2** | 0 |
| resource-browser | `24px` | 1100px | (无 h1) | — | — | — |
| marketplace | `32px` (top=24px) | none | "资源市场" | 18px | h1 | 12.06px |

### 不一致汇总 (0/13 统一)

- **wrapper.padding**: **4 种值**
  - `24px` (7 个): provider-list, provider-switch, import-sql, usage-query, single-file-deploy, optimizer, resource-browser
  - `32px 40px` (4 个): deeplink-import, json-editor, mcp-management, backup-restore
  - `32px` (2 个): home, marketplace
- **h1.fontSize**: **3 种值**
  - 18px: provider-list, import-sql, optimizer (其实是 h2), marketplace, (+resource-browser 缺)
  - 20px: home, deeplink-import, json-editor, mcp-management, backup-restore
  - 24px: usage-query, single-file-deploy
- **max-width**: **6 种值** none / 720 / 896 / 960 / 1080 / 1100 / 1280
- **h1 缺失**: provider-switch (整个 view 只有一行 stub 文字) / resource-browser (待确认,可能位置更深)
- **h1 vs h2 错位**: optimizer 用 h2 (18px) 不是 h1

### SPEC 是否定义了基线?

- **SPEC.md §5.8 视觉规范** (L542-555) 只定义:
  - 间距: 4px 网格 (默认 8px) — 没指定 wrapper padding
  - 圆角: 卡片 8px,按钮 4px,弹窗 12px
  - 字号: **标题 16-20px**,正文 14px,辅助 12px — **模糊范围,没指定 detail page**
- **CLAUDE.md §4.4** (L78-82) 同 SPEC,只说 "标题 16-20px / 正文 14px / 辅助 12px"
- **没有 Plugin Detail Page 样式基线**

→ **SPEC 留了 gap**。这就是为什么 13 个 plugin 各自写了不同 padding/fontSize。

### 修复建议 (等用户拍板)

- **方案 1 (推荐)**: **先补 SPEC §5.14 "Plugin Detail Page 样式基线"**,再统一改:
  - wrapper.padding = `var(--space-6)` (24px, 已经在 token 里) 或 `var(--space-8) var(--space-12)` (32px 48px)
  - h1.fontSize = `var(--fs-heading)` (18px token) 或 20px(若加 token `--fs-page-title: 20px`)
  - h1.marginTop = 0 (header 已经有视觉边界,不要再加 margin)
  - max-width = 1080px (中等窗口友好)
  - 推一个 `<DetailPageLayout>` 包装组件,所有 plugin 共用
- **方案 2 (最省事)**: 改 App.tsx,新增一个 `<PageContainer>` 包装,所有 plugin 不再自己写 wrapper。12 个 plugin 文件 + 1 个新组件。
- **方案 3 (不动)**: 报告 gap,**不修**(CLAUDE.md §2.5 "UI/UX 头等大事"反对此选项)。

---

## Bug C — Sidebar 二级菜单名字不统一

### 实测 13 个菜单项的显示名

| view | sidebar 显示名 | 命名模式 |
|---|---|---|
| home | 欢迎页 | 纯中文 |
| provider-list | **Provider 列表** | English+中文 (2 字英文 + 2 字中文) |
| provider-switch | **Provider 切换** | English+中文 (2 字英文 + 2 字中文) |
| import-sql | **.sql 导入** | English (扩展名) + 中文 |
| deeplink-import | **Deeplink 导入** | English+中文 (8 字英文 + 2 字中文) |
| json-editor | **JSON 编辑器** | English (缩写) + 中文 |
| mcp-management | **MCP 管理** | English (缩写) + 中文 |
| usage-query | **用量查询** | 纯中文 (4 字) |
| single-file-deploy | **单文件部署** | 纯中文 (5 字) |
| backup-restore | **备份与恢复** | 纯中文 (5 字) |
| optimizer | **配置优化** | 纯中文 (4 字) |
| resource-browser | **资源浏览** | 纯中文 (4 字) |
| marketplace | **资源市场** | 纯中文 (4 字) |

### 命名规律分析

- **8 个纯中文**: 欢迎页,用量查询,单文件部署,备份与恢复,配置优化,资源浏览,资源市场 (+ home)
- **5 个 English+中文**: Provider 列表, Provider 切换, .sql 导入, Deeplink 导入, JSON 编辑器, MCP 管理
- **不一致点**:
  - **MCP / JSON / .sql** 保留 English 缩写 → 合理(通用术语)
  - **Provider** 保留 English → 合理(产品名,CLAUDE.md §3.1 也用 "Provider")
  - **Deeplink** 保留 English → **可疑**: 用户可能看不懂 "Deeplink" 是什么,叫"链接导入"或"URL 导入"更友好
  - **没有"管理"后缀统一**: MCP 管理有"管理",用量查询/单文件部署/备份与恢复没"管理"但也合理(动作描述)
  - **没有明显 bug**,但**格式没强制**(3/4 字 / 5 字混着),读起来不太整齐

### SPEC §3.1 名称对照

SPEC.md §3.1 (L132-152) 用了:
- F1 "Provider 列表" ✓
- F2 "1 键切换" (sidebar 写 "Provider 切换" — 与 SPEC 描述不同,但 SPEC 这行是描述,sidebar 是产品标签,合理简化)
- F3 ".sql 导入" ✓
- F4 "Deeplink 导入" ✓
- F5 "JSON 编辑器" ✓
- F6 "MCP 管理" ✓
- F7 "用量查询" ✓
- F8 "单文件部署" ✓
- F16 "资源浏览" ✓
- F17 "资源市场" ✓
- F18 "配置优化" ✓
- F19 "备份与恢复" ✓

**所有 sidebar 名称都与 SPEC §3.1 一致**(F2 是简化,不算冲突)。

### 修复建议 (等用户拍板)

- **方案 1 (推荐)**: **不改**。所有名称都跟 SPEC §3.1 对得上,"Deeplink" 是 URL Scheme 通用名,保留可接受。
- **方案 2 (如果想"Deeplink"本地化)**: 改 `src/components/AppSidebar.tsx:L72` `'deeplink-import': { ..., short: 'Deeplink 导入' }` → `'URL 导入'`。需要更新 SPEC §3.1 + 页面内引用。
- **方案 3 (统一格式)**: 改 `AppSidebar.tsx` 的 `VIEW_META.short`,强制全部 4 字中文。**不推荐**:会丢 "Provider" / "MCP" / "JSON" 这些公认术语。

---

## 建议执行顺序 (等用户拍板)

**Bug A: 不用修(用户报告与实际不符)。**
**Bug B: 是真 bug,需要先补 SPEC 基线 + 推 `<DetailPageLayout>` 包装。影响 12 个 plugin 文件。**
**Bug C: 不算 bug,全部对齐 SPEC。**

如果用户要全部修:
- 一次 commit 改 3 个 (含 SPEC §5.14 补写 + Layout 组件 + Bug A 维持原状)
- 分 3 个 commit: B1=SPEC, B2=Layout, C=sidebar 调整
- **不建议分开修 Bug A**(本来就没 bug)

需要用户拍板:
1. Bug A 是不是真 bug(回用户澄清)
2. Bug B 是否补 SPEC §5.14 样式基线?padding 用 24px 还是 32px 48px?h1 字号 18px 还是 20px?
3. Bug C 是否改 "Deeplink 导入" → "URL 导入"?
