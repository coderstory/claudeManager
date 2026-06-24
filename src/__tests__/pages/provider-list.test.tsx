/**
 * Vitest coverage for the F1 + F2 ProviderListPage (M2.1).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - F1 rendering: 3 providers → 3 rows, names visible, types visible.
 *   - F1 empty: no providers → empty-state CTA.
 *   - F1 error: list_providers rejects → red error message visible.
 *   - F1 active marker: row with is_active=true shows the badge,
 *     rows with is_active=false show the [激活] button.
 *   - F2 switching: clicking [激活] calls switchProvider; on success
 *     the success InfoBar appears and the list refreshes.
 *   - F2 failure: switchProvider rejects → red failure InfoBar.
 *
 * Mocking strategy:
 *   We mock `@tauri-apps/api/core` so `invoke()` becomes a plain
 *   Promise we control. This avoids spinning up a real Tauri runtime
 *   in jsdom. The listProviders / switchProvider wrappers in
 *   src/lib/api/providers.ts pass through to `invoke()` unchanged,
 *   so the mocks are sufficient.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ProviderListPage } from '../../pages/provider-list';
import type { Provider } from '../../types/provider';

// ---------------------------------------------------------------------------
// Mock the Tauri IPC layer.
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ---------------------------------------------------------------------------
// Sample data + helpers
// ---------------------------------------------------------------------------

function p(id: string, name: string, opts: Partial<Provider> = {}): Provider {
  return {
    id,
    name,
    provider_type: opts.provider_type ?? 'anthropic',
    api_base: opts.api_base ?? `https://${id}.example.com`,
    api_key: opts.api_key ?? `key-${id}`,
    models: opts.models ?? ['claude-sonnet-4-6'],
    is_active: opts.is_active ?? false,
    created_at: opts.created_at ?? 1_700_000_000,
    last_used_at: opts.last_used_at ?? null,
    notes: opts.notes ?? null,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

// ---------------------------------------------------------------------------
// F1 — rendering
// ---------------------------------------------------------------------------

describe('ProviderListPage — F1 rendering', () => {
  it('shows loading state initially then renders 3 providers', async () => {
    mockInvoke.mockResolvedValueOnce([
      p('glm', 'GLM-4.6', { provider_type: 'anthropic', api_base: 'https://api.anthropic.com' }),
      p('deepseek', 'DeepSeek-V3', { provider_type: 'deepseek', api_base: 'https://api.deepseek.com' }),
      p('custom', 'Custom Proxy', { provider_type: 'custom', api_base: 'https://internal.example.com' }),
    ]);

    render(<ProviderListPage />);

    expect(screen.getByTestId('provider-list-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('provider-row-glm')).toBeInTheDocument();
    expect(screen.getByTestId('provider-row-deepseek')).toBeInTheDocument();
    expect(screen.getByTestId('provider-row-custom')).toBeInTheDocument();
    expect(screen.getByText('GLM-4.6')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek-V3')).toBeInTheDocument();
    expect(screen.getByText('Custom Proxy')).toBeInTheDocument();
  });

  it('shows empty state when no providers exist', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<ProviderListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/还没有任何 provider/)).toBeInTheDocument();
  });

  it('shows red error message when list_providers fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    render(<ProviderListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-list-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/错误：boom/)).toBeInTheDocument();
  });

  it('shows active badge for is_active=true and [激活] button for false', async () => {
    mockInvoke.mockResolvedValueOnce([
      p('a', 'A', { is_active: true }),
      p('b', 'B', { is_active: false }),
    ]);

    render(<ProviderListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });
    // Active row: badge present, no activate button
    expect(screen.getByTestId('provider-active-badge-a')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-activate-a')).toBeNull();
    // Inactive row: button present, no badge
    expect(screen.getByTestId('provider-activate-b')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-active-badge-b')).toBeNull();
  });

  it('clicking [刷新] reloads the list', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockResolvedValueOnce([p('a', 'A'), p('b', 'B')]);

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('provider-row-b')).toBeNull();

    fireEvent.click(screen.getByTestId('provider-list-refresh'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-b')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// F2 — switching
// ---------------------------------------------------------------------------

describe('ProviderListPage — F2 switching', () => {
  it('clicking [激活] calls switch_provider with providerId and refreshes list', async () => {
    mockInvoke.mockResolvedValueOnce([
      p('a', 'A'),
      p('b', 'B', { is_active: true }),
    ]);
    // switchProvider call
    const switched = p('a', 'A', { is_active: true, last_used_at: 1_800_000_000 });
    mockInvoke.mockResolvedValueOnce(switched);
    // Reload after switch
    mockInvoke.mockResolvedValueOnce([
      p('a', 'A', { is_active: true }),
      p('b', 'B'),
    ]);

    render(<ProviderListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-activate-a'));
    });

    // switchProvider was called with the right arg
    expect(mockInvoke).toHaveBeenCalledWith('switch_provider', { providerId: 'a' });
    // Success bar appears with the provider name
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-success-bar')).toBeInTheDocument();
    });
    expect(screen.getByText(/已切换到 A/)).toBeInTheDocument();
    // After refresh, 'a' has is_active=true → badge present
    await waitFor(() => {
      expect(screen.getByTestId('provider-active-badge-a')).toBeInTheDocument();
    });
  });

  it('shows failure InfoBar when switch_provider rejects', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockRejectedValueOnce(new Error('disk full'));

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-activate-a'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('provider-list-error-bar')).toBeInTheDocument();
    });
    expect(screen.getByText(/切换失败：disk full/)).toBeInTheDocument();
  });

  it('disables the activate button while switching', async () => {
    // Make switchProvider hang so we can observe the disabled state.
    let resolveSwitch!: (v: Provider) => void;
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockImplementationOnce(
      () => new Promise<Provider>((res) => { resolveSwitch = res; }),
    );
    // List refresh after switch completes.
    mockInvoke.mockResolvedValueOnce([p('a', 'A', { is_active: true })]);

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    const btn = screen.getByTestId('provider-activate-a');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
    expect(btn).toHaveTextContent(/切换中/);

    // Resolve to clean up the promise.
    await act(async () => {
      resolveSwitch(p('a', 'A', { is_active: true }));
    });
  });

  it('does not refresh list if post-switch list_providers fails', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockResolvedValueOnce(p('a', 'A', { is_active: true })); // switch
    mockInvoke.mockRejectedValueOnce(new Error('reload failed')); // list after switch

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-activate-a'));
    });

    // Success bar still appears (the switch itself succeeded)
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-success-bar')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// F14 — 导出单 provider (M2.16)
// ---------------------------------------------------------------------------

describe('ProviderListPage — F14 export', () => {
  it('renders an export button on each provider row', async () => {
    mockInvoke.mockResolvedValueOnce([
      p('a', 'A', { is_active: true }),
      p('b', 'B'),
    ]);

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    // 两行都有导出按钮(active + inactive 都可导出)。
    expect(screen.getByTestId('provider-export-a')).toBeInTheDocument();
    expect(screen.getByTestId('provider-export-b')).toBeInTheDocument();
  });

  it('clicking export calls export_provider with providerId + appType', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A', { provider_type: 'anthropic' })]);
    // export_provider 返回一个路径(写盘成功)。
    mockInvoke.mockResolvedValueOnce('C:\\Users\\me\\Desktop\\a.json');

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-export-a'));
    });

    // invoke 收到 export_provider + 正确的 snake_case 参数。
    expect(mockInvoke).toHaveBeenCalledWith('export_provider', {
      providerId: 'a',
      appType: 'anthropic',
    });
    // 成功 InfoBar 出现,含路径。
    await waitFor(() => {
      expect(screen.getByTestId('provider-export-success-bar')).toBeInTheDocument();
    });
    expect(screen.getByText(/已导出到/)).toBeInTheDocument();
    expect(screen.getByText(/a\.json/)).toBeInTheDocument();
  });

  it('shows no InfoBar when export returns null (user cancelled save dialog)', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    // 后端返回 null = 用户在保存框点了取消。
    mockInvoke.mockResolvedValueOnce(null);

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-export-a'));
    });

    // 取消是静默的:不显示成功 bar,也不显示失败 bar。
    expect(screen.queryByTestId('provider-export-success-bar')).toBeNull();
    expect(screen.queryByTestId('provider-export-error-bar')).toBeNull();
  });

  it('shows red failure InfoBar when export_provider rejects', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockRejectedValueOnce(new Error('disk full'));

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-export-a'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('provider-export-error-bar')).toBeInTheDocument();
    });
    expect(screen.getByText(/导出失败：disk full/)).toBeInTheDocument();
  });

  it('disables the export button while exporting', async () => {
    // 让 export_provider hang,观察 disabled 态。
    let resolveExport!: (v: string | null) => void;
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockImplementationOnce(
      () => new Promise<string | null>((res) => { resolveExport = res; }),
    );

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    const btn = screen.getByTestId('provider-export-a');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
    expect(btn).toHaveTextContent(/导出中/);

    // 解掉 promise 清理。
    await act(async () => {
      resolveExport('C:\\out\\a.json');
    });
  });

  it('export does not interfere with the switch flow (separate state machines)', async () => {
    // 导出成功后,切换流程照常工作(两个状态机独立)。
    mockInvoke.mockResolvedValueOnce([p('a', 'A'), p('b', 'B', { is_active: true })]);
    // export a
    mockInvoke.mockResolvedValueOnce('C:\\out\\a.json');
    // switch a
    const switched = p('a', 'A', { is_active: true, last_used_at: 1_800_000_000 });
    mockInvoke.mockResolvedValueOnce(switched);
    // list reload after switch
    mockInvoke.mockResolvedValueOnce([p('a', 'A', { is_active: true }), p('b', 'B')]);

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    // 先导出 a
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-export-a'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('provider-export-success-bar')).toBeInTheDocument();
    });

    // 再激活 a — 切换 InfoBar 独立出现,不受导出态影响。
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-activate-a'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-success-bar')).toBeInTheDocument();
    });
    expect(screen.getByText(/已切换到 A/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M2.17 — F15 batch3: InfoBars(切流程)改用共享 ErrorBanner。
// 原 testid `provider-list-{kind}-bar` 保留 + 内部 ErrorBanner 通过
// data-banner-kind 区分 success/error;autoDismiss 走 ErrorBanner 内部 useEffect。
// ---------------------------------------------------------------------------

describe('ProviderListPage — M2.17 F15 batch3 InfoBars → ErrorBanner', () => {
  it('switch success bar uses ErrorBanner kind=success (role=status) inside testid wrapper', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'switch_provider') return { ...(args as { providerId: string }).providerId.length ? p('a', 'A') : p('a', 'A') };
      if (cmd === 'list_providers') {
        return [p('a', 'A', { is_active: true })];
      }
      return null;
    });
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-activate-a'));
    });
    await waitFor(() => {
      const wrapper = screen.getByTestId('provider-list-success-bar');
      expect(wrapper).toBeInTheDocument();
      // ErrorBanner kind=success → role="status"
      const banner = wrapper.querySelector('[data-banner-kind="success"]');
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('role')).toBe('status');
      // success bar 内部应显示 dismiss 按钮 (autoDismiss 模式下 onDismiss 必传)
      expect(banner!.querySelector('button[aria-label="关闭提示"]')).not.toBeNull();
    });
  });

  it('switch failure bar uses ErrorBanner kind=error (role=alert) inside testid wrapper', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A')]);
    mockInvoke.mockRejectedValueOnce(new Error('disk full'));
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-activate-a'));
    });
    await waitFor(() => {
      const wrapper = screen.getByTestId('provider-list-error-bar');
      expect(wrapper).toBeInTheDocument();
      // ErrorBanner kind=error → role="alert"
      const banner = wrapper.querySelector('[data-banner-kind="error"]');
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('role')).toBe('alert');
      expect(banner!.textContent).toContain('disk full');
    });
  });

  // -----------------------------------------------------------------------
  // Reload-after-import regression (b6aa402 + 38d4f60):
  // "从当前配置生成" 按钮 confirm 导入后, 列表必须刷新才能看到新 provider.
  // 真实 testid 命名 (看 src/pages/provider-list/index.tsx): provider-*
  // -----------------------------------------------------------------------
  it('generate-confirm 触发 importSingleProvider + switchProvider + 2 次 reload', async () => {
    // 1) 初次加载: 列表为空
    mockInvoke.mockResolvedValueOnce([]);
    render(<ProviderListPage />);
    // 先等 loading 出现, 再等 list/empty 出现
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-loading')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    // 2) 点 "从当前配置生成" 按钮 → 后端返回 1 个 candidate
    mockInvoke.mockResolvedValueOnce({
      provider: p('generated-1', 'minimaxi.com'),
      is_new: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });
    // 3) preview modal 应出现
    await waitFor(() => {
      expect(screen.getByTestId('provider-generate-preview-modal')).toBeInTheDocument();
    });

    // 4) 点 "确认导入" → importSingleProvider + switchProvider + 2 次 listProviders
    mockInvoke.mockResolvedValueOnce(undefined); // importSingleProvider
    mockInvoke.mockResolvedValueOnce(undefined); // switchProvider
    mockInvoke.mockResolvedValueOnce([p('generated-1', 'minimaxi.com')]); // reload after import
    mockInvoke.mockResolvedValueOnce([p('generated-1', 'minimaxi.com', { is_active: true })]); // reload after switch
    await act(async => {
      fireEvent.click(screen.getByTestId('provider-generate-preview-confirm'));
    });

    // 5) 验证 listProviders 被调用 >=3 次 (初次 + 2 次 reload)
    const listCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'list_providers');
    expect(listCalls.length).toBeGreaterThanOrEqual(3);

    // 6) 新 provider 出现在 DOM
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-generated-1')).toBeInTheDocument();
    });
  });

  it('generate-confirm 失败: importSingleProvider reject → 状态切 failure', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-loading')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    // generate 成功
    mockInvoke.mockResolvedValueOnce({
      provider: p('generated-2', 'minimaxi.com'),
      is_new: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('provider-generate-preview-modal')).toBeInTheDocument();
    });

    // confirm 失败
    mockInvoke.mockRejectedValueOnce(new Error('disk full write failed'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-generate-preview-confirm'));
    });

    // 状态切 failure (GeneratePreviewModal 关闭, 错误显示在 generate-info-bar)
    await waitFor(() => {
      expect(screen.queryByTestId('provider-generate-preview-modal')).toBeNull();
    });
  });
});
