/**
 * AppSidebar — vertical navigation rail.
 *
 * Renders one button per ViewId in ALL_VIEWS. The currently active
 * tile is highlighted with the accent-coloured left border (the
 * same 2px-blue-bar cue SPEC §5.3 uses for the active provider
 * card — visual consistency across the app).
 *
 * Sidebar is INTENTIONALLY not draggable (no data-tauri-drag-region
 * attribute) so its buttons stay clickable and the user can't
 * accidentally drag the window by grabbing the rail.
 *
 * Layout:
 *   - fixed-ish width (220px) so the sidebar feels like a
 *     navigation rail, not a burger menu.
 *   - one tile per ViewId, including 'home'.
 *   - icon comes from lucide-react (consistent stroke + size).
 *   - the icon is a stand-in for the eventual per-plugin glyph —
 *     we don't want to invent fake icons for every plugin in M1.
 */
import type { ReactElement } from 'react';
import {
  Archive,
  Boxes,
  Database,
  FileSearch,
  Gauge,
  Home,
  KeyRound,
  Layers,
  Link2,
  Package,
  PencilLine,
  Rocket,
  Store,
  Wand2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  ALL_VIEWS,
  type ViewId,
} from '../hooks/useViewState';

/**
 * sidebarWidth — kept as a constant so App.tsx can mirror it on the
 * main pane (e.g. when computing AnimatePresence offsets).
 */
export const SIDEBAR_WIDTH = 220;

/** Map each ViewId → lucide icon component + Chinese subtitle. */
const VIEW_META: Record<
  ViewId,
  { icon: ReactElement; short: string }
> = {
  home: {
    icon: <Home size={18} aria-hidden="true" />,
    short: '欢迎页',
  },
  'provider-list': {
    icon: <Layers size={18} aria-hidden="true" />,
    short: 'Provider 列表',
  },
  'provider-switch': {
    icon: <KeyRound size={18} aria-hidden="true" />,
    short: 'Provider 切换',
  },
  'import-sql': {
    icon: <Database size={18} aria-hidden="true" />,
    short: '.sql 导入',
  },
  'deeplink-import': {
    icon: <Link2 size={18} aria-hidden="true" />,
    short: 'Deeplink 导入',
  },
  'json-editor': {
    icon: <PencilLine size={18} aria-hidden="true" />,
    short: 'JSON 编辑器',
  },
  'mcp-management': {
    icon: <Boxes size={18} aria-hidden="true" />,
    short: 'MCP 管理',
  },
  'usage-query': {
    icon: <Gauge size={18} aria-hidden="true" />,
    short: '用量查询',
  },
  'single-file-deploy': {
    icon: <Rocket size={18} aria-hidden="true" />,
    short: '单文件部署',
  },
  'resource-browser': {
    icon: <FileSearch size={18} aria-hidden="true" />,
    short: '资源浏览',
  },
  marketplace: {
    icon: <Store size={18} aria-hidden="true" />,
    short: '资源市场',
  },
  optimizer: {
    icon: <Wand2 size={18} aria-hidden="true" />,
    short: '配置优化',
  },
  'backup-restore': {
    icon: <Archive size={18} aria-hidden="true" />,
    short: '备份与恢复',
  },
};

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
      aria-label="主导航"
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg-elevated)',
        borderRight: '1px solid var(--border)',
        padding: '8px 0',
      }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ALL_VIEWS.map((view) => {
          const meta = VIEW_META[view];
          const isActive = currentView === view;
          return (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                data-testid={`sidebar-item-${view}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-2 transition-colors',
                  'hover:bg-black/5 dark:hover:bg-white/5',
                )}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 16px',
                    border: 'none',
                    borderLeft: isActive
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    background: isActive
                      ? 'var(--bg-overlay)'
                      : 'transparent',
                    color: isActive
                      ? 'var(--accent)'
                      : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 'var(--fs-body)',
                    textAlign: 'left',
                  }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {meta.icon}
                </span>
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>{meta.short}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer hint — small build-tag so M1.9 is recognisable in
          screenshots. Stays inside the sidebar so it doesn't compete
          with the page header. */}
      <div
        style={{
          marginTop: 16,
          padding: '8px 16px',
          fontSize: 'var(--fs-caption)',
          color: 'var(--text-muted)',
        }}
      >
        <Package
          size={12}
          aria-hidden="true"
          style={{ verticalAlign: 'middle', marginRight: 4 }}
        />
        M1.9 · 架构期
      </div>
    </nav>
  );
}