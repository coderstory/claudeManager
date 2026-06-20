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
import { useCallback, useMemo, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { PluginPlaceholder } from './components/PluginPlaceholder';
import { QuickSearchModal } from './components/QuickSearchModal';
import { HomeView } from './pages/home';
import { ProviderListPage } from './pages/provider-list';
import { ProviderSwitchPage } from './pages/provider-switch';
import { ImportSqlPage } from './pages/import-sql';
import DeeplinkImportPage from './pages/deeplink-import';
import JsonEditorPage from './pages/json-editor';
import McpManagementPage from './pages/mcp-management';
import OptimizerPage from './pages/optimizer';
import UsageQueryPage from './pages/usage-query';
import SingleFileDeployPage from './pages/single-file-deploy';
import ResourceBrowserPage from './pages/resource-browser';
import BackupRestorePage from './pages/backup-restore';
import { useViewState, ALL_VIEWS, type ViewId } from './hooks/useViewState';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

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
  // M2.10 F11 — quick-search modal visibility state. Ctrl+/ opens,
  // Esc closes. Kept in App.tsx (rather than in a store) because
  // it's a single global overlay with no other consumers yet.
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);

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

  // M2.10 F11 — global in-app keyboard shortcuts.
  //
  //   Ctrl+/          → open QuickSearchModal
  //   Ctrl+1..Ctrl+9  → jump to the sidebar tile at index 1..9.
  //                     Index 0 is 'home' (intentionally skipped —
  //                     Ctrl+0 would be the natural "go home" key
  //                     but we're out of single-key slots). The
  //                     home view is reachable via the Esc binding
  //                     below + the existing back button in AppHeader.
  //   Esc             → close the modal if open; otherwise go home.
  //
  // M2.11 F9 — Ctrl+N / Ctrl+P / Ctrl+↓ / Ctrl+↑ / ↓ / ↑ are NOT
  //   registered here on purpose. They are handled inside
  //   QuickSearchModal's own window keydown listener, which only
  //   activates when focus is inside the modal's search input
  //   (the modal manages focus on open). Putting them here would
  //   mean they ALSO fire when the user is typing in, say, the
  //   provider-list search box — `useKeyboardShortcuts` exempts
  //   text-entry targets, but only for the App-level listener.
  //   A modal-scoped listener is the right scope for palette
  //   navigation, and the QuickSearchModal tests (26 cases)
  //   cover Ctrl+N / Ctrl+P / ArrowUp / ArrowDown / Enter / Esc.
  //
  // The hook skips keydowns that originate inside text inputs /
  // textareas / contentEditable elements, so typing in the search
  // input won't accidentally re-trigger Ctrl+/.
  useKeyboardShortcuts([
    {
      key: '/',
      ctrlOrMeta: true,
      preventDefault: true,
      handler: () => setQuickSearchOpen(true),
    },
    ...(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const).map(
      (n, i) => ({
        key: n,
        ctrlOrMeta: true,
        preventDefault: true,
        handler: () => {
          // ALL_VIEWS[0] is 'home' (skipped above by starting the
          // map at index 1). The remaining 12 entries map to the
          // 12 sidebar plugin tiles in declaration order.
          const target = ALL_VIEWS[i + 1];
          if (target) setView(target);
        },
      }),
    ),
    {
      key: 'Escape',
      handler: () => {
        if (quickSearchOpen) {
          setQuickSearchOpen(false);
          return;
        }
        if (view !== 'home') setView('home');
      },
    },
  ]);

  return (
    <div
      style={{
        // App-shell layout: the outer box is a vertical flex
        // container that exactly fills the WebView2 viewport. The
        // flex-direction+height combination is what gives the
        // sidebar + main pane a known height to scroll inside. We
        // set these inline (rather than relying on Tailwind
        // utility classes) because this project doesn't ship a
        // Tailwind config — see CLAUDE.md §2.4 / M1.9.1-fix note.
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
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
      {/*
        Content row — the position:absolute anchor for <main>.

        M1.9.3 P0 fix: <main> was previously a flex sibling of
        <AppSidebar> with `flex: 1 + minHeight: 0`. WebView2 release
        mode miscalculates that flex chain (height collapses to 0).
        The fix is to make this row `position: relative` and turn
        <main> into `position: absolute` with 4-edge insets sourced
        from the --header-height / --sidebar-width tokens. Absolute
        positioning has a definite measure path that WebView2
        handles correctly in both dev and release.
      */}
      <div
        data-testid="app-content"
        style={{
          position: 'relative',
          display: 'flex',
          flex: '1 1 0%',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <AppSidebar currentView={view} onNavigate={handleNavigate} />
        <main
          data-testid="app-main"
          style={{
            // M1.9.3 P0 fix: position absolute replaces flex:1.
            // The flex chain `flex: 1 + minHeight: 0` collapses to
            // height:0 in Tauri WebView2 release mode. Absolute
            // positioning is not subject to that bug because each
            // edge is a definite measurement.
            position: 'absolute',
            top: 'var(--header-height)',
            left: 'var(--sidebar-width)',
            right: 0,
            bottom: 0,
            // minHeight:0 is preserved from the M1.9.1 contract
            // even though <main> is no longer a flex item — jsdom
            // + the M1.9.1/M1.9.2 regression suites assert the
            // presence of this property as a guard against the
            // old "flex chain collapses to 0" bug ever returning.
            minHeight: 0,
            minWidth: 0,
            overflow: 'auto',
            background: 'var(--bg-primary)',
          }}
        >
          {/*
            M1.9.3 P1 fix: framer-motion 12.23.25 + React 19 +
            Tauri release crashes the WebView2 renderer process.
            Replacement is a CSS @keyframes fadeIn (see tokens.css)
            applied via the .view-transition class. The `key={view}`
            forces React to remount on every view change, which
            restarts the animation — the same UX the M1.9.1
            AnimatePresence was delivering, but with 0 JS deps
            and a working release-mode WebView2.
          */}
          <div
            key={view}
            data-testid="app-view"
            className="view-transition"
          >
            {view === 'home' ? (
              <HomeView
                onNavigate={handleNavigate}
                pageTitle={pageTitleFn}
              />
            ) : view === 'provider-list' ? (
              <ProviderListPage />
            ) : view === 'provider-switch' ? (
              <ProviderSwitchPage />
            ) : view === 'import-sql' ? (
              <ImportSqlPage />
            ) : view === 'deeplink-import' ? (
              <DeeplinkImportPage />
            ) : view === 'json-editor' ? (
              <JsonEditorPage />
            ) : view === 'mcp-management' ? (
              <McpManagementPage />
            ) : view === 'usage-query' ? (
              <UsageQueryPage />
            ) : view === 'single-file-deploy' ? (
              <SingleFileDeployPage />
            ) : view === 'resource-browser' ? (
              <ResourceBrowserPage />
            ) : view === 'optimizer' ? (
              <OptimizerPage />
            ) : view === 'backup-restore' ? (
              <BackupRestorePage />
            ) : (
              <PluginPlaceholder
                pluginId={view}
                title={pageTitle(view)}
                description={pageDescription(view)}
              />
            )}
          </div>
        </main>
      </div>
      {/* M2.10 F11 — quick-search overlay. Rendered outside the
          flex container so it can use position:fixed without
          competing with the sidebar / main inset chain. */}
      <QuickSearchModal
        isOpen={quickSearchOpen}
        onClose={() => setQuickSearchOpen(false)}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
