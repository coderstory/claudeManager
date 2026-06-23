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
 *   - fixed-ish width (var(--sidebar-width) = 220px) so the
 *     sidebar feels like a navigation rail, not a burger menu.
 *   - one tile per ViewId, including 'home'.
 *   - icon comes from lucide-react (consistent stroke + size).
 *   - the icon is a stand-in for the eventual per-plugin glyph —
 *     we don't want to invent fake icons for every plugin in M1.
 *
 * M1.9.3: the previously exported `SIDEBAR_WIDTH = 220` constant
 * has been removed. The single source of truth is now
 * `--sidebar-width` in tokens.css (CLAUDE.md §4: token discipline).
 * <main> in App.tsx reads the same token for its `left: var(...)`
 * inset, so resizing the rail only requires editing one line.
 */
import type { ReactElement } from 'react';
import {
  Archive,
  Boxes,
  Database,
  FileSearch,
  Gauge,
  History,
  Home,
  Info,
  KeyRound,
  Layers,
  Link2,
  Package,
  PencilLine,
  Rocket,
  Store,
  Wand2,
} from 'lucide-react';
import {
  ALL_VIEWS,
  type ViewId,
} from '../hooks/useViewState';

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
    // M3.9 — 清单 2: 菜单/页面命名 P1 修复: ".sql 导入" → "SQL导入配置"
    short: 'SQL导入配置',
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
  // M4.6 / Phase 21-C — F21 history query page (SQLite).
  history: {
    icon: <History size={18} aria-hidden="true" />,
    short: '历史查询',
  },
  // M3.7 — 清单 18: 关于页(版本 / build hash / 许可证 / 致谢)。
  // 加在 ALL_VIEWS 末尾,不替换 D-槽1 sidebar 顶部 project switcher。
  about: {
    icon: <Info size={18} aria-hidden="true" />,
    short: '关于',
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
      className="sidebar"
      aria-label="主导航"
      style={{
        // M1.9.3: width comes from --sidebar-width token (single
        // source of truth shared with <main>'s left: var(...) inset).
        // v3.0-base: width/overflowY/height also live in
        // src/design-system/base.css under the .sidebar rule.
        // We still inline overflowY/minHeight/flexShrink so the
        // M1.9.2 + M1.9.1-fix integration tests (which read
        // getComputedStyle without injecting base.css) still see
        // the scroll contract — base.css layers theme tweaks on
        // top via the `.sidebar` className.
        flexShrink: 0,
        minHeight: 0,
        overflowY: 'auto',
        // M1.9.2 liquid glass: same token family as AppHeader so
        // the rail visually belongs to the same layer. The right
        // border is glass (translucent) rather than the opaque
        // --border so the divider picks up the backdrop tint.
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--blur-md)) saturate(180%)',
        WebkitBackdropFilter: 'blur(var(--blur-md)) saturate(180%)',
        borderRight: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
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
                data-app-sidebar-hover="true"
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
                    // hover transition lives in src/design-system/utilities.css
                    // under [data-app-sidebar-hover] — see M2.x-inline.
                    flexShrink: 0,
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
        {/* M3.13.2 — 用户要求:侧边栏底部 brand 从 "钱云飞作品" 改为
            "©CoderStory 2026"。 */}
        ©CoderStory 2026
      </div>
    </nav>
  );
}