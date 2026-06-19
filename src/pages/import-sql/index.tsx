/**
 * F3 — 导入 .sql (M1.9 placeholder).
 * Real implementation: parse cc-switch-style SQLite dump, preview,
 * dedupe by id, write into providers.json. See SPEC §3.1 F3.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function ImportSqlPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="import-sql"
      title="导入 .sql"
      description="解析 cc-switch 备份的 .sql(SQLite dump) → 预览 → 批量导入 provider + MCP。"
    />
  );
}
