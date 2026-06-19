/**
 * Frontend plugin registry.
 *
 * The single source of truth for which plugins the React app
 * mounts. Mirrors `src-tauri/src/plugins/mod.rs::init_all` — when you
 * add a plugin on the backend, add its frontend stub import + entry
 * here.
 *
 * Adding a new plugin:
 * 1. Write a new stub under `src/plugins/stubs/<id>.tsx` (or in
 *    `stubs/mod.ts`'s barrel).
 * 2. Append the import + entry to `ALL_PLUGINS` below.
 * 3. Add a corresponding Rust stub under `src-tauri/src/plugins/stubs/`
 *    and register it in `src-tauri/src/plugins/mod.rs::init_all`.
 */

import type { FrontendPlugin } from './types';

import {
  providerListPlugin,
  providerSwitchPlugin,
  importSqlPlugin,
  deeplinkImportPlugin,
  jsonEditorPlugin,
  mcpManagementPlugin,
  usageQueryPlugin,
  singleFileDeployPlugin,
  resourceBrowserPlugin,
  marketplacePlugin,
  optimizerPlugin,
  backupRestorePlugin,
} from './stubs/mod';

/**
 * The 12 frontend plugin stubs, in the same order as the Rust
 * `init_all` registrations. Order is not load-bearing but it keeps
 * the two registries visually aligned for review.
 */
export const ALL_PLUGINS: FrontendPlugin[] = [
  providerListPlugin,
  providerSwitchPlugin,
  importSqlPlugin,
  deeplinkImportPlugin,
  jsonEditorPlugin,
  mcpManagementPlugin,
  usageQueryPlugin,
  singleFileDeployPlugin,
  resourceBrowserPlugin,
  marketplacePlugin,
  optimizerPlugin,
  backupRestorePlugin,
];

/**
 * Flatten all plugin routes into the shape React Router v6 expects.
 * `App.tsx` maps this directly into `<Route>` children.
 */
export const ALL_ROUTES = ALL_PLUGINS.flatMap((p) => p.routes);
