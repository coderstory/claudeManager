/**
 * WindowControls — min/max/close chrome buttons (Task 8 redesign).
 *
 * ## Why this is a dedicated component (not inline in AppHeader)
 *   - The 3 chrome buttons are owned by OS-level concepts
 *     (minimize / toggleMaximize / close), not by the app's
 *     domain. Keeping them isolated means future "hide close
 *     button" / "always-minimize-to-tray" preferences (M2+)
 *     live in one place.
 *   - Tauri window APIs are async — the click handler must
 *     be safe to call repeatedly (the OS will just no-op
 *     duplicates). The component swallows any thrown error
 *     and surfaces it to console.error rather than crashing
 *     the React tree (CLAUDE.md §7).
 *
 * ## Visual redesign (Task 8, 2026-06-27)
 *   - macOS-style traffic lights: red / yellow / green dots,
 *     12px diameter, no inner icons. Hover reveals the
 *     action glyph (× / − / +) per the macOS HIG.
 *   - Replaces the M1.9.2 Windows-style "Minimize / Maximize /
 *     Close" icon cluster. macOS aesthetics now win on every
 *     platform (matching SPEC.md §5.1 conceptual direction
 *     + Task 8 brief: "macOS 红黄绿圆点").
 *   - CSS lives in `base.css` under `.window-controls` /
 *     `.wc-btn` and `.topbar-center` (the AppHeader pins
 *     the cluster to the topbar-left).
 *   - Theme overrides live in `tokens.css` under
 *     `[data-theme="dark"] .wc-btn.*` (glow) and
 *     `[data-theme="editorial"] .wc-btn.*` (brutalist).
 *   - The pixel theme deliberately does NOT get a per-button
 *     override; the dots render as colored squares (border-
 *     radius: 0 in pixel) courtesy of the existing `.wc-btn`
 *     shape rules.
 *
 * ## Drag-region contract
 *   - Sits in AppHeader's no-drag zone (`WebkitAppRegion: 'no-drag'`
 *     on the wrapping <div>) so clicks aren't intercepted as
 *     drag gestures by Tauri's data-tauri-drag-region handler.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
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
      className="wc-btn min"
      data-testid="app-header-minimize"
      data-app-control-hover="true"
      aria-label="最小化窗口"
      title="最小化"
      onClick={() => {
        void safeCall(() => getCurrentWindow().minimize());
      }}
    />
  );
}

function MaximizeButton(): ReactElement {
  return (
    <button
      type="button"
      className="wc-btn max"
      data-testid="app-header-maximize"
      data-app-control-hover="true"
      aria-label="最大化窗口"
      title="最大化 / 还原"
      onClick={() => {
        void safeCall(() => getCurrentWindow().toggleMaximize());
      }}
    />
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
        className="wc-btn close"
        data-testid="app-header-close"
        aria-label="关闭窗口"
        title="关闭"
        data-app-close-hover="true"
        onClick={() => setShowConfirm(true)}
      />
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
  // Task 8: macOS-style cluster — three 12px dots, 8px gap,
  // no background panel (dots float over the titlebar).
  return (
    <div
      data-testid="app-header-window-controls"
      className="window-controls"
      style={{
        ...noDragStyle,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <CloseButton />
      <MinimizeButton />
      <MaximizeButton />
    </div>
  );
}