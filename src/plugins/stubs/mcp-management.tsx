/**
 * F6 — MCP 管理 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const McpPage: React.FC = () => (
  <PluginPlaceholder pluginId="mcp-management" displayName="MCP 管理" />
);

export const mcpManagementPlugin: FrontendPlugin = {
  id: 'mcp-management',
  name: 'MCP 管理',
  routes: [
    {
      path: '/mcp',
      component: McpPage,
      pluginId: 'mcp-management',
      displayName: 'MCP 管理',
    },
  ],
};
