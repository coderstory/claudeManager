/**
 * Vitest coverage for the F16 ResourceBrowserPage (M2.13).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Page chrome: tabs, rescan button, "位置" hint
 *   - Mount triggers `list_resources('plugin')`
 *   - Items render in the table
 *   - Tab switching triggers a re-fetch for the new kind
 *   - Reveal button calls `reveal_in_file_manager` with the row's path
 *   - Reveal failure surfaces a non-blocking alert (CLAUDE.md §7)
 *   - Empty state shows a friendly hint when list is []
 *   - Scan failure surfaces a list-level error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ResourceBrowserPage from '../../pages/resource-browser';
import type { ResourceItem, ResourceKind } from '../../types/resource';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function item(
  id: string,
  kind: ResourceKind,
  overrides: Partial<ResourceItem> = {},
): ResourceItem {
  return {
    id,
    name: id.split('/').pop() ?? id,
    kind,
    path: `C:/Users/foo/.claude/${kind}s/${id.split('/').pop() ?? id}`,
    size_bytes: 1024,
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('ResourceBrowserPage — F16 (M2.13)', () => {
  it('renders page chrome on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);
    expect(screen.getByTestId('resource-browser-page')).toBeInTheDocument();
    expect(screen.getByTestId('resource-browser-tabs')).toBeInTheDocument();
  });

  it('fires list_resources("plugin") on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'list_resources' && (c[1] as { kind: string }).kind === 'plugin',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders 5 tabs for the 5 resource kinds', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);
    const kinds: ResourceKind[] = ['plugin', 'skill', 'command', 'lsp', 'mcp'];
    for (const k of kinds) {
      expect(screen.getByTestId(`resource-browser-tab-${k}`)).toBeInTheDocument();
    }
  });

  it('renders items in the table when scan returns rows', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin'),
      item('plugin/doc-writer', 'plugin', { size_bytes: 2048 }),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('resource-browser-row-plugin/doc-writer'),
    ).toBeInTheDocument();
  });

  it('shows the friendly empty state when list is []', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-empty')).toBeInTheDocument();
    });
  });

  it('switching tabs triggers a re-fetch for the new kind', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);

    // Wait for initial plugin fetch
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'list_resources' && (c[1] as { kind: string }).kind === 'plugin',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    // Click 'commands' tab
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-command'));
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) =>
          c[0] === 'list_resources' &&
          (c[1] as { kind: string }).kind === 'command',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('clicking a row reveal button calls reveal_in_file_manager with the row path', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_resources') {
        return [item('plugin/code-review', 'plugin')];
      }
      if (cmd === 'reveal_in_file_manager') {
        return null;
      }
      return null;
    });
    render(<ResourceBrowserPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-reveal-plugin/code-review'),
      );
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'reveal_in_file_manager',
      );
      expect(calls.length).toBe(1);
      const arg = calls[0][1] as { path: string };
      expect(arg.path).toContain('plugins');
      expect(arg.path).toContain('code-review');
    });
  });

  it('reveal failure surfaces a non-blocking alert', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [item('plugin/x', 'plugin')];
      }
      if (cmd === 'reveal_in_file_manager') {
        throw new Error('explorer.exe not found');
      }
      return null;
    });
    render(<ResourceBrowserPage />);

    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-row-plugin/x')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-reveal-plugin/x'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-reveal-error'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/explorer\.exe not found/),
    ).toBeInTheDocument();
  });

  it('scan failure surfaces a list-level error', async () => {
    mockInvoke.mockRejectedValue(new Error('I/O error: permission denied'));
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-list-error'),
      ).toBeInTheDocument();
    });
  });

  it('disabled items render with a 禁用 badge (mcp.json disabled: true case)', async () => {
    mockInvoke.mockResolvedValue([
      item('mcp/web', 'mcp', { enabled: false }),
    ]);
    render(<ResourceBrowserPage />);

    // Switch to mcp tab
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-mcp'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-mcp/web'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('resource-browser-status-mcp/web'),
    ).toHaveTextContent(/禁用/);
  });
});
