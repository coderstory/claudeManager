/**
 * HomeView — M3.10 (清单 23) project switcher landing page.
 *
 * Replaces the M1.9 plain tile grid with a "user / project"
 * dual-mode hub: a dropdown of all known projects, an
 * "active project" callout, an [新增项目] button, and a per-row
 * [删除] button (greyed out for the system project).
 *
 * Layout (top → bottom):
 *   1. Title + tagline
 *   2. Active project callout (name + root_dir + is_system badge)
 *   3. Project list table:
 *        - each row: name / root_dir / [切换] / [删除]
 *        - system row: [删除] disabled with title="用户级不可删除"
 *   4. [新增项目] button — opens the in-page form (name + root_dir)
 *
 * Why a single component (vs split into ProjectCard + ProjectList):
 *   - This page is M3.10-arch's primary deliverable for the
 *     frontend; keeping it monolithic makes the visual contract
 *     obvious in one file.
 *   - Splitting it would mean importing a Form + Table from
 *     `/components` — those don't exist yet (the project's M2.x
 *     pages all inline their markup).
 */
import type { ReactElement, ChangeEvent } from 'react';
import { useState, useRef } from 'react';
import { useProjects } from '../../hooks/useProjects';
import type { ViewId } from '../../hooks/useViewState';

/** M3.13.4 — pure-frontend path validation result. */
interface PathValidation {
  valid: boolean;
  reason: string | null;
}

/**
 * Optional navigation props kept for compatibility with App.tsx's
 * existing `<HomeView onNavigate={...} pageTitle={...} />` call
 * site. M3.10-arch doesn't navigate between views via tiles
 * anymore (the welcome page IS the project switcher), but we keep
 * the props optional so App.tsx doesn't need to special-case
 * `view === 'home'`.
 */
export interface HomeViewProps {
  onNavigate?: (next: ViewId) => void;
  pageTitle?: (view: ViewId) => string;
}

export function HomeView(_props: HomeViewProps = {}): ReactElement {
  const {
    projects,
    currentProject,
    loading,
    error,
    reload,
    add,
    remove,
    switchTo,
  } = useProjects();

  const [adding, setAdding] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newRoot, setNewRoot] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // M3.13.4 — project picker (HTML5 file input) + frontend path validation.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pathValidation, setPathValidation] = useState<PathValidation | null>(null);

  const handlePickRoot = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0] as File & { webkitRelativePath?: string };
      // webkitRelativePath looks like "projects/foo" — the first segment is the
      // picked directory name. Frontend-only picker (no Rust side change needed).
      const dirName = firstFile.webkitRelativePath?.split('/')[0] ?? '';
      setNewRoot(dirName);
      handleValidateRoot();
    }
  };

  const handleValidateRoot = (): void => {
    const trimmed = newRoot.trim();
    if (!trimmed) {
      setPathValidation(null);
      return;
    }
    // Pure-frontend validation — avoid new Rust command (CLAUDE.md §2.3 dep lock).
    if (trimmed.includes('..')) {
      setPathValidation({ valid: false, reason: '路径不能包含 ..' });
      return;
    }
    if (trimmed.length < 3) {
      setPathValidation({ valid: false, reason: '路径过短' });
      return;
    }
    if (!/^[A-Za-z]:[\\/]/.test(trimmed) && !trimmed.startsWith('/')) {
      setPathValidation({
        valid: false,
        reason: '必须是绝对路径（D:/... 或 /Users/...）',
      });
      return;
    }
    setPathValidation({ valid: true, reason: null });
  };

  const handleSwitch = async (id: string): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await switchTo(id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`确定要删除项目「${name}」吗？此操作不可撤销。`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await remove(id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Note (M3.10-arch): we deliberately do NOT depend on
  // `@tauri-apps/plugin-dialog` here. CLAUDE.md §2.3 locks the npm
  // dep list — adding `plugin-dialog` requires a main-session
  // approval. Instead, the user pastes / types the root_dir path
  // into the input. Future M3.11+ polish can add a native picker
  // once the dep is approved.
  const handleAdd = async (): Promise<void> => {
    if (!newName.trim() || !newRoot.trim()) {
      setActionError('项目名和根目录不能为空');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await add(newName.trim(), newRoot.trim());
      setNewName('');
      setNewRoot('');
      setAdding(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

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
            fontSize: 20,
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
          选择当前生效的项目 — 所有 plugin (Provider / MCP / 备份 / 优化器) 都会读取该项目的
          <code style={{ marginLeft: 4, marginRight: 4 }}>.claude/</code>
          配置。
        </p>

        {(error || actionError) && (
          <div
            data-testid="welcome-error"
            style={{
              padding: 12,
              marginBottom: 16,
              border: '1px solid var(--danger, #D32F2F)',
              borderRadius: 6,
              background: 'var(--bg-overlay)',
              color: 'var(--danger, #D32F2F)',
              fontSize: 'var(--fs-body)',
            }}
          >
            {error || actionError}
          </div>
        )}

        {/* Active project callout */}
        <section
          data-testid="active-project"
          style={{
            padding: 16,
            marginBottom: 24,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-caption)',
              marginBottom: 4,
            }}
          >
            当前激活项目
          </div>
          <div
            style={{
              color: 'var(--text-primary)',
              fontSize: 'var(--fs-body)',
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {currentProject ? currentProject.name : '(加载中)'}
            {currentProject?.is_system && (
              <span
                style={{
                  marginLeft: 8,
                  padding: '2px 8px',
                  fontSize: 'var(--fs-caption)',
                  color: 'var(--accent)',
                  background: 'var(--bg-overlay)',
                  borderRadius: 4,
                }}
              >
                用户级
              </span>
            )}
          </div>
          <div
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-caption)',
            }}
          >
            {currentProject?.root_dir ?? ''}
          </div>
        </section>

        {/* Project list */}
        <section style={{ marginBottom: 24 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2
              style={{
                color: 'var(--text-primary)',
                fontSize: 16,
                fontWeight: 600,
                margin: 0,
              }}
            >
              项目列表（{projects.length}）
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-testid="refresh-projects"
                onClick={() => void reload()}
                disabled={busy || loading}
                style={{
                  padding: '6px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-button)',
                  cursor: busy || loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                刷新
              </button>
              <button
                type="button"
                data-testid="add-project-toggle"
                onClick={() => setAdding((v) => !v)}
                disabled={busy}
                style={{
                  padding: '6px 12px',
                  background: 'var(--accent)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {adding ? '取消' : '+ 新增项目'}
              </button>
            </div>
          </div>

          {loading && projects.length === 0 && (
            <div
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body)',
                padding: 16,
              }}
            >
              加载中...
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body)',
                padding: 16,
                border: '1px dashed var(--border)',
                borderRadius: 6,
                textAlign: 'center',
              }}
            >
              暂无项目。点击 [新增项目] 添加，或检查系统级项目是否被删除。
            </div>
          )}

          {projects.length > 0 && (
            <table
              data-testid="project-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)',
                overflow: 'hidden',
              }}
            >
              <thead>
                <tr style={{ background: 'var(--bg-overlay)' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: 8,
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--fs-caption)',
                    }}
                  >
                    项目名
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: 8,
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--fs-caption)',
                    }}
                  >
                    根目录
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: 8,
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--fs-caption)',
                    }}
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const isActive = p.id === currentProject?.id;
                  return (
                    <tr
                      key={p.id}
                      data-testid={`project-row-${p.id}`}
                      style={{
                        background: isActive ? 'var(--bg-overlay)' : 'transparent',
                      }}
                    >
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--fs-body)',
                        }}
                      >
                        {p.name}
                        {p.is_system && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 'var(--fs-caption)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            (系统)
                          </span>
                        )}
                        {isActive && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 'var(--fs-caption)',
                              color: 'var(--accent)',
                              fontWeight: 600,
                            }}
                          >
                            ● 当前
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--fs-caption)',
                        }}
                      >
                        {p.root_dir}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid var(--border)',
                          textAlign: 'right',
                        }}
                      >
                        <button
                          type="button"
                          data-testid={`switch-${p.id}`}
                          onClick={() => void handleSwitch(p.id)}
                          disabled={busy || isActive}
                          style={{
                            marginRight: 8,
                            padding: '4px 10px',
                            background: 'var(--accent)',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: 'var(--radius-button)',
                            cursor: busy || isActive ? 'not-allowed' : 'pointer',
                            opacity: isActive ? 0.5 : 1,
                            fontFamily: 'inherit',
                          }}
                        >
                          {isActive ? '当前' : '切换'}
                        </button>
                        <button
                          type="button"
                          data-testid={`remove-${p.id}`}
                          onClick={() => void handleRemove(p.id, p.name)}
                          disabled={busy || p.is_system}
                          title={p.is_system ? '用户级项目不可删除' : '删除此项目'}
                          style={{
                            padding: '4px 10px',
                            background: 'var(--bg-elevated)',
                            color: p.is_system ? 'var(--text-muted)' : 'var(--danger, #D32F2F)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-button)',
                            cursor: busy || p.is_system ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Add project form */}
        {adding && (
          <section
            data-testid="add-project-form"
            style={{
              padding: 16,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: 16,
                fontWeight: 600,
                marginTop: 0,
                marginBottom: 12,
              }}
            >
              新增项目
            </h3>
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor="new-project-name"
                style={{
                  display: 'block',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-caption)',
                  marginBottom: 4,
                }}
              >
                项目名（≤ 64 字符）
              </label>
              <input
                id="new-project-name"
                type="text"
                data-testid="new-project-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={64}
                placeholder="我的项目 A"
                style={{
                  width: '100%',
                  padding: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-button)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--fs-body)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor="new-project-root"
                style={{
                  display: 'block',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-caption)',
                  marginBottom: 4,
                }}
              >
                项目根目录（须含 .claude/ 子目录）
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="new-project-root"
                  type="text"
                  data-testid="new-project-root"
                  value={newRoot}
                  onChange={(e) => setNewRoot(e.target.value)}
                  onBlur={handleValidateRoot}
                  placeholder="D:/projects/foo"
                  style={{
                    flex: 1,
                    padding: 8,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-button)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-caption)',
                  }}
                />
                <button
                  type="button"
                  data-testid="pick-root-button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-overlay)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-button)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 'var(--fs-caption)',
                  }}
                >
                  浏览…
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  data-testid="pick-root-input"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...({ webkitdirectory: '', directory: '' } as any)}
                  multiple
                  style={{ display: 'none' }}
                  onChange={handlePickRoot}
                />
              </div>
              {pathValidation && (
                <div
                  data-testid="path-validation-hint"
                  style={{
                    marginTop: 4,
                    fontSize: 'var(--fs-caption)',
                    color: pathValidation.valid
                      ? 'var(--success, #388E3C)'
                      : 'var(--danger, #D32F2F)',
                  }}
                >
                  {pathValidation.valid
                    ? '✓ 路径合法'
                    : `✗ ${pathValidation.reason ?? '路径无效'}`}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewName('');
                  setNewRoot('');
                  setActionError(null);
                }}
                disabled={busy}
                style={{
                  padding: '6px 14px',
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-button)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="confirm-add-project"
                onClick={() => void handleAdd()}
                disabled={busy || !newName.trim() || !newRoot.trim()}
                style={{
                  padding: '6px 14px',
                  background: 'var(--accent)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  cursor: busy || !newName.trim() || !newRoot.trim()
                    ? 'not-allowed'
                    : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                添加
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default HomeView;