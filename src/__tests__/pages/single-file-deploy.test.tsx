/**
 * Vitest coverage for the F8 SingleFileDeployPage (M2.8 + M3.7 文案重写).
 *
 * M3.7 简化后页面不含 metadata 卡片 (移到 about 页):
 *   - 不再调 `get_app_metadata` IPC (改由 about 页消费)。
 *   - "当前应用"metadata 卡片移除。
 *   - intro 文案改为"导出单 exe / 嵌入 WebView2"。
 *   - toggle 文案改为"查看构建命令"。
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Initial render: page-level testid, command toggle button.
 *   - Toggle button reveals the installer-command panel; commands
 *     reference the script path (`scripts/build-installer.sh`).
 *   - Page does NOT call `get_app_metadata` (M3.7 simplification).
 *   - No `app-metadata-card` / `meta-*` testids (regression guard).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SingleFileDeployPage from '../../pages/single-file-deploy';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('SingleFileDeployPage — F8 (M2.8 + M3.7 文案重写)', () => {
  it('renders the page title and the simplified intro', () => {
    render(<SingleFileDeployPage />);
    expect(screen.getByTestId('single-file-deploy-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /单文件部署/ })).toBeInTheDocument();
  });

  it('does NOT call get_app_metadata anymore (M3.7 simplification)', () => {
    render(<SingleFileDeployPage />);
    const calls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_app_metadata',
    );
    expect(calls.length).toBe(0);
  });

  it('does NOT render the metadata card (regression guard)', () => {
    render(<SingleFileDeployPage />);
    expect(screen.queryByTestId('app-metadata-card')).toBeNull();
    expect(screen.queryByTestId('meta-version')).toBeNull();
    expect(screen.queryByTestId('meta-identifier')).toBeNull();
    expect(screen.queryByTestId('meta-product-name')).toBeNull();
    expect(screen.queryByTestId('meta-git-commit')).toBeNull();
    expect(screen.queryByTestId('meta-build-target')).toBeNull();
    expect(screen.queryByTestId('meta-build-timestamp')).toBeNull();
  });

  it('shows the installer-command panel when toggled', () => {
    render(<SingleFileDeployPage />);
    expect(screen.getByTestId('toggle-commands-btn')).toBeInTheDocument();

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

  it('toggle button label uses "构建命令" (M3.7 文案)', () => {
    render(<SingleFileDeployPage />);
    expect(screen.getByTestId('toggle-commands-btn').textContent).toContain(
      '构建命令',
    );
  });

  it('intro mentions WebView2 / WKWebView (M3.7 功能解释)', () => {
    render(<SingleFileDeployPage />);
    const pageText =
      screen.getByTestId('single-file-deploy-page').textContent ?? '';
    expect(pageText).toContain('WebView2');
    expect(pageText).toContain('WKWebView');
  });
});