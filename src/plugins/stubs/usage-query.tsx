/**
 * F7 — 用量查询 (Phase 44: full FrontendPlugin).
 *
 * Q44-4: routes 字段填 `/usage` placeholder path.
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Gauge } from 'lucide-react';
import UsageQueryPage from '../../pages/usage-query';

const UsageQueryPageStub: React.FC = () => (
  <PluginPlaceholder pluginId="usage-query" displayName="用量查询" />
);

export const usageQueryPlugin: FrontendPlugin = {
  id: 'usage-query',
  name: '用量查询',
  viewId: 'usage-query',
  sidebarTile: {
    icon: Gauge,
    short: '用量查询',
    order: 5,
    group: 'main',
  },
  pageMeta: {
    title: '用量查询',
    description: '按 provider 类型查询 token 用量(5h / 1w / 1m 或余额),5 分钟内存缓存。',
  },
  componentEntry: {
    component: UsageQueryPage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/usage',
      component: UsageQueryPageStub,
      pluginId: 'usage-query',
      displayName: '用量查询',
    },
  ],
};