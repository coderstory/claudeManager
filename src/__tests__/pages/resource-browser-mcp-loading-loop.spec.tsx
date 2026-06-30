/**
 * TDD — ResourceBrowser (mcp tab) loading regression (D-44-A followup).
 *
 * Background — Phase 46 D-44-A moved MCP 管理 from a standalone
 * page (src/pages/mcp-management/index.tsx) into the resource-browser
 * mcp tab. Master branch `0bc3130` fixed mcp-management itself
 * (B8 fix: `useEffect(..., [currentProject?.id])`) but the parent
 * resource-browser page still uses raw `[currentProject]`:
 *
 *   src/pages/resource-browser/index.tsx:270-272
 *     useEffect(() => { syncScopeFromProject(currentProject); },
 *               [currentProject]);
 *
 * Same root cause as B8: `useProjects().currentProject` is
 * `projects.find(...) ?? null` — fresh ref every render. Depending
 * on the object instead of its id re-fires the effect on every
 * render → `syncScopeFromProject` → may emit → useScope re-render
 * → loop. In jsdom the timing obscures this, but in real Tauri
 * webview IPC round-trip it manifests as a CPU-100% loading loop
 * when navigating to 资源浏览 → mcp tab.
 *
 * §16 五步:
 *   1. 问题: 用户报告"资源管理-mcp 加载死循环"
 *   2. 真因: resource-browser/index.tsx:270-272 raw [currentProject]
 *      (同 B8 真因,migration 后这页漏套同 fix)
 *   3. 边界: 1 文件改 deps 数组
 *   4. 方案: 改 [currentProject?.id] (B8 mirror, 推荐)
 *   5. 验证: vitest 改前 FAIL → 改后 PASS + 真启 app 截图/console
 *
 * Reference commits:
 *   cb3ea09  verify(b8): MCP currentProject effect fix + regression test
 *   7cee365  (equivalent B8 fix on mcp-management)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ViewStateProvider } from '../../hooks/useViewState';

// ---------------------------------------------------------------------------
// Mock ONLY the Tauri IPC boundary
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ---------------------------------------------------------------------------
// Mock useProjects — preserve the unstable-ref pattern (projects.find)
// so the test mirrors real useProjects behavior.
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

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

// Break the registry ↔ useViewState cycle (resource-browser imports
// useViewState which imports plugins/registry which imports
// resource-browser back).
vi.mock('../../hooks/useViewState', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useViewState')>(
    '../../hooks/useViewState',
  );
  return {
    ...actual,
    useViewState: () => ({
      view: 'resource-browser',
      setView: vi.fn(),
      allViews: [],
      migrationSearch: { tab: 'mcp' },
    }),
  };
});

vi.mock('../../components/ErrorBanner', () => ({
  ErrorBanner: () => null,
  formatRevealError: () => ({ message: 'mocked', kind: 'mocked' }),
}));

describe('ResourceBrowser (mcp tab) — currentProject ref loop regression', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockProjectState.currentProject = null;
  });

  it('renders resource-browser with ?tab=mcp and triggers list_mcp_servers exactly once', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      if (cmd === 'list_resources') return [];
      return [];
    });

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '?tab=mcp');
    }

    const { default: ResourceBrowserPage } = await import(
      '../../pages/resource-browser'
    );

    render(
      <ViewStateProvider>
        <ResourceBrowserPage />
      </ViewStateProvider>,
    );

    await act(async () => {
      await new Promise((res) => setTimeout(res, 100));
    });

    const listCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    );
    console.log('list_mcp_servers call count after mount:', listCalls.length);
    expect(listCalls.length).toBe(1);
  });

  it('useProjects re-render with new currentProject ref does NOT cascade into IPC loop', async () => {
    // 关键回归测试:模拟 useProjects() 反复返回**新的对象引用**
    // (underlying data 不变)的情况。如果 resource-browser 的
    // useEffect 用 [currentProject] (unstable ref),ref 变化触发
    // syncScopeFromProject → emit → useScope re-render → 再次返回新 ref
    // → 死循环。
    //
    // 真因 fix 后 ([currentProject?.id] / 不可变值),ref 变化不会
    // 触发 effect,IPC 只调一次。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      if (cmd === 'list_resources') return [];
      return [];
    });

    // 初始 currentProject (新 ref)
    mockProjectState.currentProject = {
      id: 'p1',
      name: 'MyProj',
      root_dir: '/tmp/proj',
      is_system: false,
    };

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '?tab=mcp');
    }

    const { default: ResourceBrowserPage } = await import(
      '../../pages/resource-browser'
    );

    const { rerender } = render(
      <ViewStateProvider>
        <ResourceBrowserPage />
      </ViewStateProvider>,
    );

    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'list_mcp_servers').length,
    ).toBe(1);

    // 模拟 useProjects re-render 多次:currentProject ref 变,但值不变。
    for (let i = 0; i < 5; i++) {
      mockProjectState.currentProject = {
        id: 'p1',
        name: 'MyProj',
        root_dir: '/tmp/proj',
        is_system: false,
      };
      await act(async () => {
        rerender(
          <ViewStateProvider>
            <ResourceBrowserPage />
          </ViewStateProvider>,
        );
        await new Promise((res) => setTimeout(res, 10));
      });
    }

    // 不应有 IPC loop: ref 变化不应触发额外 mount effect 或 IPC。
    const finalCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    ).length;
    console.log('list_mcp_servers after 5 rerenders:', finalCount);
    expect(finalCount).toBe(1);
  });

  it('does NOT loop when scope value stays the same across project ref changes', async () => {
    // 真 app 流程模拟:
    //   1. 启动 → currentProject=null → scope='user'
    //   2. useProjects 加载完 → currentProject=p1 (新 ref)
    //      → scope='project' (合理 key 变)
    //   3. useProjects 多次 re-render (新 ref,scope 值不变)
    //      → scope='project' (key 不变,不应再 mount effect)
    //
    // 允许:mount effect 1 次 + scope change 触发的额外 mount 1 次 = <= 2 次。
    // 不允许多次 (那是 loop)。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      if (cmd === 'list_resources') return [];
      return [];
    });

    mockProjectState.currentProject = null;

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '?tab=mcp');
    }

    const { default: ResourceBrowserPage } = await import(
      '../../pages/resource-browser'
    );

    const { rerender } = render(
      <ViewStateProvider>
        <ResourceBrowserPage />
      </ViewStateProvider>,
    );

    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    const initialCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    ).length;

    // 切到有项目
    mockProjectState.currentProject = {
      id: 'p1',
      name: 'MyProj',
      root_dir: '/tmp/proj',
      is_system: false,
    };
    await act(async () => {
      rerender(
        <ViewStateProvider>
          <ResourceBrowserPage />
        </ViewStateProvider>,
      );
      await new Promise((res) => setTimeout(res, 30));
    });

    // re-render 多次:new ref, same value
    for (let i = 0; i < 5; i++) {
      mockProjectState.currentProject = {
        id: 'p1',
        name: 'MyProj',
        root_dir: '/tmp/proj',
        is_system: false,
      };
      await act(async () => {
        rerender(
          <ViewStateProvider>
            <ResourceBrowserPage />
          </ViewStateProvider>,
        );
        await new Promise((res) => setTimeout(res, 10));
      });
    }

    const finalCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    ).length;
    console.log(
      'list_mcp_servers initial:',
      initialCount,
      'final:',
      finalCount,
    );

    // 严格断言: 不应有 IPC loop
    expect(finalCount).toBeLessThanOrEqual(2);
  });
});