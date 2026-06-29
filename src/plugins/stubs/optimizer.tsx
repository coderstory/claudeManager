/**
 * F18 — 配置优化 (Phase 44: full FrontendPlugin).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Wand2 } from 'lucide-react';
import OptimizerPage from '../../pages/optimizer';

const OptimizerPageStub: React.FC = () => (
  <PluginPlaceholder pluginId="optimizer" displayName="配置优化" />
);

export const optimizerPlugin: FrontendPlugin = {
  id: 'optimizer',
  name: '配置优化',
  viewId: 'optimizer',
  sidebarTile: {
    icon: Wand2,
    short: '配置优化',
    order: 8,
    group: 'main',
  },
  pageMeta: {
    title: '配置优化',
    description: '扫描 settings.json 的 13 项优化清单,一键应用 + 自动备份。',
  },
  componentEntry: {
    component: OptimizerPage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/optimizer',
      component: OptimizerPageStub,
      pluginId: 'optimizer',
      displayName: '配置优化',
    },
  ],
};