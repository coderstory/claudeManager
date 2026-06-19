/**
 * App — top-level layout + view router (M1.9).
 *
 * WHY WE'RE NOT USING react-ROUTER FOR VIEW SWITCHING
 * ---------------------------------------------------
 *   This app only ever shows ONE primary view at a time (no nested
 *   routes, no outlet, no URL-based deep linking to specific
 *   plugin state — those land in M2+ via Tauri's deep-link
 *   protocol). For a single-pane router, cc-switch's
 *   `useState<View>` + localStorage pattern is materially better
 *   than `<HashRouter><Routes>...</Routes></HashRouter>`:
 *
 *     - 12 plugin tiles → 13 lines of `useState`. react-router
 *       needs a <Routes> with 13 <Route> entries, a HashRouter
 *       wrapper, plus a useNavigate / useLocation bridge for
 *       programmatic switching.
 *     - The "remember last view" requirement is a single
 *       localStorage key in cc-switch mode. react-router's
 *       <HashRouter> auto-syncs to location.hash, but reading
 *       "is the user on / or /mcp" still costs a hook + a
 *       re-render on every location change.
 *     - We never share URLs between sessions — no need to
 *       serialise view state into the address bar.
 *     - The Tauri `tauri://localhost/` scheme doesn't survive
 *       reloads cleanly under react-router's BrowserRouter, and
 *       HashRouter's `#/foo` URLs would clutter copy-paste UX.
 *
 *   We do, however, KEEP `src/plugins/registry.ts` (the
 *   M1.3-delivered 12-stub registry) because:
 *
 *     a. The `src/__tests__/plugin-registry.test.ts` covers it.
 *        Removing the registry would orphan that test.
 *     b. In M2+ when the project DOES need real URL-based
 *        routing (e.g. deeplink import → jump to /import),
 *        we'll wire <HashRouter> here without rewriting every
 *        page. The plugin stub files (src/plugins/stubs/*.tsx)
 *        will become thin shims that re-export the page
 *        components from src/pages/.
 *
 *   If you ever revert to react-router, delete this comment
 *   block, replace `useViewState()` with `useLocation()` +
 *   `useNavigate()`, and restore the original <HashRouter>
 *   wrapper from git history.
 */
import type { ReactElement } from 'react';
import { useCallback, useMemo } from 'react';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { PluginPlaceholder } from './components/PluginPlaceholder';
import { HomeView } from './pages/home';
import { useViewState, type ViewId } from './hooks/useViewState';

/**
 * pageTitle + pageDescription — the single source of truth for
 * Chinese display strings per ViewId.
 *
 * Lives in App.tsx (not in each page file) because:
 *   - The header needs the title for any view (incl. unknown ones
 *     that fall back via isValidView — see useViewState.ts).
 *   - HomeView needs the title to label each card.
 *   - The PluginPlaceholder page itself reads `title` and
 *     `description` from props (a real M2+ page may override them).
 *   - Keeping one map means "rename 'Provider 列表' to '提供商'"
 *     is one edit, not twelve.
 */
const PAGE_META: Record<ViewId, { title: string; description: string }> = {
  home: {
    title: 'Claude 配置管理器',
    description: '选择一个功能开始',
  },
  'provider-list': {
    title: 'Provider 列表',
    description: '管理所有 Claude Code provider 配置：列表、搜索、激活标记、1 键切换。',
  },
  'provider-switch': {
    title: 'Provider 切换',
    description: '选择 provider → 备份原 settings.json → 原子写入新值。F2 动作而非独立页。',
  },
  'import-sql': {
    title: '导入 .sql',
    description: '解析 cc-switch 备份的 .sql(SQLite dump) → 预览 → 批量导入 provider + MCP。',
  },
  'deeplink-import': {
    title: 'Deeplink 导入',
    description: '从 ccswitch://v1/import?... URL 解析单个 provider 配置。',
  },
  'json-editor': {
    title: 'JSON 编辑器',
    description: '可视化 JSON 编辑器：语法高亮 + 校验 + 格式化 + token 遮罩。',
  },
  'mcp-management': {
    title: 'MCP 管理',
    description: 'MCP server 列表 + 启用 toggle + 新增 / 编辑 / 删除。',
  },
  'usage-query': {
    title: '用量查询',
    description: '按 provider 类型查询 token 用量(5h / 1w / 1m 或余额),5 分钟内存缓存。',
  },
  'single-file-deploy': {
    title: '单文件部署',
    description: '应用 = 一个可执行文件,无外部 .NET / Node / Python runtime 依赖。',
  },
  'resource-browser': {
    title: '资源浏览',
    description: '按 Plugins / Skills / Commands / LSP / MCP 分类查看当前启用的资源。',
  },
  marketplace: {
    title: '资源市场',
    description: '内置推荐仓库 + 自定义 git URL → 克隆 → 扫描 → 勾选安装。',
  },
  optimizer: {
    title: '配置优化',
    description: '扫描 settings.json 的 13 项优化清单,一键应用 + 自动备份。',
  },
  'backup-restore': {
    title: '备份与恢复',
    description: '最近 N 个 settings.json 版本时间线 + 字段级 diff + 一键回滚。',
  },
};

function pageTitle(view: ViewId): string {
  return PAGE_META[view].title;
}

function pageDescription(view: ViewId): string {
  return PAGE_META[view].description;
}

export default function App(): ReactElement {
  const { view, setView } = useViewState();

  // useMemo keeps the pageTitle reference stable across renders so
  // AppHeader / HomeView don't trigger downstream re-renders on every
  // parent re-render.
  const pageTitleFn = useMemo(() => pageTitle, []);

  const handleNavigate = useCallback(
    (next: ViewId) => {
      setView(next);
    },
    [setView],
  );

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
      data-testid="app-root"
    >
      <AppHeader
        currentView={view}
        onNavigate={handleNavigate}
        pageTitle={pageTitleFn}
      />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar currentView={view} onNavigate={handleNavigate} />
        <main
          className="flex-1 overflow-hidden"
          data-testid="app-main"
          style={{ background: 'var(--bg-primary)' }}
        >
          {view === 'home' ? (
            <HomeView
              onNavigate={handleNavigate}
              pageTitle={pageTitleFn}
            />
          ) : (
            <PluginPlaceholder
              pluginId={view}
              title={pageTitle(view)}
              description={pageDescription(view)}
            />
          )}
        </main>
      </div>
    </div>
  );
}