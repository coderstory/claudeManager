/**
 * Frontend plugin system — shared types.
 *
 * Mirrors `src-tauri/src/plugins/traits.rs` on the backend. Keep both
 * in sync when adding or changing fields.
 */

import type { ComponentType } from 'react';

export interface RouteDef {
  /** URL path, e.g. `"/mcp"`. Used as the React Router `path` prop. */
  path: string;
  /** React component to render when the route matches. */
  component: ComponentType;
  /** Owning plugin id (kebab-case). */
  pluginId: string;
  /** Human-readable name, e.g. `"MCP 管理"`. */
  displayName: string;
}

export interface FrontendPlugin {
  /** Stable, kebab-case identifier. Must match the backend `IPlugin::id`. */
  id: string;
  /** Human-readable name. Must match the backend `IPlugin::name`. */
  name: string;
  /** Routes the plugin contributes. Empty for action-only plugins. */
  routes: RouteDef[];
}
