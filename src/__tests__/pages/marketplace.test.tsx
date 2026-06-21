/**
 * Vitest coverage for the F17 MarketplacePage (M2.16).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Page chrome: header, 内置推荐 section, 第三方 section
 *   - Mount triggers `list_marketplace_repos`
 *   - 推荐卡片有「克隆并扫描」按钮,点击触发 `clone_and_scan`
 *   - 第三方 URL 输入 + 克隆按钮触发 `clone_and_scan`
 *   - clone 中显示 loading + 禁用按钮
 *   - clone 失败显示红条
 *   - 扫描结果渲染资源行
 *   - 点「安装」触发 `install_from_marketplace`
 *   - 安装成功显示绿条;失败显示红条;MCP 显示黄条
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import MarketplacePage from '../../pages/marketplace';
import type { ResourceItem, ResourceKind } from '../../types/resource';
import type { MarketplaceRepo, ScanResult, InstallResult } from '../../lib/api/marketplace';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function repo(id: string, overrides: Partial<MarketplaceRepo> = {}): MarketplaceRepo {
  return {
    id,
    name: id,
    url: `https://github.com/test/${id}.git`,
    description: `${id} desc`,
    ...overrides,
  };
}

function resource(
  id: string,
  kind: ResourceKind,
  overrides: Partial<ResourceItem> = {},
): ResourceItem {
  return {
    id,
    name: id.split('/').pop() ?? id,
    kind,
    path: `C:/repo/${kind}s/${id.split('/').pop() ?? id}`,
    size_bytes: 1024,
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarketplacePage — F17 (M2.16)', () => {
  it('renders page chrome on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<MarketplacePage />);
    expect(screen.getByTestId('marketplace-page')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-builtin-section')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-custom-section')).toBeInTheDocument();
  });

  it('fires list_marketplace_repos on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<MarketplacePage />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'list_marketplace_repos',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders recommended repo cards when list returns rows', async () => {
    mockInvoke.mockResolvedValue([
      repo('claude-code-plugins', { name: 'Claude Code Plugins' }),
      repo('cc-switch-registry'),
    ]);
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-repo-card-claude-code-plugins'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('marketplace-repo-card-cc-switch-registry'),
    ).toBeInTheDocument();
  });

  it('clicking a repo clone button triggers clone_and_scan with the repo url', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_marketplace_repos') {
        return [repo('foo', { url: 'https://github.com/test/foo.git' })];
      }
      if (cmd === 'clone_and_scan') {
        const url = (args as { url: string }).url;
        expect(url).toBe('https://github.com/test/foo.git');
        return { repo_path: 'C:/mk/foo', resources: [] } satisfies ScanResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-repo-card-foo')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-repo-clone-foo'));
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'clone_and_scan',
      );
      expect(calls.length).toBe(1);
    });
  });

  it('typing a custom URL and clicking clone triggers clone_and_scan', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') {
        return { repo_path: 'C:/mk/bar', resources: [] } satisfies ScanResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/bar.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) =>
          c[0] === 'clone_and_scan' &&
          (c[1] as { url: string }).url === 'https://github.com/test/bar.git',
      );
      expect(calls.length).toBe(1);
    });
  });

  it('shows cloning loader while clone_and_scan is in flight', async () => {
    // clone_and_scan never resolves → stays cloning.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_marketplace_repos') return Promise.resolve([]);
      if (cmd === 'clone_and_scan') return new Promise(() => {});
      return Promise.resolve(null);
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/x.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-cloning')).toBeInTheDocument();
    });
  });

  it('clone failure surfaces a red error banner', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_marketplace_repos') return Promise.resolve([]);
      if (cmd === 'clone_and_scan') {
        return Promise.reject(new Error('git clone failed: network unreachable'));
      }
      return Promise.resolve(null);
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/x.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-clone-error')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/git clone failed/),
    ).toBeInTheDocument();
  });

  it('renders scanned resources in the result table', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [
        resource('plugin/code-review', 'plugin'),
        resource('command/deploy.md', 'command'),
      ],
    };
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') return scan;
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/foo.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-resource-row-plugin/code-review'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('marketplace-resource-row-command/deploy.md'),
    ).toBeInTheDocument();
  });

  it('clicking an install button triggers install_from_marketplace with repoPath + resourceId', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [resource('plugin/code-review', 'plugin')],
    };
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') return scan;
      if (cmd === 'install_from_marketplace') {
        const a = args as { repoPath: string; resourceId: string };
        expect(a.repoPath).toBe('C:/mk/foo');
        expect(a.resourceId).toBe('plugin/code-review');
        return {
          resource_id: 'plugin/code-review',
          installed: true,
          dest_path: 'C:/Users/foo/.claude/plugins/code-review',
          message: '安装成功',
        } satisfies InstallResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/foo.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('marketplace-install-plugin/code-review'),
      );
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'install_from_marketplace',
      );
      expect(calls.length).toBe(1);
    });
  });

  it('install success shows a green success banner', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [resource('plugin/code-review', 'plugin')],
    };
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') return scan;
      if (cmd === 'install_from_marketplace') {
        return {
          resource_id: 'plugin/code-review',
          installed: true,
          dest_path: 'C:/Users/foo/.claude/plugins/code-review',
          message: '安装成功',
        } satisfies InstallResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/foo.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('marketplace-install-plugin/code-review'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-success-plugin/code-review'),
      ).toBeInTheDocument();
    });
  });

  it('install failure shows a red error banner', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [resource('plugin/code-review', 'plugin')],
    };
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') return scan;
      if (cmd === 'install_from_marketplace') {
        throw new Error('目标已存在,请先删除');
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/foo.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-plugin/code-review'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('marketplace-install-plugin/code-review'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-error-plugin/code-review'),
      ).toBeInTheDocument();
    });
  });

  it('install MCP returns installed:false → shows warning banner', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [resource('mcp/fs', 'mcp')],
    };
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') return scan;
      if (cmd === 'install_from_marketplace') {
        return {
          resource_id: 'mcp/fs',
          installed: false,
          dest_path: '',
          message: 'MCP 服务器需手动编辑 ~/.claude/mcp.json,暂不支持自动安装',
        } satisfies InstallResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/foo.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-mcp/fs'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-install-mcp/fs'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-install-warning-mcp/fs'),
      ).toBeInTheDocument();
    });
  });

  it('empty scan result shows the empty state', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') {
        return { repo_path: 'C:/mk/empty', resources: [] } satisfies ScanResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-url-input')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('marketplace-custom-url-input'), {
        target: { value: 'https://github.com/test/empty.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-scan-empty')).toBeInTheDocument();
    });
  });
});
