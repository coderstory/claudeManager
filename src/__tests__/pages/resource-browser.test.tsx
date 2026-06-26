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

// Phase 27 Fix 4: ResourceBrowserPage now calls useProjects().
// Provide a default list_projects response so the hook doesn't crash.
vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    projects: [],
    currentProjectId: null,
    currentProject: null,
    loading: false,
    error: null,
    reload: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    switchTo: vi.fn(),
  }),
}));

function item(
  id: string,
  kind: ResourceKind,
  overrides: Partial<ResourceItem> = {},
): ResourceItem {
  // F21 (M2.16) — 默认 source_repo 为 null(command/lsp/mcp 的常见情况)。
  // 测试覆盖 plugin/skill 时,显式 overrides 即可。
  return {
    id,
    name: id.split('/').pop() ?? id,
    kind,
    path: `C:/Users/foo/.claude/${kind}s/${id.split('/').pop() ?? id}`,
    size_bytes: 1024,
    enabled: true,
    source_repo: null,
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
        // M3.5 — backend now throws structured RevealFailure.
        const err = new Error('Path does not exist: /x/y') as Error & {
          kind?: string;
          path?: string;
        };
        err.kind = 'not_found';
        err.path = '/x/y';
        throw err;
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
    // M3.5 — 错误已通过 ErrorBanner 渲染,文案为「不存在」+ 路径
    expect(
      screen.getByText(/不存在/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\/x\/y/),
    ).toBeInTheDocument();
  });

  /// M3.5 — 后端按 `kind` 路由中文文案。4 类分别验证。
  it('reveal failure with kind=network_path renders 「网络路径」文案', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [item('plugin/x', 'plugin')];
      if (cmd === 'reveal_in_file_manager') {
        const err = new Error('Network') as Error & { kind?: string; path?: string };
        err.kind = 'network_path';
        err.path = '\\\\srv\\share';
        throw err;
      }
      return null;
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => screen.getByTestId('resource-browser-row-plugin/x'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-reveal-plugin/x'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-reveal-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/网络路径/)).toBeInTheDocument();
  });

  it('reveal failure with kind=permission_denied renders 「无法访问」文案', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [item('plugin/x', 'plugin')];
      if (cmd === 'reveal_in_file_manager') {
        const err = new Error('denied') as Error & { kind?: string; path?: string };
        err.kind = 'permission_denied';
        err.path = 'C:/secret';
        throw err;
      }
      return null;
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => screen.getByTestId('resource-browser-row-plugin/x'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-reveal-plugin/x'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-reveal-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/无法访问/)).toBeInTheDocument();
  });

  it('reveal failure with kind=launcher_failed renders 「文件管理器启动失败」文案', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [item('plugin/x', 'plugin')];
      if (cmd === 'reveal_in_file_manager') {
        const err = new Error('exit 1') as Error & { kind?: string; path?: string };
        err.kind = 'launcher_failed';
        err.path = '/x';
        throw err;
      }
      return null;
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => screen.getByTestId('resource-browser-row-plugin/x'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-reveal-plugin/x'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-reveal-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/文件管理器启动失败/)).toBeInTheDocument();
  });

  /// M3.5 — 旧 IPC 抛 Error 字符串(无 kind)走 launcher_failed 兜底。
  it('reveal failure without kind 走 launcher_failed 兜底', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [item('plugin/x', 'plugin')];
      if (cmd === 'reveal_in_file_manager') {
        throw new Error('some random string error');
      }
      return null;
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => screen.getByTestId('resource-browser-row-plugin/x'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-reveal-plugin/x'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-reveal-error')).toBeInTheDocument();
    });
    // launcher_failed 兜底文案
    expect(screen.getByText(/文件管理器启动失败/)).toBeInTheDocument();
  });

  /// M3.5 — dismiss 按钮可清除 reveal error。
  it('reveal error dismiss button clears the banner', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [item('plugin/x', 'plugin')];
      if (cmd === 'reveal_in_file_manager') {
        const err = new Error('x') as Error & { kind?: string; path?: string };
        err.kind = 'not_found';
        err.path = '/x';
        throw err;
      }
      return null;
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => screen.getByTestId('resource-browser-row-plugin/x'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-reveal-plugin/x'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('resource-browser-reveal-error')).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-reveal-error-banner-dismiss'),
      );
    });
    await waitFor(() =>
      expect(screen.queryByTestId('resource-browser-reveal-error')).toBeNull(),
    );
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

  /// Phase 27 Fix 6 (D-14) — mcp tab 不再渲染文件系统的 mcp.json
  /// ResourceItem 列表,改渲染 McpManagementPage(共享 component)。
  /// 旧"mcp.json 禁用状态"测试语义不适用 — mcp 数据源现在是
  /// mcp_servers SQLite 表(McpService),不是文件 scanner。
  /// 这里改成断言 mcp tab 切到时 resource-browser-mcp-panel 出现,
  /// 共享 component 的禁用 badge 测试在 mcp-management.test.tsx。
  it('Phase 27 Fix 6: switching to mcp tab renders McpManagementPage panel', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [];
      if (cmd === 'list_mcp_servers') return [];
      return null;
    });
    render(<ResourceBrowserPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-mcp'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-mcp-panel'),
      ).toBeInTheDocument();
    });
    // mcp-management-page 是 McpManagementPage 内部 testid(共享
    // component 自己带,跟原路由一样 — 防止 e2e / 集成测试断链)。
    await waitFor(() => {
      expect(screen.getByTestId('mcp-management-page')).toBeInTheDocument();
    });
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

  /// Phase 27 Fix 6 (D-14) — 同上,旧"mcp.json 详情面板 禁用"测试
  /// 改写成 smoke: 切到 mcp tab 时 resource-browser-mcp-panel 出现。
  /// 真正的 detail 渲染(从 mcp_servers 表读 description/manifest)
  /// 在 mcp-management.test.tsx 覆盖。
  it('Phase 27 Fix 6: switching to mcp tab → McpManagementPage mounts (replaces file-system mcp entry detail)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') return [];
      if (cmd === 'list_mcp_servers') return [];
      return null;
    });
    render(<ResourceBrowserPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-mcp'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-mcp-panel'),
      ).toBeInTheDocument();
    });
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

// ---------------------------------------------------------------------------
// F21 — 按来源仓库过滤 (M2.16)
// 覆盖:下拉渲染 unique source_repo、选中后过滤、清空恢复、切 tab
//      重置、与 fuzzy 搜索叠加、详情面板展示来源仓库、kind=command
//      时下拉只剩 (无来源)、mock 数据来源纯 null 时不渲染下拉。
// ---------------------------------------------------------------------------
describe('ResourceBrowserPage — F21 source-repo filter (M2.16)', () => {
  it('renders the source filter dropdown with unique source_repos', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin', { source_repo: 'anthropic-tools' }),
      item('plugin/doc-writer', 'plugin', { source_repo: 'anthropic-tools' }),
      item('plugin/git-tools', 'plugin', { source_repo: 'community-plugins' }),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-source-filter')).toBeInTheDocument();
    });
    const select = screen.getByTestId(
      'resource-browser-source-select',
    ) as HTMLSelectElement;
    // 3 个 plugin 去重后 2 个 unique source_repo + 全部 = 3 个 option;
    // 无 null 资源所以没有 (无来源) 项。
    expect(select.options.length).toBe(3);
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('全部');
    expect(labels).toContain('anthropic-tools');
    expect(labels).toContain('community-plugins');
  });

  it('selecting a source filters rows down to that repo', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin', { source_repo: 'anthropic-tools' }),
      item('plugin/doc-writer', 'plugin', { source_repo: 'anthropic-tools' }),
      item('plugin/git-tools', 'plugin', { source_repo: 'community-plugins' }),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-source-select')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-source-select'),
        { target: { value: 'community-plugins' } },
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/git-tools'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('resource-browser-row-plugin/code-review'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('resource-browser-row-plugin/doc-writer'),
    ).not.toBeInTheDocument();
  });

  it('clearing the source filter restores all rows', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin', { source_repo: 'a' }),
      item('plugin/git-tools', 'plugin', { source_repo: 'b' }),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-source-select')).toBeInTheDocument();
    });

    // 过滤到 a
    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-source-select'),
        { target: { value: 'a' } },
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('resource-browser-row-plugin/git-tools'),
      ).not.toBeInTheDocument();
    });

    // 点 X 清空来源过滤
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-source-clear'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/git-tools'),
      ).toBeInTheDocument();
    });
  });

  it('switching tabs resets the source filter', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_resources') {
        const kind = (args as { kind: string }).kind;
        if (kind === 'plugin') {
          return [
            item('plugin/a', 'plugin', { source_repo: 'x' }),
            item('plugin/b', 'plugin', { source_repo: 'y' }),
          ];
        }
        if (kind === 'command') {
          return [
            item('command/c1', 'command', { source_repo: null }),
            item('command/c2', 'command', { source_repo: null }),
          ];
        }
      }
      return [];
    });
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-source-select')).toBeInTheDocument();
    });

    // 选 x
    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-source-select'),
        { target: { value: 'x' } },
      );
    });
    const sel = screen.getByTestId(
      'resource-browser-source-select',
    ) as HTMLSelectElement;
    expect(sel.value).toBe('x');

    // 切到 commands tab
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-command'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-command/c1'),
      ).toBeInTheDocument();
    });

    // 来源过滤应被清空 → 下拉值回到 "" (全部)
    const selAfter = screen.getByTestId(
      'resource-browser-source-select',
    ) as HTMLSelectElement;
    expect(selAfter.value).toBe('');
  });

  it('source filter composes with fuzzy name filter (both must pass)', async () => {
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin', { source_repo: 'a' }),
      item('plugin/code-writer', 'plugin', { source_repo: 'a' }),
      item('plugin/code-helper', 'plugin', { source_repo: 'b' }),
    ]);
    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-source-select')).toBeInTheDocument();
    });

    // source = a, search = code → 命中 2 项
    await act(async () => {
      fireEvent.change(
        screen.getByTestId('resource-browser-source-select'),
        { target: { value: 'a' } },
      );
      fireEvent.change(
        screen.getByTestId('resource-browser-search-input'),
        { target: { value: 'code' } },
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('resource-browser-row-plugin/code-writer'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('resource-browser-row-plugin/code-helper'),
    ).not.toBeInTheDocument();
  });

  it('command kind with all-null source_repo shows only (无来源) option', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_resources') {
        const kind = (args as { kind: string }).kind;
        if (kind === 'command') {
          return [
            item('command/build', 'command', { source_repo: null }),
            item('command/deploy', 'command', { source_repo: null }),
          ];
        }
      }
      return [];
    });
    render(<ResourceBrowserPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('resource-browser-tab-command'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-source-select')).toBeInTheDocument();
    });
    const select = screen.getByTestId(
      'resource-browser-source-select',
    ) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['全部', '(无来源)']);

    // 选 (无来源) → 两个 command 都在(它们 source_repo 都是 null)
    await act(async () => {
      fireEvent.change(select, { target: { value: '(无来源)' } });
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-command/build'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('resource-browser-row-command/deploy'),
    ).toBeInTheDocument();
  });

  it('does NOT render the source filter when source_repos are empty', async () => {
    // source_repo 全部 null,但这种场景下 NONE_SOURCE_LABEL 会进下拉,
    // 所以下拉一定会渲染。测试改用 state.items 为空来验证不渲染。
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);
    // 整个搜索/过滤区都不渲染(state.items.length === 0 时)
    await waitFor(() => {
      expect(screen.getByTestId('resource-browser-empty')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('resource-browser-source-filter'),
    ).not.toBeInTheDocument();
  });

  it('detail panel shows source_repo (or (无来源) for null)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_resources') {
        return [
          item('plugin/code-review', 'plugin', {
            source_repo: 'anthropic-tools',
          }),
          item('command/build', 'command', { source_repo: null }),
        ];
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

    // 展开 plugin 行:详情面板应有 "来源仓库: anthropic-tools"
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('resource-browser-row-body-plugin/code-review'),
      );
    });
    const pluginPanel = screen.getByTestId(
      'resource-browser-detail-plugin/code-review',
    );
    expect(pluginPanel.textContent).toContain('来源仓库');
    expect(pluginPanel.textContent).toContain('anthropic-tools');
  });
});

// ---------------------------------------------------------------------------
// M3.4 — 清单 17: 后端 scanner 已过滤 cache / node_modules / .git 等
// 污染目录,前端只负责展示过滤后的列表,确保 UI 行为正确。
// ---------------------------------------------------------------------------

describe('ResourceBrowserPage — M3.4 scanner filtering (清单 17)', () => {
  it('does not render items named cache / node_modules / .git (后端已过滤)', async () => {
    // 后端 scanner 已过滤,只返回真 plugin。
    mockInvoke.mockResolvedValue([
      item('plugin/code-review', 'plugin'),
      item('plugin/doc-writer', 'plugin'),
    ]);

    render(<ResourceBrowserPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('resource-browser-row-plugin/code-review'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('resource-browser-row-plugin/doc-writer'),
      ).toBeInTheDocument();
    });

    // 污染目录不应出现(后端已过滤,前端不再依赖 UI 屏蔽)。
    expect(
      screen.queryByTestId('resource-browser-row-plugin/cache'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('resource-browser-row-plugin/node_modules'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('resource-browser-row-plugin/.git'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 27 Fix 6 (D-11): URL ?tab=mcp initializes mcp tab
// ---------------------------------------------------------------------------
//
// 27-CONTEXT D-11: ResourceBrowser 接受 URL ?tab=mcp 作为默认 tab。
// 老用户从 /mcp-management 重定向过来后,ResourceBrowser mount 时
// 立即定位到 mcp tab 而不是默认的 plugin tab。
//
// 由于 useSearchParams 在 jsdom + 单测环境里需要 MemoryRouter 或
// 直接 mock URL,我们用 window.location.search 设置 + 重新 mount
// 来驱动这条路径。Test 验证 mount 后 listResources('mcp') 是第一次
// fetch(不是 listResources('plugin'))。

describe('ResourceBrowserPage — Phase 27 Fix 6: URL ?tab=mcp initial kind', () => {
  beforeEach(() => {
    // jsdom 默认 URL 是 about:blank,这里设 search 触发 useSearchParams
    // 读到 tab=mcp。
    window.history.replaceState({}, '', '/?tab=mcp');
  });

  it('mount with ?tab=mcp → first list_resources call uses kind="mcp"', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<ResourceBrowserPage />);

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'list_resources',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
    const firstCall = mockInvoke.mock.calls.find(
      (c) => c[0] === 'list_resources',
    );
    expect(firstCall).toBeDefined();
    expect((firstCall![1] as { kind: string }).kind).toBe('mcp');
  });
});
