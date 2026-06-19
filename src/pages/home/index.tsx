/**
 * HomeView — landing tile shown when there's no persisted last view,
 * or when the user explicitly clicks the "home" sidebar entry.
 *
 * In M1.9 the home tile is a small dashboard that links to each
 * plugin slot. In M2+ it'll grow into the real "first-run" entry
 * point with a "create your first provider" CTA + drag-import
 * drop zone (see SPEC §4.1 cold start journey).
 */
import type { ReactElement } from 'react';
import type { ViewId } from '../hooks/useViewState';
import { ALL_VIEWS, HOME_VIEW } from '../../hooks/useViewState';
import { cn } from '../../lib/utils';

export interface HomeViewProps {
  onNavigate: (view: ViewId) => void;
  /** The ViewId → Chinese title map, used to label the cards. */
  pageTitle: (view: ViewId) => string;
}

const PLUGIN_VIEWS: ViewId[] = ALL_VIEWS.filter((v) => v !== HOME_VIEW);

export function HomeView({ onNavigate, pageTitle }: HomeViewProps): ReactElement {
  return (
    <div
      className="h-full overflow-auto p-8"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <h1
          className="font-semibold mb-2"
          style={{
            color: 'var(--text-primary)',
            fontSize: '20px',
          }}
        >
          欢迎使用 Claude 配置管理器
        </h1>
        <p
          className="mb-6"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-body)',
          }}
        >
          M1 架构期 — 12 个功能模块已注册为 stub,业务实现将在 M2+ 替换。
          点击下方任意卡片进入对应功能页。
        </p>
        <ul
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          }}
        >
          {PLUGIN_VIEWS.map((view) => (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                data-testid={`home-tile-${view}`}
                className={cn(
                  'w-full text-left p-4 transition-shadow',
                  'hover:shadow-md focus:outline-none focus:ring-2',
                )}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-card)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div
                  className="font-semibold mb-1"
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: 'var(--fs-body)',
                  }}
                >
                  {pageTitle(view)}
                </div>
                <code
                  className="font-mono"
                  style={{
                    color: 'var(--accent)',
                    fontSize: 'var(--fs-caption)',
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
