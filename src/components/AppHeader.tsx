/**
 * AppHeader — top toolbar with native window-drag region.
 *
 * Design rationale — why we replicate cc-switch's pattern:
 *
 *   Tauri on Windows + macOS lets a webview region opt into
 *   "this area drags the OS window" via the
 *   `data-tauri-drag-region` attribute (WebKit equivalent is the
 *   `-webkit-app-region: drag` CSS). Without it, the user can't
 *   drag the chrome-stripped window from the top of the app.
 *
 *   Layout follows cc-switch's two-zone header:
 *     [drag zone ............] [non-drag controls]
 *   The whole <header> is draggable. Inner buttons set
 *   `WebkitAppRegion: 'no-drag'` so they stay clickable.
 *
 *   M1.9 keeps the header lean: just a back button (when not on
 *   'home'), the current view title, a theme toggle, and a
 *   settings placeholder. Window min/max/close buttons are owned
 *   by the OS chrome via Tauri config (src-tauri/tauri.conf.json)
 *   — they don't render in the webview at all.
 */
import type { ReactElement } from 'react';
import { ArrowLeft, Settings } from 'lucide-react';
import type { ViewId } from '../hooks/useViewState';
import { HOME_VIEW } from '../hooks/useViewState';
import { WindowControls } from './WindowControls';

/**
 * dragRegionStyle — CSS that opts a node into "drag the OS window".
 *
 * Applied to the whole <header>. Every interactive child that
 * should *not* drag (buttons) must set `WebkitAppRegion: 'no-drag'`
 * locally — see AppHeader's button elements.
 *
 * The CSSProperties type doesn't include the non-standard
 * `-webkit-app-region` key, so we cast through `React.CSSProperties`
 * with an explicit index signature to suppress TS2353.
 */
const dragRegionStyle = {
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

/**
 * noDragStyle — applied to interactive controls inside the header
 * so the OS doesn't intercept their click events as drag gestures.
 */
const noDragStyle = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

export interface AppHeaderProps {
  currentView: ViewId;
  onNavigate: (view: ViewId) => void;
  /** Map view id → Chinese title for the header label. */
  pageTitle: (view: ViewId) => string;
}

export function AppHeader({
  currentView,
  onNavigate,
  pageTitle,
}: AppHeaderProps): ReactElement {
  const isHome = currentView === HOME_VIEW;

  return (
    <header
      data-tauri-drag-region=""
      data-testid="app-header"
      style={{
        ...dragRegionStyle,
        // M1.9.3: read the height from the --header-height token so
        // <main> in App.tsx can inset from the same source of truth.
        // Previously hardcoded to 48 here and a separate 48 reference
        // in App.tsx, which is a CLAUDE.md §4 violation (token
        // discipline: dimensions in tokens.css only).
        height: 'var(--header-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        // M1.9.2 liquid glass: translucent surface + backdrop blur
        // so the native Mica (Win11) / vibrancy (macOS) backdrop
        // shows through the header. The Webkit prefix is required
        // for Safari (macOS WKWebView) and the bare property
        // covers Chromium (WebView2 / Win11).
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--blur-md)) saturate(180%)',
        WebkitBackdropFilter: 'blur(var(--blur-md)) saturate(180%)',
        borderBottom: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
        flexShrink: 0,
      }}
    >
      {/* Left zone — back button + title.
          maxWidth caps the greedy flex so the title text can never
          push the chrome (right zone) off the right edge. The 280px
          reservation covers 5 buttons × 32 + 4 gaps × 4 + 32 padding
          × 2 ≈ 280 (theme + settings + 3 chrome + left/right pad).

          M2.15-fix-v2: Tailwind utility classes (`flex items-center
          gap-2` etc.) were being used here, but the project has no
          tailwind config wired up (no tailwind.config.js / postcss
          plugin / vite plugin), so the generated CSS bundle
          (dist/assets/index-*.css) contains ONLY design tokens + a
          handful of base rules — NO utility classes. The real exe
          silently fell back to `display: block`, the right zone
          buttons stacked vertically, and the chrome cluster blew
          past the 48px header height (theme at y=-40.4, close at
          y=55.6). Fix: inline the structural rules on the same
          element so they don't depend on Tailwind being present. */}
      <div
        style={{
          minWidth: 0,
          flex: '1 1 auto',
          maxWidth: 'calc(100% - 280px)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {!isHome && (
          <button
            type="button"
            onClick={() => onNavigate(HOME_VIEW)}
            data-testid="app-header-back"
            data-app-control-hover="true"
            aria-label="返回主页"
            title="返回主页"
            style={{
              ...noDragStyle,
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--border)',
              background: 'transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-primary)',
              transition: 'background-color 120ms ease',
            }}
          >
            <ArrowLeft size={16} style={{ color: 'var(--text-primary)' }} />
          </button>
        )}
        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: 'var(--fs-heading)',
            fontWeight: 600,
            // truncate equivalent: nowrap + overflow hidden + ellipsis.
            // Was `className="font-semibold truncate"` which relied
            // on Tailwind — not generated, see M2.15-fix-v2 note.
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {pageTitle(currentView)}
        </h1>
      </div>

      {/* Right zone — settings + window controls.
          All groups sit in the no-drag zone so the OS doesn't
          intercept their clicks as drag gestures.
          flexShrink: 0 keeps the chrome pinned to the right edge
          even when the left zone title is very long.

          M2.16 theme-trim: 主题切换按钮已删(单档 light 无需切换)。
          M2.15-fix-v2: `gap-1` Tailwind class was inert (no
          Tailwind pipeline) — buttons stacked vertically and the
          cluster extended past the 48px header height. Inlined
          `display: flex` + `gap: 4px` so the chrome cluster sits
          as a tight horizontal row, matching the spec. */}
      <div
        style={{
          ...noDragStyle,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <button
          type="button"
          data-testid="app-header-settings"
          data-app-control-hover="true"
          aria-label="设置"
          title="设置（前往关于页查看应用信息）"
          onClick={() => {
            // M3.2 polish — wire the settings entry to navigate to
            // the closest available view (about) until a dedicated
            // settings page ships. M3.7 ship-status shows no
            // settings plugin is in the registry yet.
            onNavigate('about');
          }}
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            background: 'transparent',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            transition: 'background-color 120ms ease',
          }}
        >
          <Settings size={16} style={{ color: 'var(--text-primary)' }} />
        </button>
        {/* Custom chrome (M1.9.2): OS native title bar is off
            (decorations:false + titleBarStyle:Overlay in
            tauri.conf.json) so we render our own min/max/close
            cluster on the far right. On macOS the OS still paints
            the traffic lights via the overlay style; the buttons
            remain visible and clickable as a backup. */}
        <WindowControls />
      </div>
      {/* Shared hover rules for the header's chrome buttons
          (back / settings / min / max / close).
          Tailwind would normally supply these via
          `hover:bg-black/5 dark:hover:bg-white/5` utility classes,
          but the project has no Tailwind pipeline (no
          tailwind.config.js / no PostCSS plugin in vite.config.ts)
          so the rules were never generated. Inlining a small
          `<style>` block here restores the cosmetic hover cue
          without touching the build pipeline. Scoping by data-*
          attributes prevents leakage to unrelated chrome in the
          rest of the app. */}
      <style>{`
        [data-app-control-hover] {
          transition: background-color 120ms ease, color 120ms ease;
        }
        [data-app-control-hover]:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }
        [data-app-close-hover]:hover {
          background-color: var(--danger);
          color: #fff;
        }
      `}</style>
    </header>
  );
}