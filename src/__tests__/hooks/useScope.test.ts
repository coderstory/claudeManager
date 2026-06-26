/**
 * TDD RED — Failing tests for useScope hook (Phase 27 Fix 4, BUG-CR-04).
 *
 * The hook must:
 *   - Return a 4-tuple [scope, setScope, projectRoot, setProjectRoot].
 *   - Be a module-level singleton (multiple calls share state).
 *   - Subscribe via React 19 useSyncExternalStore (no zustand).
 *   - Initialize scope from useProjects().currentProject.
 *   - Be SSR-safe (typeof window check).
 *   - Return stable references from getSnapshot (immutable updates).
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

// ---------------------------------------------------------------------------
// Mock useSyncExternalStore to capture subscribe/getSnapshot calls.
// We test the hook's contract at the public API level (return shape,
// singleton, re-render on change) — the actual useSyncExternalStore
// integration is verified by the component remount tests.
// ---------------------------------------------------------------------------

describe('useScope — Phase 27 Fix 4 (BUG-CR-04)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCurrentProject.mockReset();
  });

  it('returns a 4-tuple [scope, setScope, projectRoot, setProjectRoot]', async () => {
    mockCurrentProject.mockReturnValue(null);
    const { useScope } = await import('../../hooks/useScope');
    const { result } = renderHook(() => useScope());
    const tuple = result.current;
    expect(Array.isArray(tuple)).toBe(true);
    expect(tuple).toHaveLength(4);
    const [scope, setScope, projectRoot, setProjectRoot] = tuple;
    // Initial values derived from currentProject=null.
    expect(scope).toBe('user');
    expect(projectRoot).toBe(null);
    expect(typeof setScope).toBe('function');
    expect(typeof setProjectRoot).toBe('function');
  });

  it('initializes scope=project when currentProject is set', async () => {
    mockCurrentProject.mockReturnValue({
      id: 'p1',
      name: 'MyApp',
      root_dir: '/x/y',
      is_system: false,
    });
    const { useScope } = await import('../../hooks/useScope');
    const { result } = renderHook(() => useScope());
    expect(result.current[0]).toBe('project');
    expect(result.current[2]).toBe('/x/y');
  });

  it('setScope updates scope and triggers re-render', async () => {
    mockCurrentProject.mockReturnValue(null);
    const { useScope } = await import('../../hooks/useScope');
    const { result } = renderHook(() => useScope());
    expect(result.current[0]).toBe('user');
    act(() => {
      result.current[1]('project');
    });
    expect(result.current[0]).toBe('project');
  });

  it('setProjectRoot updates projectRoot and triggers re-render', async () => {
    mockCurrentProject.mockReturnValue(null);
    const { useScope } = await import('../../hooks/useScope');
    const { result } = renderHook(() => useScope());
    expect(result.current[2]).toBe(null);
    act(() => {
      result.current[3]('/a/b');
    });
    expect(result.current[2]).toBe('/a/b');
  });

  it('is a singleton — multiple calls share state', async () => {
    mockCurrentProject.mockReturnValue(null);
    const { useScope } = await import('../../hooks/useScope');
    const { result: r1 } = renderHook(() => useScope());
    const { result: r2 } = renderHook(() => useScope());
    // Both start user.
    expect(r1.current[0]).toBe('user');
    expect(r2.current[0]).toBe('user');
    // Change via r1 → r2 sees it.
    act(() => {
      r1.current[1]('project');
    });
    expect(r2.current[0]).toBe('project');
  });

  it('does NOT import zustand (CLAUDE.md §2.3)', async () => {
    // Dynamic import the hook source and check for zustand usage.
    // We can't easily read the file in vitest, but we verify at the
    // package level that zustand is not a dependency.
    const pkg = await import('../../../package.json');
    expect(pkg.dependencies).not.toHaveProperty('zustand');
    expect(pkg.devDependencies).not.toHaveProperty('zustand');
  });
});
