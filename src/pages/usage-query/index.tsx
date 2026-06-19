/**
 * F7 — 用量查询 (M1.9 placeholder).
 * Real implementation: 5-minute cached per-provider quota lookups
 * (Anthropic / DeepSeek / OpenAI-compatible / NotSupported). See
 * SPEC §3.1 F7 + §5.7.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function UsageQueryPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="usage-query"
      title="用量查询"
      description="按 provider 类型查询 token 用量(5h / 1w / 1m 或余额),5 分钟内存缓存。"
    />
  );
}
