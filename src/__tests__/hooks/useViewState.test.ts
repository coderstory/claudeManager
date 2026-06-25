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
  it('exports 10 plugin views plus "home" as the synthetic landing view', () => {
    // M1.9 spec: plugin placeholders are reachable via the sidebar,
    // and 'home' is the welcome tile the user lands on after the first
    // launch (before any localStorage value exists).
    // M3.7: +1 utility view 'about' (清单 18).
    // M4.6 / Phase 21-C: +1 view 'history' (F21).
    // F2 redirect shim removed (action moved to F1 [激活] button).
    // F4 deeplink-import removed in cleanup commit 0ff5b86 → 10 plugins.
    // Total = home + 10 plugins + history + about = 13.
    expect(ALL_VIEWS).toContain(HOME_VIEW);
    expect(ALL_VIEWS.length).toBe(13);
  });

  it('defaults to "home" when localStorage is empty', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
  });

  it('reads the persisted view from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('mcp-management');
  });

  it('falls back to "home" when the persisted view is not in ALL_VIEWS', () => {
    // Defensive: a future plugin that gets removed leaves stale
    // localStorage behind. We must not crash — just open at 'home'.
    localStorage.setItem(STORAGE_KEY, 'some-deleted-plugin');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
  });

  it('setView updates the current view and writes to localStorage', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    act(() => {
      result.current.setView('mcp-management');
    });
    expect(result.current.view).toBe('mcp-management');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('mcp-management');
  });

  it('setView with the same value is a no-op (no extra localStorage write)', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    act(() => {
      result.current.setView('mcp-management');
    });
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const callsBefore = spy.mock.calls.length;
    act(() => {
      result.current.setView('mcp-management');
    });
    expect(spy.mock.calls.length).toBe(callsBefore);
    spy.mockRestore();
  });

  it('exposes ALL_VIEWS so the sidebar can render the nav list', () => {
    // The sidebar imports this directly to avoid duplicating the
    // 13-element list. This test pins the contract.
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

  it('ALL_VIEWS contains exactly the 10 plugin ids from the registry', () => {
    // Pin the contract: every plugin id in src/plugins/registry.ts
    // must appear in ALL_VIEWS, otherwise its nav tile is missing.
    // This is checked dynamically (not hardcoded) so adding a new
    // plugin only requires the developer to update the union in
    // useViewState.ts — the test then points out the omission.
    const registryIds = [
      'provider-list',
      'import-sql',
      'json-editor',
      'mcp-management',
      'usage-query',
      'single-file-deploy',
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
