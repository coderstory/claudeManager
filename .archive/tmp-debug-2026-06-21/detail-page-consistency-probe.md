# Detail Page 实测数据 (raw probe)

> 13 views × computed style. launch: release exe + `--remote-debugging-port=9223`, 13 views probed.
> Probe script: `tmp/probe_detail_consistency.cjs`, deep probe: `tmp/probe_deep2.cjs`.

## Bug A — Back 按钮

| view | back 存在 |
|---|---|
| home | **false** (基线) |
| provider-list | true |
| provider-switch | true |
| import-sql | true |
| deeplink-import | true |
| json-editor | true |
| mcp-management | true |
| usage-query | true |
| single-file-deploy | true |
| backup-restore | true |
| optimizer | true |
| resource-browser | true |
| marketplace | true |

**结论**: 用户报告"Provider 列表 + SQL 导入多 back，其他没有"是**错的**。**所有 12 个非 home 页面都有 back 按钮**。
- 根因: `src/components/AppHeader.tsx:L128` 条件 `{!isHome && <button data-testid="app-header-back" .../>}`。
- `isHome` 只在 `currentView === 'home'` 时为 true (`useViewState.ts:L51` `HOME_VIEW = 'home'`)。
- 所以**任何非 home view 都显示 back 按钮**——这是 by design,不是 bug。

## Bug B — 详情页样式 (wrapper padding + h1)

| view | wrapper.padding | max-width | h1.text | h1.fontSize | h1.fontWeight | h1.marginTop |
|---|---|---|---|---|---|---|
| home | `32px` | none | "欢迎使用 Claude 配置管理器" | **20px** | 600 | 13.4px |
| provider-list | `24px` | none | "Provider 列表" | **18px** | 600 | 0 |
| provider-switch | `24px` (var(--space-6)) | none | (无 h1,只是简单 stub) | — | — | — |
| import-sql | `24px` | none | "导入 .sql" | **18px** | 600 | 0 |
| deeplink-import | `32px 40px` | 720px | "Deeplink 导入" | **20px** | 600 | 13.4px |
| json-editor | `32px 40px` | 960px | "JSON 编辑器" | **20px** | 600 | 13.4px |
| mcp-management | `32px 40px` | 1080px | "MCP 管理" | **20px** | 600 | 13.4px |
| usage-query | `24px` | 896px | "用量查询" | **24px** | 600 | 16.08px |
| single-file-deploy | `24px` | 896px | "单文件部署" | **24px** | 600 | 16.08px |
| backup-restore | `32px 40px` | 1280px | "备份与恢复" | **20px** | 600 | 13.4px |
| optimizer | `24px` | 1100px | "配置优化检查" (是 H2!) | **18px** | 600 | 0 |
| resource-browser | `24px` | 1100px | (无 h1 / 待确认) | — | — | — |
| marketplace | `32px` (top=24px) | none | "资源市场" | **18px** | 600 | 12.06px |

### 不一致汇总

- **wrapper.padding 一致性**: 0/13 全统一
  - 4 种值: `24px` / `32px 40px` / `32px` / `32px`+marginTop
  - `24px` (6 个): provider-list, provider-switch, import-sql, usage-query, single-file-deploy, optimizer, resource-browser
  - `32px 40px` (4 个): deeplink-import, json-editor, mcp-management, backup-restore
  - `32px` (2 个): home, marketplace
- **h1.fontSize 一致性**: 0/13 全统一
  - 3 种值: 18px / 20px / 24px
  - 18px: provider-list, import-sql, optimizer, marketplace, (resource-browser 缺数据)
  - 20px: home, deeplink-import, json-editor, mcp-management, backup-restore
  - 24px: usage-query, single-file-deploy
- **maxWidth 一致性**: 0/13 全统一
  - 4 种值: none / 720 / 896 / 960 / 1080 / 1100 / 1280
- **h1 元素缺失**: provider-switch 整个 view 没有 h1 (只有一行文字 stub); resource-browser 也没 h1 (待确认)
- **h1 vs h2**: optimizer 用 h2 不是 h1

### card padding

| view | card.padding | card.borderRadius | card.boxShadow |
|---|---|---|---|
| home | 0 | 0 | none |
| provider-list | 0 | 0 | none |
| import-sql | 0 | 0 | none |
| deeplink-import | 0 | 0 | none |
| json-editor | 0 | 0 | none |
| mcp-management | 0 | 0 | none |
| usage-query | **20px** | **8px** | none |
| single-file-deploy | **16px** | **8px** | rgba(0,0,0,0.04) 0 1px 3px |
| backup-restore | 0 | 0 | none |
| optimizer | 0 | 0 | none |
| resource-browser | 0 | 0 | none |
| marketplace | 0 | 0 | none |

注: probe 找的是 "第一个 class*=card 或 data-testid*=card",很多页面 wrapper 内部不是统一 card 模式,所以 padding 0 不代表真的没卡片(可能是 list 模式 + 子元素自己 padding)。

## Bug C — Sidebar 菜单名

| view | 显示名 |
|---|---|
| home | 欢迎页 |
| provider-list | Provider 列表 |
| provider-switch | Provider 切换 |
| import-sql | **.sql 导入** |
| deeplink-import | **Deeplink 导入** |
| json-editor | JSON 编辑器 |
| mcp-management | MCP 管理 |
| usage-query | 用量查询 |
| single-file-deploy | 单文件部署 |
| backup-restore | 备份与恢复 |
| optimizer | 配置优化 |
| resource-browser | 资源浏览 |
| marketplace | 资源市场 |

### 命名模式分析

- **混合命名**: 12 个 plugin 标签
  - `<English> + <中文>` (provider-list → "Provider 列表", provider-switch → "Provider 切换"): 2 个
  - `<English> + <中文>` (json-editor → "JSON 编辑器", import-sql → ".sql 导入", deeplink-import → "Deeplink 导入"): 3 个
  - **纯中文**: mcp-management → "MCP 管理", usage-query → "用量查询", single-file-deploy → "单文件部署", backup-restore → "备份与恢复", optimizer → "配置优化", resource-browser → "资源浏览", marketplace → "资源市场", home → "欢迎页": 8 个
- **不一致点**:
  - **MCP** 在 mcp-management 标签里是 **"MCP 管理"** (English+中文),但 MCP 是公认的 Claude 概念名,不是混搭问题
  - **JSON** → "JSON 编辑器" (English+中文)
  - **.sql** → ".sql 导入" (保留扩展名作为产品名,合理)
  - **Deeplink** → "Deeplink 导入" (English+中文) — "Deeplink" 是不是用户能理解的词?
  - **没有 "管理" 后缀但带**: 实际上 "MCP 管理" / "备份与恢复" (没"管理"但有"恢复") / "资源浏览" (没"管理") / "配置优化" (没"管理")
  - **没有明显规律** — 有的是 动作+对象 (用量查询、单文件部署、备份与恢复),有的是 对象+动词 (MCP 管理、配置优化),有的是 纯名词 (欢迎页、资源市场、资源浏览、Provider 列表、Provider 切换)

### SPEC F1~F24 名称参考

SPEC §3.1 (F1~F24) 用的是:
- F1 "Provider 列表" ✓
- F2 "1 键切换" (我们的 sidebar 叫 "Provider 切换" — 不一致)
- F3 "拖放 .sql 导入" (我们的 sidebar 叫 ".sql 导入" — 可接受简化)
- F4 "Deeplink 导入" ✓
- F5 "JSON 编辑器" ✓
- F6 "MCP 管理" ✓
- F7 "用量查询" ✓
- F8 "单文件部署" ✓
- F16 "资源浏览" ✓
- F17 "资源市场" ✓
- F18 "配置优化" ✓
- F19 "备份与恢复" ✓

**唯一与 SPEC 不一致**: F2 sidebar 写 "Provider 切换",SPEC §3.1 写 "1 键切换" (但这是 §3.1 的描述标签,sidebar 叫 "Provider 切换" 也不算错,只是 SPEC 没用这个表述)
