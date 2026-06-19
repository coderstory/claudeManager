/**
 * PluginPlaceholder — shared "this lands in M2+" tile.
 *
 * Why this is a component (and not inline JSX in every page file):
 *   - All 12 plugin pages must render identically — same icon, same
 *     typography, same token usage. Centralising means we cannot
 *     accidentally drift one tile's spacing.
 *   - The lucide `Construction` icon is the visual cue that the
 *     page is a placeholder. If we ever add a "click to track" or
 *     "feedback on this view" button, it lives here and propagates.
 *
 * Design tokens (CLAUDE.md §4.2 + §4.4):
 *   - Background, text colour, radius all come from CSS variables
 *     defined in src/design-system/tokens.css.
 *   - The `cn` util from src/lib/utils collapses any Tailwind
 *     conflicts so callers can override padding etc. cleanly.
 */
import type { ReactElement } from 'react';
import { Construction } from 'lucide-react';
import { cn } from '../lib/utils';

export interface PluginPlaceholderProps {
  /** The kebab-case plugin id, e.g. "mcp-management". */
  pluginId: string;
  /** The human-readable Chinese title shown at the top. */
  title: string;
  /** Optional one-liner describing what the page will do in M2+. */
  description?: string;
  /** Optional className merged via `cn` for layout overrides. */
  className?: string;
}

const DEFAULT_DESCRIPTION = '该功能将在 M2+ 阶段开发。';

export function PluginPlaceholder({
  pluginId,
  title,
  description = DEFAULT_DESCRIPTION,
  className,
}: PluginPlaceholderProps): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full p-8 text-center',
        className,
      )}
      data-plugin-id={pluginId}
    >
      <Construction
        size={48}
        aria-hidden="true"
        className="mb-4"
        style={{ color: 'var(--text-muted)' }}
      />
      <h1
        className="font-semibold mb-2"
        style={{
          color: 'var(--text-primary)',
          fontSize: 'var(--fs-heading)',
        }}
      >
        {title}
      </h1>
      <p
        className="mb-1"
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-body)',
        }}
      >
        {description}
      </p>
      <code
        className="font-mono mt-2"
        style={{
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-caption)',
          background: 'var(--bg-elevated)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--border)',
        }}
      >
        plugin: {pluginId}
      </code>
    </div>
  );
}
