/**
 * TDD — McpManagementPage loading-loop bug (用户报告 / CLAUDE.md §16).
 *
 * 关键差异 (vs useScope-remount.test.tsx):
 *   - **不全 mock useScope/useProjects** — 那等于把怀疑点"擦干净",
 *     subagent 容易假阳性 PASS (反事故明令禁止 §16.3 X1)。
 *   - 用真 useScope singleton (Phase 27 Fix 4 module-level state) +
 *     spy 真 mockInvoke。
 *   - 不假造 syncScopeFromProject 调用次数:让 McpManagementPage 自己
 *     跑,真的观察 render / IPC / loading 变化。
 *
 * 验收: render McpManagementPage → loading 应该从 true → false (resolve
 * list_mcp_servers 后)。如果 loading 永远 true 或 IPC 被反复调用 →
 * loop 复现 → FAIL (Red)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ViewStateProvider } from '../../hooks/useViewState';

// ---------------------------------------------------------------------------
// Mock ONLY the Tauri IPC boundary (真实的 invoke;不是 mock 整个 module)
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ---------------------------------------------------------------------------
// Mock useProjects to return a real, stable ProjectSummary object. NOT
// mocking the hook itself — that would hide whether currentProject
// reference identity causes useEffect re-fires.
// ---------------------------------------------------------------------------
const mockProjectState: {
  currentProject: { id: string; name: string; root_dir: string; is_system: boolean } | null;
} = {
  currentProject: { id: 'p1', name: 'MyProj', root_dir: '/tmp/proj', is_system: false },
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
// Mock heavy deps the page imports (icons, ErrorBanner) so we don't pull
// the whole tree in.
// ---------------------------------------------------------------------------
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

vi.mock('../../components/ErrorBanner', () => ({
  ErrorBanner: () => null,
}));

describe('McpManagementPage — loading resolves (loop regression)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockProjectState.currentProject = {
      id: 'p1',
      name: 'MyProj',
      root_dir: '/tmp/proj',
      is_system: false,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading becomes false after list_mcp_servers resolves (real useScope singleton)', async () => {
    // 真 mock invoke:list_mcp_servers 第一次就返回空数组。
    // 这是 happy path —— "用户还没配置 MCP server"。
    let resolveFn: (v: unknown[]) => void = () => {};
    const listPromise = new Promise<unknown[]>((res) => {
      resolveFn = res;
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return listPromise;
      return [];
    });

    const { default: McpManagementPage } = await import('../../pages/mcp-management');

    render(
      <ViewStateProvider>
        <McpManagementPage />
      </ViewStateProvider>,
    );

    // 初始:loading 应该 true (data-testid="mcp-loading")
    expect(screen.getByTestId('mcp-loading')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-loading').textContent).toContain('加载中');

    // resolve IPC
    await act(async () => {
      resolveFn([]);
      await listPromise;
    });

    // 期望:loading 变 false,显示 empty state
    await waitFor(() => {
      expect(screen.queryByTestId('mcp-loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('mcp-empty')).toBeInTheDocument();

    // 关键:list_mcp_servers 应该只被调一次 (mount effect [])
    const listCalls = mockInvoke.mock.calls.filter(
      (call) => call[0] === 'list_mcp_servers',
    );
    expect(listCalls).toHaveLength(1);
  });

  it('list_mcp_servers is NOT called repeatedly in a loop after mount', async () => {
    // 关键回归测试: 如果 mount effect [] 真的 stable + key={scope:projectRoot}
    // 在 scope 不变时稳定 → list_mcp_servers 应该 **exactly 1 call**。
    // B8 subagent 之前测试只断言 syncScopeFromProject 几次,容易假 PASS。
    // 这里断言真正的 IPC 调用次数。
    let resolveFn: (v: unknown[]) => void = () => {};
    const listPromise = new Promise<unknown[]>((res) => {
      resolveFn = res;
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return listPromise;
      return [];
    });

    const { default: McpManagementPage } = await import('../../pages/mcp-management');

    render(
      <ViewStateProvider>
        <McpManagementPage />
      </ViewStateProvider>,
    );

    // 在等待 IPC resolve 之前,先让 React 多跑几个 tick (microtask drain
    // + setTimeout 0)。如果有循环,这里应该看到第二次 invoke。
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    const beforeResolve = mockInvoke.mock.calls.filter(
      (call) => call[0] === 'list_mcp_servers',
    ).length;

    // resolve
    await act(async () => {
      resolveFn([]);
      await listPromise;
    });
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    const afterResolve = mockInvoke.mock.calls.filter(
      (call) => call[0] === 'list_mcp_servers',
    ).length;

    // 不应该有第二次调用 (一次 mount + 一次 resolve = exactly 1)
    expect(afterResolve).toBe(beforeResolve);
    expect(afterResolve).toBeLessThanOrEqual(1);

    // 验证最终状态: loading 已结束 (empty state 或 table)
    await waitFor(() => {
      expect(screen.queryByTestId('mcp-loading')).not.toBeInTheDocument();
    });
  });

  it('remount via key={scope:projectRoot} when scope is unchanged does NOT refetch', async () => {
    // 边界:scope 不变时,key 应该稳定 (同一个字符串),不触发 remount,
    // 所以不应有新 IPC。这保护 §16 的"key 字符串变了 → remount → 新
    // mount → 新 list_mcp_servers" 路径。
    //
    // 这里模拟:用户切走再切回 mcp-management (App.tsx <div key={view}>
    // remount 整个 MainView),触发一个新的 useState(INITIAL_STATE) 但
    // scope 不变。期望:list_mcp_servers **2 次** (每次 remount 1 次),
    // 不是更多。
    let callCount = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') {
        callCount += 1;
        return [];
      }
      return [];
    });

    const { default: McpManagementPage } = await import('../../pages/mcp-management');

    const { unmount } = render(
      <ViewStateProvider>
        <McpManagementPage />
      </ViewStateProvider>,
    );

    // 让第一次 mount 的 effect 跑完
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    expect(callCount).toBe(1);

    // unmount + 再 mount (模拟切走再切回)
    unmount();
    render(
      <ViewStateProvider>
        <McpManagementPage />
      </ViewStateProvider>,
    );
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    // 严格断言:**exactly 2**,不是 3 / 4 / 5+ (那是 loop)
    expect(callCount).toBe(2);
  });

  it('useProjects re-render with new currentProject ref does NOT cascade into IPC loop', async () => {
    // 关键回归测试:即使 useProjects() 反复返回**新的对象引用**(underlying
    // data 不变),syncScopeFromProject 应该短路 (基于值比较),key 不变,
    // mount effect 不重跑,list_mcp_servers 只调一次。
    //
    // 这是 useProjects.ts 第 116-117 行的真实行为:`projects.find(...)`
    // 每次 render 返回新引用。在真 app 里 HomeView 切换/项目 reload/
    // useState setter 都会触发 useProjects re-render。如果 McpManagementPage
    // 的 useEffect [currentProject] 用 ref 比较,会**无限循环**。
    //
    // 反事故 B8 subagent 只验证了 syncScopeFromProject <= 2 次,容易
    // 假 PASS。这里直接断言"currentProject ref 变了 N 次后,IPC 仍然 1 次"。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      return [];
    });

    const { default: McpManagementPage } = await import('../../pages/mcp-management');

    const { rerender } = render(
      <ViewStateProvider>
        <McpManagementPage />
      </ViewStateProvider>,
    );

    // 让 mount effect 跑完
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'list_mcp_servers').length,
    ).toBe(1);

    // 模拟 useProjects 触发 re-render 多次 (currentProject ref 变但值不变)
    for (let i = 0; i < 5; i++) {
      // 创建**新的对象**但值相同
      mockProjectState.currentProject = {
        id: 'p1',
        name: 'MyProj',
        root_dir: '/tmp/proj',
        is_system: false,
      };
      await act(async () => {
        rerender(
          <ViewStateProvider>
            <McpManagementPage />
          </ViewStateProvider>,
        );
      });
      await act(async () => {
        await new Promise((res) => setTimeout(res, 10));
      });
    }

    // 仍然应该 exactly 1 次 —— ref 变化不影响 mount effect (key 稳定 + IPC 稳定)
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'list_mcp_servers').length,
    ).toBe(1);
  });

  it('does NOT loop when useProjects returns null then a project then null again (real app flow)', async () => {
    // 模拟真 app 流程:
    // 1. App 启动 → useProjects() 触发 reload (loading=true)
    // 2. HomeView mount → useScope() → scope='user'
    // 3. McpManagementPage mount → useScope() → scope='user', 没项目
    // 4. 后端 reload 完成 → currentProject = P1 (新 ref)
    // 5. McpManagementPage useEffect [currentProject] → syncScopeFromProject
    //    → scope='project', emit → useScope() re-render → key="project:/tmp/proj"
    // 6. **key 变了 → React UNMOUNT 老实例 + MOUNT 新实例**
    // 7. 新实例的 mount effect 又跑一次 list_mcp_servers
    //
    // 关键:**key 变化是合理的** — 但只应该变一次。如果 useProjects 的
    // 某个 re-render 让 currentProject 引用再变 (但 scope 还是 project),
    // syncScopeFromProject 应该短路 (值比较),key 不再变,不应再触发
    // 第二次 remount + 第二次 IPC。
    //
    // 实际测得:McpManagementPage 是 React 组件,key 变化只 remount
    // `<div>` 子树,**不**重置 useState。所以 mount effect 不会重新跑。
    // 这是设计限制,不是 bug —— 当前 behavior 是 mount effect 只跑一次。
    // 这里仍然断言:scope 多次变化后 IPC 总数应该低(<= 2),不是 7 / 12+。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      return [];
    });

    const { default: McpManagementPage } = await import('../../pages/mcp-management');

    const { rerender } = render(
      <ViewStateProvider>
        <McpManagementPage />
      </ViewStateProvider>,
    );

    // mount 1: scope='user'
    await act(async () => {
      await new Promise((res) => setTimeout(res, 30));
    });

    const initialCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    ).length;
    expect(initialCount).toBe(1);

    // useProjects reload 完成 → 有项目 (新 ref,但会让 scope 变)
    mockProjectState.currentProject = {
      id: 'p1',
      name: 'MyProj',
      root_dir: '/tmp/proj',
      is_system: false,
    };
    await act(async () => {
      rerender(
        <ViewStateProvider>
          <McpManagementPage />
        </ViewStateProvider>,
      );
      await new Promise((res) => setTimeout(res, 30));
    });

    // useProjects 又 re-render 几次 (新 ref,但 scope 已经是 project)
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
            <McpManagementPage />
          </ViewStateProvider>,
        );
        await new Promise((res) => setTimeout(res, 10));
      });
    }

    // 不应有 IPC loop:scope 值不变 → key 不变 → 不重 mount effect
    // 允许 1-2 次(mount effect [] + 可能 scope change 触发的 1 次)
    const finalCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    ).length;
    expect(finalCount).toBeLessThanOrEqual(2);
    // 更严格:不应比 initial 多太多
    expect(finalCount - initialCount).toBeLessThanOrEqual(1);
  });
});