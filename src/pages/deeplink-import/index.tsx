/**
 * F4 — Deeplink 导入 (M1.9 placeholder).
 * Real implementation: parse ccswitch://v1/import?... URL → single
 * provider. See SPEC §3.1 F4.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function DeeplinkImportPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="deeplink-import"
      title="Deeplink 导入"
      description="从 ccswitch://v1/import?... URL 解析单个 provider 配置。"
    />
  );
}
