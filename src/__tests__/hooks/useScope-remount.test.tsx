/**
 * TDD — Component remount behavior for Phase 27 Fix 4 (BUG-CR-04).
 *
 * After the fix:
 *   - McpManagementPage wraps body in a div with
 *     key={scope + ':' + (projectRoot ?? 'user')} data-testid="mcp-management-page"
 *   - ResourceBrowserPage wraps body in a div with
 *     key={scope + ':' + (projectRoot ?? 'user')} data-testid="resource-browser-page"
 *   - JsonEditorPage wraps JsonFileTree in a key={scope + ':' + (projectRoot ?? 'user')}
 *
 * These tests verify the key-driven remount contract at the DOM level.
 * The key prop is consumed by React (not rendered to DOM), so we verify
 * indirectly by checking that the components render correctly and the
 * data-testid wrappers exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Phase 46 D-44-A — break the registry ↔ useViewState cycle that otherwise
// blows up at module load (registry → stubs/usage-query → pages/usage-query
// → hooks/useViewState → registry). The cycle's only side effect that
// ResourceBrowserPage actually USES is `migrationSearch` (Phase 46 Q46-3),
// and this test file doesn't care about it. Stub it.
vi.mock('../../hooks/useViewState', () => ({
  useViewState: () => ({
    view: 'resource-browser',
    setView: vi.fn(),
    allViews: [],
    migrationSearch: undefined,
  }),
  ViewStateProvider: ({ children }: { children: React.ReactNode }) => children,
  HOME_VIEW: 'home',
  STORAGE_KEY: 'ccm.lastView',
  ALL_VIEWS: [],
  migrateViewId: (stored: string | null) => ({ view: stored ?? 'home' }),
}));

// Mock useProjects + useScope so we can drive scope changes.
const mockCurrentProject = vi.fn();
const mockSyncScope = vi.fn();
vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    currentProject: mockCurrentProject(),
    projects: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    switchTo: vi.fn(),
  }),
}));

vi.mock('../../hooks/useScope', () => ({
  useScope: () => {
    // Return the current state from the singleton. Since the singleton
    // is shared across tests, we read mockCurrentProject directly.
    const proj = mockCurrentProject();
    const scope = proj ? 'project' : 'user';
    const root = proj ? proj.root_dir : null;
    return [
      scope,
      (next: string) => {
        // Simulate scope change by updating the mock.
        if (next === 'user') mockCurrentProject.mockReturnValue(null);
        else mockCurrentProject.mockReturnValue({ id: 'p1', name: 'X', root_dir: '/x', is_system: false });
      },
      root,
      vi.fn(),
    ] as const;
  },
  syncScopeFromProject: mockSyncScope,
}));

function setProject(proj: { id: string; name: string; root_dir: string; is_system: boolean } | null) {
  mockCurrentProject.mockReturnValue(proj);
}

describe('Phase 27 Fix 4 — component remount on scope change (BUG-CR-04)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockCurrentProject.mockReset();
    mockSyncScope.mockReset();
  });

  // ----- McpManagementPage -----
  describe('McpManagementPage', () => {
    it('wraps body in a div with data-testid="mcp-management-page"', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: McpManagementPage } = await import('../../pages/mcp-management');
      render(<McpManagementPage />);
      const page = await screen.findByTestId('mcp-management-page');
      expect(page).toBeInTheDocument();
      expect(page.getAttribute('data-testid')).toBe('mcp-management-page');
    });

    it('calls syncScopeFromProject on mount', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: McpManagementPage } = await import('../../pages/mcp-management');
      render(<McpManagementPage />);
      await screen.findByTestId('mcp-management-page');
      // syncScopeFromProject is called via useEffect after render.
      await waitFor(() => {
        expect(mockSyncScope).toHaveBeenCalled();
      });
    });
  });

  // ----- ResourceBrowserPage -----
  describe('ResourceBrowserPage', () => {
    it('wraps body in a div with data-testid="resource-browser-page"', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: ResourceBrowserPage } = await import('../../pages/resource-browser');
      render(<ResourceBrowserPage />);
      const page = await screen.findByTestId('resource-browser-page');
      expect(page).toBeInTheDocument();
      expect(page.getAttribute('data-testid')).toBe('resource-browser-page');
    });

    it('calls syncScopeFromProject on mount', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: ResourceBrowserPage } = await import('../../pages/resource-browser');
      render(<ResourceBrowserPage />);
      await screen.findByTestId('resource-browser-page');
      // syncScopeFromProject is called via useEffect after render.
      await waitFor(() => {
        expect(mockSyncScope).toHaveBeenCalled();
      });
    });
  });

  // ----- JsonEditorPage + JsonFileTree -----
  describe('JsonEditorPage + JsonFileTree', () => {
    it('JsonFileTree renders with key prop', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { JsonFileTree } = await import('../../components/JsonFileTree');
      const sampleEntry = {
        path: '/home/u/.claude/settings.json',
        relative_path: 'settings.json',
        scope: 'user',
        scope_label: '用户级',
        size: 100,
        last_modified: 1700000000,
      };
      render(
        <JsonFileTree
          key="user:/initial"
          entries={[sampleEntry]}
          selectedPath={null}
          onSelect={() => {}}
        />,
      );
      expect(screen.getByTestId('json-file-tree')).toBeInTheDocument();
    });

    it('JsonEditorPage calls syncScopeFromProject on mount', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: JsonEditorPage } = await import('../../pages/json-editor');
      render(<JsonEditorPage />);
      await screen.findByTestId('json-editor-page');
      // syncScopeFromProject is called via useEffect after render.
      await waitFor(() => {
        expect(mockSyncScope).toHaveBeenCalled();
      });
    });
  });
});
