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
    mockInvoke.mockImplementation(async (cmd: string) => {
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

// ---------------------------------------------------------------------------
// F21 — 资源搜索 (M2.16)
// 覆盖：搜索框渲染、实时过滤、清空、空查询不过滤、无匹配空态、
//       切 tab 清空查询、模糊子序列匹配排序。
// ---------------------------------------------------------------------------
describe('ResourceBrowserPage — F21 search (M2.16)', () => {
  it('renders the search box once items are loaded', async () => {
    mockInvoke.mockResolvedValue([item('plugin/code-review', 'plugin')]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-search-input'),
      ).toBeInTheDocument();
    });
  });

  it('does NOT render the search box while loading', async () => {
    // Never resolves → stays loading → no search box.
    mockInvoke.mockImplementation(
      () => new Promise(() => {}),
    );
    render(<ResourceBrowserPage />);
    // Give React a tick to settle into loading state.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('resource-browser-search-input'),
    ).not.toBeInTheDocument();
  });

  it('typing in the search box filters rows by name (substring)', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin'),
      item('plugin/doc-writer', 'plugin'),
      item('plugin/git-tools', 'plugin'),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-search-input'),
        { target: { value: 'doc' } },
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/doc-writer'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('resource-browser-row-plugin/code-review'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('resource-browser-row-plugin/git-tools'),
    ).not.toBeInTheDocument();
  });

  it('shows the no-match empty state with the query echoed', async () => {
    mockInvoke.mockResolvedValue([item('plugin/code-review', 'plugin')]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-search-input'),
        { target: { value: 'zzzz' } },
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-empty'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/没有匹配「zzzz」/)).toBeInTheDocument();
    // Result count "0/1" visible.
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('clearing the query restores all rows', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin'),
      item('plugin/doc-writer', 'plugin'),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // Filter down to one.
    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-search-input'),
        { target: { value: 'doc' } },
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('resource-browser-row-plugin/code-review'),
      ).not.toBeInTheDocument();
    });

    // Click the clear (X) button.
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-search-clear'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('resource-browser-row-plugin/doc-writer'),
    ).toBeInTheDocument();
  });

  it('switching tabs clears the search query', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_resources') {
        const kind = (args as { kind: string }).kind;
        if (kind === 'plugin') {
          return [
            item('plugin/code-review', 'plugin'),
            item('plugin/doc-writer', 'plugin'),
          ];
        }
        if (kind === 'command') {
          return [item('command/build', 'command')];
        }
      }
      return [];
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // Type a filter that hides everything but doc-writer.
    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-search-input'),
        { target: { value: 'doc' } },
      );
    });
    const input = screen.getByTestId(
      'resource-browser-search-input',
    ) as HTMLInputElement;
    expect(input.value).toBe('doc');

    // Switch to commands tab.
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-command'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-command/build'),
      ).toBeInTheDocument();
    });
    // Query should be reset to empty.
    const inputAfter = screen.getByTestId(
      'resource-browser-search-input',
    ) as HTMLInputElement;
    expect(inputAfter.value).toBe('');
  });

  it('fuzzy subsequence matches across a gap (mp → MCP-like names)', async () => {
    // Names with 'm' then later 'p' should match query "mp".
    mockInvoke.mockResolvedValue([
      item('plugin/marketplace-sync', 'plugin'), // has m...p
      item('plugin/zip-pack', 'plugin'), // no m before p
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/marketplace-sync'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-search-input'),
        { target: { value: 'mp' } },
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/marketplace-sync'),
      ).toBeInTheDocument();
    });
    // zip-pack has 'p' but no 'm' before it → subsequence fails.
    expect(
      screen.queryByTestId('resource-browser-row-plugin/zip-pack'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F22 — 资源详情预览 (M2.16)
// 覆盖：点击行展开详情面板、再点收起、多行同时展开、切 tab 清空展开态、
//       详情字段渲染、详情内 reveal 按钮、点 reveal 按钮不触发行展开。
// ---------------------------------------------------------------------------
describe('ResourceBrowserPage — F22 detail panel (M2.16)', () => {
  it('clicking a row body expands the detail panel', async () => {
    mockInvoke.mockResolvedValue([item('plugin/code-review', 'plugin')]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // 详情面板初始不渲染。
    expect(
      screen.queryByTestId('resource-browser-detail-plugin/code-review'),
    ).not.toBeInTheDocument();

    // 点击行体(非按钮)展开。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-detail-plugin/code-review'),
      ).toBeInTheDocument();
    });
  });

  it('clicking an expanded row body collapses the detail panel', async () => {
    mockInvoke.mockResolvedValue([item('plugin/code-review', 'plugin')]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // 展开。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });
    expect(
      screen.getByTestId('resource-browser-detail-plugin/code-review'),
    ).toBeInTheDocument();

    // 再点收起。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });
    expect(
      screen.queryByTestId('resource-browser-detail-plugin/code-review'),
    ).not.toBeInTheDocument();
  });

  it('multiple rows can be expanded simultaneously', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin'),
      item('plugin/doc-writer', 'plugin'),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // 展开第一行。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });
    // 展开第二行。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/doc-writer'),
      );
    });

    expect(
      screen.getByTestId('resource-browser-detail-plugin/code-review'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('resource-browser-detail-plugin/doc-writer'),
    ).toBeInTheDocument();
  });

  it('switching tabs clears all expanded detail panels', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_resources') {
        const kind = (args as { kind: string }).kind;
        if (kind === 'plugin') {
          return [item('plugin/code-review', 'plugin')];
        }
        if (kind === 'command') {
          return [item('command/build', 'command')];
        }
      }
      return [];
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // 展开 plugin 行。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });
    expect(
      screen.getByTestId('resource-browser-detail-plugin/code-review'),
    ).toBeInTheDocument();

    // 切到 command tab。
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-command'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-command/build'),
      ).toBeInTheDocument();
    });

    // command 行默认未展开。
    expect(
      screen.queryByTestId('resource-browser-detail-command/build'),
    ).not.toBeInTheDocument();
  });

  it('detail panel shows name / kind / source / path / size / enabled state', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin', {
        size_bytes: 4096,
        enabled: true,
        path: 'C:/Users/foo/.claude/plugins/code-review',
      }),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    const panel = screen.getByTestId(
      'resource-browser-detail-plugin/code-review',
    );
    // 名称、路径、大小、启用状态都应渲染。
    expect(panel.textContent).toContain('code-review');
    expect(panel.textContent).toContain('C:/Users/foo/.claude/plugins/code-review');
    expect(panel.textContent).toContain('4.0 KB');
    expect(panel.textContent).toContain('启用');
    // 来源字段应有语义说明。
    expect(panel.textContent).toContain('插件目录');
  });

  it('detail panel shows 禁用 state for disabled mcp entry', async () => {
    mockInvoke.mockResolvedValue([
      item('mcp/web', 'mcp', { enabled: false }),
    ]);
    render(<ResourceBrowserPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-mcp'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-mcp/web'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-mcp/web'),
      );
    });

    const panel = screen.getByTestId('resource-browser-detail-mcp/web');
    expect(panel.textContent).toContain('禁用');
    expect(panel.textContent).toContain('mcp.json');
  });

  it('clicking the row reveal button does NOT toggle expand (stopPropagation)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
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

    // 点 reveal 按钮应调 reveal,但不应展开详情面板。
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
    });
    expect(
      screen.queryByTestId('resource-browser-detail-plugin/code-review'),
    ).not.toBeInTheDocument();
  });

  it('detail panel has its own reveal button that calls reveal', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
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

    // 先展开。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    // 点详情面板内的 reveal 按钮。
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          'resource-browser-detail-reveal-plugin/code-review',
        ),
      );
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'reveal_in_file_manager',
      );
      expect(calls.length).toBe(1);
    });
  });

  it('keyboard Enter on row body toggles expand', async () => {
    mockInvoke.mockResolvedValue([item('plugin/code-review', 'plugin')]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    const rowBody = screen.getByTestId(
      'resource-browser-row-body-plugin/code-review',
    );
    await act(async () => {
      fireEvent.keyDown(rowBody, { key: 'Enter' });
    });

    expect(
      screen.getByTestId('resource-browser-detail-plugin/code-review'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F22 — 资源详情 manifest + 文件列表 (M2.16-f22-manifest)
// 覆盖：展开触发 get_resource_detail、description 渲染、文件列表渲染、
//       暂无描述、读取错误非阻塞提示。
// ---------------------------------------------------------------------------
describe('ResourceBrowserPage — F22 manifest detail (M2.16-f22-manifest)', () => {
  it('expanding a row fires get_resource_detail(path, kind)', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_resources') {
        return [item('plugin/code-review', 'plugin')];
      }
      if (cmd === 'get_resource_detail') {
        // 校验 path + kind 参数被正确传递。
        const { path, kind } = args as { path: string; kind: string };
        return {
          files: [],
          description: null,
          manifest: null,
          _echo: { path, kind },
        };
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
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_resource_detail',
      );
      expect(calls.length).toBe(1);
      const arg = calls[0][1] as { path: string; kind: string };
      expect(arg.kind).toBe('plugin');
      expect(arg.path).toContain('code-review');
    });
  });

  it('renders description from manifest when present', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [item('plugin/code-review', 'plugin')];
      }
      if (cmd === 'get_resource_detail') {
        return {
          files: [],
          description: '代码审查插件,自动 review PR',
          manifest: { name: 'code-review' },
        };
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
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText('代码审查插件,自动 review PR'),
      ).toBeInTheDocument();
    });
  });

  it('renders file list when resource is a directory', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [item('plugin/code-review', 'plugin')];
      }
      if (cmd === 'get_resource_detail') {
        return {
          files: ['index.js', 'plugin.json', 'src/main.js'],
          description: null,
          manifest: null,
        };
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
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    const filesList = await screen.findByTestId(
      'resource-browser-detail-files-plugin/code-review',
    );
    expect(filesList.textContent).toContain('index.js');
    expect(filesList.textContent).toContain('plugin.json');
    expect(filesList.textContent).toContain('src/main.js');
  });

  it('shows 暂无描述 when description is null', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [item('plugin/code-review', 'plugin')];
      }
      if (cmd === 'get_resource_detail') {
        return { files: [], description: null, manifest: null };
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
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('暂无描述')).toBeInTheDocument();
    });
  });

  it('shows non-blocking error when get_resource_detail rejects', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [item('plugin/code-review', 'plugin')];
      }
      if (cmd === 'get_resource_detail') {
        throw new Error('路径含 ..,拒绝');
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
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(
          'resource-browser-detail-error-plugin/code-review',
        ),
      ).toBeInTheDocument();
    });
    // 描述字段显示"读取失败"。
    expect(screen.getByText('读取失败')).toBeInTheDocument();
  });

  it('single-file resource shows "单文件资源" hint instead of file list', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [item('command/build', 'command')];
      }
      if (cmd === 'get_resource_detail') {
        return { files: [], description: '构建命令', manifest: null };
      }
      return null;
    });
    render(<ResourceBrowserPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-command'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-command/build'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-command/build'),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('单文件资源(path 即文件本身)')).toBeInTheDocument();
    });
  });
});
