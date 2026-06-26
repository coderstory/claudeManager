/**
 * SidebarProjectSwitcher — compact project switcher for the sidebar (Phase 11 SC #7).
 *
 * Why a separate component (vs. reusing HomeView's switcher):
 *   - HomeView owns the "manage projects" UX: list + add modal + remove buttons.
 *     That's too heavy for a 220px-wide sidebar rail.
 *   - The sidebar only needs: current project name + a quick dropdown to switch.
 *     A separate compact component keeps both views focused.
 *
 * Reuse over reinvention (CLAUDE.md §2.3):
 *   - Same Tauri command (`switch_project`) via `useProjects().switchTo`.
 *   - Same `useProjects()` hook → same reload path → no second fetch source.
 *   - Same `projects` + `currentProject` data shape.
 *
 * Layout (220px-wide sidebar rail):
 *   ┌──────────────────────────┐
 *   │ 当前项目 ▼              │  ← button shows current project name
 *   │ ┌──────────────────────┐ │
 *   │ │ ● proj-A   (active)  │ │  ← dropdown panel (absolute positioned)
 *   │ │   proj-B             │ │
 *   │ │   proj-C             │ │
 *   │ └──────────────────────┘ │
 *   └──────────────────────────┘
 *
 * Edge cases:
 *   - `projects.length === 0` → render a small "暂无项目" hint that links to
 *     the home page where the user can create one.
 *   - `currentProject === null && !loading` → fall back to "未选择" + show
 *     the first available project as a hint.
 *   - `loading` → render a muted "加载中…" placeholder.
 *   - `error` → keep the previous label visible (no crash); the home page
 *     has the full error callout.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { SYSTEM_PROJECT_ID } from '../types/project';

export interface SidebarProjectSwitcherProps {
  /**
   * Optional: when the user picks a different project, we navigate to
   * the home page so they can see the new active callout. The sidebar
   * itself doesn't need to navigate (the switch is global), but going
   * to home makes the change visible in the project's main UI surface.
   */
  onSwitchNavigate?: () => void;
}

export function SidebarProjectSwitcher({
  onSwitchNavigate,
}: SidebarProjectSwitcherProps = {}): ReactElement {
  const {
    projects,
    currentProject,
    loading,
    error,
    switchTo,
  } = useProjects();
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown on outside click (standard popover pattern).
  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent): void => {
      const target = e.target;
      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const handleSelect = async (id: string): Promise<void> => {
    if (id === currentProject?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await switchTo(id);
      setOpen(false);
      if (onSwitchNavigate) onSwitchNavigate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Display label priority: current project name > "未选择" > "加载中…"
  const label = loading
    ? '加载中…'
    : currentProject
      ? currentProject.name
      : projects.length > 0
        ? '未选择项目'
        : '暂无项目';

  const disabled = busy || projects.length === 0;

  return (
    <div
      ref={containerRef}
      data-testid="sidebar-project-switcher"
      data-loading={loading ? 'true' : 'false'}
      data-error={actionError || error ? 'true' : 'false'}
      style={{
        position: 'relative',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-soft)',
        flexShrink: 0,
        // macOS sidebar: dropdown trigger should NOT drag the window.
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          color: 'var(--text-muted)',
          fontSize: 11,
          marginBottom: 4,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        当前项目
      </div>
      <button
        type="button"
        data-testid="sidebar-project-switcher-toggle"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换项目"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          fontFamily: 'inherit',
          textAlign: 'left',
          minWidth: 0,
        }}
      >
        <Folder size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
          }}
        />
      </button>
      {currentProject?.is_system && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          用户级（不可删除）
        </div>
      )}

      {open && projects.length > 0 && (
        <ul
          data-testid="sidebar-project-switcher-menu"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 12,
            right: 12,
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 50,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {projects.map((p) => {
            const isActive = p.id === currentProject?.id;
            const isSystem = p.id === SYSTEM_PROJECT_ID;
            return (
              <li key={p.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  data-testid={`sidebar-switch-to-${p.id}`}
                  onClick={() => void handleSelect(p.id)}
                  disabled={busy}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    border: 'none',
                    borderRadius: 'var(--radius-button)',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}
                    {isSystem && (
                      <span
                        style={{
                          marginLeft: 6,
                          color: 'var(--text-muted)',
                          fontWeight: 400,
                        }}
                      >
                        (系统)
                      </span>
                    )}
                  </span>
                  {isActive && (
                    <span
                      style={{
                        color: 'var(--accent)',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      ●
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(actionError || error) && (
        <div
          data-testid="sidebar-project-switcher-error"
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--danger, #D32F2F)',
            wordBreak: 'break-word',
          }}
        >
          {actionError || error}
        </div>
      )}
    </div>
  );
}

export default SidebarProjectSwitcher;
