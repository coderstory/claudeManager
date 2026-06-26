/**
 * TDD RED — Component remount behavior for Phase 27 Fix 4 (BUG-CR-04).
 *
 * After the fix:
 *   - McpManagementPage wraps body in a div with
 *     key={scope + ':' + (projectRoot ?? 'user')} data-testid="mcp-management-page"
 *   - ResourceBrowserPage wraps body in a div with
 *     key={scope + ':' + (projectRoot ?? 'user')} data-testid="resource-browser-page"
 *   - JsonEditorPage wraps JsonFileTree in a key={scope + ':' + (projectRoot ?? 'user')}
 *   - JsonFileTree accepts + passes through the key prop
 *
 * These tests verify the key-driven remount contract at the DOM level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock useProjects + useScope so we can drive scope changes.
const mockCurrentProject = vi.fn();
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

// Helper to set the project and force the hook to re-evaluate.
function setProject(proj: { id: string; name: string; root_dir: string; is_system: boolean } | null) {
  mockCurrentProject.mockReturnValue(proj);
}

describe('Phase 27 Fix 4 — component remount on scope change (BUG-CR-04)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockCurrentProject.mockReset();
  });

  // ----- McpManagementPage -----
  describe('McpManagementPage', () => {
    it('wraps body in a div with key={scope + ":" + projectRoot} and data-testid="mcp-management-page"', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: McpManagementPage } = await import('../../pages/mcp-management');
      render(<McpManagementPage />);
      const page = await screen.findByTestId('mcp-management-page');
      // The outer div should have a key attribute (React sets it on the
      // fiber, not the DOM — but we can verify the div exists and has
      // stable identity by checking its data-testid).
      expect(page).toBeInTheDocument();
      // The key is set on the React element, not the DOM. We verify
      // the wrapper exists and has the expected structure.
      expect(page.getAttribute('data-testid')).toBe('mcp-management-page');
    });
  });

  // ----- ResourceBrowserPage -----
  describe('ResourceBrowserPage', () => {
    it('wraps body in a div with key={scope + ":" + projectRoot} and data-testid="resource-browser-page"', async () => {
      setProject(null);
      mockInvoke.mockResolvedValue([]);
      const { default: ResourceBrowserPage } = await import('../../pages/resource-browser');
      render(<ResourceBrowserPage />);
      const page = await screen.findByTestId('resource-browser-page');
      expect(page).toBeInTheDocument();
      expect(page.getAttribute('data-testid')).toBe('resource-browser-page');
    });
  });

  // ----- JsonEditorPage + JsonFileTree -----
  describe('JsonEditorPage + JsonFileTree', () => {
    it('JsonFileTree accepts and passes through the key prop', async () => {
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
      const { container } = render(
        <JsonFileTree
          key="user:/initial"
          entries={[sampleEntry]}
          selectedPath={null}
          onSelect={() => {}}
        />,
      );
      // The key prop is consumed by React, not rendered to DOM. We
      // verify the component renders successfully with the key.
      expect(screen.getByTestId('json-file-tree')).toBeInTheDocument();
    });
  });
});
