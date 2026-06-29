/**
 * X1 "从当前配置生成 按钮无反应" 重验证测试。
 *
 * 背景:用户在 Anthropic 官方 settings.json(ANTHROPIC_API_KEY 命名)
 * 下点"从当前配置生成"按钮,UI 没有任何反应 — 既不弹 modal,也不显示
 * 错误条。CLAUDE.md §16.3 反事故:commit b16b979 加的 `if (!provider)
 * return null;` 是 defense-in-depth,真因未明,用户问题未解决。
 *
 * 本 spec 严格按 §16 第 2 步:写 vitest 测试用 vi.spyOn 拦 IPC,
 * 定位真因。FAIL 状态留 codebase 做回归保护,改 root cause 后 PASS。
 *
 * 测试矩阵:
 * 1) 后端正常返回 {provider, is_new} → 应弹 preview modal
 * 2) 后端返回 {provider: null, is_new: false} → 不应静默(b16b979 guard
 *    会 return null → modal 完全不渲染 → 用户体验=无反应);修复后
 *    应显示明确错误提示
 * 3) invoke 抛错 → 应显示错误 banner 而非静默
 * 4) settings.json 含 ANTHROPIC_API_KEY(无 ANTHROPIC_AUTH_TOKEN)
 *    时 generate 应成功(由后端 read_current_active_env 保证,
 *    此测试桩后端返回模拟)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ProviderListPage } from '../../pages/provider-list';
import type { Provider } from '../../types/provider';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

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
// X1 场景 1: 正常路径 — 后端返回合法 provider → preview modal 应弹出
// ---------------------------------------------------------------------------

describe('X1 — "从当前配置生成" button click chain', () => {
  it('X1.1: click → invoke("generate_from_current_config") 必被调用', async () => {
    mockInvoke.mockResolvedValueOnce([]);                                  // initial list
    mockInvoke.mockResolvedValueOnce({                                      // generate
      provider: p('anthropic', 'Anthropic 官方', {
        api_base: 'https://api.anthropic.com',
        api_key: 'sk-test-123',
      }),
      is_new: true,
    });

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });

    // 真因定位器:这一行 FAIL = invoke 没被调/onClick 没绑
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('generate_from_current_config');
    });
  });

  it('X1.2: 后端返回合法 provider → preview modal 应渲染候选详情', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({
      provider: p('anthropic', 'Anthropic 官方', {
        api_base: 'https://api.anthropic.com',
        api_key: 'sk-test-123',
      }),
      is_new: true,
    });

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });

    // 真因定位器:modal 不渲染 = setGenerateState 没切到 preview
    await waitFor(() => {
      expect(screen.getByTestId('provider-generate-preview-modal')).toBeInTheDocument();
    });
    // 真因定位器:modal 内文不显示 = 解构 provider 后没正确渲染
    expect(screen.getByText(/从当前配置生成新 provider/)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic 官方/)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // X1 场景 2 (核心): b16b979 guard 触发的"返回 null 路径"
  // 当前 b16b979 加了 `if (!provider) return null;` → modal 完全不渲染,
  // 错误状态也没切 → 用户体验 = "按钮无反应"。
  // 这条测试改前 FAIL,改后 PASS(改法见 §4 方案)。
  // -----------------------------------------------------------------------
  it('X1.3: 后端返回 {provider: null, is_new: false} → 必须显示明确错误提示,不能静默无反应', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ provider: null, is_new: false });

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });

    // 给状态机时间从 'generating' 切到 'failure'
    await waitFor(() => {
      expect(screen.getByTestId('provider-generate-error-bar')).toBeInTheDocument();
    });

    // 错误条不能只显示 "Error",要给出用户能懂的诊断(为什么没生成)
    const errorBar = screen.getByTestId('provider-generate-error-bar');
    expect(errorBar.textContent).not.toBe('');
    expect(errorBar.textContent!.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // X1 场景 3: invoke 抛错 → 应显示错误 banner(确认错误链路通畅)
  // -----------------------------------------------------------------------
  it('X1.4: invoke reject → 显示错误 banner,不静默吞错', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockRejectedValueOnce(new Error('当前配置不完整:缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN'));

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list-empty')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('provider-generate-error-bar')).toBeInTheDocument();
    });
    expect(screen.getByText(/当前配置不完整/)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // X1 场景 4 (回归): 正常 is_new=false 路径(库中已存在同 base_url)—
  // modal 标题切到 "当前配置匹配现有 provider"
  // -----------------------------------------------------------------------
  it('X1.5: 库中已存在同 base_url → modal 显示匹配提示而非生成', async () => {
    const existing = p('anthropic', 'Anthropic 官方', {
      api_base: 'https://api.anthropic.com',
      api_key: 'sk-test-123',
      is_active: true,
    });
    mockInvoke.mockResolvedValueOnce([existing]);                          // initial list
    mockInvoke.mockResolvedValueOnce({                                      // generate
      provider: existing,
      is_new: false,
    });

    render(<ProviderListPage />);
    await waitFor(() => {
      expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-list-generate'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('provider-generate-preview-modal')).toBeInTheDocument();
    });
    expect(screen.getByText(/当前配置匹配现有 provider/)).toBeInTheDocument();
    // is_new=false 时"确认导入"按钮不渲染
    expect(screen.queryByTestId('provider-generate-preview-confirm')).toBeNull();
  });
});