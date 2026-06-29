/**
 * B8 regression — useEffect infinite loop on currentProject (MCP 管理页).
 *
 * ## Bug history
 *
 * Buggy code in `src/pages/mcp-management/index.tsx`:
 *
 *   useEffect(() => {
 *     syncScopeFromProject(currentProject);
 *   }, [currentProject]);
 *
 * `currentProject` is derived via `projects.find(...)` inside
 * `useProjects()`. On every re-render of the page (e.g. after the
 * initial `list_mcp_servers` IPC resolves and `setState` fires inside the
 * page, or after the user toggles a row), `useProjects` returns a NEW
 * `currentProject` object even when the project id hasn't changed
 * (`Array.prototype.find` returns a fresh object reference because
 * `useProjects` rebuilds the array via `setProjects(result.projects)`).
 *
 * React compares effect deps with `Object.is`. The new object identity
 * makes the buggy effect re-fire on every render:
 *
 *   render -> effect fires -> syncScopeFromProject -> scope store updated
 *     -> useSyncExternalStore notifies -> re-render -> effect fires again
 *
 * The loop drives the page's render churn to the point where the page
 * never settles — the "加载中" placeholder stays visible and the page
 * pegs CPU at 100% (real-world symptoms reported pre-fix).
 *
 * ## Fix
 *
 * Depend on the stable project id, not the object reference:
 *
 *   useEffect(() => {
 *     syncScopeFromProject(currentProject);
 *   }, [currentProject?.id]);
 *
 * `currentProject?.id` is a primitive string. As long as the project id
 * doesn't change, `Object.is(prevId, nextId) === true` and the effect
 * does NOT re-fire. The effect runs exactly once per project switch.
 *
 * ## Why this test catches the regression
 *
 * The mock `useProjects` returns a NEW `{...currentProject}` object on
 * every call. We mount `McpManagementPage` with this hook; the page's
 * own `listMcpServers` IPC resolves during the test, which forces a
 * `setState` and a re-render of the page. Each re-render calls
 * `useProjects` again, getting a fresh `currentProject` reference.
 *
 * We route `syncScopeFromProject` through a `vi.fn()` spy at the module
 * mock boundary. The spy is the SAME exported function the page imports,
 * so every call from the page is captured.
 *
 *   Buggy version [currentProject]      -> syncScope fires once per
 *                                          render (≥ 3 calls during
 *                                          mount + IPC resolve + commit)
 *   Fixed version [currentProject?.id]   -> syncScope fires once on
 *                                          mount (≤ 2 calls allowing
 *                                          for one StrictMode/act jitter)
 *
 * The assertion `<= 2` is strict but realistic: in jsdom (no StrictMode
 * double-invoke), a fixed version produces exactly 1 call on mount. We
 * allow 2 to account for potential test-environment commit jitter while
 * still flagging the multi-render fire pattern of the buggy version.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Spy counter for syncScopeFromProject. We mock useScope's module so we
// control the exported `syncScopeFromProject` reference; the page imports
// it from this module, so the spy captures every call.
// ---------------------------------------------------------------------------

let syncScopeCallCount = 0;

const mockSyncScopeFromProject = vi.fn((_currentProject: unknown) => {
  syncScopeCallCount += 1;
});

// ---------------------------------------------------------------------------
// Mock useProjects — every call returns a NEW object reference so the test
// mimics the real bug condition (the object identity is unstable).
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => {
    // KEY: build a FRESH object literal on each call. Even when the
    // underlying state is unchanged, the returned `currentProject` is a
    // different reference each time, exactly like the production
    // `Array.prototype.find` returning a fresh reference after a reload.
    const project = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'TestProject',
      root_dir: '/tmp/test-project',
      is_system: false,
    };
    return {
      projects: [project],
      current_project_id: project.id,
      currentProject: { ...project }, // new ref each call
      loading: false,
      error: null,
      reload: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      switchTo: vi.fn(),
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock useScope — preserve the real useSyncExternalStore semantics so any
// scope-store mutation triggers a real re-render (the bug's loop depends
// on this). The exported `syncScopeFromProject` is the spy above.
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useScope', () => {
  let currentState: {
    scope: 'user' | 'project';
    projectRoot: string | null;
  } = { scope: 'user', projectRoot: null };
  const listeners = new Set<() => void>();
  return {
    useScope: () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useSyncExternalStore } = require('react');
      const state = useSyncExternalStore(
        (cb: () => void) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
        () => currentState,
        () => currentState,
      );
      return [
        state.scope,
        (next: 'user' | 'project') => {
          if (currentState.scope !== next) {
            currentState = { ...currentState, scope: next };
            for (const l of Array.from(listeners)) l();
          }
        },
        state.projectRoot,
        (next: string | null) => {
          if (currentState.projectRoot !== next) {
            currentState = { ...currentState, projectRoot: next };
            for (const l of Array.from(listeners)) l();
          }
        },
      ] as const;
    },
    syncScopeFromProject: (
      currentProject: {
        id: string;
        name: string;
        root_dir: string;
        is_system: boolean;
      } | null,
    ) => {
      // Route through the spy so the call count is captured.
      mockSyncScopeFromProject(currentProject);
      const nextScope: 'user' | 'project' = currentProject ? 'project' : 'user';
      const nextRoot = currentProject ? currentProject.root_dir : null;
      if (
        currentState.scope !== nextScope ||
        currentState.projectRoot !== nextRoot
      ) {
        currentState = { scope: nextScope, projectRoot: nextRoot };
        for (const l of Array.from(listeners)) l();
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Mock lib/api/mcp — listMcpServers resolves with [] so the page
// transitions from `loading=true` to `loading=false` after mount. That
// setState inside the page triggers a re-render, which is the bug's
// necessary condition (the effect must re-fire on that re-render).
// ---------------------------------------------------------------------------

vi.mock('../../lib/api/mcp', () => ({
  listMcpServers: () => Promise.resolve([]),
  listMcpServersWithWarnings: () =>
    Promise.resolve({ servers: [], warning: null }),
  addMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  toggleMcpServer: vi.fn(),
  removeMcpServer: vi.fn(),
  parseMcpDeeplink: vi.fn(),
}));

// Mock IPC handlers the page may invoke transitively (no-ops).
vi.mock('../../components/ErrorBanner', () => ({
  ErrorBanner: () => null,
}));

beforeEach(() => {
  syncScopeCallCount = 0;
  // syncScopeCallCount reset happens before each test via beforeEach
  mockSyncScopeFromProject.mockClear();
});

afterEach(() => {
  // Defensive: no fake timers used here, but reset anyway in case a
  // future test introduces them.
  vi.useRealTimers();
});

describe('B8 regression — currentProject effect loop', () => {
  it('fires syncScopeFromProject at most twice when currentProject reference is unstable but id is stable (project scope)', async () => {
    const { default: McpManagementPage } = await import(
      '../../pages/mcp-management'
    );

    // Mount. The page's two effects run: initial load (IPC) and the
    // syncScope effect. After mount, IPC resolves → setState →
    // re-render. With the buggy version [currentProject], the effect
    // re-fires on the re-render. With the fix [currentProject?.id], it
    // does not.
    await act(async () => {
      render(<McpManagementPage />);
    });

    // Flush microtasks so the IPC promise resolves and the page's
    // setState runs, triggering the post-mount re-render.
    for (let i = 0; i < 25; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    // The fixed version fires syncScopeFromProject exactly once on
    // mount. The buggy version fires once per render; with the IPC
    // resolve + commit cycles in this test, that is at least 3 calls.
    // Bound of 2 is strict but realistic — any value above 2 means
    // the effect is firing on subsequent renders.
    expect(syncScopeCallCount).toBeLessThanOrEqual(2);
  });

  it('also stays stable in user scope (currentProject === null, ref instability is moot but verify no extra fires)', async () => {
    // Override the mock for this test only — currentProject = null.
    const useProjectsMod = await import('../../hooks/useProjects');
    const originalUseProjects = useProjectsMod.useProjects;
    // Re-mock useProjects to return null currentProject.
    vi.doMock('../../hooks/useProjects', () => ({
      useProjects: () => ({
        projects: [],
        current_project_id: null,
        currentProject: null,
        loading: false,
        error: null,
        reload: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        switchTo: vi.fn(),
      }),
    }));

    // Force module reload to pick up the new mock.
    vi.resetModules();
    const { default: McpManagementPage } = await import(
      '../../pages/mcp-management'
    );

    await act(async () => {
      render(<McpManagementPage />);
    });

    for (let i = 0; i < 25; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(syncScopeCallCount).toBeLessThanOrEqual(2);

    // Restore the original mock for any subsequent tests.
    vi.doMock('../../hooks/useProjects', () => originalUseProjects);
  });
});