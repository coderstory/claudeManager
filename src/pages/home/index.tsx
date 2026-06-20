/**
 * HomeView — landing tile shown when there's no persisted last view,
 * or when the user explicitly clicks the "home" sidebar entry.
 *
 * In M1.9 the home tile is a small dashboard that links to each
 * plugin slot. In M2+ it'll grow into the real "first-run" entry
 * point with a "create your first provider" CTA + drag-import
 * drop zone (see SPEC §4.1 cold start journey).
 *
 * M2.x-inline: previously used `cn(...)` to compose Tailwind utility
 * classes (`grid gap-3`, `w-full text-left p-4 transition-shadow`,
 * `hover:shadow-md focus:outline-none focus:ring-2`, etc). The
 * project has no Tailwind pipeline, so those classes silently
 * noop'd on the real Tauri WebView2 release exe. All structural
 * rules are now inlined as `style={{}}` properties and the
 * hover/focus rules live in src/design-system/utilities.css under
 * the [data-app-home-tile] selector.
 */
import type { ReactElement } from 'react';
import type { ViewId } from '../../hooks/useViewState';
import { ALL_VIEWS, HOME_VIEW } from '../../hooks/useViewState';

export interface HomeViewProps {
  onNavigate: (view: ViewId) => void;
  /** The ViewId → Chinese title map, used to label the cards. */
  pageTitle: (view: ViewId) => string;
}

const PLUGIN_VIEWS: ViewId[] = ALL_VIEWS.filter((v) => v !== HOME_VIEW);

export function HomeView({ onNavigate, pageTitle }: HomeViewProps): ReactElement {
  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 32,
        background: 'var(--bg-primary)',
      }}
    >
      <div style={{ maxWidth: 896, marginLeft: 'auto', marginRight: 'auto' }}>
        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: '20px',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          欢迎使用 Claude 配置管理器
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-body)',
            marginBottom: 24,
          }}
        >
          M1 架构期 — 12 个功能模块已注册为 stub,业务实现将在 M2+ 替换。
          点击下方任意卡片进入对应功能页。
        </p>
        <ul
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {PLUGIN_VIEWS.map((view) => (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                data-testid={`home-tile-${view}`}
                // M2.x-inline: hover/focus rules live in
                // src/design-system/utilities.css under
                // [data-app-home-tile].
                data-app-home-tile="true"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: 16,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-card)',
                  boxShadow: 'var(--shadow-sm)',
                  fontFamily: 'inherit',
                }}
              >
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: 'var(--fs-body)',
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {pageTitle(view)}
                </div>
                <code
                  style={{
                    color: 'var(--accent)',
                    fontSize: 'var(--fs-caption)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {view}
                </code>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default HomeView;
