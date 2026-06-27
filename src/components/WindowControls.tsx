/**
 * WindowControls — min/max/close chrome buttons (M1.9.2).
 *
 * Why this is a dedicated component (not inline in AppHeader):
 *   - The 3 chrome buttons are owned by OS-level concepts
 *     (minimize / toggleMaximize / close), not by the app's
 *     domain. Keeping them isolated means future "hide close
 *     button" / "always-minimize-to-tray" preferences (M2+)
 *     live in one place.
 *   - Tauri window APIs are async — the click handler must
 *     be safe to call repeatedly (the OS will just no-op
 *     duplicates). The component swallows any thrown error
 *     and surfaces it to console.error rather than crashing
 *     the React tree (CLAUDE.md §7: no silent error eating
 *     — but also no crashes for cosmetic chrome).
 *
 * Layout — Windows-style right-anchored cluster:
 *   [  ̄  ] [ □ ] [ × ]
 *   minimize / maximize / close
 *
 * - All three sit in the header's no-drag zone (set by AppHeader
 *   on the wrapping <div>) so clicks aren't intercepted as
 *   drag gestures by Tauri's data-tauri-drag-region handler.
 * - Close button uses --danger on hover (Windows convention).
 * - On macOS the OS still owns the chrome, so Tauri renders
 *   its native traffic lights separately — we leave these
 *   buttons visible (M1.9.2 ships consistent UI on both
 *   platforms; the OS-level traffic lights are hidden in
 *   tauri.conf.json by the titleBarStyle + decorations pair
 *   applied in M1.9.2).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * noDragStyle — applied to the wrapping cluster so the Tauri
 * drag region on the parent <header> doesn't intercept these
 * button clicks. Mirrors the same shape AppHeader uses for
 * its other interactive children.
 */
const noDragStyle = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

// baseButtonStyle 删除 (M3.0.1 inline-fix): 改用 className="chrome-btn",
// 样式由 base.css `.titlebar .chrome-btn` 接管, 主题维度调优由各主题
// 自行覆盖。

async function safeCall(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    // CLAUDE.md §7: never silent. Surface to console so the
    // dev-tools webview inspector sees it; the user gets no
    // modal because the chrome is cosmetic (closing / min /
    // max all have OS fallbacks).
    console.error('[WindowControls] Tauri window op failed:', err);
  }
}

function MinimizeButton(): ReactElement {
  return (
    <button
      type="button"
      className="chrome-btn"
      data-testid="app-header-minimize"
      data-app-control-hover="true"
      aria-label="最小化窗口"
      title="最小化"
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
      className="chrome-btn"
      data-testid="app-header-maximize"
      data-app-control-hover="true"
      aria-label="最大化窗口"
      title="最大化 / 还原"
      onClick={() => {
        void safeCall(() => getCurrentWindow().toggleMaximize());
      }}
    >
      <Maximize2 size={16} aria-hidden="true" />
    </button>
  );
}

function CloseButton(): ReactElement {
  // M3.0.2: close-app is the most dangerous OS-level action
  // (CLAUDE.md §7 — destructive ops need explicit confirmation).
  // Wraps the bare getCurrentWindow().close() in a themed ConfirmDialog
  // so the user gets one last chance to back out.
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  return (
    <>
      <button
        type="button"
        className="chrome-btn close"
        data-testid="app-header-close"
        aria-label="关闭窗口"
        title="关闭"
        data-app-close-hover="true"
        onClick={() => setShowConfirm(true)}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <ConfirmDialog
        open={showConfirm}
        title="关闭应用"
        message="所有未保存的更改将丢失。确定要关闭吗?"
        confirmLabel="关闭"
        danger
        onConfirm={() => {
          setShowConfirm(false);
          Promise.resolve(getCurrentWindow().close()).catch((err) => {
            console.error('[WindowControls] close() failed:', err);
            throw err;
          });
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}

export function WindowControls(): ReactElement {
  // M2.15-fix-v2: project has no Tailwind pipeline (see AppHeader
  // note), so the cluster wrapper's `flex items-center gap-1` class
  // was inert — buttons stacked vertically and the cluster extended
  // to 96px tall (way past the 48px header). Inlined the same flex
  // + gap on the cluster so it sits as a tight horizontal row at
  // 32px tall. The hover/transition rules are co-located in
  // AppHeader's <style> tag (data-app-control-hover /
  // data-app-close-hover) so all chrome buttons share one rule set.
  return (
    <div
      data-testid="app-header-window-controls"
      // The whole cluster sits in the no-drag zone of the parent
      // <header>. Keeping them grouped in one flex row also lets
      // us add a "always-on-top" or "minimize-to-tray" button in
      // M2+ without re-architecting AppHeader.
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
