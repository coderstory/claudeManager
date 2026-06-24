/**
 * F2 — Provider 切换 (M2.1 routing shim).
 *
 * F2 is implemented as an action (the [激活] button on each F1 row)
 * — see `src/pages/provider-list/index.tsx`. This page exists only so
 * the F2 sidebar tile / home tile resolves to a real component rather
 * than a placeholder; on mount it forwards to the F1 view which is
 * where the actual switching happens.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { useViewState } from '../../hooks/useViewState';

export function ProviderSwitchPage(): ReactElement | null {
  const { view, setView } = useViewState();
  const redirected = useRef(false);

  useEffect(() => {
    if (view === 'provider-switch' && !redirected.current) {
      redirected.current = true;
      setView('provider-list');
    }
  }, [view, setView]);

  // 纯重定向页：仅保留 testid 供 integration 测试断言，不渲染可见内容
  return <div data-testid="provider-switch-page" style={{ display: 'none' }} />;
}

export default ProviderSwitchPage;