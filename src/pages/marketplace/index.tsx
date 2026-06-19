/**
 * F17 — 资源市场 (M1.9 placeholder).
 * Real implementation: built-in recommended repos + custom git URL
 * → git clone → scan marketplace.json → install. See SPEC §5.13.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function MarketplacePage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="marketplace"
      title="资源市场"
      description="内置推荐仓库 + 自定义 git URL → 克隆 → 扫描 → 勾选安装 plugin / skill / command。"
    />
  );
}
