/**
 * F16 — 资源浏览 (M1.9 placeholder).
 * Real implementation: 5-tab view (Plugins / Skills / Commands /
 * LSP / MCPs) showing what's actually enabled in settings.json +
 * claude.json. See SPEC §5.10.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function ResourceBrowserPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="resource-browser"
      title="资源浏览"
      description="按 Plugins / Skills / Commands / LSP / MCP 分类查看当前启用的资源,可一键启用 / 禁用。"
    />
  );
}
