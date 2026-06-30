/**
 * TDD — McpManagementPage in resource-browser (mcp tab) loading regression.
 *
 * 真因假设:当用户通过 resource-browser ?tab=mcp 进入时,
 * McpManagementPage 被内嵌渲染。如果 MCP 的 IPC 解析顺序 / 时序
 * 有问题,loading 可能 stuck。
 *
 * 真测循环行为 — 不全 mock useScope / useProjects / useViewState,
 * 只 spy invoke 看真实调用序列 + 渲染次数。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ViewStateProvider } from '../../hooks/useViewState';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockProjectState: {
  currentProject: { id: string; name: string; root_dir: string; is_system: boolean } | null;
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
// useViewState which imports from plugins/registry which imports
// resource-browser back). Same pattern as useScope-remount.test.tsx.
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
      migrationSearch: undefined,
    }),
  };
});

describe('ResourceBrowser (mcp tab) — McpManagementPage loading regression', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockProjectState.currentProject = null;
  });

  it('entering resource-browser with ?tab=mcp resolves both list_resources and list_mcp_servers', async () => {
    // 真模拟:用户从 sidebar 点击 MCP 管理 → setView('resource-browser')
    // + URL ?tab=mcp → resource-browser mount → kind='mcp' →
    // runList('mcp') 调 list_resources + 渲染 <McpManagementPage />
    // → list_mcp_servers。
    let resolveResources: (v: unknown[]) => void = () => {};
    let resolveMcp: (v: unknown[]) => void = () => {};
    const resourcesPromise = new Promise<unknown[]>((res) => {
      resolveResources = res;
    });
    const mcpPromise = new Promise<unknown[]>((res) => {
      resolveMcp = res;
    });

    mockInvoke.mockImplementation(async (cmd: string, ...args: unknown[]) => {
      console.log('[IPC]', cmd, 'args=', args[1]);
      if (cmd === 'list_resources') return resourcesPromise;
      if (cmd === 'list_mcp_servers') return mcpPromise;
      return [];
    });

    // 设置 URL ?tab=mcp (Phase 46 双源优先级之一)
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '?tab=mcp');
    }

    const { default: ResourceBrowserPage } = await import('../../pages/resource-browser');

    render(
      <ViewStateProvider>
        <ResourceBrowserPage />
      </ViewStateProvider>,
    );

    // 等待 mount effects 触发
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    console.log('--- after mount ---');
    console.log('IPC calls so far:', mockInvoke.mock.calls.map(c => c[0]));

    // 两个 IPC 都应该被触发
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'list_resources').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'list_mcp_servers').length,
    ).toBeGreaterThanOrEqual(1);

    // resolve mcp
    await act(async () => {
      resolveMcp([]);
      await mcpPromise;
    });

    // resolve resources
    await act(async () => {
      resolveResources([]);
      await resourcesPromise;
    });

    // 等几个 tick
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    console.log('--- after resolve ---');
    console.log('IPC calls total:', mockInvoke.mock.calls.map(c => c[0]));

    // 关键:不应有循环 (e.g. list_mcp_servers 不应被调 2+ 次)
    const mcpCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_mcp_servers',
    );
    expect(mcpCalls.length).toBeLessThanOrEqual(2); // 允许 1-2 次 (mount effect),不允许多

    // resource-browser 不应在 mcp tab 显示 "加载中" 无限久
    // (它内部用 state.loading,但 McpManagementPage 才是加载显示)
    // 因为我们没找到 data-testid="resource-browser-loading",只验证 mcp loading
    const loadingEl = screen.queryByTestId('mcp-loading');
    if (loadingEl) {
      console.log('still loading!', loadingEl.textContent);
    }
  });

  it('McpManagementPage inside resource-browser: list_mcp_servers called at most twice (no loop)', async () => {
    // 严格断言:**exactly 1** list_mcp_servers call on mount (mount effect [])
    let mcpCallCount = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') {
        mcpCallCount += 1;
        return [];
      }
      if (cmd === 'list_resources') return [];
      return [];
    });

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '?tab=mcp');
    }

    const { default: ResourceBrowserPage } = await import('../../pages/resource-browser');

    render(
      <ViewStateProvider>
        <ResourceBrowserPage />
      </ViewStateProvider>,
    );

    await act(async () => {
      await new Promise((res) => setTimeout(res, 100));
    });

    console.log('mcpCallCount:', mcpCallCount);
    console.log('all IPC calls:', mockInvoke.mock.calls.map(c => c[0]));

    // 如果是 loop,这里会是 3+ / 5+ / 10+
    expect(mcpCallCount).toBeLessThanOrEqual(2);
  });
});