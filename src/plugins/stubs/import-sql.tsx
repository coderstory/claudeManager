/**
 * F3 — 导入 .sql (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const ImportSqlPage: React.FC = () => (
  <PluginPlaceholder pluginId="import-sql" displayName="导入 .sql" />
);

export const importSqlPlugin: FrontendPlugin = {
  id: 'import-sql',
  name: '导入 .sql',
  routes: [
    {
      path: '/import',
      component: ImportSqlPage,
      pluginId: 'import-sql',
      displayName: '导入 .sql',
    },
  ],
};
