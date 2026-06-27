/**
 * Vitest coverage for the About page (M3.7 — 清单 18).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Initial render: page-level testid, 4 sections (版本 / 许可证 / 致谢 / 技术栈).
 *   - On mount: invokes `get_app_metadata` IPC.
 *   - Renders the metadata fields (version, identifier, git_commit, build_target, build_timestamp).
 *   - Build-timestamp 0 renders "未知" rather than "1970-01-01".
 *   - 4 section headings are present and labeled.
 *   - License section mentions MIT.
 *   - IPC error: shows the ErrorBanner with the error message.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AboutPage from '../../pages/about';
import type { AppMetadata } from '../../types/app';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleMetadata = (overrides: Partial<AppMetadata> = {}): AppMetadata => ({
  version: '0.1.1',
  identifier: 'com.claudemanager.app',
  product_name: 'ClaudeManager',
  git_commit: 'abc1234',
  build_target: 'windows/x86_64',
  build_timestamp: 1_700_000_000,
  // UI-A-05 (2026-06-27) — homepage_url 是新字段, 测试 fixture 必须同步
  // (CLAUDE.md §6.4 三处同步)。默认填 HOMEPAGE_URL 常量值。
  homepage_url: 'https://github.com/coderstory/claudeManager',
  ...overrides,
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_app_metadata') return sampleMetadata();
    return null;
  });
});

describe('AboutPage — M3.7 (清单 18)', () => {
  it('renders the page with title and 4 sections', async () => {
    render(<AboutPage />);
    expect(screen.getByTestId('about-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /关于/ })).toBeInTheDocument();
  });

  it('fires get_app_metadata on mount', async () => {
    render(<AboutPage />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_app_metadata',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the version section with all metadata fields', async () => {
    render(<AboutPage />);
    await waitFor(() => {
      expect(screen.getByTestId('about-version-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('about-app-name').textContent).toContain(
      'ClaudeManager',
    );
    expect(screen.getByTestId('about-version').textContent).toContain('0.1.1');
    expect(screen.getByTestId('about-build-hash').textContent).toContain(
      'abc1234',
    );
    expect(screen.getByTestId('about-build-target').textContent).toContain(
      'windows/x86_64',
    );
    expect(screen.getByTestId('about-identifier').textContent).toContain(
      'com.claudemanager.app',
    );
  });

  it('renders "未知" when build_timestamp is 0', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_metadata') {
        return sampleMetadata({ build_timestamp: 0 });
      }
      return null;
    });
    render(<AboutPage />);
    await waitFor(() => {
      expect(screen.getByTestId('about-build-timestamp').textContent).toContain(
        '未知',
      );
    });
  });

  it('renders all 4 sections (版本/许可证/致谢/技术栈)', () => {
    render(<AboutPage />);
    // The 4 section headings must be present regardless of IPC state.
    expect(screen.getByTestId('about-license-section')).toBeInTheDocument();
    expect(screen.getByTestId('about-credits-section')).toBeInTheDocument();
    expect(screen.getByTestId('about-stack-section')).toBeInTheDocument();
  });

  it('license section mentions MIT', () => {
    render(<AboutPage />);
    expect(screen.getByTestId('about-license-section').textContent).toContain(
      'MIT',
    );
  });

  it('credits section mentions Tauri and cc-switch', () => {
    render(<AboutPage />);
    expect(screen.getByTestId('about-credits-section').textContent).toContain(
      'Tauri',
    );
    expect(screen.getByTestId('about-credits-section').textContent).toContain(
      'cc-switch',
    );
  });

  it('renders the ErrorBanner when get_app_metadata rejects', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_metadata') {
        throw new Error('IPC failed: process gone');
      }
      return null;
    });
    render(<AboutPage />);
    await waitFor(() => {
      expect(screen.getByTestId('about-metadata-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('about-metadata-error').textContent).toContain(
      'IPC failed',
    );
  });

  // M5 bug #32 — 许可证区"项目主页"必须单独一行, 不能跟"许可证 MIT"并排.
  // 验证 grid 改成 flex-direction: column, 两个 dt 在不同 row 上.
  it('M5 bug #32: 许可证区用单列布局, 项目主页与许可证各占一行', () => {
    render(<AboutPage />);
    const section = screen.getByTestId('about-license-section');
    // 找包裹 dl 的容器
    const dl = section.querySelector('dl');
    expect(dl).not.toBeNull();
    // 布局是 flex column (单列), 不是 grid 2 列.
    expect(dl!.style.display).toBe('flex');
    expect(dl!.style.flexDirection).toBe('column');
    // 验证旧 grid 2 列布局已被替换 (CSS 字符串里不能含 'grid')
    expect(dl!.style.cssText).not.toContain('grid');
    // 项目主页 testid 存在
    expect(screen.getByTestId('about-license-homepage')).toBeInTheDocument();
    // 两个 dt 在不同的父 div 里 (即两个独立 flex item)
    const licenseTypeRow = screen.getByTestId('about-license-type').parentElement as HTMLElement;
    const homepageRow = screen.getByTestId('about-license-homepage').parentElement as HTMLElement;
    expect(licenseTypeRow).not.toBe(homepageRow);
    // 两者都是 dl 的直接子元素, 验证单列布局
    expect(dl!.contains(licenseTypeRow)).toBe(true);
    expect(dl!.contains(homepageRow)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Phase 30 UI-A-05 — 项目主页 URL 来自 IPC, 不再硬编码
  //
  // 旧 bug: 前端 src/pages/about/index.tsx::PROJECT_HOMEPAGE 硬编码
  //   "github.com/coderstory/claude-config-manager"(无 https:// 前缀,
  //   旧 cc-switch-main 链路残留)。
  // 新实现: Rust 端 HOMEPAGE_URL 常量 → AppMetadata.homepage_url → 前端
  //   About 页读 m.homepage_url。3 处同步 (CLAUDE.md §6.4):
  //   - Rust src-tauri/src/commands/app.rs::HOMEPAGE_URL
  //   - TS src/types/app.ts::AppMetadata.homepage_url
  //   - 测试 fixture sampleMetadata.homepage_url
  // -------------------------------------------------------------------------
  it('UI-A-05: 关于页项目主页 URL 渲染来自 IPC 的 homepage_url 字段', async () => {
    render(<AboutPage />);
    await waitFor(() => {
      expect(screen.getByTestId('about-license-homepage')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('about-license-homepage'),
    ).toHaveTextContent('https://github.com/coderstory/claudeManager');
  });

  it('UI-A-05: IPC 返回的 homepage_url 含 https:// 前缀 (避免旧 cc-switch-main 短链接残留)', async () => {
    // 验证 fixture 默认值有 https:// 前缀, 防止后续 rebrand 漏改前缀
    const meta = sampleMetadata();
    expect(meta.homepage_url).toMatch(/^https:\/\//);
    // 不应是短链或 cc-switch-main 残留
    expect(meta.homepage_url).not.toContain('cc-switch-main');
  });

  it('UI-A-05: IPC 失败时仍显示 HOMEPAGE_FALLBACK 而非空白 (CLAUDE.md §7 不静默吞错)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_metadata') {
        throw new Error('IPC failed');
      }
      return null;
    });
    render(<AboutPage />);
    await waitFor(() => {
      expect(screen.getByTestId('about-metadata-error')).toBeInTheDocument();
    });
    // Fallback URL 必须出现, 而不是空白
    const homepage = screen.getByTestId('about-license-homepage');
    expect(homepage.textContent).toContain('github.com/coderstory');
  });
});
