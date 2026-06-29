/**
 * ConfirmDialog — v3.0 (M3.0.2) 通用确认弹窗.
 *
 * Replaces native `window.confirm()` / `window.alert()` calls with a
 * themed modal that respects the active theme (light / liquid-glass /
 * dark / editorial / pixel) via base.css + tokens.css. CLAUDE.md §7
 * mandates user-visible confirmation before destructive writes
 * (delete project / close app / wipe settings), so this primitive
 * is needed for every dangerous action across the app.
 *
 * ## Design contract
 *
 * - Markup: `.modal-overlay` > `.modal[role="dialog"][aria-modal="true"]`
 *   > `.modal-header` (title) + `.modal-body` (message) +
 *   `.modal-footer` (cancel + confirm buttons).
 * - The confirm button is `btn-danger` when `danger` is true, otherwise
 *   `btn-primary` (matches the design-system token vocabulary).
 * - The cancel button is always `btn-ghost` (low-emphasis).
 *
 * ## Behaviour
 *
 * - `open` is fully controlled — closing is the parent's job via
 *   `onCancel` / `onConfirm`. (Uncontrolled would force the parent
 *   to remount on every close, which fights React 19's transition
 *   batching and complicates "open → fill form → submit" flows.)
 * - Click on overlay → `onCancel()` (skipped when `dismissable=false`).
 * - ESC key → `onCancel()`.
 * - Enter key → `onConfirm()`.
 * - Body scroll locked while open (restored on close/unmount).
 * - Focus moves to confirm button on open so Enter is one keystroke away.
 * - When `confirmDisabled` is true, the confirm button is non-interactive
 *   and Enter does not fire `onConfirm`.
 *
 * ## Why a separate file (vs inlining in WindowControls / home)
 *
 * Two of the three planned integration sites (close-app, delete-project)
 * have visually identical dialog shells; backup-restore, mcp-management,
 * and provider-list will need it next (out of scope for M3.0.2 — see
 * STATE.md). Centralising the markup here means later integrations
 * only need a useState + ConfirmDialog pair, not a copy-pasted shell.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body content. String → wrapped in <p>; ReactNode → rendered verbatim (allows <strong>/<code>). */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true = red destructive button; false (default) = blue primary button. */
  danger?: boolean;
  /** true (default) = click overlay or ESC to cancel. false = must click a button. */
  dismissable?: boolean;
  /** When true, confirm button is disabled and Enter does not fire onConfirm. */
  confirmDisabled?: boolean;
  /** When true, hide the cancel button. ESC and overlay click still trigger
   *  onCancel (unless dismissable=false). Use for acknowledgement-only dialogs
   *  (e.g. first-time user welcome) where a destructive cancel is meaningless. */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Generate a stable id for the title element so aria-labelledby points
 * at it. React 19 strict mode double-invokes effects, so we can't
 * rely on a useId-free inline call — module-level counter is the
 * simplest deterministic approach.
 */
let titleIdCounter = 0;
const nextTitleId = (): string => {
  titleIdCounter += 1;
  return `confirm-dialog-title-${titleIdCounter}`;
};

export function ConfirmDialog(props: ConfirmDialogProps): ReactElement | null {
  const {
    open,
    title,
    message,
    confirmLabel = '确认',
    cancelLabel = '取消',
    danger = false,
    dismissable = true,
    confirmDisabled = false,
    hideCancel = false,
    onConfirm,
    onCancel,
  } = props;

  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const titleIdRef = useRef<string>(nextTitleId());

  // Keyboard handlers — mounted only while open. We bind to document
  // (not the dialog) because the overlay sits on top with no focusable
  // children except the buttons, and we want the shortcut to work
  // even before the user clicks into the dialog.
  useEffect(() => {
    if (!open) return undefined;

    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        // Enter triggers confirm unless the confirm button is disabled.
        // We don't gate on document.activeElement because the dialog is
        // the only focusable surface when open; this keeps the shortcut
        // working even after the user tabs to cancel.
        if (!confirmDisabled) {
          e.preventDefault();
          onConfirm();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onCancel, onConfirm, confirmDisabled]);

  // Body scroll lock + initial focus on the confirm button. Restoring
  // the previous overflow value (instead of always setting '') handles
  // the case where another component already locked the body.
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus to the confirm button so Enter works immediately.
    // Use a microtask to let the dialog paint first.
    const rafId = window.requestAnimationFrame(() => {
      confirmRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(rafId);
    };
  }, [open]);

  const handleOverlayClick = useCallback((): void => {
    if (dismissable) onCancel();
  }, [dismissable, onCancel]);

  if (!open) return null;

  /* v3.0 redesign: 取消用 .btn-modal-cancel (浅色底), 确认用 .btn-modal-confirm (深色 solid).
   * danger 模式下 confirm 保持深色不变 (警告信号由 .modal-header 左侧竖条承担, data-danger 控制). */
  const cancelClass = 'btn-modal-cancel';
  const confirmClass = 'btn-modal-confirm';

  return (
    <div
      className="modal-overlay"
      data-testid="confirm-dialog-overlay"
      onClick={handleOverlayClick}
    >
      {/* Stop click propagation so clicks inside the modal don't dismiss it. */}
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        data-danger={danger ? 'true' : 'false'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" id={titleIdRef.current}>
          <h2 className="modal-title">{title}</h2>
          {dismissable && (
            <button
              type="button"
              className="modal-close-btn"
              data-testid="confirm-dialog-close"
              aria-label="关闭弹窗"
              title="关闭"
              onClick={onCancel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="modal-body">
          {typeof message === 'string' ? <p style={{ margin: 0 }}>{message}</p> : message}
        </div>
        <div className="modal-footer">
          {!hideCancel && (
            <button
              type="button"
              className={cancelClass}
              data-testid="confirm-dialog-cancel"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={confirmClass}
            data-testid="confirm-dialog-confirm"
            data-danger={danger ? 'true' : 'false'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}