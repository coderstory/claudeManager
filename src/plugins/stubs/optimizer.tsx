/**
 * F18 — 配置优化 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const OptimizerPage: React.FC = () => (
  <PluginPlaceholder pluginId="optimizer" displayName="配置优化" />
);

export const optimizerPlugin: FrontendPlugin = {
  id: 'optimizer',
  name: '配置优化',
  routes: [
    {
      path: '/optimizer',
      component: OptimizerPage,
      pluginId: 'optimizer',
      displayName: '配置优化',
    },
  ],
};
