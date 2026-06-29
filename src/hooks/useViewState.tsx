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
 *
 * ## Phase 46 — VIEW_ID_MIGRATIONS 派生 + 链式 stale-route 兜底
 *
 *   Phase 27 Fix 6 之前最后一刻,用户 localStorage 存的是 'mcp-management'
 *   (Phase 46 D-44-A 删 + 合并到 'resource-browser' 的 mcp tab)。v3.2
 *   user 升级到 v3.4 启动时,读 localStorage 'mcp-management' → 派生
 *   SidebarTile.migrateFrom 反向索引 → fallback 到 'resource-browser'
 *   + 暴露 migrationSearch = { tab: 'mcp' } → ResourceBrowser 双源优先级
 *   选 mcp tab。完整流程:
 *     localStorage 'mcp-management' → migrateViewId → 'resource-browser'
 *     + search = { tab: 'mcp' } → useState init + useLayoutEffect URL
 *     注入 + useEffect localStorage 覆盖。
 *
 *   设计决策见 46-DECISIONS.md:
 *     Q1 (cycle/depth 兜底):递归 visited Set + 深度上限 5 + unknown →
 *        home + dev mode console.warn
 *     Q2 (appendQuery 链式):取第一跳 stored 直接对应的 migration.appendQuery,
 *        中间跳不合并 (Phase 47 评估合并策略)
 *     Q3 (URL 保留):mount 时用 useLayoutEffect 改 URL (早于子组件
 *        useEffect),保留用户可分享/可重入语义
 *     Q4 (mount-time 锁死):migrationSearch = useMemo(() => readInitialView().search, [])
 *        — 只在 mount 算一次,后续 setView 不重算 (URL 已被覆盖)
 *     Q5 (dev mode warn):import.meta.env?.DEV !== false 时 console.warn
 *        (production build 不报警)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

import { VIEW_META } from '../plugins/registry';
import { ALL_VIEW_IDS as ALL_VIEWS, type ViewId } from '../plugins/registry';
import type { SidebarTile } from '../plugins/types';

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
export { ALL_VIEW_IDS as ALL_VIEWS } from '../plugins/registry';
export type { ViewId } from '../plugins/registry';

function isValidView(v: string | null): v is ViewId {
  return v !== null && (ALL_VIEWS as readonly string[]).includes(v);
}

/* ──────────── Phase 46 — VIEW_ID_MIGRATIONS 派生 ──────────── */

/**
 * MigrationEntry — Phase 46 (46-DECISIONS §PLAN 2):
 * 一条 stale viewId → 新 viewId 反向索引项。
 */
export interface MigrationEntry {
  toViewId: ViewId;
  appendQuery?: Record<string, string>;
}

/**
 * isDevMode — 守卫 import.meta.env.DEV (Vite define),production build
 * DEV=false → console.warn 不打 (Q46-5)。用 `import.meta.env?.DEV`
 * 可选链 + `!== false` 守卫,以防 esbuild 把整个 import.meta.env
 * tree-shake 掉时 undefined 不误判。
 */
function isDevMode(): boolean {
  // Vite defines `import.meta.env.DEV` at build time. In production
  // it becomes `false`. In dev it becomes `true`. Test runners (vitest)
  // usually run with DEV=true. SSR / node side-effect imports may have
  // `import.meta.env` undefined — guard with `?.`.
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return env?.DEV !== false;
}

/**
 * buildMigrationIndex — Phase 46 派生 SidebarTile.migrateFrom 反向索引。
 *
 * 遍历 registry VIEW_META (所有 view 的 SidebarTile),收集
 * tile.migrateFrom 字段到 Map<fromViewId, MigrationEntry>。Q46-5:
 * dev mode 检测 duplicate fromViewId (两个 plugin 同时声明同一 fromViewId
 * 会静默覆盖 — 容易踩)。
 */
function buildMigrationIndex(): ReadonlyMap<string, MigrationEntry> {
  const idx = new Map<string, MigrationEntry>();
  for (const [viewId, tile] of Object.entries(VIEW_META) as Array<
    [ViewId, SidebarTile]
  >) {
    if (tile.migrateFrom) {
      // Q46-5: dev mode warn on duplicate fromViewId
      if (idx.has(tile.migrateFrom.fromViewId) && isDevMode()) {
        console.warn(
          `[useViewState] duplicate migrateFrom.fromViewId: ${tile.migrateFrom.fromViewId} (already maps to ${idx.get(tile.migrateFrom.fromViewId)?.toViewId}, now also ${viewId})`,
        );
      }
      idx.set(tile.migrateFrom.fromViewId, {
        toViewId: viewId,
        appendQuery: tile.migrateFrom.appendQuery,
      });
    }
  }
  return idx;
}

/**
 * VIEW_ID_MIGRATIONS — Phase 46 反向索引 (Q46-1 决策, 派生自
 * SidebarTile.migrateFrom 字段)。
 *
 * 在模块加载时构建一次。所有 'mcp-management' 之类的 stale viewId
 * 都通过这张表路由到对应的新 viewId + 携带 appendQuery (URL ?tab=mcp
 * 这类)。
 */
export const VIEW_ID_MIGRATIONS: ReadonlyMap<string, MigrationEntry> =
  buildMigrationIndex();

/**
 * MAX_MIGRATION_DEPTH — 链式迁移递归深度上限 (Q46-1 决策)。
 *
 * 防止恶意 / 错误的 migrateFrom 链 (A→B→C→...) 无限递归。深度 5
 * 远超任何现实场景 (Phase 46 实测 1 跳);深度 5+ 视为配置错误。
 */
const MAX_MIGRATION_DEPTH = 5;

/**
 * migrateViewId — Phase 46 链式 stale viewId 解析 (Q46-1 / Q46-2)。
 *
 * 终止条件 (按顺序短路):
 *   1. stored === null → { view: HOME_VIEW } (无 appendQuery)
 *   2. stored 是有效 ViewId → { view: stored } (无 appendQuery)
 *   3. visited.has(stored) → cycle detected, dev warn + home fallback
 *   4. depth >= MAX_MIGRATION_DEPTH → dev warn + home fallback
 *   5. VIEW_ID_MIGRATIONS miss → unknown stale, dev warn + home fallback
 *
 * appendQuery 链式策略 (Q46-2 决策):取 stored **直接对应** 的 migration
 * appendQuery,中间跳的 appendQuery 不合并 (Phase 47 评估合并策略,
 * 评估通过前保持简化语义)。
 *
 * @param stored - localStorage 读到的 viewId (可能 null)
 * @param visited - 已访问节点 Set,防 cycle;递归内部用,外部调用可省
 * @param depth - 当前递归深度,起始 0
 * @returns { view, appendQuery? } — appendQuery 仅在 stale hit 时携带
 */
export function migrateViewId(
  stored: string | null,
  visited: Set<string> = new Set(),
  depth: number = 0,
): { view: ViewId; appendQuery?: Record<string, string> } {
  // 终止条件 1: 无值 → home
  if (!stored) return { view: HOME_VIEW };

  // 终止条件 2: 已是有效 ViewId → 原样返回
  if (isValidView(stored)) return { view: stored };

  // 终止条件 3: cycle detected
  if (visited.has(stored)) {
    if (isDevMode()) {
      console.warn(
        `[useViewState] migration cycle detected at ${stored}, fallback to home`,
      );
    }
    return { view: HOME_VIEW };
  }

  // 终止条件 4: 深度上限
  if (depth >= MAX_MIGRATION_DEPTH) {
    if (isDevMode()) {
      console.warn(
        `[useViewState] migration depth ${MAX_MIGRATION_DEPTH} exceeded at ${stored}, fallback to home`,
      );
    }
    return { view: HOME_VIEW };
  }

  visited.add(stored);

  // 终止条件 5: 查 VIEW_ID_MIGRATIONS — 命中则递归到 toViewId
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (!migration) {
    if (isDevMode()) {
      console.warn(
        `[useViewState] unknown stale viewId: ${stored}, fallback to home`,
      );
    }
    return { view: HOME_VIEW };
  }

  // 链式递归:toViewId 也可能 stale,继续查
  const next = migrateViewId(migration.toViewId, visited, depth + 1);

  // Q46-2: appendQuery 取第一跳 (stored 直接对应的 migration.appendQuery)
  return {
    view: next.view,
    appendQuery: migration.appendQuery ?? next.appendQuery,
  };
}

/**
 * ReadInitialViewResult — Phase 46 readInitialView 返回类型。
 *
 * 包含迁移后的 viewId + 可选 URL search (stale viewId 迁移时携带,
 * ResourceBrowser 等消费者读 migrationSearch.tab 决定初始 kind)。
 */
export interface ReadInitialViewResult {
  view: ViewId;
  /** URL search params to apply via history.replaceState (Phase 46 stale redirect) */
  search?: Record<string, string>;
}

/**
 * readInitialView — 启动时读 localStorage,Phase 46 走链式 migrateViewId。
 *
 * 流程:
 *   1. 无 window (SSR / sandbox) → home
 *   2. localStorage 空 → home
 *   3. localStorage 是有效 ViewId → 原样返回
 *   4. localStorage 是 stale → migrateViewId 解析 (含 chain / fallback)
 *   5. 若解析出 appendQuery → 透传到 search 字段 (Q46-3 优先级最高源)
 */
export function readInitialView(): ReadInitialViewResult {
  if (typeof window === 'undefined') return { view: HOME_VIEW };
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };

  // Phase 46 — stale viewId 链式迁移
  const result = migrateViewId(stored);
  return result.appendQuery
    ? { view: result.view, search: result.appendQuery }
    : { view: result.view };
}

export interface UseViewStateResult {
  view: ViewId;
  setView: (v: ViewId) => void;
  allViews: typeof ALL_VIEWS;
  /**
   * Phase 46 (Q46-4) — stale viewId 迁移时携带的初始 URL search。
   *
   * mount-time 锁死:useMemo(() => readInitialView().search, []),
   * 后续 setView 不重算 (URL 已被覆盖写入,避免覆盖后续 QuickSearchModal
   * 等交互写入的 query)。
   *
   * ResourceBrowser 消费:`migrationSearch?.tab` 决定初始 kind
   * (优先级 1,高于 URL ?tab= 优先级 2)。
   */
  migrationSearch: Record<string, string> | undefined;
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
 * Phase 46 mount-time 三段 dispatch:
 *   1. useState initializer:同步拿 initial view (无副作用)
 *   2. useLayoutEffect:URL 注入 (Q46-3 — 早于子组件 useEffect)
 *   3. useEffect:localStorage 同步 (覆盖 stale 值)
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
  // useState initializer 同步拿 initial view (无副作用)
  const [view, setViewState] = useState<ViewId>(() => readInitialView().view);

  // Phase 46 (Q46-3) — URL 注入 (useLayoutEffect 保证在子组件 useEffect 之前)
  useLayoutEffect(() => {
    const initial = readInitialView();
    if (initial.search && Object.keys(initial.search).length > 0) {
      const qs = new URLSearchParams(initial.search).toString();
      try {
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${qs ? '?' + qs : ''}`,
        );
      } catch {
        /* sandbox / 隐私模式 history API 不可用 — 静默忽略 */
      }
    }
  }, []);

  // Phase 46 — localStorage 同步 (覆盖 stale 值)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Phase 46 (Q46-4) — migrationSearch mount-time 锁死
  const migrationSearch = useMemo(() => readInitialView().search, []);

  const value = useMemo<UseViewStateResult>(
    () => ({ view, setView, allViews: ALL_VIEWS, migrationSearch }),
    [view, setView, migrationSearch],
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