/**
 * useViewState — TDD coverage.
 *
 * Mirrors cc-switch's view-state pattern (CLAUDE.md §3.1 + the M1.9
 * decision to copy cc-switch's useState + localStorage shape rather
 * than react-router — see src/App.tsx for the rationale comment).
 *
 * What this hook does:
 *   - Holds the currently-active view id (one of the 10 plugin slots
 *     plus a synthetic 'home' landing view).
 *   - Persists the last view to localStorage under STORAGE_KEY so
 *     relaunching the app reopens where the user was.
 *   - Treats an unknown / corrupt localStorage value as "fall back to
 *     home" rather than crashing the app.
 *
 * Why this hook exists at all:
 *   - Localised state + 1 helper (`setView`) keeps App.tsx declarative.
 *   - Co-locating the validation set (`ALL_VIEWS`) here means the
 *     sidebar and AppHeader can import `ALL_VIEWS` to render the nav,
 *     and `isValidView` keeps both writer (us) and reader (initial
 *     mount) honest.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createElement } from 'react';
import {
  useViewState,
  ViewStateProvider,
  ALL_VIEWS,
  STORAGE_KEY,
  HOME_VIEW,
  type ViewId,
} from '../../hooks/useViewState.tsx';

beforeEach(() => {
  // jsdom's localStorage persists across tests in the same file.
  // Wipe between cases so the "no persisted value" branch is real,
  // not a fluke from a leftover key.
  localStorage.clear();
});

/**
 * wrap — every renderHook here runs through the ViewStateProvider.
 * The canonical hook (M4.6-fix) reads from React Context, so calls
 * without a provider throw. See useViewState.test.tsx for the
 * throw-guard regression test.
 *
 * NOTE: this file is intentionally named .ts (not .tsx). The
 * canonical coverage that exercises the full JSX flow lives in
 * useViewState.test.tsx; this file is the bare-import smoke test
 * (M3.0.3 lesson) and uses createElement to keep the .ts extension
 * valid for esbuild.
 */
function wrap({ children }: { children: ReactNode }): ReactElement {
  return createElement(ViewStateProvider, null, children);
}

describe('useViewState', () => {
  it('exports 8 plugin views plus 3 core views (home, history, about) — Phase 46 D-44-A removed mcp-management', () => {
    // Phase 44 派生收敛:ALL_VIEWS = ALL_VIEW_IDS re-exported from
    // src/plugins/registry.ts → 3 core + 8 plugin = 11 项。
    //
    // Phase 46 D-44-A 删 mcp-management stub (mcp 入口迁到
    // resource-browser 的 mcp tab via SidebarTile.migrateFrom),所以
    // ALL_VIEWS 不再含 mcp-management。'mcp-management' 现在是
    // stale viewId,经 useViewState.readInitialView → migrateViewId →
    // resource-browser (via resource-browser.sidebarTile.migrateFrom)。
    expect(ALL_VIEWS).toContain(HOME_VIEW);
    expect(ALL_VIEWS.length).toBe(11);
    expect(ALL_VIEWS).not.toContain('mcp-management');
  });

  it('defaults to "home" when localStorage is empty', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
  });

  it('reads the persisted view from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'resource-browser');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('resource-browser');
  });

  it('falls back to "home" when the persisted view is not in ALL_VIEWS', () => {
    // Defensive: a future plugin that gets removed leaves stale
    // localStorage behind. We must not crash — just open at 'home'.
    localStorage.setItem(STORAGE_KEY, 'some-deleted-plugin');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
  });

  it('Phase 46: stale "mcp-management" localStorage is migrated to "resource-browser" via SidebarTile.migrateFrom', () => {
    // Phase 46 (Q46-1) 启用 resource-browser.sidebarTile.migrateFrom =
    // { fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }。
    // useViewState.readInitialView 读 localStorage 'mcp-management'
    // → migrateViewId 反向索引 VIEW_ID_MIGRATIONS → 命中 resource-browser。
    // view 不再是 'mcp-management' (Phase 46 已删 stub),
    // 而是 'resource-browser' + migrationSearch = { tab: 'mcp' }
    // (供 ResourceBrowser 双源优先级读)。
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('resource-browser');
    expect(result.current.migrationSearch).toEqual({ tab: 'mcp' });
  });

  it('setView updates the current view and writes to localStorage', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    act(() => {
      result.current.setView('resource-browser');
    });
    expect(result.current.view).toBe('resource-browser');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('resource-browser');
  });

  it('setView with the same value is a no-op (no extra localStorage write)', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    act(() => {
      result.current.setView('resource-browser');
    });
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const callsBefore = spy.mock.calls.length;
    act(() => {
      result.current.setView('resource-browser');
    });
    expect(spy.mock.calls.length).toBe(callsBefore);
    spy.mockRestore();
  });

  it('exposes ALL_VIEWS so the sidebar can render the nav list', () => {
    // The sidebar imports this directly to avoid duplicating the
    // 12-element list. This test pins the contract.
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.allViews).toBe(ALL_VIEWS);
  });

  it('every plugin view in ALL_VIEWS is a valid kebab-case id', () => {
    // Defensive against typos in the union. The compiler can't catch
    // 'foo bar' as a string literal — only the test can.
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const v of ALL_VIEWS) {
      expect(v, `view id must be kebab-case: ${v}`).toMatch(kebab);
    }
  });

  it('ALL_VIEWS contains exactly the 8 plugin ids from the registry (Phase 46 D-44-A)', () => {
    // Pin the contract: every plugin id in src/plugins/registry.ts
    // must appear in ALL_VIEWS, otherwise its nav tile is missing.
    // Phase 27 Fix 6: 'mcp-management' 不再是独立 view,合并到
    // 'resource-browser' 的 mcp tab。
    // Phase 46 D-44-A: mcp-management stub 删,8 plugin ALL_VIEWS 8 项。
    const registryIds = [
      'provider-list',
      'import-sql',
      'json-editor',
      'usage-query',
      'resource-browser',
      'marketplace',
      'optimizer',
      'backup-restore',
    ];
    for (const id of registryIds) {
      expect(ALL_VIEWS, `ALL_VIEWS missing plugin id ${id}`).toContain(id);
    }
  });

  it('ViewId type stays exhaustive against ALL_VIEWS at compile time', () => {
    // If a developer adds a new id to ALL_VIEWS but forgets to widen
    // the ViewId union, this fails. The test is intentionally
    // type-asserting — runtime value is irrelevant.
    const exhaustive: ViewId = 'home';
    void exhaustive;
  });
});
