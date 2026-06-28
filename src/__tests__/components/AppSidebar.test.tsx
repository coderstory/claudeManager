/**
 * Vitest coverage for AppSidebar — Phase 11 SC #7 integration.
 *
 * Verifies the sidebar renders the project switcher at the top
 * and that picking a project from the sidebar fires
 * `switch_project` (not just from HomeView).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Phase 46 D-44-A — break the registry ↔ useViewState cycle that otherwise
// blows up at module load (registry → stubs/usage-query → pages/usage-query
// → hooks/useViewState → registry). AppSidebar consumes registry directly;
// useViewState is never called in this test file. Stub it.
vi.mock('../../hooks/useViewState', () => ({
  useViewState: () => ({
    view: 'home',
    setView: () => {},
    allViews: [],
    migrationSearch: undefined,
  }),
  ViewStateProvider: ({ children }: { children: React.ReactNode }) => children,
  HOME_VIEW: 'home',
  STORAGE_KEY: 'ccm.lastView',
  ALL_VIEWS: [],
  migrateViewId: (stored: string | null) => ({ view: stored ?? 'home' }),
}));

import { AppSidebar } from '../../components/AppSidebar';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const projectsResultA = {
  projects: [
    { id: 'sys', name: '用户模式', root_dir: 'C:/Users/me', is_system: true },
    { id: 'proj-A-uuid', name: '项目 A', root_dir: 'D:/A', is_system: false },
    { id: 'proj-B-uuid', name: '项目 B', root_dir: 'D:/B', is_system: false },
  ],
  current_project_id: 'proj-A-uuid',
  file: { version: 1, current_project_id: 'proj-A-uuid', projects: [] },
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_projects') return projectsResultA;
    if (cmd === 'switch_project')
      return projectsResultA.projects.find((p) => p.id === 'proj-B-uuid');
    return null;
  });
});

describe('AppSidebar — Phase 11 SC #7', () => {
  it('renders the sidebar with the project switcher at the top', async () => {
    render(<AppSidebar currentView="home" onNavigate={vi.fn()} />);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar).toBeInTheDocument();
    // Switcher sits above the nav list — use findBy to wait for the IPC fetch.
    const switcher = await screen.findByTestId('sidebar-project-switcher');
    expect(switcher).toBeInTheDocument();
  });

  it('shows the current project name in the switcher toggle', async () => {
    render(<AppSidebar currentView="home" onNavigate={vi.fn()} />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    expect(toggle.textContent).toContain('项目 A');
  });

  it('clicking a project in the sidebar switcher fires switch_project IPC', async () => {
    const onNavigate = vi.fn();
    render(<AppSidebar currentView="provider-list" onNavigate={onNavigate} />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    const target = await screen.findByTestId('sidebar-switch-to-proj-B-uuid');
    fireEvent.click(target);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === 'switch_project');
      expect(calls.length).toBe(1);
      expect(calls[0]?.[1]).toEqual({ id: 'proj-B-uuid' });
    });
  });

  it('navigates to home view after switching from the sidebar', async () => {
    const onNavigate = vi.fn();
    render(<AppSidebar currentView="provider-list" onNavigate={onNavigate} />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    const target = await screen.findByTestId('sidebar-switch-to-proj-B-uuid');
    fireEvent.click(target);
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('home');
    });
  });

  it('still renders all the navigation tiles alongside the switcher', async () => {
    render(<AppSidebar currentView="home" onNavigate={vi.fn()} />);
    // Wait for the switcher to appear (post-fetch) so the assertion is stable.
    await screen.findByTestId('sidebar-project-switcher');
    expect(screen.getByTestId('sidebar-item-home')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-provider-list')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-about')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 27 Fix 6 (BUG-CR-04 子件) — MCP 合并到 ResourceBrowser
// ---------------------------------------------------------------------------
//
// D-10/D-12: sidebar "MCP 管理" 入口删除 (route 'mcp-management' 退出
// ALL_VIEWS + VIEW_META)。mcp tab 现在挂在 /resource-browser 下。
// D-13: 老用户 localStorage 还存 'mcp-management' → App.tsx redirect。

describe('AppSidebar — Phase 46 D-44-A: mcp-management stub deleted', () => {
  // Phase 27 Fix 6 merged mcp → resource-browser tab.
  // Phase 44 派生收敛 re-introduced mcp-management sidebar tile.
  // Phase 46 D-44-A: mcp-management stub 删,sidebar tile 不再有
  // mcp-management entry (Q44-3 migrateFrom + Phase 46 启用)。
  it('Phase 46 D-44-A: mcp-management sidebar tile removed (mcp entry merged into resource-browser)', async () => {
    render(<AppSidebar currentView="home" onNavigate={vi.fn()} />);
    await screen.findByTestId('sidebar-project-switcher');
    expect(screen.queryByTestId('sidebar-item-mcp-management')).toBeNull();
  });

  it('still renders the resource-browser tile (D-11 + URL ?tab=mcp)', async () => {
    render(<AppSidebar currentView="home" onNavigate={vi.fn()} />);
    await screen.findByTestId('sidebar-project-switcher');
    expect(screen.getByTestId('sidebar-item-resource-browser')).toBeInTheDocument();
  });
});
