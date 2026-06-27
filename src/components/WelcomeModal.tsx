/**
 * WelcomeModal — first-time user welcome dialog (BUG-RF-01 fix).
 *
 * ## Why this exists
 *
 * M5 user bug #28 (from 2026-06-27 M6 retro): first-time users reported
 * "the welcome popup appears at the wrong moment — before the app
 * finishes loading the SQLite database, so the welcome text shows
 * before the actual app is responsive." A modal popping up during
 * the React mount cycle looks broken.
 *
 * ## Fix (BUG-RF-01)
 *
 * The modal must ONLY render after:
 *  1. The React tree has mounted (i.e. the App is visible), AND
 *  2. A short "settle" delay has passed (50ms — long enough to
 *     guarantee the splash + first paint cycle has completed;
 *     short enough to feel responsive).
 *
 * Both conditions are encoded in `useWelcomeModal` (see
 * `src/hooks/useWelcomeModal.ts`). The hook's `dbReady` flag flips
 * to `true` inside a `useEffect` with empty deps, so the modal
 * never appears during the initial mount cycle.
 *
 * ## Persistence
 *
 * Once dismissed, the welcome state is persisted in localStorage
 * under the `ccm.welcomed` key so the modal does not re-appear
 * on subsequent app launches.
 */
import type { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

export interface WelcomeModalProps {
  /** Parent-controlled open state. */
  open: boolean;
  onClose: () => void;
}

export function WelcomeModal({
  open,
  onClose,
}: WelcomeModalProps): ReactElement | null {
  if (!open) return null;

  return (
    <ConfirmDialog
      open={open}
      title={
        <span
          data-testid="welcome-modal-title"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Sparkles size={16} aria-hidden="true" />
          欢迎使用 Claude 配置管理器
        </span>
      }
      message={
        <div data-testid="welcome-modal-body">
          <p style={{ margin: '0 0 8px 0' }}>
            这是你第一次使用本应用。我们帮你把多个 Claude Code
            <code
              style={{
                background: 'var(--bg-elevated)',
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              provider
            </code>
            配置文件集中管理,1 秒切换。
          </p>
          <p style={{ margin: '0 0 8px 0' }}>
            <strong>核心能力:</strong>
          </p>
          <ul style={{ margin: '0 0 8px 18px', lineHeight: 1.6 }}>
            <li>
              <strong>Provider 列表</strong> — 一键切换 / 搜索 / 激活标记
            </li>
            <li>
              <strong>资源市场</strong> — 浏览 + 安装 Claude 官方与第三方 plugin
            </li>
            <li>
              <strong>备份与恢复</strong> — 自动备份 + 字段级 diff + 一键回滚
            </li>
            <li>
              <strong>用量查询</strong> — 5h / 1w / 1m / 余额 实时查看
            </li>
          </ul>
          <p
            style={{
              margin: '8px 0 0 0',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            按 <kbd>Ctrl</kbd>+<kbd>/</kbd> 唤起快速搜索,任意视图按
            <kbd>Esc</kbd> 回到首页。
          </p>
        </div>
      }
      confirmLabel="开始使用"
      cancelLabel=""
      // No cancel button — only the primary "开始使用" acknowledgement
      // button. The overlay click / Esc also close (dismissable).
      dismissable={true}
      onConfirm={onClose}
      onCancel={onClose}
    />
  );
}
