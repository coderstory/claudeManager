/**
 * F16 — 资源浏览 (Phase 44: full FrontendPlugin + migrateFrom 示例).
 *
 * Q44-3: resource-browser 是唯一已知 migrateFrom 案例 — Phase 46 启用
 * 时,useViewState 读到 localStorage 'mcp-management' → fallback 到
 * 'resource-browser' + appendQuery { tab: 'mcp' },触发 ResourceBrowser
 * 默认 kind='mcp'。
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { FileSearch } from 'lucide-react';
import ResourceBrowserPage from '../../pages/resource-browser';

const ResourceBrowserPageStub: React.FC = () => (
  <PluginPlaceholder pluginId="resource-browser" displayName="资源浏览" />
);

export const resourceBrowserPlugin: FrontendPlugin = {
  id: 'resource-browser',
  name: '资源浏览',
  viewId: 'resource-browser',
  sidebarTile: {
    icon: FileSearch,
    short: '资源浏览',
    order: 6,
    group: 'main',
    // Q44-3: Phase 46 启用 — 老用户 localStorage 存 'mcp-management'
    // (Phase 27 Fix 6 之前最后一刻) → fallback 到 'resource-browser'
    // + URL ?tab=mcp。
    migrateFrom: {
      fromViewId: 'mcp-management',
      appendQuery: { tab: 'mcp' },
    },
  },
  pageMeta: {
    title: '资源浏览',
    description: '按 Plugins / Skills / Commands / LSP / MCP 分类查看当前启用的资源。',
  },
  componentEntry: {
    component: ResourceBrowserPage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/resources',
      component: ResourceBrowserPageStub,
      pluginId: 'resource-browser',
      displayName: '资源浏览',
    },
  ],
};