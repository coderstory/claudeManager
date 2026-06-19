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
import { ArrowLeft, Moon, Settings, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme } from '../design-system/ThemeProvider';
import type { ViewId } from '../hooks/useViewState';
import { HOME_VIEW } from '../hooks/useViewState';

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
  const { theme, setTheme } = useTheme();
  const isHome = currentView === HOME_VIEW;

  return (
    <header
      data-tauri-drag-region=""
      data-testid="app-header"
      style={{
        ...dragRegionStyle,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* Left zone — back button + title */}
      <div
        className="flex items-center gap-2"
        style={{ minWidth: 0, flex: '1 1 auto' }}
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

      {/* Right zone — theme toggle + settings (no-drag so clicks work) */}
      <div className="flex items-center gap-2" style={noDragStyle}>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          data-testid="app-header-theme-toggle"
          aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
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
      </div>
    </header>
  );
}