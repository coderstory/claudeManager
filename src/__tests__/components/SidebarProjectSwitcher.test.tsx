/**
 * Vitest coverage for the M3.10 / Phase 11 SC #7 SidebarProjectSwitcher.
 *
 * Covers (TDD, CLAUDE.md §5.2):
 *   1. Shows the current project name when projects are loaded.
 *   2. Clicking the toggle opens the dropdown menu with the project list.
 *   3. Clicking a different project calls `switch_project` IPC.
 *   4. Loading state renders "加载中…".
 *   5. Empty projects list disables the toggle and renders "暂无项目".
 *   6. Outside click closes the dropdown.
 *   7. Escape key closes the dropdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SidebarProjectSwitcher } from '../../components/SidebarProjectSwitcher';
import { SYSTEM_PROJECT_ID } from '../../types/project';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleProjects = [
  {
    id: SYSTEM_PROJECT_ID,
    name: '用户模式',
    root_dir: 'C:/Users/me',
    is_system: true,
  },
  {
    id: 'proj-A-uuid',
    name: '项目 A',
    root_dir: 'D:/projects/A',
    is_system: false,
  },
  {
    id: 'proj-B-uuid',
    name: '项目 B',
    root_dir: 'D:/projects/B',
    is_system: false,
  },
];

const emptyProjectsResult = {
  projects: [],
  current_project_id: null,
  file: { version: 1, current_project_id: null, projects: [] },
};

const projectsResultA = {
  projects: sampleProjects,
  current_project_id: 'proj-A-uuid',
  file: { version: 1, current_project_id: 'proj-A-uuid', projects: [] },
};

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: list_projects returns proj-A as active.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_projects') return projectsResultA;
    if (cmd === 'switch_project') return sampleProjects[1];
    return null;
  });
});

describe('SidebarProjectSwitcher — Phase 11 SC #7', () => {
  it('renders the current project name as the toggle label', async () => {
    render(<SidebarProjectSwitcher />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    expect(toggle.textContent).toContain('项目 A');
  });

  it('shows a "加载中…" label before the first fetch resolves', () => {
    // Override: never resolve the fetch.
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<SidebarProjectSwitcher />);
    const toggle = screen.getByTestId('sidebar-project-switcher-toggle');
    expect(toggle.textContent).toContain('加载中');
  });

  it('clicking the toggle opens a listbox with all projects', async () => {
    render(<SidebarProjectSwitcher />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    const menu = screen.getByTestId('sidebar-project-switcher-menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-switch-to-proj-A-uuid')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-switch-to-proj-B-uuid')).toBeInTheDocument();
    expect(screen.getByTestId(`sidebar-switch-to-${SYSTEM_PROJECT_ID}`)).toBeInTheDocument();
  });

  it('clicking a different project fires switch_project IPC', async () => {
    render(<SidebarProjectSwitcher />);
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

  it('clicking the active project does NOT fire switch_project', async () => {
    render(<SidebarProjectSwitcher />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    const activeItem = await screen.findByTestId('sidebar-switch-to-proj-A-uuid');
    fireEvent.click(activeItem);
    // Wait a tick to make sure no async switch is dispatched.
    await new Promise((r) => setTimeout(r, 10));
    const calls = mockInvoke.mock.calls.filter((c) => c[0] === 'switch_project');
    expect(calls.length).toBe(0);
  });

  it('disables the toggle and shows "暂无项目" when projects is empty', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_projects') return emptyProjectsResult;
      return null;
    });
    render(<SidebarProjectSwitcher />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    expect(toggle.textContent).toContain('暂无项目');
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('sidebar-project-switcher-menu')).not.toBeInTheDocument();
  });

  it('outside click closes the dropdown', async () => {
    render(
      <div>
        <SidebarProjectSwitcher />
        <div data-testid="outside">outside</div>
      </div>,
    );
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('sidebar-project-switcher-menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('sidebar-project-switcher-menu')).not.toBeInTheDocument();
  });

  it('Escape key closes the dropdown', async () => {
    render(<SidebarProjectSwitcher />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('sidebar-project-switcher-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('sidebar-project-switcher-menu')).not.toBeInTheDocument();
  });

  it('marks the active project in the dropdown with the accent-soft background', async () => {
    render(<SidebarProjectSwitcher />);
    const toggle = await screen.findByTestId('sidebar-project-switcher-toggle');
    fireEvent.click(toggle);
    // aria-selected is set on the parent <li role="option">.
    const activeItem = await screen.findByTestId('sidebar-switch-to-proj-A-uuid');
    const li = activeItem.closest('[role="option"]');
    expect(li).not.toBeNull();
    expect(li!.getAttribute('aria-selected')).toBe('true');
  });
});
