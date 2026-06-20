/**
 * F2 — Provider 切换 (M2.1 routing shim).
 *
 * F2 is implemented as an action (the [激活] button on each F1 row)
 * — see `src/pages/provider-list/index.tsx`. This page exists only so
 * the F2 sidebar tile / home tile resolves to a real component rather
 * than a placeholder; on mount it forwards to the F1 view which is
 * where the actual switching happens.
 */
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useViewState } from '../../hooks/useViewState';

export function ProviderSwitchPage(): ReactElement {
  const { setView } = useViewState();
  useEffect(() => {
    setView('provider-list');
  }, [setView]);
  return (
    <div
      data-testid="provider-switch-page"
      style={{
        padding: 'var(--space-6)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--fs-body)',
      }}
    >
      F2 是 F1 列表上的 [激活] 动作。正在跳转到 Provider 列表…
    </div>
  );
}

export default ProviderSwitchPage;