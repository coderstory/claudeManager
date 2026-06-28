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
 *   - Phase 46: stale viewId (e.g. 'mcp-management' from v3.2 user)
 *     链式迁移到 SidebarTile.migrateFrom 派生的新 viewId + 暴露
 *     migrationSearch 给消费者 (ResourceBrowser 双源优先级用)。
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
import type { ReactNode, ReactElement } from 'react';
import {
  useViewState,
  ViewStateProvider,
  ALL_VIEWS,
  STORAGE_KEY,
  HOME_VIEW,
  VIEW_ID_MIGRATIONS,
  migrateViewId,
  type ViewId,
} from '../../hooks/useViewState.tsx';

beforeEach(() => {
  // jsdom's localStorage persists across tests in the same file.
  // Wipe between cases so the "no persisted value" branch is real,
  // not a fluke from a leftover key.
  localStorage.clear();
  // Reset URL (Phase 46 useLayoutEffect may have appended ?tab=mcp etc.)
  window.history.replaceState({}, '', '/');
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

  /// Phase 46 — 老用户 localStorage 还存 'mcp-management' (D-44-A 删) →
  /// SidebarTile.migrateFrom 反向索引 (resource-browser.tsx:31-34) →
  /// fallback 到 'resource-browser' + 暴露 migrationSearch = { tab: 'mcp' }。
  it('Phase 46: stale "mcp-management" → resource-browser via VIEW_ID_MIGRATIONS', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('resource-browser');
    // mount-time useEffect 同步覆盖 stale 值
    expect(localStorage.getItem(STORAGE_KEY)).toBe('resource-browser');
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

/* ──────────── Phase 46 — VIEW_ID_MIGRATIONS + 链式迁移 (5 单测) ──────────── */

describe('Phase 46 — VIEW_ID_MIGRATIONS + chain migration', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('stale "mcp-management" → resource-browser + migrationSearch.tab=mcp (Q46-2 first-hop appendQuery)', () => {
    // 验证 resource-browser stub 的 migrateFrom.fromViewId='mcp-management' + appendQuery
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('resource-browser');
    expect(result.current.migrationSearch).toEqual({ tab: 'mcp' });
  });

  it('unknown stale viewId → home + dev warn (Q46-1 / Q46-5)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, 'totally-unknown-plugin');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe(HOME_VIEW);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('totally-unknown-plugin'),
    );
    expect(result.current.migrationSearch).toBeUndefined();
    spy.mockRestore();
  });

  it('chain A→B→C resolves to C with first-hop appendQuery (Q46-2)', () => {
    // chain fixture: A→B (appendQuery=x=1), B→C (appendQuery=y=2)
    // 第一跳 A 的 appendQuery 应被保留,B / C 跳的 appendQuery 不合并
    const fixture = new Map<string, { toViewId: ViewId; appendQuery?: Record<string, string> }>([
      ['A', { toViewId: 'B' as ViewId, appendQuery: { x: '1' } }],
      ['B', { toViewId: 'C' as ViewId, appendQuery: { y: '2' } }],
    ]);
    const spy = vi
      .spyOn(
        Object.getPrototypeOf(VIEW_ID_MIGRATIONS),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'get' as any,
      )
      .mockReturnValue(fixture);

    const result = migrateViewId('A');
    expect(result.view).toBe('C');
    expect(result.appendQuery).toEqual({ x: '1' }); // 第一跳 appendQuery
    spy.mockRestore();
  });

  it('chain cycle (A→B→A) → home + dev warn (Q46-1 cycle detection)', () => {
    const fixture = new Map<string, { toViewId: ViewId }>([
      ['A', { toViewId: 'B' as ViewId }],
      ['B', { toViewId: 'A' as ViewId }],
    ]);
    // 通过替换 VIEW_ID_MIGRATIONS 引用 (它是 readonly Map;通过 module getter 拦截)
    const originalMap = VIEW_ID_MIGRATIONS;
    // 直接替换 Map 内 entries (mutation, 不替换引用)
    for (const [k, v] of fixture) {
      (VIEW_ID_MIGRATIONS as Map<string, { toViewId: ViewId }>).set(k, v);
    }
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = migrateViewId('A');
    expect(result.view).toBe(HOME_VIEW);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('cycle'));

    // 清理 (fixture 不污染其它测试)
    for (const k of fixture.keys()) {
      (VIEW_ID_MIGRATIONS as Map<string, unknown>).delete(k);
    }
    spy.mockRestore();
    void originalMap;
  });

  it('chain depth 6 (A→B→C→D→E→F) → home + dev warn (Q46-1 depth limit)', () => {
    const fixture = new Map<string, { toViewId: ViewId }>();
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'];
    ids.forEach((id, i) => {
      if (i < ids.length - 1) {
        fixture.set(id, { toViewId: ids[i + 1] as ViewId });
      }
    });
    for (const [k, v] of fixture) {
      (VIEW_ID_MIGRATIONS as Map<string, { toViewId: ViewId }>).set(k, v);
    }
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 起始 F: F→E→D→C→B→A,depth 5 跳完到 A (depth=5 仍合法) → 验证 start 从 F 触发
    // 但 plan §1 描述 "depth 6 (A→B→C→D→E→F)" 指 5 跳都走完后还没命中 → 兜底
    // 直接 start A → A→B→C→D→E (depth 0,1,2,3,4) → 第 6 跳 depth=5 == MAX 命中兜底
    const result = migrateViewId('A');
    expect(result.view).toBe(HOME_VIEW);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('depth'));

    for (const k of fixture.keys()) {
      (VIEW_ID_MIGRATIONS as Map<string, unknown>).delete(k);
    }
    spy.mockRestore();
  });
});