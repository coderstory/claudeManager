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
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useProjects } from '../../hooks/useProjects';
import type { ProjectSummary } from '../../types/project';
import type { ViewId } from '../../hooks/useViewState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { pickProjectRoot, validateProjectPath } from '../../lib/api/projects';

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

  // M5 #3 — modal mode flag. The user requested 新增项目 render as
  // a modal dialog (Esc to close, click overlay to dismiss) instead
  // of an inline form below the project list. `modalOpen` is the
  // single source of truth for the dialog's open/closed state.
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newRoot, setNewRoot] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // M3.0.2 — themed confirmation dialog state for the destructive
  // "delete project" action. Stores the full row so the dialog title
  // can show the project name without a second fetch.
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  // M3.13.4 — project picker uses native Tauri dialog (pickProjectRoot)
  // to get an ABSOLUTE path. The previous webkitRelativePath-based HTML5
  // picker returned only the basename (e.g. "Documents"), which failed
  // Rust's `validate_root` (NotAbsolute). See A3 fix below.
  const [pathValidation, setPathValidation] = useState<PathValidation | null>(null);

  const handlePickRoot = async (): Promise<void> => {
    // Native folder picker — wraps `tauri-plugin-dialog::pick_folder` on
    // the Rust side (see `commands::project::pick_project_root_dir`).
    // Returns the absolute path (e.g. `/Users/foo/projects`) or null
    // if the user cancelled.
    const picked = await pickProjectRoot();
    if (!picked) return; // user cancelled — leave form unchanged
    setNewRoot(picked);
    // Auto-fill name from the last path segment if user hasn't typed one
    // yet (matches A7 fix from the previous round).
    if (!newName.trim()) {
      const segments = picked.split(/[\\/]/).filter(Boolean);
      const last = segments[segments.length - 1] ?? '';
      if (last) setNewName(last);
    }
    handleValidateRoot();
  };

  const handleValidateRoot = async (): Promise<void> => {
    const trimmed = newRoot.trim();
    if (!trimmed) {
      setPathValidation(null);
      return;
    }
    // Cheap frontend pre-check first (absolute path / ".." / length).
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
    // Rust-side deep validation — checks path exists + contains .claude/.
    // Returns PathValidation with reason_code + reason (Chinese).
    try {
      const result = await validateProjectPath(trimmed);
      setPathValidation({
        valid: result.valid,
        reason: result.valid ? null : result.reason,
      });
    } catch {
      // If the IPC call itself fails, fall back to the frontend check
      // passing — Rust will still re-validate at `add_project` time.
      setPathValidation({ valid: true, reason: null });
    }
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

  // M3.0.2 — confirmation now goes through the themed ConfirmDialog
  // (set by the table row's onClick → setPendingDelete). This entry
  // point is called by the dialog's onConfirm handler, so no
  // window.confirm() is needed here.
  const handleRemove = async (id: string): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await remove(id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  // Note (M3.10-arch): we deliberately do NOT depend on
  // `@tauri-apps/plugin-dialog` here. CLAUDE.md §2.3 locks the npm
  // dep list — adding `plugin-dialog` requires a main-session
  // approval. Instead, the user pastes / types the root_dir path
  // into the input. Future M3.11+ polish can add a native picker
  // once the dep is approved.
  // A3 真因修复 (CLAUDE.md §16): commit db74286 修了 picker
  // 拿到绝对路径 + 调 validateProjectPath 显示红字 hint, 但 handleAdd
  // 没检查 pathValidation.valid, 用户可绕过前端验证点 [添加] → Rust
  // 抛 "must be an absolute path"。修复: 提交前显式拦截 pathValidation
  // 状态 (注意: pathValidation === null 表示用户从未 blur 过 input, 此时
  // 走乐观放行 + addProject 由 Rust 端 validate 兜底路径, 避免一个
  // 用户什么都没输就阻止提交的死锁)。
  const handleAdd = async (): Promise<void> => {
    if (!newName.trim() || !newRoot.trim()) {
      setActionError('项目名和根目录不能为空');
      return;
    }
    if (pathValidation && !pathValidation.valid) {
      setActionError(pathValidation.reason ?? '路径无效');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await add(newName.trim(), newRoot.trim());
      setNewName('');
      setNewRoot('');
      setModalOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  // M5 #3 — close the modal cleanly (Esc / overlay / 取消).
  const closeAddModal = useCallback((): void => {
    setModalOpen(false);
    setNewName('');
    setNewRoot('');
    setActionError(null);
  }, []);

  return (
    <div
      data-testid="home-page"
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
              borderRadius: 'var(--radius-button)',
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
          className="card"
          style={{ padding: 16, marginBottom: 24 }}
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
                  borderRadius: 'var(--radius-button)',
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
                className="btn"
                data-testid="refresh-projects"
                onClick={() => void reload()}
                disabled={busy || loading}
                style={{ cursor: busy || loading ? 'not-allowed' : 'pointer', opacity: busy || loading ? 0.6 : 1 }}
              >
                刷新
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="add-project-toggle"
                onClick={() => {
                  // M5 #3 — open as a modal dialog (Esc to close,
                  // click overlay to dismiss) instead of inline.
                  setModalOpen(true);
                }}
                disabled={busy}
                style={{ cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
              >
                + 新增项目
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
                borderRadius: 'var(--radius-button)',
                textAlign: 'center',
              }}
            >
              暂无项目。点击 [新增项目] 添加，或检查系统级项目是否被删除。
            </div>
          )}

          {projects.length > 0 && (
            <table
              className="dense card"
              data-testid="project-table"
              style={{ overflow: 'hidden' }}
            >
              <thead>
                <tr>
                  <th>项目名</th>
                  <th>根目录</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const isActive = p.id === currentProject?.id;
                  return (
                    <tr
                      key={p.id}
                      data-testid={`project-row-${p.id}`}
                      className={isActive ? 'active' : undefined}
                    >
                      <td>
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
                        className="mono"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {p.root_dir}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          data-testid={`switch-${p.id}`}
                          onClick={() => void handleSwitch(p.id)}
                          disabled={busy || isActive}
                          style={{ marginRight: 8, opacity: isActive ? 0.5 : 1 }}
                        >
                          {isActive ? '当前' : '切换'}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid={`remove-${p.id}`}
                          onClick={() => setPendingDelete(p)}
                          disabled={busy || p.is_system}
                          title={p.is_system ? '用户级项目不可删除' : '删除此项目'}
                          style={{
                            color: p.is_system ? 'var(--text-muted)' : 'var(--danger, #D32F2F)',
                            opacity: p.is_system ? 0.4 : 1,
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

        {/* Add project modal (M5 #3) — wraps the existing form fields in a
            themed modal dialog (Esc to close, click overlay to dismiss).
            Reuses the same data-testids so the existing tests keep
            passing without churning fixtures. */}
        {modalOpen && (
          <div
            className="modal-overlay"
            data-testid="add-project-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-project-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeAddModal();
            }}
          >
            <section
              data-testid="add-project-form"
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeAddModal();
              }}
              style={{
                padding: 16,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--shadow-md)',
                maxWidth: 480,
                margin: '10vh auto 0',
              }}
            >
              <h3
                id="add-project-modal-title"
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
                  onClick={() => void handlePickRoot()}
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
                onClick={closeAddModal}
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
                disabled={
                  busy ||
                  !newName.trim() ||
                  !newRoot.trim() ||
                  (pathValidation !== null && !pathValidation.valid)
                }
                style={{
                  padding: '6px 14px',
                  background: 'var(--accent)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  cursor:
                    busy ||
                    !newName.trim() ||
                    !newRoot.trim() ||
                    (pathValidation !== null && !pathValidation.valid)
                      ? 'not-allowed'
                      : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                添加
              </button>
            </div>
          </section>
          </div>
        )}
      </div>

      {/* M3.0.2 — destructive "delete project" confirmation. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `删除项目「${pendingDelete.name}」` : '删除项目'}
        message="此操作不可撤销,项目配置将被永久删除。"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          if (pendingDelete) {
            void handleRemove(pendingDelete.id);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default HomeView;