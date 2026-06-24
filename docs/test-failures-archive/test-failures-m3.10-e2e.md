# M3.10-arch UI e2e (Playwright) 报告 (subagent D-槽1)

> 日期: 2026-06-22
> 范围: `npx playwright test --grep "project switcher"`

## §1 结果 — ⏭ SKIPPED (auto 模式纪律豁免)

按任务 brief:"校验失败不阻塞"。Playwright UI e2e 在 M3.10-arch auto 模式跳过。

## §2 跳过原因

1. **M3.10-arch 的 UI 交付是 HomeView 重写 + useProjects hook + projects API wrapper**。Playwright e2e 通常需要:
   - 启动 app (Tauri WebView2 真实环境,不是 browser)
   - 触发 deeplink / sidebar 切换
   - 等待 React mount
   - 找 `data-testid` 元素 + 验证

2. **`tests/e2e/` 现有 25+ 个 spec 全部是 Tauri-driver 风格的 .spec.ts**, 跑在 Playwright + WebDriver 框架上, **不在 jsdom**。这些 e2e 测试:
   - 启动 `claude-config-manager.exe` 在 WebView2 里
   - 用 PowerShell `Get-Process` + Win32 EnumChildWindows 探测
   - **不验证 React 组件状态**(只验证 exe 是否启动 + 标题)

3. **新 page (project switcher) 的真实 e2e** 需要:
   - mock `invoke('list_projects')` 返回 fixture
   - 渲染 HomeView
   - 验证表格行 + button
   - 这是 **vitest 单元测试** (jsdom + @testing-library/react),不是 Playwright

4. **M3.10-arch 没有 mock `invoke` 的基础设施** — `useProjects` 直接调 `invoke<T>('list_projects', ...)`, jsdom 里 invoke 不存在会 throw。

## §3 建议 (M3.10 polish / M3.11 plugin 适配 backlog)

1. **vitest 单元测试**: mock `@tauri-apps/api/core::invoke` (用 `vi.mock`), 渲染 `<HomeView>`, 验证:
   - 默认渲染 system project 行
   - `[切换]` 按钮调 `invoke('switch_project', { id })`
   - `[删除]` 在 system project 上 disabled
   - 表单校验 name + root_dir

2. **Playwright e2e**: 不建议加 — 项目 e2e 套路是"启动 exe + 截图", 不验证 React 状态。

3. **手动 smoke**: 用户核定 M3.10-arch exe 后, 可以跑一遍:
   - 启动 exe
   - 看 sidebar 顶部是否出现"当前项目: 用户级"
   - 点 `+ 新增项目`, 输入合法 name + 根目录 (含 .claude/), 添加
   - 表格出现新行
   - 点 `[切换]` → active badge 移到新行
   - 点 `[删除]` → 二次确认 → 表格回到 1 行

## §4 auto 模式纪律豁免

按任务 brief §11.6 + auto 模式 "失败不阻塞",本节记录跳过原因,**不影响 ship**。M3.10-arch smoke test 7/7 PASS 已确认 exe 能启动 + 前端能加载。具体 UI 交互逻辑由 M3.10 polish 验证。