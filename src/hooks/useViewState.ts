/**
 * useViewState — view routing state hook (M1.9).
 *
 * Why this hook exists — and why we're NOT using react-router for it:
 *
 *   cc-switch (the reference app for our UX patterns — see CLAUDE.md
 *   §3.1 + the bottom-of-file rationale in src/App.tsx) keeps its
 *   current view in `useState<View>` plus a localStorage round-trip
 *   under a single STORAGE_KEY. This is intentionally simpler than
 *   react-router:
 *
 *     - We only ever have ONE primary view rendered at a time.
 *       No nested routes, no outlet, no deep-link sharing, no URL
 *       bar to read from. react-router's location.hash sync and
 *       match-resolution machinery is pure overhead.
 *
 *     - The user rarely navigates by URL: they click a sidebar tile.
 *       A useState + onClick handler is one line; a <Link to=...>
 *       + <Route path=...> pair is four.
 *
 *     - Persisting "where the user was" is just one localStorage
 *       key on mount + one setItem on change. No <BrowserRouter>
 *       basename juggling, no HashRouter dance for the
 *       `tauri://localhost/` scheme.
 *
 *     - The 12 plugin stubs are declared once (in
 *       src/plugins/registry.ts for the M1.3 wiring) and once here
 *       (for the M1.9 sidebar). They MUST agree — the test in
 *       src/__tests__/hooks/useViewState.test.ts enforces this.
 *       If we ever switch back to react-router, this hook goes
 *       away and App.tsx reaches into `useLocation()` instead.
 *
 *   The contract:
 *     - `view` is the currently-active id, always one of ViewId.
 *     - `setView(v)` updates the view + persists to localStorage,
 *       unless `v` is already current (no-op).
 *     - On mount, if localStorage holds an unknown value we fall
 *       back to 'home' rather than throw — a removed plugin's
 *       stale key must not crash the next launch.
 */
import { useCallback, useState } from 'react';

/**
 * The synthetic landing view — what the user sees when there is no
 * persisted last-view, or when the persisted one is unknown.
 *
 * Kept as a string constant (not a `null`) so the type stays a
 * closed union, which means AppHeader / AppSidebar can render the
 * "home" tile without `view ?? <fallback>` everywhere.
 */
export const HOME_VIEW = 'home' as const;

/**
 * STORAGE_KEY — localStorage slot used to remember the last view
 * across launches.
 *
 * Project-scoped (`ccm.` prefix) so we don't collide with any other
 * tool that might share the same Tauri webview origin.
 */
export const STORAGE_KEY = 'ccm.lastView';

/**
 * ViewId — closed union of every reachable view in M1.9.
 *
 * Adding a new plugin? Two edits:
 *   1. Add the entry to ALL_PLUGINS in src/plugins/registry.ts
 *   2. Add the id here as a literal in the union AND to ALL_VIEWS.
 * The test `ALL_VIEWS contains exactly the 12 plugin ids from the
 * registry` will catch the second if you forget the first.
 */
export type ViewId =
  | 'home'
  | 'provider-list'
  | 'provider-switch'
  | 'import-sql'
  | 'deeplink-import'
  | 'json-editor'
  | 'mcp-management'
  | 'usage-query'
  | 'single-file-deploy'
  | 'resource-browser'
  | 'marketplace'
  | 'optimizer'
  | 'backup-restore'
  | 'about';

/**
 * ALL_VIEWS — runtime list of valid ViewIds.
 *
 * Order is the on-screen order in the sidebar:
 *   home first (landing), then the 12 plugin tiles in registry order,
 *   then the 1 utility view ('about', M3.7 — 清单 18).
 *
 * Exported so AppSidebar can iterate without hardcoding a parallel
 * list, and so the test can pin "every plugin id is reachable".
 */
export const ALL_VIEWS: readonly ViewId[] = [
  'home',
  'provider-list',
  'provider-switch',
  'import-sql',
  'deeplink-import',
  'json-editor',
  'mcp-management',
  'usage-query',
  'single-file-deploy',
  'resource-browser',
  'marketplace',
  'optimizer',
  'backup-restore',
  'about',
] as const;

function isValidView(v: string | null): v is ViewId {
  return v !== null && (ALL_VIEWS as readonly string[]).includes(v);
}

function readInitialView(): ViewId {
  if (typeof window === 'undefined') return HOME_VIEW;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isValidView(stored) ? stored : HOME_VIEW;
}

export interface UseViewStateResult {
  view: ViewId;
  setView: (v: ViewId) => void;
  allViews: typeof ALL_VIEWS;
}

/**
 * useViewState — see the file header for the design rationale.
 *
 * @example
 *   const { view, setView } = useViewState();
 *   return <Sidebar currentView={view} onNavigate={setView} />;
 */
export function useViewState(): UseViewStateResult {
  const [view, setViewState] = useState<ViewId>(readInitialView);

  const setView = useCallback(
    (next: ViewId): void => {
      // No-op when the user clicks the tile they're already on.
      // We compare against the previous value via functional update
      // so the closure doesn't capture a stale `view`.
      setViewState((prev) => {
        if (prev === next) return prev;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, next);
        }
        return next;
      });
    },
    [],
  );

  return { view, setView, allViews: ALL_VIEWS };
}
