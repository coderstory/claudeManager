/**
 * App — integration coverage (M1.9).
 *
 * Exercises the full mount → click → re-render cycle for the
 * cc-switch-style view router:
 *
 *   1. Initial render shows the home tile grid (12 plugin cards +
 *      the home welcome panel).
 *   2. Clicking a sidebar item navigates to that view's placeholder.
 *   3. The "back" header button returns to home.
 *   4. Persistence across unmount/mount reads back the last view
 *      from localStorage (useViewState hook contract).
 *   5. The header has the `data-tauri-drag-region` attribute so
 *      Tauri will treat it as a draggable area on the OS chrome.
 *   6. Theme toggle button is wired to the existing useTheme hook.
 *
 * This file deliberately uses the same localStorage / jsdom plumbing
 * as src/__tests__/design-system/ThemeProvider.test.tsx so we don't
 * re-invent the matchMedia mock — ThemeProvider already injects one
 * via the App tree.
 */
import { describe, it, expect, beforeEach, test } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';
import {
  HOME_VIEW,
  STORAGE_KEY,
  ALL_VIEWS,
  type ViewId,
} from '../../hooks/useViewState';

beforeEach(() => {
  localStorage.clear();
});

function renderApp(): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

describe('App — view routing integration', () => {
  it('renders the home tile grid on first launch (no localStorage)', () => {
    renderApp();
    // The home tile grid renders one button per plugin view (12).
    // Each button has data-testid="home-tile-<id>".
    for (const view of ALL_VIEWS) {
      if (view === HOME_VIEW) continue;
      expect(
        screen.getByTestId(`home-tile-${view}`),
        `home tile missing for ${view}`,
      ).toBeInTheDocument();
    }
  });

  it('renders all 12 sidebar nav items', () => {
    renderApp();
    for (const view of ALL_VIEWS) {
      expect(
        screen.getByTestId(`sidebar-item-${view}`),
        `sidebar item missing for ${view}`,
      ).toBeInTheDocument();
    }
  });

  it('clicking the "MCP 管理" sidebar item navigates to the F6 page (M2.5: real impl)', () => {
    renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-mcp-management').click();
    });
    // M2.5: the mcp-management view now mounts the real page, not
    // the PluginPlaceholder. Assert on the page's data-testid.
    expect(screen.getByTestId('mcp-management-page')).toBeInTheDocument();
  });

  it('clicking the "Provider 列表" sidebar item shows the F1 page (M2.1: real impl)', () => {
    renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-provider-list').click();
    });
    // M2.1: the provider-list view now mounts the real page, not the
    // PluginPlaceholder. We assert on the page's data-testid.
    expect(screen.getByTestId('provider-list-page')).toBeInTheDocument();
  });

  it('clicking the home tile on the welcome page navigates to that plugin', () => {
    renderApp();
    // Click from welcome → resource-browser (M2.13: real page
    // shipped, not the placeholder anymore). Assert the page mounts
    // via its data-testid instead of the old PluginPlaceholder marker.
    act(() => {
      screen.getByTestId('home-tile-resource-browser').click();
    });
    expect(screen.getByTestId('resource-browser-page')).toBeInTheDocument();
  });

  it('header back button returns from any non-home view to home', () => {
    renderApp();
    // Navigate away from home first.
    act(() => {
      screen.getByTestId('sidebar-item-marketplace').click();
    });
    // F17 shipped a real MarketplacePage (M2.16) — assert on its
    // data-testid instead of the old PluginPlaceholder marker.
    expect(screen.getByTestId('marketplace-page')).toBeInTheDocument();

    // Now hit "back" — should bring the home tile grid back.
    const backBtn = screen.getByTestId('app-header-back');
    act(() => {
      backBtn.click();
    });
    // Home tile for marketplace no longer exists as a page, but the
    // home tile for marketplace DOES exist as a button on home — so
    // we assert by looking for the heading "欢迎使用 Claude 配置管理器"
    // which only renders in HomeView.
    expect(
      screen.getByText('欢迎使用 Claude 配置管理器'),
    ).toBeInTheDocument();
  });

  it('persists the last view to localStorage across mounts', () => {
    const first = renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-json-editor').click();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('json-editor');
    first.unmount();

    // Second mount should restore the last view.
    renderApp();
    // On the second mount, we should immediately see the JSON editor
    // page (M2.4: real implementation, not the placeholder anymore).
    expect(screen.getByTestId('json-editor-page')).toBeInTheDocument();
    expect(
      screen.queryByText('欢迎使用 Claude 配置管理器'),
    ).not.toBeInTheDocument();
  });

  it('falls back to "home" when localStorage holds an unknown view id', () => {
    localStorage.setItem(STORAGE_KEY, 'some-deleted-plugin');
    renderApp();
    // Home page renders the welcome heading.
    expect(
      screen.getByText('欢迎使用 Claude 配置管理器'),
    ).toBeInTheDocument();
  });

  it('header has the data-tauri-drag-region attribute for native window dragging', () => {
    renderApp();
    const header = screen.getByTestId('app-header');
    // Tauri reads this attribute and converts it to
    // -webkit-app-region: drag under the hood.
    expect(
      header.getAttribute('data-tauri-drag-region'),
      'header must be a Tauri drag region',
    ).not.toBeNull();
  });

  it('theme toggle button is NOT rendered (M2.16 theme-trim — single light theme)', () => {
    // M2.16 theme-trim: 主题砍到单档 light,切换按钮已删。此用例
    // 是回归 guard — 防止后期误把按钮加回(单档无意义切换)。
    // 如后期重新加多档主题,先在此处恢复 cycleTheme + 按钮,再更新
    // 本断言。
    renderApp();
    const toggle = screen.queryByTestId('app-header-theme-toggle');
    expect(toggle).toBeNull();
  });

  it('clicking the same sidebar item twice does not push duplicates to localStorage', () => {
    renderApp();
    const sidebar = screen.getByTestId('app-sidebar');
    const item = within(sidebar).getByTestId('sidebar-item-usage-query');
    act(() => {
      item.click();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('usage-query');

    act(() => {
      item.click();
    });
    // Still 'usage-query' — setView is a no-op when already on target.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('usage-query');
  });

  // ---------------------------------------------------------------------------
  // M2.6.1 routing-fix regression — F13 备份与恢复 must mount the REAL
  // BackupRestorePage, not fall through to PluginPlaceholder.
  //
  // M2.6 delivered the page, service, commands, and tests, but missed
  // wiring App.tsx (the view router). On the release exe, clicking the
  // sidebar "备份与恢复" tile rendered `plugin: backup-restore` instead
  // of the real timeline UI (see .planning/diagnostics/m2-2-6-verify/
  // 01-f13-page.png).
  //
  // This test asserts the routing fix: navigating to backup-restore must
  //   (a) mount the BackupRestorePage (data-testid="backup-restore-page")
  //   (b) NOT render the PluginPlaceholder fallback marker
  //       ("plugin: backup-restore") for that view.
  //
  // The previous test for `optimizer` (line ~84) intentionally asserts the
  // placeholder marker because that view genuinely is a stub; this new
  // test asserts the NEGATION for backup-restore because that view is a
  // shipped real implementation.
  // ---------------------------------------------------------------------------
  it('clicking the "备份与恢复" sidebar item navigates to the F13 real page (M2.6.1 routing-fix)', () => {
    renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-backup-restore').click();
    });
    // M2.6.1: backup-restore must mount the real page now, not the
    // PluginPlaceholder. Assert on the page's data-testid.
    expect(screen.getByTestId('backup-restore-page')).toBeInTheDocument();
    // Regression guard: the PluginPlaceholder marker MUST NOT render
    // for this view anymore. This is the exact text the broken release
    // exe was rendering per the M2.6 diagnostic screenshot.
    expect(
      screen.queryByText('plugin: backup-restore'),
      'backup-restore must NOT fall through to PluginPlaceholder',
    ).not.toBeInTheDocument();
  });

  it('persists backup-restore view to localStorage across mounts (M2.6.1)', () => {
    const first = renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-backup-restore').click();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('backup-restore');
    first.unmount();

    // Second mount should restore the last view AND mount the real page
    // (not the placeholder).
    renderApp();
    expect(screen.getByTestId('backup-restore-page')).toBeInTheDocument();
    expect(
      screen.queryByText('plugin: backup-restore'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M2.8.1 structural regression for plugin routing wiring.
//
// THE BUG CLASS THIS GUARDS AGAINST
// ---------------------------------
// M2.6 (F13 备份与恢复) and M2.8 (F8 单文件部署) each shipped a real
// page + service + commands + a per-page test that called
// `render(<RealPage />)` directly. Vitest reported 100% green, yet
// the release exe still rendered `plugin: <view>` (PluginPlaceholder)
// for those views — because nobody had wired the new component into
// the App.tsx ternary chain. The per-page tests skipped the App.tsx
// router entirely, so they could not see the missing branch.
//
// The fix is a STRUCTURAL test: for every view that has a real page
// shipped, render <App /> with that view persisted, and assert the
// PluginPlaceholder marker `plugin: <view>` does NOT appear. The
// inverse holds for views still on placeholder. Adding a new real
// page = move the id from PLACEHOLDER_VIEWS → REAL_PAGE_VIEWS, and
// this suite enforces the App.tsx wiring at the same commit.
//
// This caught the M2.8 F8 bug (single-file-deploy) and the matching
// M2.2 F3 bug (import-sql) on the very first run.
// ---------------------------------------------------------------------------
describe('all plugin views route to their real page (M2.8.1 structural regression)', () => {
  // Views whose real page has shipped. Body MUST NOT contain the
  // PluginPlaceholder marker `plugin: <id>` once mounted.
  const REAL_PAGE_VIEWS: ReadonlyArray<{
    view: ViewId;
    realTestId: string;
  }> = [
    { view: 'provider-list', realTestId: 'provider-list-page' },
    { view: 'provider-switch', realTestId: 'provider-switch-page' },
    { view: 'import-sql', realTestId: 'import-sql-page' },
    { view: 'deeplink-import', realTestId: 'deeplink-import-page' },
    { view: 'json-editor', realTestId: 'json-editor-page' },
    { view: 'mcp-management', realTestId: 'mcp-management-page' },
    { view: 'usage-query', realTestId: 'usage-query-page' },
    { view: 'single-file-deploy', realTestId: 'single-file-deploy-page' },
    { view: 'resource-browser', realTestId: 'resource-browser-page' },
    { view: 'marketplace', realTestId: 'marketplace-page' },
    { view: 'backup-restore', realTestId: 'backup-restore-page' },
    { view: 'optimizer', realTestId: 'optimizer-page' },
  ] as const;

  // Views still on PluginPlaceholder (no real page shipped yet).
  // When a real page lands for any of these, MOVE the id into
  // REAL_PAGE_VIEWS above (and add its data-testid). Do not just
  // delete it from this list — the inverse assertion is what proves
  // the placeholder is no longer reachable for that view.
  const PLACEHOLDER_VIEWS: ReadonlyArray<ViewId> = [
  ] as const;

  beforeEach(() => {
    localStorage.clear();
  });

  test.each(REAL_PAGE_VIEWS)(
    'view "$view" routes to its real page (no PluginPlaceholder fallback)',
    ({ view, realTestId }) => {
      // Persist the target view so App's initial render lands there
      // directly (avoids depending on sidebar layout for this guard).
      localStorage.setItem(STORAGE_KEY, view);

      render(
        <ThemeProvider>
          <App />
        </ThemeProvider>,
      );

      // Forward assertion: the real page mounts.
      expect(
        screen.getByTestId(realTestId),
        `expected real page testid="${realTestId}" for view "${view}"`,
      ).toBeInTheDocument();

      // Inverse assertion: the PluginPlaceholder marker for this view
      // is NOT rendered. This is the exact text the broken release
      // exes were showing (see M2.6/M2.8 diagnostic screenshots).
      expect(
        screen.queryByText(`plugin: ${view}`),
        `view "${view}" must NOT fall through to PluginPlaceholder`,
      ).not.toBeInTheDocument();
    },
  );

  test.each(PLACEHOLDER_VIEWS)(
    'view "%s" still uses PluginPlaceholder (real page not shipped yet)',
    (view) => {
      localStorage.setItem(STORAGE_KEY, view);

      render(
        <ThemeProvider>
          <App />
        </ThemeProvider>,
      );

      // Inverse: until a real page ships for this view, App.tsx must
      // fall through to the PluginPlaceholder. If this assertion
      // fails, you either shipped a real page (move the id into
      // REAL_PAGE_VIEWS above) or accidentally lost the fallback.
      expect(
        screen.getByText(`plugin: ${view}`),
        `view "${view}" must still render PluginPlaceholder marker`,
      ).toBeInTheDocument();
    },
  );

  it('every ViewId is covered by exactly one of the two lists (drift guard)', () => {
    const realIds = new Set<ViewId>(REAL_PAGE_VIEWS.map((r) => r.view));
    const phIds = new Set<ViewId>(PLACEHOLDER_VIEWS);
    for (const v of ALL_VIEWS) {
      if (v === HOME_VIEW) continue;
      const inReal = realIds.has(v);
      const inPh = phIds.has(v);
      expect(
        inReal || inPh,
        `view "${v}" missing from both REAL_PAGE_VIEWS and PLACEHOLDER_VIEWS`,
      ).toBe(true);
      expect(
        inReal && inPh,
        `view "${v}" appears in BOTH REAL_PAGE_VIEWS and PLACEHOLDER_VIEWS`,
      ).toBe(false);
    }
  });
});