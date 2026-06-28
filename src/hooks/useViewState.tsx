/**
 * useViewState — view routing state hook + shared provider (M1.9 + M4.6-fix).
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
 *     - The 10 plugin stubs are declared once (in
 *       src/plugins/registry.ts for the M1.3 wiring) and once here
 *       (for the M1.9 sidebar). They MUST agree — the test in
 *       src/__tests__/hooks/useViewState.test.ts enforces this.
 *       If we ever switch back to react-router, this hook goes
 *       away and App.tsx reaches into `useLocation()` instead.
 *
 * ## M4.6-fix — why the hook now uses Context
 *
 *   Pre-M4.6 this hook was a plain `useState` inside the hook body.
 *   That meant EVERY component that called `useViewState()` got its
 *   OWN independent `view` state. App.tsx (the actual view router,
 *   with the big `view === 'foo' ? <Foo /> : ...` ternary) had one
 *   copy; usage-query's `setView('history')` button updated a
 *   *different* copy in usage-query's render tree. Result: clicking
 *   "查看用量历史" updated localStorage, then did nothing visible.
 *
 *   The fix is a Context Provider that holds the single source of
 *   truth, plus a thin `useViewState()` wrapper that reads from the
 *   context. App.tsx mounts the provider once at the root. Any
 *   descendant that calls `useViewState()` reads/writes the SAME
 *   state. localStorage persistence contract is unchanged.
 *
 *   The contract:
 *     - `view` is the currently-active id, always one of ViewId.
 *     - `setView(v)` updates the view + persists to localStorage,
 *       unless `v` is already current (no-op).
 *     - On mount, if localStorage holds an unknown value we fall
 *       back to 'home' rather than throw — a removed plugin's
 *       stale key must not crash the next launch.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

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
 * ViewId — re-exported from the canonical registry (Phase 44 派生收敛).
 *
 * Adding a new view? Edit ONLY the plugin stub + ALL_PLUGINS in
 * src/plugins/registry.ts; the union widens automatically.
 */
import { ALL_VIEW_IDS as ALL_VIEWS, type ViewId } from '../plugins/registry';

export { ALL_VIEW_IDS as ALL_VIEWS } from '../plugins/registry';
export type { ViewId } from '../plugins/registry';

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
 * ViewStateContext — React Context holding the singleton view state.
 *
 * M4.6-fix: this is the entire reason this file became a .tsx (was
 * .ts). Pre-fix, the hook used `useState` per-call, so each consumer
 * had its own `view` value and `setView` only updated the local
 * copy. The provider pattern guarantees a single source of truth
 * that App.tsx (router) and any descendant page (link-out buttons)
 * share.
 */
const ViewStateContext = createContext<UseViewStateResult | null>(null);

/**
 * ViewStateProvider — mounts the singleton state at the app root.
 *
 * Mount it once, as high as possible, in App.tsx (above the
 * sidebar / main pane split). All descendants that call
 * `useViewState()` will read and write the same value.
 *
 * @example
 *   <ViewStateProvider>
 *     <AppHeader ... />
 *     <AppSidebar ... />
 *     <MainView />
 *   </ViewStateProvider>
 */
export function ViewStateProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
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

  const value = useMemo<UseViewStateResult>(
    () => ({ view, setView, allViews: ALL_VIEWS }),
    [view, setView],
  );

  return (
    <ViewStateContext.Provider value={value}>
      {children}
    </ViewStateContext.Provider>
  );
}

/**
 * useViewState — see the file header for the design rationale.
 *
 * Reads the singleton view state from ViewStateContext. Throws if
 * called outside a <ViewStateProvider> — that's a developer error
 * (missing provider in the test / app tree), not a runtime concern.
 *
 * @example
 *   const { view, setView } = useViewState();
 *   return <Sidebar currentView={view} onNavigate={setView} />;
 */
export function useViewState(): UseViewStateResult {
  const ctx = useContext(ViewStateContext);
  if (ctx === null) {
    throw new Error(
      'useViewState() must be called inside a <ViewStateProvider>. ' +
        'Wrap your app root in <ViewStateProvider> in App.tsx.',
    );
  }
  return ctx;
}
