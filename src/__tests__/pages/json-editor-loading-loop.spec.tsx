/**
 * TDD — JsonEditorPage currentProject ref loop regression (B8 mirror).
 *
 * Background — Phase 46 B8 fix on mcp-management switched
 * `useEffect(..., [currentProject])` to `[currentProject?.id]`
 * because `useProjects().currentProject = projects.find(...) ?? null`
 * returns a fresh ref every render. Resource-browser got the same
 * fix in c8c7958 / d171a50.
 *
 * src/pages/json-editor/index.tsx:137-141 has the identical pattern:
 *
 *   useEffect(() => { syncScopeFromProject(currentProject); },
 *             [currentProject]);   // <- raw unstable ref
 *
 * Latent: same root cause as B8. `syncScopeFromProject` is a no-op
 * when scope/projectRoot haven't changed, but the EFFECT itself
 * still re-runs on every render because the dep ref differs. In
 * real Tauri webview with concurrent React 19 + IPC round-trip,
 * this manifests as repeated effect churn and (with key-driven
 * remounts in some pages) visible IPC loops. The fix is the same:
 * depend on `currentProject?.id` (stable primitive) instead of the
 * object ref.
 *
 * §16 五步:
 *   1. 问题: latent ref loop on json-editor page (同 B8 真因)
 *   2. 真因: src/pages/json-editor/index.tsx:137-141 raw [currentProject]
 *   3. 边界: 1 文件改 deps 数组 + 1 新 test 文件 (≤2 files, §2.4 白名单内)
 *   4. 方案: 改 [currentProject?.id] (B8 mirror, 与 mcp-management + resource-browser 一致)
 *   5. 验证: vitest 改前 FAIL → 改后 PASS
 *
 * Reference commits:
 *   cb3ea09  verify(b8): MCP currentProject effect fix + regression test
 *   7cee365  (B8 fix on mcp-management)
 *   c8c7958  (resource-browser ref loop fix, mirror of B8)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock ONLY the Tauri IPC boundary
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ---------------------------------------------------------------------------
// Spy on syncScopeFromProject — the actual call from the effect is the
// observable side effect we want to count. BEFORE fix: every re-render
// fires the effect → calls syncScopeFromProject → callCount grows on
// every unstable-ref re-render. AFTER fix ([currentProject?.id]):
// ref-changes don't trigger effect → callCount stays flat.
// ---------------------------------------------------------------------------
const mockSyncScope = vi.fn();
vi.mock('../../hooks/useScope', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useScope')>(
    '../../hooks/useScope',
  );
  return {
    ...actual,
    syncScopeFromProject: (...args: unknown[]) => mockSyncScope(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock useProjects — preserve the unstable-ref pattern (projects.find)
// so the test mirrors real useProjects behavior. The mutable ref lets
// us swap refs without remounting.
// ---------------------------------------------------------------------------
const mockProjectState: {
  currentProject:
    | { id: string; name: string; root_dir: string; is_system: boolean }
    | null;
} = {
  currentProject: null,
};

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    currentProject: mockProjectState.currentProject,
    projects: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    switchTo: vi.fn(),
    currentProjectId: mockProjectState.currentProject?.id ?? null,
  }),
}));

// ---------------------------------------------------------------------------
// Mock JsonFileTree so we don't drag in its entire dep graph. Stub
// respects React `key` prop via React.cloneElement-free form: any
// re-mount produces a fresh component instance.
// ---------------------------------------------------------------------------
vi.mock('../../components/JsonFileTree', () => ({
  JsonFileTree: () => <div data-testid="json-file-tree-stub" />,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

describe('JsonEditorPage — currentProject ref loop regression (B8 mirror)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockSyncScope.mockReset();
    mockProjectState.currentProject = null;
  });

  it('mount calls syncScopeFromProject exactly once', async () => {
    mockInvoke.mockImplementation(async () => null);

    const { default: JsonEditorPage } = await import('../../pages/json-editor');

    render(<JsonEditorPage />);

    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    // Mount → useEffect runs once → syncScopeFromProject called once.
    expect(mockSyncScope).toHaveBeenCalledTimes(1);
  });

  it('re-renders with same id but NEW object ref do NOT re-fire the effect (loop regression)', async () => {
    // 关键回归测试: 模拟 useProjects() 反复返回**新的对象引用**
    // (underlying data 不变) 的情况. 如果 json-editor 的
    // useEffect 用 [currentProject] (unstable ref), ref 每次都变 →
    // 每次 effect 都重跑 → syncScopeFromProject callCount 累积.
    // 修后 ([currentProject?.id]) deps 值不变 → 不触发 → callCount 稳定.
    //
    // 这是 B8 + resource-browser 的真因 + 测试模式.
    mockInvoke.mockImplementation(async () => null);

    // 初始 currentProject = null → scope='user'
    mockProjectState.currentProject = null;

    const { default: JsonEditorPage } = await import('../../pages/json-editor');

    const { rerender } = render(<JsonEditorPage />);

    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    const initialCount = mockSyncScope.mock.calls.length;
    expect(initialCount).toBe(1); // mount fired once

    // 切到 project (id='p1', new ref): 这是真值变化 (null → p1)，
    // effect 应该重跑。 允许多 1 次。
    mockProjectState.currentProject = {
      id: 'p1',
      name: 'MyProj',
      root_dir: '/tmp/proj',
      is_system: false,
    };
    await act(async () => {
      rerender(<JsonEditorPage />);
      await new Promise((res) => setTimeout(res, 30));
    });

    const afterSwitchCount = mockSyncScope.mock.calls.length;
    // 合法 scope change → effect 重跑 → 多 1 次
    expect(afterSwitchCount).toBe(initialCount + 1);

    // 关键: 用同样 id + 不同 object ref 反复 re-render 5 次.
    // BEFORE fix: ref 每次都变 → effect 每次重跑 → callCount +5.
    // AFTER fix: [currentProject?.id] deps 不变 → 不触发 → callCount 不变.
    for (let i = 0; i < 5; i++) {
      mockProjectState.currentProject = {
        id: 'p1',
        name: 'MyProj',
        root_dir: '/tmp/proj',
        is_system: false,
      };
      await act(async () => {
        rerender(<JsonEditorPage />);
        await new Promise((res) => setTimeout(res, 10));
      });
    }

    const finalCount = mockSyncScope.mock.calls.length;
    // callCount 必须稳定 (不许累积).
    // BEFORE fix: finalCount = 2 + 5 = 7 (loop)
    // AFTER fix: finalCount = 2 + 0 = 2 (clean)
    expect(finalCount).toBe(afterSwitchCount);
  });

  it('changing currentProject.id DOES re-fire the effect (legitimate change preserved)', async () => {
    // 反向 sanity: 真因 fix 不应破坏"换 project → effect 重跑"的合法行为.
    // 起始 project = p1 (scope='project', root='/tmp/p1'), 切到 p2 →
    // id 变 → effect 应重跑 → syncScopeFromProject 多 1 次.
    mockInvoke.mockImplementation(async () => null);

    mockProjectState.currentProject = {
      id: 'p1',
      name: 'Proj1',
      root_dir: '/tmp/p1',
      is_system: false,
    };

    const { default: JsonEditorPage } = await import('../../pages/json-editor');

    const { rerender } = render(<JsonEditorPage />);

    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    const initialCount = mockSyncScope.mock.calls.length;
    expect(initialCount).toBe(1);

    // 切到 p2: id 变 → effect 应重跑 (deps [currentProject?.id] 时)
    mockProjectState.currentProject = {
      id: 'p2',
      name: 'Proj2',
      root_dir: '/tmp/p2',
      is_system: false,
    };
    await act(async () => {
      rerender(<JsonEditorPage />);
      await new Promise((res) => setTimeout(res, 30));
    });

    const afterSwitchCount = mockSyncScope.mock.calls.length;
    // 应该比 initial 多 1 次 (合法 scope/root 变化)
    expect(afterSwitchCount).toBe(initialCount + 1);
  });
});
