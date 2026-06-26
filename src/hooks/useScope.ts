/**
 * useScope — Phase 27 Fix 4 (BUG-CR-04): scope state singleton + 3 组件 remount.
 *
 * ## Why useSyncExternalStore instead of zustand
 *
 * CLAUDE.md §2.3 ("依赖纪律") forbids adding new dependencies without
 * reason. The project has no zustand installed (verified: package.json).
 * React 19's native `useSyncExternalStore` provides the same subscribe /
 * getSnapshot / update semantics as zustand's `subscribeWithSelector`
 * middleware, with zero new dependencies.
 *
 * ## Design
 *
 * - Module-level singleton store: `{ scope, projectRoot }`.
 * - `useSyncExternalStore` for React 19 concurrent-mode safety.
 * - SSR-safe: `typeof window === 'undefined'` fallback to a static
 *   snapshot so the hook works in SSR / test environments.
 * - `getSnapshot()` returns the current state reference. State is
 *   replaced immutably on every update so React detects changes.
 * - Initial scope derived from `useProjects().currentProject`:
 *   - `currentProject === null` → `'user'`, `projectRoot = null`
 *   - `currentProject !== null` → `'project'`, `projectRoot = currentProject.root_dir`
 *
 * ## API
 *
 * ```ts
 * const [scope, setScope, projectRoot, setProjectRoot] = useScope();
 * ```
 *
 * - `scope`: `'user' | 'project'` — current scope.
 * - `setScope(next)`: update scope (triggers re-render of all subscribers).
 * - `projectRoot`: `string | null` — active project's root_dir (project scope only).
 * - `setProjectRoot(next)`: update projectRoot (triggers re-render).
 *
 * ## Initialization from useProjects
 *
 * The hook itself cannot call `useProjects()` (React hook rules). To keep
 * the singleton in sync with the existing project source of truth,
 * components call `syncScopeFromProject(currentProject)` at the top level
 * after they read `currentProject` from `useProjects()`. This is a plain
 * function (not a hook) that updates the singleton if needed.
 */
import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Scope = 'user' | 'project';

export interface ScopeState {
  scope: Scope;
  projectRoot: string | null;
}

export type ScopeListener = () => void;

export type UseScopeResult = [
  scope: Scope,
  setScope: (next: Scope) => void,
  projectRoot: string | null,
  setProjectRoot: (next: string | null) => void,
];

// ---------------------------------------------------------------------------
// Singleton store (module-level — shared across all hook instances)
// ---------------------------------------------------------------------------

let currentState: ScopeState = {
  scope: 'user',
  projectRoot: null,
};

const listeners = new Set<ScopeListener>();

function emitChange(): void {
  // Copy to array to avoid mutation issues if a listener unsubscribes.
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    listener();
  }
}

function getSnapshot(): ScopeState {
  return currentState;
}

function subscribe(listener: ScopeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setScope(next: Scope): void {
  if (currentState.scope === next) return;
  currentState = { ...currentState, scope: next };
  emitChange();
}

function setProjectRoot(next: string | null): void {
  if (currentState.projectRoot === next) return;
  currentState = { ...currentState, projectRoot: next };
  emitChange();
}

// ---------------------------------------------------------------------------
// SSR-safe fallback for non-browser environments
// ---------------------------------------------------------------------------

function getServerSnapshot(): ScopeState {
  return { scope: 'user', projectRoot: null };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Read the current scope + projectRoot from the module-level singleton.
 *
 * Returns a 4-tuple `[scope, setScope, projectRoot, setProjectRoot]`.
 *
 * The hook subscribes via `useSyncExternalStore` so it re-renders when
 * scope or projectRoot changes. Components can force a remount on scope
 * change by setting `key={scope + ':' + (projectRoot ?? 'user')}` on the
 * subtree — the key change unmounts the old instance (cancelling any
 * in-flight fetches via the `cancelled` flag pattern) and mounts a new
 * one that re-runs the mount effect with the new scope.
 */
export function useScope(): UseScopeResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [state.scope, setScope, state.projectRoot, setProjectRoot];
}

// ---------------------------------------------------------------------------
// Sync helper — plain function (not a hook)
// ---------------------------------------------------------------------------

/**
 * Initialize the singleton scope from the current project.
 *
 * Call this once at the top of a component that already has
 * `currentProject` from `useProjects()`. Updates the singleton if the
 * derived scope differs from the current state.
 *
 * Why a separate function instead of doing this inside `useScope()`:
 * - `useScope` is a hook and must follow React's rules.
 * - `useProjects` is also a hook.
 * - We can't call `useProjects` from inside `useSyncExternalStore`'s
 *   getSnapshot (not a React component context).
 * - So we expose this helper for components to call at the top level.
 */
export function syncScopeFromProject(
  currentProject: { id: string; name: string; root_dir: string; is_system: boolean } | null,
): void {
  const nextScope: Scope = currentProject ? 'project' : 'user';
  const nextRoot = currentProject ? currentProject.root_dir : null;

  if (currentState.scope !== nextScope || currentState.projectRoot !== nextRoot) {
    currentState = { scope: nextScope, projectRoot: nextRoot };
    emitChange();
  }
}
