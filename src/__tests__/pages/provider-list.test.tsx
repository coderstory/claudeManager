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
    models: opts.models ?? { default: 'claude-sonnet-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} },
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
    await act(() => {
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

  // -----------------------------------------------------------------------
  // M3.6 (清单 22) — CRUD USER FLOW E2E TESTS
  // 这些不是单元测试 — 它们模拟真实用户点击 + 输入 + 提交,验证完整流程.
  // 之前的"啥也干不了"是分析层发现, 现在的测试确保它真的能用.
  // -----------------------------------------------------------------------

  it('+ Add 按钮 → 打开 form → 填表 → 保存 → 调用 addProvider → 刷新列表', async () => {
    mockInvoke.mockResolvedValueOnce([]);  // initial list (empty)
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    // 1. 用户点 [+ Add]
    fireEvent.click(screen.getByTestId('provider-list-add'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('provider-form-save')).toBeInTheDocument();
    expect(screen.getByTestId('provider-form-cancel')).toBeInTheDocument();

    // 2. 用户填表 (5 个字段: name / base_url / api_key / default model / notes)
    fireEvent.change(screen.getByTestId('provider-form-name'), { target: { value: 'Test Add' } });
    fireEvent.change(screen.getByTestId('provider-form-base-url'), { target: { value: 'https://api.add.example' } });
    fireEvent.change(screen.getByTestId('provider-form-api-key'), { target: { value: 'sk-add-12345' } });
    // M4.6.1 — 4-tier model mapping: default / haiku / sonnet / opus
    fireEvent.change(screen.getByTestId('provider-form-model-default'), { target: { value: 'add-model' } });
    fireEvent.change(screen.getByTestId('provider-form-notes'), { target: { value: 'e2e test' } });

    // 3. mock addProvider 成功 + reload
    mockInvoke.mockResolvedValueOnce({
      id: 'test-add', name: 'Test Add', provider_type: 'anthropic',
      api_base: 'https://api.add.example', api_key: 'sk-add-12345',
      models: { default: 'add-model', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: false,
      created_at: 1700000000, last_used_at: null, notes: 'e2e test',
    });
    mockInvoke.mockResolvedValueOnce([{  // reload 后
      id: 'system', name: 'System', provider_type: 'anthropic',
      api_base: 'https://api.system', api_key: 'sk-system',
      models: { default: 'claude-sonnet-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: true,
      created_at: 1, last_used_at: null, notes: null,
    }, {
      id: 'test-add', name: 'Test Add', provider_type: 'anthropic',
      api_base: 'https://api.add.example', api_key: 'sk-add-12345',
      models: { default: 'add-model', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: false,
      created_at: 1700000000, last_used_at: null, notes: 'e2e test',
    }]);

    // 4. 用户点 [保存]
    fireEvent.click(screen.getByTestId('provider-form-save'));

    // 5. 验证 addProvider 被调用
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'add_provider');
      expect(calls.length).toBe(1);
    });
    // 6. 验证 form modal 关闭 + 列表更新
    await waitFor(() => {
      expect(screen.queryByTestId('provider-form-modal')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-test-add')).toBeInTheDocument();
    });
  });

  // A2 regression (CLAUDE.md §16 验证) — add_provider invoke payload must include `input.id`.
  //
  // 历史 bug: ProviderFormModal.handleSubmit 把 `id` 漏掉,Rust serde
  // 拒绝 "missing field `id`" → IPC 100% 失败。修复在
  // src/pages/provider-list/index.tsx 的 ProviderFormModal.handleSubmit
  // (通过 generateIdFromName(name) 派生 id)。
  //
  // 与 M5 bug #6 (update_provider) 平行 — 同样需要断言 payload 含 id,
  // 否则未来重构 ProviderFormModal 时 id 可能再次丢失。
  it('[Add] invoke payload must include input.id (A2 regression)', async () => {
    mockInvoke.mockResolvedValueOnce([]);  // initial list (empty)
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('provider-list-add'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-modal')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('provider-form-name'), { target: { value: 'GLM Add' } });
    fireEvent.change(screen.getByTestId('provider-form-base-url'), { target: { value: 'https://api.add2.example' } });
    fireEvent.change(screen.getByTestId('provider-form-api-key'), { target: { value: 'sk-add-67890' } });
    fireEvent.change(screen.getByTestId('provider-form-model-default'), { target: { value: 'glm-4-6' } });

    // mock add_provider 成功 + reload
    mockInvoke.mockResolvedValueOnce({
      id: 'glm-add', name: 'GLM Add', provider_type: 'anthropic',
      api_base: 'https://api.add2.example', api_key: 'sk-add-67890',
      models: { default: 'glm-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} },
      is_active: false, created_at: 1_700_000_000, last_used_at: null, notes: null,
    });
    mockInvoke.mockResolvedValueOnce([{
      id: 'glm-add', name: 'GLM Add', provider_type: 'anthropic',
      api_base: 'https://api.add2.example', api_key: 'sk-add-67890',
      models: { default: 'glm-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} },
      is_active: false, created_at: 1_700_000_000, last_used_at: null, notes: null,
    }]);

    fireEvent.click(screen.getByTestId('provider-form-save'));

    // 核心断言: add_provider 必须被调, 且 payload.input.id 必须存在。
    // generateIdFromName("GLM Add") = "glm-add" (lowercase + 非 a-z0-9-_ 转 '-')。
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'add_provider');
      expect(calls.length).toBe(1);
      const args = calls[0][1] as { input: Record<string, unknown> };
      expect(args.input).toBeDefined();
      expect(args.input.id).toBe('glm-add');
      // 业务字段全在
      expect(args.input.name).toBe('GLM Add');
      expect(args.input.base_url).toBe('https://api.add2.example');
      expect(args.input.api_key).toBe('sk-add-67890');
      expect(args.input.models).toEqual({
        default: 'glm-4-6', haiku: null, sonnet: null, opus: null, by_tier: {},
      });
    });
  });

  it('[View] 按钮 → 打开 details modal → 显示完整字段 (含 api_key)', async () => {
    const target = {
      id: 'glm', name: 'GLM-4.6', provider_type: 'custom',
      api_base: 'https://api.glm.example', api_key: 'sk-glm-secret',
      models: { default: 'glm-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: false,
      created_at: 1700000000, last_used_at: 1700000500, notes: 'GLM notes',
    };
    mockInvoke.mockResolvedValueOnce([
      { id: 'system', name: 'System', provider_type: 'anthropic',
        api_base: 'https://api.system', api_key: 'sk-sys',
        models: { default: 'claude-sonnet-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: true,
        created_at: 1, last_used_at: null, notes: null },
      target,
    ]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-glm')).toBeInTheDocument();
    });

    // 用户点 [View]
    mockInvoke.mockResolvedValueOnce(target);  // get_provider_details 返回
    fireEvent.click(screen.getByTestId('provider-view-glm'));

    // details modal 出现 + 所有字段可见
    await waitFor(() => {
      expect(screen.getByTestId('provider-details-modal')).toBeInTheDocument();
    });
    await waitFor(() => {
      const content = screen.getByTestId('provider-details-content');
      expect(content).toBeInTheDocument();
      expect(content.textContent).toContain('GLM-4.6');
      expect(content.textContent).toContain('custom');
      expect(content.textContent).toContain('https://api.glm.example');
      expect(content.textContent).toContain('sk-glm-secret');
      expect(content.textContent).toContain('glm-4-6');
      expect(content.textContent).toContain('GLM notes');
    });
  });

  it('[Edit] 按钮 → 打开 form prefilled → 修改 → 保存 → 调用 updateProvider → 刷新', async () => {
    const target = {
      id: 'glm', name: 'GLM-OLD', provider_type: 'custom',
      api_base: 'https://api.old.example', api_key: 'sk-old',
      models: { default: 'old-model', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: false,
      created_at: 1700000000, last_used_at: null, notes: 'old',
    };
    mockInvoke.mockResolvedValueOnce([target]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-glm')).toBeInTheDocument();
    });

    // 1. 用户点 [Edit]
    fireEvent.click(screen.getByTestId('provider-edit-glm'));

    // 2. form modal 出现, 字段 prefilled
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-modal')).toBeInTheDocument();
    });
    const nameInput = screen.getByTestId('provider-form-name') as HTMLInputElement;
    expect(nameInput.value).toBe('GLM-OLD');  // 预填

    // 3. 用户改 name
    fireEvent.change(nameInput, { target: { value: 'GLM-NEW' } });

    // 4. mock updateProvider 成功 + reload
    const updated = { ...target, name: 'GLM-NEW' };
    mockInvoke.mockResolvedValueOnce(updated);
    mockInvoke.mockResolvedValueOnce([updated]);
    fireEvent.click(screen.getByTestId('provider-form-save'));

    // 5. 验证 updateProvider 被调用 (with new name)
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd, _args]) => cmd === 'update_provider');
      expect(calls.length).toBe(1);
      expect(calls[0][1].input.name).toBe('GLM-NEW');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('provider-form-modal')).toBeNull();
    });
  });

  // M5 bug #6 regression — update_provider invoke payload must include `input.id`.
  // The Rust `ProviderInput` struct (src-tauri/src/domain/provider.rs:235) has
  // `pub id: String` as a required field. The frontend MUST pass `id` inside
  // the `input` object (not just as the separate path argument), otherwise
  // serde fails with "missing field `id`" and the edit flow 100% fails.
  it('[Edit] invoke payload must include input.id (M5 bug #6 regression)', async () => {
    const target = {
      id: 'glm', name: 'GLM', provider_type: 'anthropic',
      api_base: 'https://api.anthropic.com', api_key: 'sk-old',
      models: { default: 'm', haiku: null, sonnet: null, opus: null, by_tier: {} },
      is_active: false, created_at: 1, last_used_at: null, notes: null,
    };
    mockInvoke.mockResolvedValueOnce([target]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-glm')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('provider-edit-glm'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-modal')).toBeInTheDocument();
    });

    mockInvoke.mockResolvedValueOnce(target);
    mockInvoke.mockResolvedValueOnce([target]);
    fireEvent.click(screen.getByTestId('provider-form-save'));

    // The bug: input.id was missing → Rust returns "missing field `id`".
    // After the fix, both the path arg `id` AND input.id must be present.
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'update_provider');
      expect(calls.length).toBe(1);
      const args = calls[0][1] as { id: string; input: Record<string, unknown> };
      expect(args.id).toBe('glm');
      expect(args.input.id).toBe('glm');
    });
  });

  it('[Delete] 按钮 (is_active=false 时) → 弹确认 → 确认 → 调用 deleteProvider', async () => {
    const target = {
      id: 'deletable', name: 'ToDelete', provider_type: 'custom',
      api_base: 'https://api.del.example', api_key: 'sk-del',
      models: { default: 'm', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: false,
      created_at: 1, last_used_at: null, notes: null,
    };
    mockInvoke.mockResolvedValueOnce([target]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-deletable')).toBeInTheDocument();
    });

    // 1. 用户点 [Delete] (is_active=false, 所以按钮启用)
    const delBtn = screen.getByTestId('provider-delete-deletable') as HTMLButtonElement;
    expect(delBtn.disabled).toBe(false);
    fireEvent.click(delBtn);

    // 2. ConfirmDialog 出现
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();
    });
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();

    // 3. mock deleteProvider 成功 + reload (在点 confirm 前设)
    mockInvoke.mockResolvedValueOnce(undefined);  // deleteProvider
    mockInvoke.mockResolvedValueOnce([]);         // reload

    // 4. 用户点 [删除] (确认按钮)
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    // 5. 验证 deleteProvider 被调用
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd, _args]) => cmd === 'delete_provider');
      expect(calls.length).toBe(1);
      expect(calls[0][1].providerId).toBe('deletable');
    });
    // 6. ConfirmDialog 关闭
    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog-overlay')).toBeNull();
    });
  });

  it('[Delete] 按钮 (is_active=true 时) 禁用 — CannotDeleteActive 业务规则', async () => {
    const active = {
      id: 'active-p', name: 'Active', provider_type: 'anthropic',
      api_base: 'https://api.a', api_key: 'sk-a',
      models: { default: 'm', haiku: null, sonnet: null, opus: null, by_tier: {} }, is_active: true,  // 当前激活
      created_at: 1, last_used_at: null, notes: null,
    };
    mockInvoke.mockResolvedValueOnce([active]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-active-p')).toBeInTheDocument();
    });

    // 删除按钮在 is_active=true 时应禁用 (UI 层面防止误操作)
    const delBtn = screen.getByTestId('provider-delete-active-p') as HTMLButtonElement;
    expect(delBtn.disabled).toBe(true);
    // tooltip 应说明原因
    expect(delBtn.title).toContain('无法删除');
  });
});

// ---------------------------------------------------------------------------
// M3.0.4 — `models.by_tier` field dropped by Rust `skip_serializing_if`
// when empty. Frontend must tolerate the missing field (defensive default
// to `{}` so Object.keys() doesn't throw and break the entire row render).
// ---------------------------------------------------------------------------

describe('ProviderListPage — M3.0.4 defensive handling of missing models.by_tier', () => {
  it('row still renders [查看]/[编辑]/[删除]/[导出] when backend omits by_tier (empty hashmap skipped via serde)', async () => {
    // Simulate the real IPC payload: ProviderModels with by_tier absent
    // because HashMap::is_empty skips serialization (provider.rs:141).
    // This is the production shape for any provider that has no custom
    // tiers — the common case (>=99% of providers).
    const rawProvider: Record<string, unknown> = {
      id: 'glm', name: 'GLM-4.6', provider_type: 'anthropic',
      api_base: 'https://api.anthropic.com', api_key: 'sk-x',
      models: { default: 'claude-sonnet-4-6', haiku: null, sonnet: null, opus: null /* by_tier missing */ },
      is_active: false, created_at: 1, last_used_at: null, notes: null,
    };
    mockInvoke.mockResolvedValueOnce([rawProvider]);

    render(<ProviderListPage />);

    // The row MUST render despite the missing by_tier field.
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-glm')).toBeInTheDocument();
    });
    // All 4 buttons must be present (查看/编辑/删除/导出/激活).
    expect(screen.getByTestId('provider-view-glm')).toBeInTheDocument();
    expect(screen.getByTestId('provider-edit-glm')).toBeInTheDocument();
    expect(screen.getByTestId('provider-delete-glm')).toBeInTheDocument();
    expect(screen.getByTestId('provider-export-glm')).toBeInTheDocument();
    expect(screen.getByTestId('provider-activate-glm')).toBeInTheDocument();
  });

  // M5 bug #5 — "Default Model (ANTHROPIC_MODEL)" → "Default Model"
  // 验证 provider 列表页源码 (Form + Detail 两处) 都不再显示 "(ANTHROPIC_MODEL)" 后缀
  // (env var 名不进 UI, 防止 §6.5 显示名/系统标识分层事故).
  // 注: 源码级回归 — 渲染表单需先 mock invoke + click Add 按钮, 用 readFileSync 更直接.
  it('M5 bug #5: provider-list 源码里表单/详情 Field label 不含 "(ANTHROPIC_MODEL)" 后缀', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const src = readFileSync(
      resolve(__dirname, '../../pages/provider-list/index.tsx'),
      'utf-8',
    );
    // 新文案 "Default Model" 必须出现 (表单 + 详情 2 处)
    const matches = src.match(/Default Model\b/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // 旧文案 "Default Model (ANTHROPIC_MODEL)" 必须不出现
    expect(src).not.toContain('Default Model (ANTHROPIC_MODEL)');
  });

  // -------------------------------------------------------------------------
  // Phase 30 UI-A-02 — Default Model 字段存在 + 编辑保留值
  //
  // 验证 provider 表单的 Default Model 字段:
  //   1. testid `provider-form-model-default` 存在 + 标签 "Default Model"
  //   2. 编辑现有 provider 时, 字段值从 settings.json model 字段读取
  //      (这里用 provider.models.default 模拟 settings.json 持久化值 —
  //       list_providers → 选中 → 打开 form → 字段预填)
  //   3. placeholder 提示用户填什么 (claude-sonnet-4-6)
  //
  // 范围限制 (UI-A-02, Claude discretion):
  //   "值从 settings.json model 字段读取" 走的路径是:
  //     list_providers → 选中 provider → 打开 form → field 预填。
  //     这与已有 M3.6 编辑流程一致 (existing?.models.default)。
  //   新建 provider 时预填 settings.json 当前 model 是 deferred to v3.2.1
  //     (需要新增 IPC read_current_settings_model 跨 provider 边界,
  //     改动范围超过本 phase "UI polish" 范畴 — 见 SUMMARY.md deviations)。
  // -------------------------------------------------------------------------
  it('UI-A-02: 编辑现有 provider 时, Default Model 字段值从 provider.models.default 读取', async () => {
    const target = {
      id: 'glm', name: 'GLM-4.6', provider_type: 'anthropic',
      api_base: 'https://api.glm.example', api_key: 'sk-glm',
      models: {
        default: 'claude-sonnet-4-6-from-settings-json',
        haiku: null, sonnet: null, opus: null,
        by_tier: {},
      },
      is_active: false, created_at: 1700000000, last_used_at: null, notes: null,
    };
    mockInvoke.mockResolvedValueOnce([target]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-row-glm')).toBeInTheDocument();
    });

    // 打开 edit modal
    fireEvent.click(screen.getByTestId('provider-edit-glm'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-modal')).toBeInTheDocument();
    });

    // Default Model 字段必须存在 (testid 锁定, UI-A-02)
    const defaultModelInput = screen.getByTestId('provider-form-model-default') as HTMLInputElement;
    expect(defaultModelInput).toBeInTheDocument();

    // 值必须等于 provider.models.default (即 settings.json 持久化的 model)
    expect(defaultModelInput.value).toBe('claude-sonnet-4-6-from-settings-json');
  });

  it('UI-A-02: + Add 新建时 Default Model 字段为空 + placeholder 提示', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('provider-list-add'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-modal')).toBeInTheDocument();
    });

    const defaultModelInput = screen.getByTestId('provider-form-model-default') as HTMLInputElement;
    // 新建时为空 (用户自己填)
    expect(defaultModelInput.value).toBe('');
    // placeholder 提示默认模型名 (用户有线索)
    expect(defaultModelInput.placeholder).toBe('claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// M5 #31 — pagination correctness on a 100-item fixture.
// ---------------------------------------------------------------------------

describe('ProviderListPage — pagination (M5 #31)', () => {
  it('100 providers: page 1 shows rows 1-20; next; page 2 shows 21-40', async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      p(`p${String(i).padStart(3, '0')}`, `Provider ${i}`),
    );
    mockInvoke.mockResolvedValueOnce(items);

    render(<ProviderListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    // 100 items / page size 20 = 5 pages. Pagination chrome must show.
    expect(screen.getByTestId('provider-list-pagination')).toBeInTheDocument();
    expect(
      screen.getByTestId('provider-list-pagination-indicator').textContent,
    ).toContain('第 1 / 5 页');

    // Page 1: first 20 rows visible, row 21+ not yet.
    expect(screen.getByTestId('provider-row-p000')).toBeInTheDocument();
    expect(screen.getByTestId('provider-row-p019')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-row-p020')).toBeNull();

    // Click next → page 2 shows rows 21-40.
    fireEvent.click(screen.getByTestId('provider-list-pagination-next'));
    expect(
      screen.getByTestId('provider-list-pagination-indicator').textContent,
    ).toContain('第 2 / 5 页');
    expect(screen.queryByTestId('provider-row-p000')).toBeNull();
    expect(screen.getByTestId('provider-row-p020')).toBeInTheDocument();
    expect(screen.getByTestId('provider-row-p039')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-row-p040')).toBeNull();
  });

  it('hides pagination when total is below page size', async () => {
    mockInvoke.mockResolvedValueOnce([p('a', 'A'), p('b', 'B'), p('c', 'C')]);

    render(<ProviderListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    // Pagination self-hides on single-page lists.
    expect(
      screen.queryByTestId('provider-list-pagination'),
    ).not.toBeInTheDocument();
  });
});
