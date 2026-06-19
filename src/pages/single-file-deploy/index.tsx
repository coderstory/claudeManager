/**
 * F8 — 单文件部署 (M1.9 placeholder).
 * Build-time concern (Tauri bundler config) but gets a nav tile in
 * M1.9 so the sidebar can show "everything that will land in v1.1".
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function SingleFileDeployPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="single-file-deploy"
      title="单文件部署"
      description="应用 = 一个可执行文件,无外部 .NET / Node / Python runtime 依赖。"
    />
  );
}
