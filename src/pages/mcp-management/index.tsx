/**
 * F6 — MCP 管理 (M1.9 placeholder).
 * Real implementation: list + toggle + add/edit/delete dialog for
 * mcpServers. Writes ~/.claude.json preserving all other keys via
 * deep-copy + sub-key mutation. See SPEC §3.1 F6 + §5.5.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function McpManagementPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="mcp-management"
      title="MCP 管理"
      description="MCP server 列表 + 启用 toggle + 新增 / 编辑 / 删除。保留 ~/.claude.json 其他键。"
    />
  );
}
