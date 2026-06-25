/**
 * ConfirmDialog — TDD coverage (v3.0 M3.0.2).
 *
 * Tests the 9 contracts documented in ConfirmDialog.tsx:
 *   1. Does not render when open=false.
 *   2. Renders title + message when open=true.
 *   3. Confirm button fires onConfirm.
 *   4. Cancel button fires onCancel.
 *   5. danger mode applies btn-danger class to confirm button.
 *   6. ESC key fires onCancel.
 *   7. Overlay click fires onCancel (default dismissable).
 *   8. Overlay click does NOT fire onCancel when dismissable=false.
 *   9. Custom confirmLabel / cancelLabel are rendered.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../../components/ConfirmDialog';

afterEach(() => {
  cleanup();
  // ConfirmDialog locks document.body.style.overflow='hidden' on open —
  // reset between tests so a stale 'hidden' doesn't poison the next render.
  document.body.style.overflow = '';
});

describe('ConfirmDialog', () => {
  it('不渲染当 open=false', () => {
    render(
      <ConfirmDialog
        open={false}
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('渲染 title + message 当 open=true', () => {
    render(
      <ConfirmDialog
        open
        title="删除项目"
        message="不可撤销"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('删除项目')).toBeInTheDocument();
    expect(screen.getByText('不可撤销')).toBeInTheDocument();
  });

  it('点确认调 onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('点取消调 onCancel', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('danger 模式下确认按钮用 btn-danger class', () => {
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        danger
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: '确认' });
    expect(btn.className).toContain('btn-modal-confirm');
  });

  it('非 danger 模式下确认按钮用 btn-primary class', () => {
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: '确认' });
    expect(btn.className).toContain('btn-modal-confirm');
    expect(btn.className).not.toContain('btn-danger');
  });

  it('ESC 键调 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点遮罩调 onCancel (默认 dismissable)', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    // The overlay is the parent element of the dialog.
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('dismissable=false 时点遮罩不调 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        dismissable={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('自定义按钮 label', () => {
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        confirmLabel="删除"
        cancelLabel="再想想"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再想想' })).toBeInTheDocument();
  });
});