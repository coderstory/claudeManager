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
 *
 * M2.x-inline: previously used `cn(...)` to compose Tailwind utility
 * classes (`flex flex-col items-center justify-center h-full p-8
 * text-center`). The project has no Tailwind pipeline (no
 * tailwind.config.js / no PostCSS plugin), so those classes were
 * silently noop'd by the real Tauri WebView2 release exe. All
 * structural rules are now inlined as `style={{}}` properties and
 * the `cn()` import is gone. Callers that need to override the
 * layout can still pass a `style` prop instead of a `className`
 * (see PluginPlaceholderProps below).
 */
import type { CSSProperties, ReactElement } from 'react';
import { Construction } from 'lucide-react';

export interface PluginPlaceholderProps {
  /** The kebab-case plugin id, e.g. "mcp-management". */
  pluginId: string;
  /** The human-readable Chinese title shown at the top. */
  title: string;
  /** Optional one-liner describing what the page will do in M2+. */
  description?: string;
  /** Optional inline style override for callers that need a tweak. */
  style?: CSSProperties;
}

const DEFAULT_DESCRIPTION = '该功能将在 M2+ 阶段开发。';

export function PluginPlaceholder({
  pluginId,
  title,
  description = DEFAULT_DESCRIPTION,
  style,
}: PluginPlaceholderProps): ReactElement {
  return (
    <div
      data-plugin-id={pluginId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 'var(--space-6)',
        textAlign: 'center',
        // M1.9.2 liquid glass: the placeholder card uses the
        // stronger glass tier so it reads as a distinct surface
        // against the (now also-glass) header + sidebar rail.
        // Tighter blur (sm) because the card is a smaller surface
        // — md would over-blur and visually disappear.
        background: 'var(--glass-bg-strong)',
        backdropFilter: 'blur(var(--blur-sm)) saturate(160%)',
        WebkitBackdropFilter: 'blur(var(--blur-sm)) saturate(160%)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
        borderRadius: 'var(--radius-card)',
        margin: '24px',
        ...style,
      }}
    >
      <Construction
        size={48}
        aria-hidden="true"
        style={{ color: 'var(--text-muted)', marginBottom: 16 }}
      />
      <h1
        style={{
          color: 'var(--text-primary)',
          fontSize: 'var(--fs-heading)',
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-body)',
          marginBottom: 4,
        }}
      >
        {description}
      </p>
      <code
        style={{
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-caption)',
          background: 'var(--bg-elevated)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          marginTop: 8,
        }}
      >
        plugin: {pluginId}
      </code>
    </div>
  );
}
