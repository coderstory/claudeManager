/**
 * F3 — SQL导入配置 (Phase 44: full FrontendPlugin).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Database } from 'lucide-react';
import { ImportSqlPage } from '../../pages/import-sql';

const ImportSqlPageStub: React.FC = () => (
  <PluginPlaceholder pluginId="import-sql" displayName="SQL导入配置" />
);

interface ImportSqlPluginProps {
  initialFilePath?: string | null;
}

export const importSqlPlugin: FrontendPlugin = {
  id: 'import-sql',
  name: 'SQL导入配置',
  viewId: 'import-sql',
  sidebarTile: {
    icon: Database,
    // M3.9 — 清单 2: 菜单/页面命名 P1 修复: ".sql 导入" → "SQL导入配置"
    short: 'SQL导入配置',
    order: 2,
    group: 'main',
  },
  pageMeta: {
    // M3.9 — 清单 2: 页面标题 P1 修复: "导入 .sql" → "SQL导入配置"
    title: 'SQL导入配置',
    // M3.9 — 清单 21: 描述补 "schema 校验" 环节
    description: '校验 .sql(SQLite dump) schema → 预览将导入的 provider/MCP → 批量导入。',
  },
  componentEntry: {
    component: ImportSqlPage as unknown as React.ComponentType<ImportSqlPluginProps>,
    propsBuilder: (ctx) => ({
      initialFilePath: ctx.pendingSqlFile,
    }),
  },
  routes: [
    {
      path: '/import',
      component: ImportSqlPageStub,
      pluginId: 'import-sql',
      displayName: 'SQL导入配置',
    },
  ],
};