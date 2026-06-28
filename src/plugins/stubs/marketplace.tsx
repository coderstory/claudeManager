/**
 * F17 — 资源市场 (Phase 44: full FrontendPlugin).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Store } from 'lucide-react';
import MarketplacePage from '../../pages/marketplace';

const MarketplacePageStub: React.FC = () => (
  <PluginPlaceholder pluginId="marketplace" displayName="资源市场" />
);

export const marketplacePlugin: FrontendPlugin = {
  id: 'marketplace',
  name: '资源市场',
  viewId: 'marketplace',
  sidebarTile: {
    icon: Store,
    short: '资源市场',
    order: 7,
    group: 'main',
  },
  pageMeta: {
    title: '资源市场',
    description: '内置推荐仓库 + 自定义 git URL → 克隆 → 扫描 → 勾选安装。',
  },
  componentEntry: {
    component: MarketplacePage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/marketplace',
      component: MarketplacePageStub,
      pluginId: 'marketplace',
      displayName: '资源市场',
    },
  ],
};