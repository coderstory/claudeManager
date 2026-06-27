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

// M5 #22 — 浏览资源按钮调 @tauri-apps/plugin-opener 的 openUrl 打开 git 仓库 URL。
// 原来 Git-mode RepoCard 上的 "预览资源" 按钮误调 clone_and_scan,导致用户点击
// 期望打开 GitHub 仓库网页却触发本地 clone。修复后该按钮调 openUrl(repo.url),
// clone_and_scan 仅由第三方 URL 区(customUrl)走。
const mockOpenUrl = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
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
    // F21 (M2.16) — marketplace test 不关心 source_repo,默认 null。
    source_repo: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockOpenUrl.mockReset();
  mockOpenUrl.mockResolvedValue(undefined);
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

  // M5 #25 — 第三方仓库 section needs explanatory copy so new
  // users know what the input does (粘贴 git URL → 预览 → 勾选).
  it('third-party repo section explains its purpose', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<MarketplacePage />);
    const section = screen.getByTestId('marketplace-custom-section');
    expect(section.textContent).toContain('粘贴任意 git 仓库 URL');
    expect(section.textContent).toContain('plugin / skill / command');
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
    // BZ-07 — 错误经 localizeMarketplaceError 翻译;使用 Rust
    // Git variant 的 Display 模板前缀 'git error:' 让本地化函数
    // 命中 Git 分支 (返回中文 'Git 操作失败')。
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_marketplace_repos') return Promise.resolve([]);
      if (cmd === 'clone_and_scan') {
        return Promise.reject(new Error('git error: network unreachable'));
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
    // BZ-07 — 文案已翻译为中文
    expect(
      screen.getByText(/Git 操作失败/),
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

// ---------------------------------------------------------------------------
// M3.4 — 三类 install 语义 + GSD 合并 + 批量 install
// ---------------------------------------------------------------------------

import type { MarketplaceRepo as MMarketplaceRepo } from '../../lib/api/marketplace';

function builtinRepo(
  id: string,
  installMode: 'builtin' | 'npx' | 'git',
  installTarget: string,
  overrides: Partial<MMarketplaceRepo> = {},
): MMarketplaceRepo {
  return {
    id,
    name: id,
    url: `https://github.com/test/${id}.git`,
    description: `${id} desc`,
    install_mode: installMode,
    install_target: installTarget,
    ...overrides,
  };
}

describe('MarketplacePage — M3.4 三类 install', () => {
  it('renders install_mode badge (CLI / NPX / GIT) on each builtin card', async () => {
    mockInvoke.mockResolvedValue([
      builtinRepo('superpowers', 'builtin', 'superpowers@claude-plugins-official', {
        name: 'Superpowers',
      }),
      builtinRepo('gsd-core', 'npx', '@opengsd/gsd-core@latest', {
        name: 'GSD',
      }),
      builtinRepo('claude-cookbooks', 'git', '', { name: 'Cookbooks' }),
    ]);
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-repo-mode-superpowers'),
      ).toHaveTextContent('CLI');
      expect(screen.getByTestId('marketplace-repo-mode-gsd-core')).toHaveTextContent(
        'NPX',
      );
      expect(
        screen.getByTestId('marketplace-repo-mode-claude-cookbooks'),
      ).toHaveTextContent('GIT');
    });
  });

  it('clicking a Builtin repo card triggers install_builtin_plugin', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_marketplace_repos') {
        return [builtinRepo('superpowers', 'builtin', 'superpowers@x')];
      }
      if (cmd === 'install_builtin_plugin') {
        const a = args as { pluginId: string };
        expect(a.pluginId).toBe('superpowers');
        return {
          resource_id: 'plugin/superpowers',
          installed: true,
          dest_path: 'C:/Users/foo/.claude/plugins/superpowers',
          message: '内置插件安装成功',
        } satisfies InstallResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-repo-card-superpowers')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-repo-clone-superpowers'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-repo-success-superpowers'),
      ).toBeInTheDocument();
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'install_builtin_plugin',
      );
      expect(calls.length).toBe(1);
    });
  });

  it('clicking an Npx repo card triggers install_npx_package', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_marketplace_repos') {
        return [builtinRepo('gsd-core', 'npx', '@opengsd/gsd-core@latest')];
      }
      if (cmd === 'install_npx_package') {
        const a = args as { package: string };
        expect(a.package).toBe('@opengsd/gsd-core@latest');
        return {
          resource_id: 'plugin/gsd-core',
          installed: true,
          dest_path: 'C:/Users/foo/.claude/plugins/gsd-core',
          message: 'npx 安装成功',
        } satisfies InstallResult;
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-repo-card-gsd-core')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-repo-clone-gsd-core'));
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'install_npx_package',
      );
      expect(calls.length).toBe(1);
      expect(
        screen.getByTestId('marketplace-repo-success-gsd-core'),
      ).toBeInTheDocument();
    });
  });

  it('clicking a Git repo card opens the repo URL via @tauri-apps/plugin-opener (M5 #22)', async () => {
    // M5 #22 — 修复前: Git-mode RepoCard 按钮调 clone_and_scan(本地 clone,
    // 不打开 GitHub)。修复后: 调 openUrl(repo.url) 打开系统默认浏览器到
    // git 仓库网页。clone_and_scan 仅由"第三方仓库"section 走。
    const repoUrl = 'https://github.com/anthropics/claude-cookbooks.git';
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') {
        return [builtinRepo('claude-cookbooks', 'git', '', { url: repoUrl })];
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-repo-card-claude-cookbooks'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('marketplace-repo-clone-claude-cookbooks'),
      );
    });

    await waitFor(() => {
      // 应调 openUrl(repoUrl) 一次
      expect(mockOpenUrl).toHaveBeenCalledTimes(1);
      expect(mockOpenUrl).toHaveBeenCalledWith(repoUrl);
      // 不应调 clone_and_scan (这条路径已迁出 RepoCard)
      const cloneCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'clone_and_scan',
      );
      expect(cloneCalls.length).toBe(0);
    });
  });

  it('install_builtin_plugin failure shows red error banner on card (with BZ-07 localized title)', async () => {
    // BZ-07 — Rust 端返回 CliNotFound 字符串,前端走 localizeMarketplaceError
    // 翻成中文 title。原来的 raw error text 已被替换 (M6 用户实测需求)。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') {
        return [builtinRepo('superpowers', 'builtin', 'superpowers@x')];
      }
      if (cmd === 'install_builtin_plugin') {
        throw new Error("无法启动 'claude' CLI (请确认已安装)");
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-repo-card-superpowers')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-repo-clone-superpowers'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-repo-error-superpowers'),
      ).toBeInTheDocument();
    });
    // BZ-07 — 错误条显示本地化中文 title "无法启动 claude 命令行工具"
    expect(
      screen.getByTestId('marketplace-repo-error-title-superpowers'),
    ).toHaveTextContent('无法启动 claude 命令行工具');
    // BZ-07 — hint 给出 brew / Windows 安装指引
    expect(
      screen.getByTestId('marketplace-repo-error-hint-superpowers'),
    ).toHaveTextContent('brew install claude-code');
    expect(
      screen.getByTestId('marketplace-repo-error-hint-superpowers'),
    ).toHaveTextContent('Windows');
  });

  it('GSD-* resources get the "Get Shit Done" category badge (清单 16)', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/gsd',
      resources: [
        resource('plugin/gsd-discuss', 'plugin'),
        resource('command/gsd-plan.md', 'command'),
        resource('plugin/code-review', 'plugin'), // 不应被识别
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
        target: { value: 'https://github.com/test/gsd.git' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-custom-clone-btn'));
    });

    await waitFor(() => {
      // gsd-* 资源有 category badge
      expect(
        screen.getByTestId('marketplace-resource-category-plugin/gsd-discuss'),
      ).toHaveTextContent('Get Shit Done');
      expect(
        screen.getByTestId('marketplace-resource-category-command/gsd-plan.md'),
      ).toHaveTextContent('Get Shit Done');
      // 非 gsd-* 没有 badge
      expect(
        screen.queryByTestId(
          'marketplace-resource-category-plugin/code-review',
        ),
      ).not.toBeInTheDocument();
    });
  });

  it('batch install (M3.4): selecting resources + clicking "安装所选" triggers install_third_party_repo', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [
        resource('plugin/code-review', 'plugin'),
        resource('command/deploy.md', 'command'),
      ],
    };
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_marketplace_repos') return [];
      if (cmd === 'clone_and_scan') return scan;
      if (cmd === 'install_third_party_repo') {
        const a = args as {
          url: string;
          selections: string[];
        };
        expect(a.url).toBe('https://github.com/test/foo.git');
        expect(a.selections).toEqual([
          'plugin/code-review',
          'command/deploy.md',
        ]);
        return [
          {
            resource_id: 'plugin/code-review',
            installed: true,
            dest_path: 'C:/dest/plugins/code-review',
            message: '安装成功',
          },
          {
            resource_id: 'command/deploy.md',
            installed: true,
            dest_path: 'C:/dest/commands/deploy.md',
            message: '安装成功',
          },
        ] satisfies InstallResult[];
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
        screen.getByTestId('marketplace-resource-row-plugin/code-review'),
      ).toBeInTheDocument();
    });

    // 勾选 2 个资源
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          'marketplace-resource-checkbox-plugin/code-review',
        ),
      );
      fireEvent.click(
        screen.getByTestId('marketplace-resource-checkbox-command/deploy.md'),
      );
    });

    // 点批量 install
    await act(async () => {
      fireEvent.click(screen.getByTestId('marketplace-batch-install-btn'));
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'install_third_party_repo',
      );
      expect(calls.length).toBe(1);
      // 每行有 success banner (从批量结果合并)
      expect(
        screen.getByTestId(
          'marketplace-install-success-plugin/code-review',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          'marketplace-install-success-command/deploy.md',
        ),
      ).toBeInTheDocument();
    });
  });

  it('batch install button is disabled when no resources are selected', async () => {
    const scan: ScanResult = {
      repo_path: 'C:/mk/foo',
      resources: [resource('plugin/code-review', 'plugin')],
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
        screen.getByTestId('marketplace-batch-install-btn'),
      ).toBeInTheDocument();
    });
    // 未勾选任何资源 → 按钮 disabled
    const btn = screen.getByTestId('marketplace-batch-install-btn');
    expect(btn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Phase 28 BZ-06 — marketplace browse button regression (M5 #22 already shipped)
// ---------------------------------------------------------------------------

describe('MarketplacePage — Phase 28 BZ-06 browse-button regression', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockOpenUrl.mockReset();
    mockOpenUrl.mockResolvedValue(undefined);
  });

  it('marketplace_browse_button_calls_openUrl_with_repo_url', async () => {
    // BZ-06 regression — clicking the Git-mode repo card's clone/browse
    // button must call openUrl(repo.url) (NOT clone_and_scan), so the
    // user gets the GitHub page in their default browser.
    const repoUrl = 'https://github.com/anthropics/claude-cookbooks.git';
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') {
        return [
          builtinRepo('claude-cookbooks', 'git', '', { url: repoUrl }),
        ];
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-repo-card-claude-cookbooks'),
      ).toBeInTheDocument();
    });
    // Click the repo's action button (Git mode → "浏览")
    fireEvent.click(
      screen.getByTestId('marketplace-repo-clone-claude-cookbooks'),
    );
    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith(repoUrl);
    });
    // Should NOT have called clone_and_scan (that path moved to
    // the custom-URL input section)
    const cloneCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'clone_and_scan',
    );
    expect(cloneCalls.length).toBe(0);
  });

  it('rendered_repo_url_does_not_contain_cc_switch_main_path', async () => {
    // BZ-06 — RepoCard 底部显示 repo.url (行 868);这条字串
    // 不能含 'cc-switch-main' 旧路径占位 (M6 用户实测反馈:
    // 看到 URL 后误以为是私仓库/失效 → 不敢点「浏览」)。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') {
        return [
          builtinRepo('superpowers', 'builtin', 'superpowers@claude-plugins-official'),
          builtinRepo('gsd-core', 'npx', '@opengsd/gsd-core@latest'),
          builtinRepo('claude-cookbooks', 'git', ''),
        ];
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-repo-card-superpowers')).toBeInTheDocument();
    });
    // 三张卡片全文都不能出现 'cc-switch-main'
    const cardSuperpowers = screen.getByTestId('marketplace-repo-card-superpowers');
    const cardGsd = screen.getByTestId('marketplace-repo-card-gsd-core');
    const cardCookbooks = screen.getByTestId('marketplace-repo-card-claude-cookbooks');
    for (const card of [cardSuperpowers, cardGsd, cardCookbooks]) {
      expect(card.textContent).not.toContain('cc-switch-main');
      // 必须是 github.com 链接
      expect(card.textContent).toContain('github.com');
    }
  });

  // -------------------------------------------------------------------------
  // BUG-RF-03 — 第三方仓库警告条
  //
  // 第三方仓库未经 Claude 官方审核,需在第三方 URL section 顶部显示
  // 警告条。这是用户实测反馈:之前无警告 → 用户随手粘了任意 git URL
  // 直接 install 装到 ~/.claude/ 之后才发现仓库内容可能含恶意。
  // -------------------------------------------------------------------------
  it('BUG-RF-03: 第三方仓库 section 顶部显示警告条', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') return [];
      return null;
    });
    render(<MarketplacePage />);
    // 等待 mount 后 listMarketplaceRepos 调用完成(空数组)
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-custom-section')).toBeInTheDocument();
    });
    // 警告条必须出现,文案含 "未经 Claude 官方审核" 关键字。
    const warn = screen.getByTestId('marketplace-third-party-warning');
    expect(warn).toBeInTheDocument();
    expect(warn.textContent).toContain('第三方仓库未经 Claude 官方审核');
    expect(warn.textContent).toContain('请自行甄别');
  });

  it('BUG-RF-03: 内置推荐源不显示第三方警告(只在第三方 section 顶部显示)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_marketplace_repos') {
        return [builtinRepo('superpowers', 'builtin', 'superpowers@claude-plugins-official')];
      }
      return null;
    });
    render(<MarketplacePage />);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-repo-card-superpowers')).toBeInTheDocument();
    });
    // 警告条在「第三方 git URL」section 顶部,只出现 1 次。
    const warns = screen.getAllByTestId('marketplace-third-party-warning');
    expect(warns).toHaveLength(1);
    // 内置推荐卡片不内嵌警告条。
    const card = screen.getByTestId('marketplace-repo-card-superpowers');
    expect(
      card.querySelector('[data-testid="marketplace-third-party-warning"]'),
    ).toBeNull();
  });
});
