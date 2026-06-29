/**
 * F6 — MCP 管理 (Phase 44 stub, D-44-A: Phase 46 删).
 *
 * 注:Phase 27 Fix 6 已把 MCP 管理入口迁到 /resource-browser 的 mcp tab
 * (D-10/D-11/D-12)。Phase 44 仍保留 mcp-management plugin stub,作为
 * 提供 McpManagementPanel 共享组件的 entry(registry 9 项 → Phase 46
 * 删 → 8 项)。
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Package } from 'lucide-react';
import McpManagementPage from '../../pages/mcp-management';

const McpPage: React.FC = () => (
  <PluginPlaceholder pluginId="mcp-management" displayName="MCP 管理" />
);

export const mcpManagementPlugin: FrontendPlugin = {
  id: 'mcp-management',
  name: 'MCP 管理',
  viewId: 'mcp-management',
  sidebarTile: {
    icon: Package,
    short: 'MCP 管理',
    order: 4,
    group: 'main',
  },
  pageMeta: {
    title: 'MCP 管理',
    description: '管理已注册的 MCP server 列表 / 启用状态 / 配置同步。',
  },
  componentEntry: {
    component: McpManagementPage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/mcp',
      component: McpPage,
      pluginId: 'mcp-management',
      displayName: 'MCP 管理',
    },
  ],
};