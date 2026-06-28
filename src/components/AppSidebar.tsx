/**
 * AppSidebar — vertical navigation rail.
 *
 * Renders one button per ViewId in ALL_VIEWS_ORDERED. The currently
 * active tile is highlighted with the accent-coloured left border
 * (the same 2px-blue-bar cue SPEC §5.3 uses for the active provider
 * card — visual consistency across the app).
 *
 * Sidebar is INTENTIONALLY not draggable (no data-tauri-drag-region
 * attribute) so its buttons stay clickable and the user can't
 * accidentally drag the window by grabbing the rail.
 *
 * Layout:
 *   - fixed-ish width (var(--sidebar-width) = 220px) so the
 *     sidebar feels like a navigation rail, not a burger menu.
 *   - one tile per ViewId, including 'home'.
 *   - icon comes from VIEW_META (lucide-react component, consistent
 *     stroke + size).
 *   - the icon is a stand-in for the eventual per-plugin glyph —
 *     we don't want to invent fake icons for every plugin in M1.
 *
 * M1.9.3: the previously exported `SIDEBAR_WIDTH = 220` constant
 * has been removed. The single source of truth is now
 * `--sidebar-width` in tokens.css (CLAUDE.md §4: token discipline).
 * <main> in App.tsx reads the same token for its `left: var(...)`
 * inset, so resizing the rail only requires editing one line.
 *
 * Phase 44 派生收敛:本文件不再 hardcode 12 项 VIEW_META Record,改
 * import 自 `src/plugins/registry`;顺序走 `ALL_VIEWS_ORDERED`(字段
 * 驱动,Q44-1)。icon 渲染:`const Icon = meta.icon; <Icon size={18} />`。
 */
import type { ReactElement } from 'react';
import { Package } from 'lucide-react';
import { ALL_VIEWS_ORDERED, VIEW_META } from '../plugins/registry';
import type { ViewId } from '../plugins/registry';
import { SidebarProjectSwitcher } from './SidebarProjectSwitcher';

export interface AppSidebarProps {
  currentView: ViewId;
  onNavigate: (view: ViewId) => void;
}

export function AppSidebar({
  currentView,
  onNavigate,
}: AppSidebarProps): ReactElement {
  return (
    <nav
      data-testid="app-sidebar"
      className="sidebar"
      aria-label="主导航"
      style={{
        overflowY: 'auto',
        minHeight: 0,
        WebkitAppRegion: 'drag',
        background: 'var(--glass-bg)',
        WebkitBackdropFilter: 'blur(var(--blur-md)) saturate(160%)',
        backdropFilter: 'blur(var(--blur-md)) saturate(160%)',
      } as React.CSSProperties}
    >
      {/* Phase 11 SC #7 — Sidebar top project switcher.
          Shows the active project name + a dropdown to switch to
          another project. Reuses useProjects() so state stays in
          sync with HomeView (no second fetch path). */}
      <SidebarProjectSwitcher
        onSwitchNavigate={() => onNavigate('home')}
      />
      <ul>
        {ALL_VIEWS_ORDERED.map((view) => {
          const meta = VIEW_META[view];
          const isActive = currentView === view;
          // Phase 44: icon is a LucideIcon component (not ReactElement).
          //   const Icon = meta.icon;
          //   return <Icon size={18} />;
          const Icon = meta.icon;
          return (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                data-testid={`sidebar-item-${view}`}
                aria-current={isActive ? 'page' : undefined}
                data-app-sidebar-hover="true"
                className={isActive ? 'nav-item active' : 'nav-item'}
                style={{
                  // macOS sidebar nav item: 单独 no-drag, 不被父 drag 吞 click
                  WebkitAppRegion: 'no-drag',
                } as React.CSSProperties}
              >
                <span className="nav-item-icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="nav-item-label">{meta.short}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer hint — small build-tag so M1.9 is recognisable in
          screenshots. Stays inside the sidebar so it doesn't compete
          with the page header. */}
      <div
        className="sidebar-footer"
        style={{
          // macOS: footer 不该 drag
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <Package
          size={12}
          aria-hidden="true"
          style={{ verticalAlign: 'middle', marginRight: 4 }}
        />
        {/* M3.13.2 — 用户要求:侧边栏底部 brand 从 "钱云飞作品" 改为
            "©CoderStory 2026"。 */}
        ©CoderStory 2026
      </div>
    </nav>
  );
}