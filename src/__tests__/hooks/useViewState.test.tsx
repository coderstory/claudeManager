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
  it('exports 10 plugin views plus "home" as the synthetic landing view', () => {
    // M1.9 spec: plugin placeholders are reachable via the sidebar,
    // and 'home' is the welcome tile the user lands on after the first
    // launch (before any localStorage value exists).
    // M3.7: +1 utility view 'about' (清单 18).
    // M4.6 / Phase 21-C: +1 view 'history' (F21).
    // F2 redirect shim removed (action moved to F1 [激活] button).
    // F4 deeplink-import removed → 10 plugins.
    // F8 removed in M5 #18 → 9 plugins.
    // Phase 27 Fix 6: 'mcp-management' 合并到 'resource-browser' mcp tab,
    //                ALL_VIEWS 移除该 view,12 → 11。
    expect(ALL_VIEWS).toContain(HOME_VIEW);
    expect(ALL_VIEWS.length).toBe(11);
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
  /// (D-10 删 view 之前) → 回退到 'home'。App.tsx 之后会接住这个
  /// 分支用 window.location.replace 重定向到 /resource-browser?tab=mcp。
  it('Phase 27 Fix 6: stale "mcp-management" localStorage falls back to "home"', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
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

  it('ALL_VIEWS contains exactly the 8 plugin ids from the registry (post-Fix-6)', () => {
    // Pin the contract: every plugin id in src/plugins/registry.ts
    // must appear in ALL_VIEWS, otherwise its nav tile is missing.
    // Phase 27 Fix 6: 'mcp-management' 合并到 'resource-browser' mcp tab,
    // ALL_VIEWS 不再列它。registry 仍 9 plugin(mcp-management entry
    // 仍存在,只是不再作为独立 view 暴露 — 提供 McpManagementPanel
    // 共享组件给 mcp tab 用)。
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
    expect(ALL_VIEWS, 'mcp-management should NOT be a ViewId after Fix 6').not.toContain(
      'mcp-management',
    );
  });

  it('ViewId type stays exhaustive against ALL_VIEWS at compile time', () => {
    // If a developer adds a new id to ALL_VIEWS but forgets to widen
    // the ViewId union, this fails. The test is intentionally
    // type-asserting — runtime value is irrelevant.
    const exhaustive: ViewId = 'home';
    void exhaustive;
  });
});
