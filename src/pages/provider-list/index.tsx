/**
 * F1 — Provider 列表 (M1.9 placeholder).
 * Real implementation lands in M2+ — see CLAUDE.md §3.3 / SPEC §3.1 F1.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function ProviderListPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="provider-list"
      title="Provider 列表"
      description="管理所有 Claude Code provider 配置：列表、搜索、激活标记、1 键切换。"
    />
  );
}
