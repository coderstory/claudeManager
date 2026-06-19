/**
 * F1 — Provider 列表 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const ProviderListPage: React.FC = () => (
  <PluginPlaceholder pluginId="provider-list" displayName="Provider 列表" />
);

export const providerListPlugin: FrontendPlugin = {
  id: 'provider-list',
  name: 'Provider 列表',
  routes: [
    {
      path: '/',
      component: ProviderListPage,
      pluginId: 'provider-list',
      displayName: 'Provider 列表',
    },
  ],
};
