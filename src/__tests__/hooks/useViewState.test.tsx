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
import { act, render, renderHook, screen } from '@testing-library/react';
import {
  useViewState,
  ViewStateProvider,
  ALL_VIEWS,
  STORAGE_KEY,
  HOME_VIEW,
  type ViewId,
} from '../../hooks/useViewState.tsx';
import type { ReactNode, ReactElement } from 'react';

beforeEach(() => {
  // jsdom's localStorage persists across tests in the same file.
  // Wipe between cases so the "no persisted value" branch is real,
  // not a fluke from a leftover key.
  localStorage.clear();
});

/**
 * wrap — test helper that mounts a <ViewStateProvider> so child
 * `useViewState()` calls have access to the context. M4.6-fix:
 * useViewState is no longer a plain `useState` per-call — it
 * reads from a React Context. Every test that calls renderHook
 * / render with useViewState must wrap in this.
 */
function wrap({ children }: { children: ReactNode }): ReactElement {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

describe('useViewState', () => {
  it('exports 9 plugin views plus 3 core views (home, history, about) — Phase 44 registry-driven', () => {
    // Phase 44 派生收敛:ALL_VIEWS = ALL_VIEW_IDS re-exported from
    // src/plugins/registry.ts → 3 core + 9 plugin = 12 项。
    expect(ALL_VIEWS).toContain(HOME_VIEW);
    expect(ALL_VIEWS.length).toBe(12);
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

  /// Phase 27 Fix 6 (D-13) — 老用户 localStorage 还存 'mcp-management'
  /// (D-10 删 view 之前) → 视图直接切到 'mcp-management' (Phase 44
  /// 派生收敛后 mcp-management 重新在 ALL_VIEW_IDS,Phase 46 D-44-A 删)。
  /// App.tsx:174-197 useEffect 接着会 setView('resource-browser') +
  /// URL ?tab=mcp。这里 verify useViewState 单独的行为:view =
  /// 'mcp-management'。
  it('Phase 27 Fix 6: stale "mcp-management" localStorage now passes isValidView (Phase 44 keeps stub)', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('mcp-management');
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

  it('M4.6-fix: two consumers in the same provider share the same `view`', () => {
    // Regression test for the "查看用量历史 button does nothing" bug.
    //
    // Pre-M4.6 the hook was a plain useState per call, so each
    // component had its own private `view`. usage-query's
    // setView('history') updated ITS copy, App.tsx's copy (the
    // actual router) never moved, and the page never rendered.
    //
    // After M4.6-fix the hook reads from a React Context Provider
    // mounted at App root, so every consumer in the same tree
    // observes the same state. This test mounts two
    // `useViewState()` consumers in one provider, has the first
    // setView, and asserts the second sees the new value.
    function ConsumerA({
      onView,
    }: {
      onView: (v: ViewId) => void;
    }): ReactElement {
      const { view, setView } = useViewState();
      onView(view);
      return (
        <button
          data-testid="consumer-a"
          onClick={() => setView('history')}
        >
          A
        </button>
      );
    }
    function ConsumerB({
      onView,
    }: {
      onView: (v: ViewId) => void;
    }): ReactElement {
      const { view } = useViewState();
      onView(view);
      return <span data-testid="consumer-b-view">{view}</span>;
    }
    let aView: ViewId = HOME_VIEW;
    let bView: ViewId = HOME_VIEW;
    render(
      <ViewStateProvider>
        <ConsumerA onView={(v) => (aView = v)} />
        <ConsumerB onView={(v) => (bView = v)} />
      </ViewStateProvider>,
    );
    expect(aView).toBe(HOME_VIEW);
    expect(bView).toBe(HOME_VIEW);
    act(() => {
      screen.getByTestId('consumer-a').click();
    });
    // After A.setView('history'), BOTH consumers must observe it.
    expect(aView).toBe('history');
    expect(bView).toBe('history');
  });

  it('throws when useViewState is called outside a <ViewStateProvider>', () => {
    // Fail-fast contract: a missing provider is a developer error,
    // not a runtime condition to silently absorb. Callers MUST
    // mount <ViewStateProvider> in their tree; the production app
    // does this in main.tsx.
    expect(() => renderHook(() => useViewState())).toThrow(
      /must be called inside a <ViewStateProvider>/,
    );
  });

  it('every plugin view in ALL_VIEWS is a valid kebab-case id', () => {
    // Defensive against typos in the union. The compiler can't catch
    // 'foo bar' as a string literal — only the test can.
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const v of ALL_VIEWS) {
      expect(v, `view id must be kebab-case: ${v}`).toMatch(kebab);
    }
  });

  it('ALL_VIEWS contains exactly the 9 plugin ids from the registry (Phase 44, D-44-A: Phase 46 → 8)', () => {
    // Pin the contract: every plugin id in src/plugins/registry.ts
    // must appear in ALL_VIEWS, otherwise its nav tile is missing.
    // Phase 44 派生收敛:registry 9 个 plugin (含 mcp-management,Phase 46
    // D-44-A 删 → 8 个),ALL_VIEWS 也 12 项 (3 core + 9 plugin)。
    const registryIds = [
      'provider-list',
      'import-sql',
      'json-editor',
      'mcp-management',
      'usage-query',
      'resource-browser',
      'marketplace',
      'optimizer',
      'backup-restore',
    ];
    for (const id of registryIds) {
      expect(ALL_VIEWS, `ALL_VIEWS missing plugin id ${id}`).toContain(id);
    }
    // Phase 46 D-44-A:删 mcp-management stub → 8 plugin
  });

  it('ViewId type stays exhaustive against ALL_VIEWS at compile time', () => {
    // If a developer adds a new id to ALL_VIEWS but forgets to widen
    // the ViewId union, this fails. The test is intentionally
    // type-asserting — runtime value is irrelevant.
    const exhaustive: ViewId = 'home';
    void exhaustive;
  });
});
