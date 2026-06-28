/**
 * F1 — Provider 列表 (Phase 44: full FrontendPlugin with viewId/pageMeta/componentEntry).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Layers } from 'lucide-react';
import { ProviderListPage } from '../../pages/provider-list';

const ProviderListPageStub: React.FC = () => (
  <PluginPlaceholder pluginId="provider-list" displayName="Provider 列表" />
);

export const providerListPlugin: FrontendPlugin = {
  id: 'provider-list',
  name: 'Provider 列表',
  viewId: 'provider-list',
  sidebarTile: {
    icon: Layers,
    short: 'Provider 列表',
    order: 1,
    group: 'main',
  },
  pageMeta: {
    title: 'Provider 列表',
    description: '管理所有 Claude Code provider 配置：列表、搜索、激活标记、1 键切换。',
  },
  componentEntry: {
    component: ProviderListPage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/',
      component: ProviderListPageStub,
      pluginId: 'provider-list',
      displayName: 'Provider 列表',
    },
  ],
};