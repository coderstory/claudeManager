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
import { ArrowLeft, Moon, Monitor, Settings, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme } from '../design-system/ThemeProvider';
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
  // M2.10 F12 polish — use cycleTheme() from the provider instead
  // of recomputing the light→dark→auto ternary inline (which used
  // to live here). Centralising it means future controls (settings
  // page dropdown, etc.) share one definition of the order.
  const { theme, cycleTheme } = useTheme();
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
          × 2 ≈ 280 (theme + settings + 3 chrome + left/right pad). */}
      <div
        className="flex items-center gap-2"
        style={{ minWidth: 0, flex: '1 1 auto', maxWidth: 'calc(100% - 280px)' }}
      >
        {!isHome && (
          <button
            type="button"
            onClick={() => onNavigate(HOME_VIEW)}
            data-testid="app-header-back"
            aria-label="返回主页"
            title="返回主页"
            className={cn(
              'flex items-center justify-center',
              'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
            )}
            style={{
              ...noDragStyle,
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--border)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={16} style={{ color: 'var(--text-primary)' }} />
          </button>
        )}
        <h1
          className="font-semibold truncate"
          style={{
            color: 'var(--text-primary)',
            fontSize: 'var(--fs-heading)',
          }}
        >
          {pageTitle(currentView)}
        </h1>
      </div>

      {/* Right zone — theme + settings + window controls.
          All three groups sit in the no-drag zone so the OS
          doesn't intercept their clicks as drag gestures.
          flexShrink: 0 keeps the chrome pinned to the right
          edge even when the left zone title is very long. */}
      <div
        className="flex items-center gap-1"
        style={{ ...noDragStyle, flexShrink: 0 }}
      >
        <button
          type="button"
          onClick={() => {
            // M2.10 F12 polish — delegate to ThemeProvider's
            // cycleTheme so the order lives in one place. The
            // aria-label + title still surface the current state
            // so screen-reader users hear "切换到 X" instead of
            // an opaque "toggle theme".
            cycleTheme();
          }}
          data-testid="app-header-theme-toggle"
          aria-label={
            theme === 'light' ? '切换到深色主题' :
            theme === 'dark' ? '切换到自动模式' :
            '切换到浅色主题'
          }
          title={
            theme === 'light' ? '切换到深色' :
            theme === 'dark' ? '切换到自动' :
            '切换到浅色'
          }
          className={cn(
            'flex items-center justify-center',
            'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
          )}
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          {theme === 'dark' ? (
            <Sun size={16} style={{ color: 'var(--text-primary)' }} />
          ) : theme === 'auto' ? (
            <Monitor size={16} style={{ color: 'var(--text-primary)' }} />
          ) : (
            <Moon size={16} style={{ color: 'var(--text-primary)' }} />
          )}
        </button>
        <button
          type="button"
          data-testid="app-header-settings"
          aria-label="设置"
          title="设置（M2+ 实现）"
          className={cn(
            'flex items-center justify-center',
            'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
          )}
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            background: 'transparent',
            cursor: 'pointer',
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
    </header>
  );
}