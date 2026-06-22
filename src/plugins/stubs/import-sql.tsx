/**
 * F3 — SQL导入配置 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const ImportSqlPage: React.FC = () => (
  <PluginPlaceholder pluginId="import-sql" displayName="SQL导入配置" />
);

export const importSqlPlugin: FrontendPlugin = {
  id: 'import-sql',
  name: 'SQL导入配置',
  routes: [
    {
      path: '/import',
      component: ImportSqlPage,
      pluginId: 'import-sql',
      displayName: 'SQL导入配置',
    },
  ],
};
