/**
 * F17 — 资源市场 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const MarketplacePage: React.FC = () => (
  <PluginPlaceholder pluginId="marketplace" displayName="资源市场" />
);

export const marketplacePlugin: FrontendPlugin = {
  id: 'marketplace',
  name: '资源市场',
  routes: [
    {
      path: '/marketplace',
      component: MarketplacePage,
      pluginId: 'marketplace',
      displayName: '资源市场',
    },
  ],
};
