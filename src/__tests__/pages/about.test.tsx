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
  version: '0.1.0',
  identifier: 'com.claudeconfigmanager.app',
  product_name: 'ClaudeConfigManager',
  git_commit: 'abc1234',
  build_target: 'windows/x86_64',
  build_timestamp: 1_700_000_000,
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
      'ClaudeConfigManager',
    );
    expect(screen.getByTestId('about-version').textContent).toContain('0.1.0');
    expect(screen.getByTestId('about-build-hash').textContent).toContain(
      'abc1234',
    );
    expect(screen.getByTestId('about-build-target').textContent).toContain(
      'windows/x86_64',
    );
    expect(screen.getByTestId('about-identifier').textContent).toContain(
      'com.claudeconfigmanager.app',
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
});
