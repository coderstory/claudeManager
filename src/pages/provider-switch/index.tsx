/**
 * F2 — Provider 切换 (M1.9 placeholder).
 * Action-only in real life (no standalone page), but M1.9 gives it a
 * nav tile so the registry test "12 plugin ids are reachable" holds.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function ProviderSwitchPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="provider-switch"
      title="Provider 切换"
      description="选择 provider → 备份原 settings.json → 原子写入新值。F2 动作而非独立页。"
    />
  );
}
