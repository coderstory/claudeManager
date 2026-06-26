/**
 * TDD — Tests for useScope hook (Phase 27 Fix 4, BUG-CR-04).
 *
 * The hook must:
 *   - Return a 4-tuple [scope, setScope, projectRoot, setProjectRoot].
 *   - Be a module-level singleton (multiple calls share state).
 *   - Subscribe via React 19 useSyncExternalStore (no zustand).
 *   - Initialize scope from syncScopeFromProject(currentProject).
 *   - Be SSR-safe (typeof window check).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock useProjects so the hook has a deterministic source.
// ---------------------------------------------------------------------------
const mockCurrentProject = vi.fn();
vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    currentProject: mockCurrentProject(),
  }),
}));

// Use a mutable module reference so vi.resetModules() invalidation works.
let useScopeModule: typeof import('../../hooks/useScope');

async function loadUseScope() {
  useScopeModule = await import('../../hooks/useScope');
  return useScopeModule;
}

describe('useScope — Phase 27 Fix 4 (BUG-CR-04)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCurrentProject.mockReset();
  });

  it('returns a 4-tuple [scope, setScope, projectRoot, setProjectRoot]', async () => {
    const { useScope } = await loadUseScope();
    const { result } = renderHook(() => useScope());
    const tuple = result.current;
    expect(Array.isArray(tuple)).toBe(true);
    expect(tuple).toHaveLength(4);
    const [scope, setScope, projectRoot, setProjectRoot] = tuple;
    // Initial values: singleton defaults to user.
    expect(scope).toBe('user');
    expect(projectRoot).toBe(null);
    expect(typeof setScope).toBe('function');
    expect(typeof setProjectRoot).toBe('function');
  });

  it('initializes scope=project when syncScopeFromProject is called with a project', async () => {
    const { useScope, syncScopeFromProject } = await loadUseScope();
    const { result } = renderHook(() => useScope());
    expect(result.current[0]).toBe('user');

    act(() => {
      syncScopeFromProject({
        id: 'p1',
        name: 'MyApp',
        root_dir: '/x/y',
        is_system: false,
      });
    });
    expect(result.current[0]).toBe('project');
    expect(result.current[2]).toBe('/x/y');
  });

  it('syncScopeFromProject updates scope back to user when project=null', async () => {
    const { useScope, syncScopeFromProject } = await loadUseScope();
    const { result } = renderHook(() => useScope());

    act(() => {
      syncScopeFromProject({
        id: 'p1',
        name: 'MyApp',
        root_dir: '/x/y',
        is_system: false,
      });
    });
    expect(result.current[0]).toBe('project');

    act(() => {
      syncScopeFromProject(null);
    });
    expect(result.current[0]).toBe('user');
    expect(result.current[2]).toBe(null);
  });

  it('setScope updates scope and triggers re-render', async () => {
    const { useScope } = await loadUseScope();
    const { result } = renderHook(() => useScope());
    expect(result.current[0]).toBe('user');
    act(() => {
      result.current[1]('project');
    });
    expect(result.current[0]).toBe('project');
  });

  it('setProjectRoot updates projectRoot and triggers re-render', async () => {
    const { useScope } = await loadUseScope();
    const { result } = renderHook(() => useScope());
    expect(result.current[2]).toBe(null);
    act(() => {
      result.current[3]('/a/b');
    });
    expect(result.current[2]).toBe('/a/b');
  });

  it('is a singleton — multiple calls share state', async () => {
    const { useScope } = await loadUseScope();
    const { result: r1 } = renderHook(() => useScope());
    const { result: r2 } = renderHook(() => useScope());
    expect(r1.current[0]).toBe('user');
    expect(r2.current[0]).toBe('user');
    act(() => {
      r1.current[1]('project');
    });
    expect(r2.current[0]).toBe('project');
  });

  it('does NOT import zustand (CLAUDE.md §2.3)', async () => {
    // Verify at the package level that zustand is not a dependency.
    const pkg = await import('../../../package.json');
    expect(pkg.default.dependencies).not.toHaveProperty('zustand');
    expect(pkg.default.devDependencies).not.toHaveProperty('zustand');
  });

  it('setScope is a no-op when scope is unchanged', async () => {
    const { useScope } = await loadUseScope();
    const { result } = renderHook(() => useScope());
    expect(result.current[0]).toBe('user');
    act(() => {
      result.current[1]('user'); // same value
    });
    expect(result.current[0]).toBe('user');
  });
});
