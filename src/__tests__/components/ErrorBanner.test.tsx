/**
 * ErrorBanner — 单元测试 (M2.16 F15)
 *
 * 覆盖:
 *   1. 4 种 kind 都正确渲染对应图标 + 文案。
 *   2. 默认 kind = 'error'。
 *   3. onDismiss 渲染 ✕ 按钮 + 点击触发。
 *   4. 不传 onDismiss → 不渲染 ✕。
 *   5. autoDismissMs=2000 时,2s 后自动调用 onDismiss。
 *   6. 长路径 / 长 message 不会溢出 (wordBreak 样式存在)。
 *   7. 边界: message 为空字符串仍渲染容器 (有 data-testid)。
 *
 * 写法参考 QuickSearchModal.test.tsx:
 *   - 不 mock lucide-react,直接渲染 (testid + role 即可定位)。
 *   - vi.useFakeTimers() 控制 autoDismiss 时间。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { ErrorBanner } from '../../components/ErrorBanner';

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ErrorBanner — kinds', () => {
  it('default kind is error', () => {
    render(<ErrorBanner message="出错了" />);
    const el = screen.getByTestId('error-banner-error');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('data-banner-kind', 'error');
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveTextContent('出错了');
  });

  it('renders error kind with alert role', () => {
    render(<ErrorBanner kind="error" message="disk full" />);
    const el = screen.getByTestId('error-banner-error');
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveAttribute('data-banner-kind', 'error');
  });

  it('renders warning kind with alert role', () => {
    render(<ErrorBanner kind="warning" message="配置过期" />);
    const el = screen.getByTestId('error-banner-warning');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveAttribute('data-banner-kind', 'warning');
    expect(el).toHaveTextContent('配置过期');
  });

  it('renders info kind with status role', () => {
    render(<ErrorBanner kind="info" message="提示一下" />);
    const el = screen.getByTestId('error-banner-info');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('data-banner-kind', 'info');
  });

  it('renders success kind with status role', () => {
    render(<ErrorBanner kind="success" message="操作成功" />);
    const el = screen.getByTestId('error-banner-success');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('data-banner-kind', 'success');
    expect(el).toHaveTextContent('操作成功');
  });

  it('uses testId override when provided', () => {
    render(
      <ErrorBanner
        kind="error"
        message="custom"
        testId="my-special-banner"
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('my-special-banner')).toBeInTheDocument();
    expect(screen.getByTestId('my-special-banner-dismiss')).toBeInTheDocument();
  });
});

describe('ErrorBanner — dismiss', () => {
  it('does NOT render dismiss button when onDismiss is not provided', () => {
    render(<ErrorBanner message="no dismiss" />);
    // 只有默认 testid 的容器,没有 dismiss 按钮。
    expect(screen.queryByTestId('error-banner-error-dismiss')).toBeNull();
  });

  it('renders dismiss button when onDismiss is provided, and clicking it fires', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner kind="error" message="x" onDismiss={onDismiss} />);
    const dismissBtn = screen.getByTestId('error-banner-error-dismiss');
    expect(dismissBtn).toBeInTheDocument();
    expect(dismissBtn).toHaveAttribute('aria-label', '关闭提示');
    act(() => {
      dismissBtn.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBanner — autoDismiss', () => {
  it('does NOT auto-dismiss when onDismiss is not provided', () => {
    vi.useFakeTimers();
    // 即使传 autoDismissMs,没有 onDismiss 也不会自动消失 (no setState to fire)。
    render(<ErrorBanner message="static" autoDismissMs={1000} />);
    // 推进时间,容器仍在。
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('error-banner-error')).toBeInTheDocument();
  });

  it('does NOT auto-dismiss when autoDismissMs is not provided', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ErrorBanner message="static" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('auto-fires onDismiss after autoDismissMs', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ErrorBanner
        kind="success"
        message="saved"
        onDismiss={onDismiss}
        autoDismissMs={2000}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears pending timer when component unmounts before autoDismiss fires', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <ErrorBanner
        message="bye"
        onDismiss={onDismiss}
        autoDismissMs={2000}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    unmount();
    // 推进到原本该 fire 的时间 — 由于卸载,timer 被清,onDismiss 不应被调。
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // M2.16 — H4: 父组件 inline 传新 onDismiss(每次 render 新引用)时,
  // 老实现 timer 会重置(永不 fire),新实现用 ref 保持 timer 稳定。
  it('autoDismiss timer survives parent re-renders with new onDismiss ref', () => {
    vi.useFakeTimers();
    let dismissCount = 0;
    // Wrapper 模拟"父组件 inline 传新 onDismiss"。注意 message
    // 故意保持稳定 —— message/kind/autoDismissMs 变才会真正重置 timer
    // (这是期望行为);只有 onDismiss 引用变不应该重置。
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function Parent({ tick: _tick }: { tick: number }): ReactElement {
      return (
        <ErrorBanner
          message="stable"
          // 每次 render 新引用 —— 老实现会因此重置 timer。
          onDismiss={() => {
            dismissCount += 1;
          }}
          autoDismissMs={2000}
        />
      );
    }
    const { rerender } = render(<Parent tick={0} />);
    // 1s 后,父组件因其他 state 变重渲,onDismiss 引用变了。
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(<Parent tick={1} />);
    // 再 1s,刚好到 2s — 应 fire 1 次(老实现会因 onDismiss 引用变
    // 清掉旧 timer + 起新 timer,这里永远 fire 不了)。
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dismissCount).toBe(1);
  });
});

describe('ErrorBanner — layout & boundaries', () => {
  it('renders container even when message is empty', () => {
    const { container } = render(<ErrorBanner message="" />);
    expect(screen.getByTestId('error-banner-error')).toBeInTheDocument();
    // message span 存在但是空的。
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('');
  });

  it('long path / long message wordBreaks instead of overflowing', () => {
    const long =
      'C:\\Users\\somebody\\AppData\\Roaming\\ClaudeConfigManager\\providers\\work-anthropic.json (file not found)';
    const { container } = render(<ErrorBanner kind="error" message={long} />);
    // 内层 span 用了 wordBreak: 'break-word',断言内联 style 包含 break-word。
    const inner = container.querySelector('span');
    expect(inner).not.toBeNull();
    const styleAttr = (inner as HTMLElement).style.wordBreak;
    expect(styleAttr).toBe('break-word');
    // 容器持有原 message。
    expect(screen.getByTestId('error-banner-error').textContent).toContain(
      'work-anthropic.json',
    );
  });

  it('forwards className and style to root container', () => {
    render(
      <ErrorBanner
        message="styled"
        className="extra-class"
        style={{ marginBottom: 24 }}
      />,
    );
    const el = screen.getByTestId('error-banner-error');
    expect(el.className).toContain('extra-class');
    expect((el as HTMLElement).style.marginBottom).toBe('24px');
  });

  it('applies kind-specific background + color', () => {
    const { rerender } = render(<ErrorBanner kind="error" message="x" />);
    let el = screen.getByTestId('error-banner-error');
    expect((el as HTMLElement).style.background).toBe('rgba(211, 47, 47, 0.08)');
    expect((el as HTMLElement).style.color).toBe('var(--danger)');

    rerender(<ErrorBanner kind="success" message="x" />);
    el = screen.getByTestId('error-banner-success');
    expect((el as HTMLElement).style.background).toBe('rgba(56, 142, 60, 0.08)');
    expect((el as HTMLElement).style.color).toBe('var(--success)');

    rerender(<ErrorBanner kind="warning" message="x" />);
    el = screen.getByTestId('error-banner-warning');
    expect((el as HTMLElement).style.color).toBe('var(--warning)');

    rerender(<ErrorBanner kind="info" message="x" />);
    el = screen.getByTestId('error-banner-info');
    expect((el as HTMLElement).style.color).toBe('var(--accent)');
  });
});
