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
 *   Task 8 (2026-06-27): macOS-style traffic-light cluster
 *   (red / yellow / green 12px dots, no inner icons, hover
 *   glyphs) replaces the previous Windows-style Win chrome
 *   cluster. The 3 dots now sit on the **topbar-left** so the
 *   app's own controls (back button + view title + theme toggle
 *   + settings) cluster on the right per macOS HIG. A new
 *   absolutely-positioned `.topbar-center` element pins the app
 *   product name ("ClaudeManager") to the titlebar centre.
 *   The 5-theme layout invariant (`data-header-layout="split"`
 *   + `justifyContent: space-between`) is preserved — the
 *   centre is layered over the split via `position: absolute`
 *   in base.css, so the regression guard
 *   "header-layout 5 主题统一 split / space-between" (Task 4
 *   fix) keeps passing.
 *
 *   M1.9 keeps the header lean: back button (when not on
 *   'home'), the current view title, a theme toggle, and a
 *   settings placeholder.
 */
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Settings, Sun, Sparkles, type LucideIcon } from 'lucide-react';
import type { ViewId } from '../hooks/useViewState';
import { HOME_VIEW } from '../hooks/useViewState';
import { WindowControls } from './WindowControls';
import { useTheme } from '../design-system/ThemeProvider';

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

  // v3.0 主题切换 — 循环到下一个主题, 切换时按钮旋转 360°
  const { theme, themes, setTheme } = useTheme();
  const themeIconMap: Record<string, LucideIcon> = { sun: Sun, sparkles: Sparkles };
  const ThemeIcon = themeIconMap[theme.icon] ?? Sun;
  const nextTheme = themes[(themes.findIndex((t) => t.id === theme.id) + 1) % themes.length];
  const themeToggleDisabled = themes.length <= 1;
  // 旋转动画状态 — 400ms 后清掉 spinning class, 让 .theme-toggle.spinning
  // (base.css) 的 @keyframes spin-once 生效一次
  const [themeSpinning, setThemeSpinning] = useState(false);
  const handleThemeToggle = () => {
    setTheme(nextTheme.id);
    setThemeSpinning(true);
    window.setTimeout(() => setThemeSpinning(false), 400);
  };

  return (
    <header
      className="titlebar"
      data-tauri-drag-region=""
      data-testid="app-header"
      data-header-layout="split"
      style={{
        ...dragRegionStyle,
        // 高度 + 布局: 留 inline; 背景/阴影/边框走 base.css
        height: 'var(--header-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
      }}
    >
      {/* Left zone — macOS traffic lights (Task 8) + back button + title.
          Task 8 (2026-06-27) moves the window controls cluster to
          the FAR LEFT (matching macOS HIG where red/yellow/green
          dots sit on the left edge of the title bar). The cluster
          is rendered first so the back button stays visually
          grouped with the title (which still lives in the same
          zone).
          maxWidth caps the greedy flex so the title text can never
          push the chrome (right zone) off the right edge.

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
          element so they don't depend on Tailwind being present.
          Title wrap uses maxWidth + 左对齐布局 (5 主题一致,
          与 SPEC 对齐)。*/}
      <div
        className="titlebar-title-wrap"
        style={{
          display: 'flex',
          alignItems: 'center',
          flex: '0 1 auto',
          maxWidth: 'calc(100% - 320px)',
          minWidth: 0,
          gap: 12,
        }}
      >
        {/* macOS 红黄绿圆点按钮 (Task 8) — 移到 topbar-left,
            按 macOS HIG: 红(关闭) → 黄(最小化) → 绿(最大化).
            整组 sit in no-drag zone (WindowControls 自身已加),
            不会被 header drag-region 截走 click event. */}
        <WindowControls />
      <div
        className="titlebar-title"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flexShrink: 1,
          background: 'var(--glass-bg)',
          WebkitBackdropFilter: 'blur(var(--blur-md)) saturate(160%)',
          backdropFilter: 'blur(var(--blur-md)) saturate(160%)',
        } as React.CSSProperties}
      >
        {!isHome && (
          <button
            type="button"
            className="back-btn"
            onClick={() => onNavigate(HOME_VIEW)}
            data-testid="app-header-back"
            data-app-control-hover="true"
            aria-label="返回主页"
            title="返回主页"
            style={{
              ...noDragStyle,
              width: '32px',
              height: '32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h1
          style={{
            // truncate: nowrap + overflow hidden + ellipsis
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {pageTitle(currentView)}
        </h1>
      </div>
      </div>

      {/* Topbar centre — Task 8 (2026-06-27) macOS-style app name
          overlay. Absolutely-positioned so it doesn't disturb the
          split-layout invariant (data-header-layout="split" +
          justifyContent: space-between) — both regression guards
          from Task 4 fix stay green. The product name is hard-
          coded to mirror PRODUCT_NAME in src-tauri/src/commands/
          app.rs::PRODUCT_NAME = "ClaudeManager"; the runtime
          source of truth is the Rust constant. CLAUDE.md §6.4
          三处同步 reminder: if this string ever changes, also
          update src/pages/about/index.tsx + the
          sampleMetadata() fixture in
          src/__tests__/pages/about.test.tsx + Rust PRODUCT_NAME
          + tauri.conf.json productName. */}
      <div
        className="topbar-center"
        data-testid="app-header-app-name"
        aria-hidden="true"
      >
        ClaudeManager
      </div>

      {/* Right zone — settings + window controls.
          All groups sit in the no-drag zone so the OS doesn't
          intercept their clicks as drag gestures.
          flexShrink: 0 keeps the chrome pinned to the right edge
          even when the left zone title is very long.

          v3.0-base: outer wrapper now carries className="actions"
          so base.css `.titlebar .actions button` can layer theme-
          specific sizes/borders across all 5 registered themes.
          M2.15-fix-v2: `gap-1` Tailwind class was inert (no
          Tailwind pipeline) — buttons stacked vertically and the
          cluster extended past the 48px header height. Inlined
          `display: flex` + `gap: 4px` so the chrome cluster sits
          as a tight horizontal row, matching the spec. */}
      <div
        className="actions"
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
          className={`theme-toggle${themeSpinning ? ' spinning' : ''}`}
          data-testid="app-header-theme-toggle"
          data-app-control-hover="true"
          aria-label="切换主题"
          title={`切换到 ${nextTheme.name} 主题`}
          disabled={themeToggleDisabled}
          onClick={handleThemeToggle}
          style={{
            ...noDragStyle,
            cursor: themeToggleDisabled ? 'not-allowed' : 'pointer',
            opacity: themeToggleDisabled ? 0.4 : 1,
          }}
        >
          <ThemeIcon size={16} />
        </button>
        <button
          type="button"
          data-testid="app-header-settings"
          data-app-control-hover="true"
          aria-label="设置"
          title="设置（前往关于页查看应用信息）"
          onClick={() => {
            onNavigate('about');
          }}
          style={noDragStyle}
        >
          <Settings size={16} />
        </button>
        {/* WindowControls 已在 Task 8 移到 topbar-left (红黄绿圆点按钮),
            跟 macOS HIG 一致. 这里不再渲染. */}
      </div>
    </header>
  );
}