/**
 * Vitest coverage for the F8 SingleFileDeployPage (M2.8).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Initial render: page-level testid, metadata card, command panel.
 *   - On mount: invokes `get_app_metadata`.
 *   - Renders the metadata fields (version, identifier, product_name,
 *     git_commit, build_target, build_timestamp).
 *   - Build-timestamp 0 renders "未知" rather than "1970-01-01".
 *   - Toggle button reveals the installer-command panel; commands
 *     reference the script path (`scripts/build-installer.sh`).
 *   - IPC error: shows the InfoBar with the error message.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SingleFileDeployPage from '../../pages/single-file-deploy';
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

describe('SingleFileDeployPage — F8 (M2.8)', () => {
  it('renders the page title and intro', async () => {
    render(<SingleFileDeployPage />);
    expect(screen.getByTestId('single-file-deploy-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /单文件部署/ })).toBeInTheDocument();
  });

  it('fires get_app_metadata on mount', async () => {
    render(<SingleFileDeployPage />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_app_metadata',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the metadata card with all six fields', async () => {
    render(<SingleFileDeployPage />);
    await waitFor(() => {
      expect(screen.getByTestId('app-metadata-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('meta-version').textContent).toContain('0.1.0');
    expect(screen.getByTestId('meta-identifier').textContent).toContain(
      'com.claudeconfigmanager.app',
    );
    expect(screen.getByTestId('meta-product-name').textContent).toContain(
      'ClaudeConfigManager',
    );
    expect(screen.getByTestId('meta-git-commit').textContent).toContain('abc1234');
    expect(screen.getByTestId('meta-build-target').textContent).toContain(
      'windows/x86_64',
    );
    // Timestamp is rendered as a human-readable string (locale-dependent),
    // so just assert it's not empty / not the literal "0".
    const ts = screen.getByTestId('meta-build-timestamp').textContent ?? '';
    expect(ts.length).toBeGreaterThan(0);
    expect(ts).not.toBe('0');
  });

  it('renders "未知" when build_timestamp is 0', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_metadata') {
        return sampleMetadata({ build_timestamp: 0 });
      }
      return null;
    });
    render(<SingleFileDeployPage />);
    await waitFor(() => {
      expect(screen.getByTestId('meta-build-timestamp').textContent).toContain(
        '未知',
      );
    });
  });

  it('shows the installer-command panel when toggled', async () => {
    render(<SingleFileDeployPage />);
    await waitFor(() => {
      expect(screen.getByTestId('toggle-commands-btn')).toBeInTheDocument();
    });

    // Panel should be hidden by default.
    expect(screen.queryByTestId('installer-commands-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('toggle-commands-btn'));

    expect(screen.getByTestId('installer-commands-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('installer-commands-panel').textContent,
    ).toContain('scripts/build-installer.sh');
    // Both targets are referenced.
    expect(
      screen.getByTestId('installer-commands-panel').textContent,
    ).toContain('windows');
    expect(
      screen.getByTestId('installer-commands-panel').textContent,
    ).toContain('macos');
  });

  it('renders the InfoBar when get_app_metadata rejects', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_metadata') {
        throw new Error('IPC failed: process gone');
      }
      return null;
    });
    render(<SingleFileDeployPage />);
    await waitFor(() => {
      expect(screen.getByTestId('app-metadata-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-metadata-error').textContent).toContain(
      'IPC failed',
    );
  });
});
