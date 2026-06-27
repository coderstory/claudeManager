/**
 * WindowControls — min/max/close chrome buttons (Windows 风格, M1.9.2 重设计).
 *
 * ## 历史
 *   - M1.9.2 (commit e5b0d92): 引入 Windows 风格 minimize/maximize/close
 *     (lucide-react Minus / Maximize2 / X + 32x32 矩形按钮 + --radius-button).
 *   - Task 8 (commit 8eb85da): 改成 macOS 风格红黄绿圆点 (12px, no icon).
 *   - M4.8 重设计: 用户要求改回 Windows 风格 (lucide icons + 矩形).
 *
 * ## Drag-region contract
 *   - 坐在 AppHeader 的 no-drag zone (wrapping <div> 上有 WebkitAppRegion: 'no-drag'),
 *     Tauri drag region 不会拦截这些 button click.
 */
import type { ReactElement } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const noDragStyle = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

const BUTTON_SIZE = 32;

const baseButtonStyle: React.CSSProperties = {
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  borderRadius: 'var(--radius-button)',
  color: 'var(--text-primary)',
  transition: 'background-color 120ms ease, color 120ms ease',
};

async function safeCall(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    // CLAUDE.md §7: 永不静默. log 到 console.error.
    console.error('[WindowControls] Tauri window op failed:', err);
  }
}

function MinimizeButton(): ReactElement {
  return (
    <button
      type="button"
      data-testid="app-header-minimize"
      aria-label="最小化窗口"
      title="最小化"
      className="chrome-btn-hover"
      style={baseButtonStyle}
      onClick={() => {
        void safeCall(() => getCurrentWindow().minimize());
      }}
    >
      <Minus size={16} aria-hidden="true" />
    </button>
  );
}

function MaximizeButton(): ReactElement {
  return (
    <button
      type="button"
      data-testid="app-header-maximize"
      aria-label="最大化窗口"
      title="最大化 / 还原"
      className="chrome-btn-hover"
      style={baseButtonStyle}
      onClick={() => {
        void safeCall(() => getCurrentWindow().toggleMaximize());
      }}
    >
      <Maximize2 size={16} aria-hidden="true" />
    </button>
  );
}

function CloseButton(): ReactElement {
  return (
    <button
      type="button"
      data-testid="app-header-close"
      aria-label="关闭窗口"
      title="关闭"
      className="chrome-btn-hover chrome-btn-close"
      style={baseButtonStyle}
      onClick={() => {
        void safeCall(() => getCurrentWindow().close());
      }}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}

export function WindowControls(): ReactElement {
  return (
    <div
      data-testid="app-header-window-controls"
      className="window-controls"
      style={{
        ...noDragStyle,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <MinimizeButton />
      <MaximizeButton />
      <CloseButton />
    </div>
  );
}
