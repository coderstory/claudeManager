/**
 * F16 — 资源浏览 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const ResourceBrowserPage: React.FC = () => (
  <PluginPlaceholder pluginId="resource-browser" displayName="资源浏览" />
);

export const resourceBrowserPlugin: FrontendPlugin = {
  id: 'resource-browser',
  name: '资源浏览',
  routes: [
    {
      path: '/resources',
      component: ResourceBrowserPage,
      pluginId: 'resource-browser',
      displayName: '资源浏览',
    },
  ],
};
