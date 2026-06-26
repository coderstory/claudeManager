/**
 * Vitest coverage for AppSidebar — Phase 11 SC #7 integration.
 *
 * Verifies the sidebar renders the project switcher at the top
 * and that picking a project from the sidebar fires
 * `switch_project` (not just from HomeView).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
