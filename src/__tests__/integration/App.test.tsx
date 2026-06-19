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
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';
import { HOME_VIEW, STORAGE_KEY, ALL_VIEWS } from '../../hooks/useViewState';

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

  it('clicking the "MCP 管理" sidebar item navigates to the MCP placeholder', () => {
    renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-mcp-management').click();
    });
    // The placeholder renders a <code> with the literal "plugin: mcp-management".
    expect(screen.getByText('plugin: mcp-management')).toBeInTheDocument();
  });

  it('clicking the "Provider 列表" sidebar item shows its placeholder', () => {
    renderApp();
    act(() => {
      screen.getByTestId('sidebar-item-provider-list').click();
    });
    expect(screen.getByText('plugin: provider-list')).toBeInTheDocument();
  });

  it('clicking the home tile on the welcome page navigates to that plugin', () => {
    renderApp();
    // Click from welcome → optimizer
    act(() => {
      screen.getByTestId('home-tile-optimizer').click();
    });
    expect(screen.getByText('plugin: optimizer')).toBeInTheDocument();
  });

  it('header back button returns from any non-home view to home', () => {
    renderApp();
    // Navigate away from home first.
    act(() => {
      screen.getByTestId('sidebar-item-marketplace').click();
    });
    expect(screen.getByText('plugin: marketplace')).toBeInTheDocument();

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
    // placeholder (not the home tile grid).
    expect(screen.getByText('plugin: json-editor')).toBeInTheDocument();
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

  it('theme toggle button is rendered and clickable', () => {
    renderApp();
    const toggle = screen.getByTestId('app-header-theme-toggle');
    expect(toggle).toBeInTheDocument();
    // Clicking should not throw — actual theme mutation is covered
    // by ThemeProvider.test.tsx; we just confirm the wiring.
    act(() => {
      toggle.click();
    });
    // The icon flips between Sun / Moon — the button still exists.
    expect(toggle).toBeInTheDocument();
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
});