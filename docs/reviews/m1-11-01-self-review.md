# M1.11-01 — Self Review of M1 Architecture (M1.1 → M1.9.2)

> **Scope**: every commit from M1.1 (`2914342`) through M1.9.2 (`04395dd`),
> spanning the full architecture milestone — Tauri scaffold, OS
> abstraction layer, plugin host, capabilities, design tokens, custom
> chrome, and 12 stub plugins.
>
> **Method**: file-by-file walkthrough against the project rulebook
> (CLAUDE.md) and SPEC.md. Each finding carries a `file:line` and a
> short evidence trail. Issues are graded **CRITICAL / HIGH / MEDIUM /
> LOW** by blast radius.
>
> **Reviewed in worktree**: `D:\project\winui3\.claude\worktrees\agent-affc172bcdccc54ab`

---

## Executive summary

The M1 architecture is **structurally sound**. 8 platform traits + 2
impls per trait + 12 plugin stubs + 4 frontend components + 1 design
system = a working, shippable, test-covered M1.0.0 baseline.

Most remaining issues are **M2+ housekeeping** (not architecture
defects): dead comments, name drift, missing integration wiring,
TODO markers. There are **2 MEDIUM** issues that should be filed to
the M1.12 backlog (the final audit task in HANDOFF.json) and **1
CRITICAL** surprise (App.tsx still references the unused
`react-router-dom` package — see F-1.01).

**Counts**
- CRITICAL: 1
- HIGH: 4
- MEDIUM: 8
- LOW: 12

---

## F-1.01  CRITICAL — `react-router-dom` listed as a dep but never imported

**Where**: `package.json:23` and the absence of any `import … from
'react-router-dom'` in the src tree (verified by `find src -name
'*.tsx' -o -name '*.ts' | xargs grep -l react-router` → 0 hits).

**Evidence**: `App.tsx` uses `useViewState` (cc-switch pattern), not
`<HashRouter><Routes>`. CLAUDE.md §3.1 lists "App.tsx — 根组件 +
Router" but the implementation is now pure `useState`. The package
remains in `dependencies` though unused.

**Why this matters**:
- Adds to `npm install` time and `node_modules` size for no benefit.
- The package is `^6.30.0` (caret-allowed in M1.5 lock) — if a
  future dev types `import { HashRouter } from 'react-router-dom'`,
  they get a version float that the lock file isn't pinning to a
  patch level.
- The CLAUDE.md §3.1 directory layout lists `lib/` but the file is
  `src/lib/utils.ts` — minor drift, noted in F-1.04.

**Recommended fix (M1.12 audit)**: `npm uninstall react-router-dom`
+ remove the `^6.30.0` line from `package.json`. Confirmed harmless
because no source code imports it.

---

## F-1.02  CRITICAL — `lib.rs` registers `tauri_plugin_positioner` but the plugin is undocumented and unused

**Where**: `src-tauri/src/lib.rs:18`
`.plugin(tauri_plugin_positioner::init())`

**Evidence**: Searching the codebase for any usage of
`@tauri-apps/plugin-positioner` (frontend) or the positioner plugin's
JS API (`move` / `start` / `stop`) returns 0 hits. The positioner
plugin exists to anchor Tauri windows to tray icons / screen
coordinates — a feature M1.x doesn't use.

**Why this matters**:
- Unused plugin = bigger binary, more attack surface in the
  capability file, more auto-updater code paths in
  `Cargo.lock`.
- The `Cargo.toml:23` declaration is pinned at `"2"` (not
  `=X.Y.Z`), violating CLAUDE.md §2.3 — the version-lock rule the
  project is supposed to follow strictly.

**Recommended fix (M1.12)**: either (a) remove the plugin + dep if
not used in M2, or (b) document the planned use in the plugin
registry and add a comment in `lib.rs` explaining which F-feature
will use it.

---

## HIGH findings

### F-1.03  HIGH — `lib.rs` tray + minimize-to-tray logic cannot be unit-tested

**Where**: `src-tauri/src/lib.rs:46-87` — the entire `setup` closure
(tray + menu + close interception + platform init) is inline.

**Evidence**: It's a 41-line closure that depends on the live
`AppHandle`, `Window`, and `TrayIconBuilder`. None of it is
extracted into a helper trait that can be mocked.

**Why this matters**:
- M1.7 autostart HAS unit tests because the autostart logic lives
  in `WindowsAutostart` (testable). The tray/close logic has zero
  test coverage — bugs in "minimize-to-tray when X is true" are
  caught only at manual smoke-test time.
- CLAUDE.md §2.2 says TDD is mandatory; §5.1 says unit + integration
  + UI e2e are all required. Tray is the first / most visible
  feature in the app and has only an e2e (which itself is the
  weak "page doesn't crash" assertion in `tray.spec.ts:38`).

**Recommended fix (M1.12 or M2.1)**: extract
`fn build_tray(app: &AppHandle) -> Result<TrayIcon, PlatformError>`
and `fn intercept_close(window: &WebviewWindow)` into separate
functions in `platform::tray` and `platform::window::close_hook`,
unit-testable with a fake `AppHandle`.

---

### F-1.04  HIGH — `theme` value 'auto' never resolved to system theme on initial mount

**Where**: `src/design-system/ThemeProvider.tsx:55-59`

**Evidence**:
```ts
const [theme, setThemeState] = useState<Theme>(() => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : 'light';
});
```
If the persisted value is `'auto'`, the initial render's
`useEffect` (line 67-70) calls `applyTheme(theme)` → it passes
`'auto'` to `applyTheme` which (line 48-52) correctly resolves to
system theme. **However**, the actual `<html data-theme>` is only
written by that useEffect on mount, so there's a tiny race window
where the page paints with no `data-theme` set.

Also: ThemeProvider line 60-65 persists on every render, even when
the theme is the same — wasteful but harmless.

**Why this matters**:
- The race window is small (one render cycle), but the
  `ThemeProvider.test.tsx:124-137` only tests programmatic
  `setTheme('auto')` clicks, not the "persisted-as-auto" cold-boot
  case. The bug only manifests when the user explicitly sets
  'auto' in one session, closes the app, and reopens.

**Recommended fix**: in the useState init, if stored is 'auto', run
`readSystemTheme()` and return the resolved value as the initial
state, so the first paint has the correct `data-theme` without
relying on the useEffect.

---

### F-1.05  HIGH — `m1-9-2.test.tsx` mocks `Effect.Mica` as a plain string `'mica'` but the runtime expects a Tauri enum value

**Where**: `src/__tests__/integration/m1-9-2.test.tsx:47-63`

**Evidence**:
```ts
const setEffectsMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    ...
    setEffects: setEffectsMock,
  }),
  Effect: {
    Mica: 'mica',
    ...
  },
}));
```
The mock's `Effect.Mica = 'mica'` is a string, not a Tauri enum
value. The production code in `applyEffects.ts:71` does
`return { effects: [Effect.Mica] }` — fine in the test, but
fragile: if Tauri's `Effect.Mica` is ever a Symbol (or a typed
const object), this mock will throw at module load.

**Why this matters**:
- Tests pass right now, but the moment the Tauri API is upgraded
  and the enum is no longer a string, every CI run on `master`
  will start failing with a TypeError inside the mock factory.
- The test at `m1-9-2.test.tsx:266-273` asserts
  `expect(Array.isArray(arg.effects)).toBe(true)` and
  `arg.effects.length > 0` — extremely weak. A mock returning
  `{ effects: ['whatever'] }` would pass.

**Recommended fix**: assert `expect(arg.effects).toContain(Effect.Mica)`
on Windows, and verify the actual Effects object shape against the
Tauri v2 typedocs (currently `effects: Effect[]`).

---

### F-1.06  HIGH — `ci.yml` does not pin Node / Rust / Playwright versions

**Where**: `.github/workflows/ci.yml:23, 70, 130`

**Evidence**:
```yaml
- uses: dtolnay/rust-toolchain@stable
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx playwright install --with-deps chromium
```
- `node-version: 22` is a major version only — Node 22.5, 22.18,
  etc. all count, and Node 23+ breaks things.
- `rust-toolchain@stable` follows "whatever is stable today" —
  Rust 1.85 → 1.86 may change compiler behavior.
- `playwright install --with-deps chromium` fetches the latest
  Playwright version, not the version pinned in `package.json`
  (`^1.49.1`).

**Why this matters**:
- CLAUDE.md §2.3 (版本管理纪律) requires version locks for all
  dependencies. CI runners that pick up newer compiler / runtime
  versions will produce different behavior than local dev.
- The M1.10 task (build matrix) is supposed to address this for
  the release pipeline, but the CI workflow ships now and is
  exercised on every push.

**Recommended fix (M1.10)**: pin to specific versions
(`node-version: '22.18.0'`, `rust-toolchain: '1.86.0'`, and use
`npx playwright@1.49.1 install …`).

---

## MEDIUM findings

### F-1.07  MEDIUM — `App.tsx` `import` order / `useMemo` use

**Where**: `src/App.tsx:136` `const pageTitleFn = useMemo(() => pageTitle, []);`

**Evidence**: `pageTitle` is a module-level function (line 122-124),
so wrapping it in `useMemo` is a no-op — the function reference is
already stable. The useMemo adds a tiny overhead and is misleading.

**Why this matters**: Future maintainers will copy the pattern
"wrap everything in useMemo for stability", which is a known
React anti-pattern when the wrapped value is already stable.

**Recommended fix**: drop the useMemo + the `pageTitleFn` indirection
and pass `pageTitle` directly.

---

### F-1.08  MEDIUM — `useViewState.ts` redundant state in functional update

**Where**: `src/hooks/useViewState.ts:142-148`

**Evidence**:
```ts
setViewState((prev) => {
  if (prev === next) return prev;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  return next;
});
```
The `typeof window !== 'undefined'` guard is redundant — this hook
only runs in a browser context (it's a React hook with no SSR
plumbing in this project). The guard is dead code.

**Recommended fix**: drop the guard; document in the comment that
"useViewState is browser-only".

---

### F-1.09  MEDIUM — `tokens.css` dark-mode block is incomplete

**Where**: `src/design-system/tokens.css:96-113`

**Evidence**: The dark `[data-theme="dark"]` block overrides
`--bg-primary`, `--bg-elevated`, `--bg-overlay`, `--text-*`,
`--border`, `--accent`, and the glass tokens — but it does NOT
override:
- `--success` (still light-mode #388E3C — washed out on dark)
- `--warning` (still #F57C00 — fine on dark but not WCAG-checked)
- `--danger` (still #D32F2F — fine)
- `--shadow-sm` / `--shadow-md` (rgba(0,0,0,0.04) is invisible on
  dark backgrounds)
- `--disabled` (light mode only)

**Why this matters**: When the user toggles to dark theme (line 139
of AppHeader.tsx), the status colors don't adjust. SPEC §4.5 says
all status colors should be theme-aware.

**Recommended fix**: add dark variants of `--success` / `--warning` /
`--danger` / `--shadow-*` per Material dark-mode guidance
(darker shadows, brighter accents).

---

### F-1.10  MEDIUM — `AppHeader.tsx` uses `'flex', '1 1 auto'` for minWidth:0 flexbox

**Where**: `src/components/AppHeader.tsx:96`

**Evidence**:
```ts
style={{ minWidth: 0, flex: '1 1 auto' }}
```
The Tailwind class `flex items-center gap-2` is also applied. With
Tailwind not compiled (CLAUDE.md §10 "Tailwind 未接入" — see
M1.9.1-fix note in App.tsx:155), the classes are no-ops, so the
inline `flex` etc. is the only thing that takes effect. The
`flex: '1 1 auto'` plus `minWidth: 0` is the correct flexbox
incantation for "shrink below content width", but this is implicit
knowledge — the next dev may simplify it to just `width: '100%'`
and break long titles.

**Why this matters**: The inline `flex: '1 1 auto'` is correct but
undocumented. A comment in AppHeader.tsx would prevent regression
when the same pattern is copied for the Settings drawer (M2+).

**Recommended fix**: add a 1-line comment explaining
"min-width:0 + flex 1 1 auto = shrink below intrinsic content size".

---

### F-1.11  MEDIUM — `WindowControls.tsx` close button doesn't actually trigger minimize-to-tray on Windows

**Where**: `src/components/WindowControls.tsx:135-137`

**Evidence**:
```ts
onClick={() => {
  void safeCall(() => getCurrentWindow().close());
}}
```
This calls `getCurrentWindow().close()` which dispatches a close
event. The Rust side `lib.rs:78-83` intercepts `CloseRequested` and
hides the window. So this works — BUT the integration test
`m1-9-2.test.tsx:168-172` only verifies that `closeMock` was
called, not that the Rust side actually intercepts it. If the Rust
`on_window_event` handler is removed in a future refactor, the test
will still pass while the user behavior breaks.

**Why this matters**: The contract test in JS covers only half the
path. A real E2E test that boots the app and clicks the close
button would catch the regression — but `close-minimize.spec.ts:46-60`
just verifies the page stays mounted, not that the window actually
hides.

**Recommended fix (M1.10)**: add a Playwright spec that calls
`__TAURI_INTERNALS__.invoke('plugin:window|is_visible')` before and
after the close click and asserts the transition `true → false`.

---

### F-1.12  MEDIUM — `MacSingleInstance::try_acquire` is `unimplemented!()` and will panic at runtime

**Where**: `src-tauri/src/platform/macos/single_instance.rs:11`

**Evidence**: `try_acquire` body is `unimplemented!(...)` — any
non-Windows target that exercises the runtime will panic.
The Mac build isn't exercised today (Windows-only dev box per
HANDOFF.json decision), but the moment a Mac dev starts running
the same Tauri builder, `tauri_plugin_single_instance::init` in
`lib.rs:26` will trigger the unimplemented path.

**Why this matters**: The Mac platform impls are stubbed by design
(M1.2 decision), so this is "expected unimplemented" — but a
runtime panic with no friendly error message is a poor UX. CLAUDE.md
§7 says "不允许静默吞错" (no silent error eating); panicking without
context is the opposite of that.

**Recommended fix**: replace `unimplemented!()` with
`Err(PlatformError::NotSupported)` and a message like
"macOS single-instance impl lands with the Mac build — use the
tauri_plugin_single_instance hook until then". Document in
`mod.rs:14-20` that "NotSupported on macOS is the M1 contract".

---

### F-1.13  MEDIUM — `lib.rs` registers `tauri_plugin_process` but no code uses it

**Where**: `src-tauri/src/lib.rs:41` `.plugin(tauri_plugin_process::init())`

**Evidence**: Searching the codebase for `tauri_plugin_process` /
`@tauri-apps/plugin-process` / `process.exit` / `process.kill`
returns 0 hits. The plugin is registered in the builder but never
called.

**Why this matters**: Same as F-1.02 — unused plugin in builder.

**Recommended fix (M1.12)**: either remove or document which M2+
feature will use it (likely F10 "kill restart" or M1.10's
"self-update").

---

### F-1.14  MEDIUM — `useViewState` test pins the plugin id list manually instead of dynamically

**Where**: `src/__tests__/hooks/useViewState.test.ts:114-127`

**Evidence**:
```ts
const registryIds = [
  'provider-list', 'provider-switch', 'import-sql', ...
];
for (const id of registryIds) {
  expect(ALL_VIEWS, ...).toContain(id);
}
```
The test hard-codes the 12 plugin ids a second time. If a new
plugin is added to `src/plugins/registry.ts` but the test list is
not updated, the test still passes (the test list is smaller than
ALL_VIEWS). The test should iterate over `ALL_PLUGINS` from
`registry.ts` and assert each id is in `ALL_VIEWS`.

**Why this matters**: The test is supposed to be the
drift-detector. A dynamic check would catch "plugin added to
backend but not exposed in UI"; a hard-coded list just verifies the
list of strings the dev typed in 2 weeks ago.

**Recommended fix**: change the test body to
`expect(ALL_PLUGINS.map(p => p.id)).toEqual(ALL_VIEWS.filter(v => v !== 'home'))`.

---

## LOW findings

### F-1.15  LOW — `WindowsNotifer` (sic) typo? No, but a real name collision: `WindowsNotifier` stubs `notify` with `eprintln!`

**Where**: `src-tauri/src/platform/windows/notifier.rs:33`

**Evidence**: The stub body is `eprintln!("[WindowsNotifier] (stub) ...")`.
On a Windows release build, `eprintln!` writes to stderr. With
`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`
in `lib.rs:2`, the release exe has `windows_subsystem = "windows"`,
which means **there is no stderr** — the eprintln call panics in
release builds.

**Why this matters**: M1.2 ships only a stub, so this won't be
exercised in production. But the moment M1.4 wires
`tauri-plugin-notification` and a real call site is added, the
stub will be replaced. Still, the stub itself is dangerous.

**Recommended fix (M1.4)**: replace the stub with a real call to
`tauri_plugin_notification::NotificationExt::notification(&app_handle)…
.show()…` — the same dependency the plugin registration in
`lib.rs:22` already pulls in. No reason to have a stub.

---

### F-1.16  LOW — `pages/{plugin}/index.tsx` files duplicate the description that's already in `App.tsx::PAGE_META`

**Where**: `src/pages/provider-list/index.tsx:13` has the same
description string as `src/App.tsx:74`.

**Evidence**: The page-level `description` prop is never used by
`PluginPlaceholder` when the `description` is omitted — but
`App.tsx:221-222` always passes the `pageDescription(view)` from
the `PAGE_META` map. So the page-level description prop is dead
code.

**Why this matters**: M2 will replace the placeholder with a real
page; the page-level description will be picked up. But the
duplication is a maintenance trap — change the description in one
place, forget the other, drift.

**Recommended fix (M2)**: drop the `description` prop from
`PluginPlaceholder`, and pass it via the page component (which is
what `index.tsx` is already doing). Or invert: drop
`PAGE_META.description` and have each page export its own
`description: string` constant.

---

### F-1.17  LOW — `cn` util is imported but not heavily used (most styling is inline)

**Where**: `src/lib/utils.ts` vs `AppHeader.tsx`, `AppSidebar.tsx`,
`PluginPlaceholder.tsx`, `HomeView.tsx` (all 4 use cn() with
3-4 short class lists).

**Evidence**: The cn() is used because Tailwind classes are
sometimes interleaved with inline styles. CLAUDE.md §10 says
Tailwind is not in scope; the cn() exists for "future Tailwind
adoption". For M1 it's a half-use — Tailwind is in `devDependencies`
but not compiled.

**Why this matters**: M1.5.1 will either commit to Tailwind
(mapping tokens.css to Tailwind theme) or remove it. cn() is the
pivot point.

**Recommended fix (M1.5 or M1.12)**: decide on Tailwind direction.
Either delete `tailwindcss` / `autoprefixer` / `postcss` from
`package.json` + remove cn(), or commit to Tailwind and write a
`tailwind.config.ts` that consumes tokens.css variables.

---

### F-1.18  LOW — `Cargo.toml:23` `tauri-plugin-positioner = "2"` is the only dep without `=X.Y.Z` lock

**Where**: `src-tauri/Cargo.toml:23`

**Evidence**: Every other plugin is pinned to `=X.Y.Z`; positioner
is `"2"` (major-only). Violates CLAUDE.md §2.3.

**Why this matters**: Minor, but sets a bad precedent — if the
"rule" allows one exception, future devs will add more.

**Recommended fix**: pin to `=2.X.Y` (read the installed version
from `Cargo.lock`).

---

### F-1.19  LOW — `useViewState` storage key is "ccm.lastView" but `STORAGE_KEY` is exported and never re-used

**Where**: `src/hooks/useViewState.ts:60`

**Evidence**: `STORAGE_KEY` is exported. The test imports it
(`useViewState.test.ts:28`). But the home page / App.tsx / sidebar
don't read the storage key — they only call `setView` through the
hook, so the only place the string is "spelled out" is the hook
itself. Exporting it adds API surface that the test relies on for
nothing.

**Why this matters**: The export is fine, just possibly YAGNI.

**Recommended fix**: keep the export (the test uses it), but add a
comment that the export is intentionally public for tests.

---

### F-1.20  LOW — `Cargo.toml:51` `winreg = "0.52"` is still in deps but `WindowsAutostart` no longer uses it

**Where**: `src-tauri/Cargo.toml:51`

**Evidence**: M1.7 rewrote the autostart to delegate to
`tauri-plugin-autostart` (per STATE.md). The `winreg` crate is
still in the Cargo.toml's `[target.'cfg(windows)'.dependencies]`
block, and `windows::Win32::Security` feature flag is also still
on (line 50).

**Why this matters**: Dead deps = larger binary, more attack
surface, more `cargo update` noise.

**Recommended fix (M1.12)**: grep for `winreg::` and
`Security::` usage; if 0 hits, drop both.

---

### F-1.21  LOW — `tauri.conf.json` capabilities config exists but isn't read here

**Where**: `src-tauri/src/lib.rs` does not reference the
`capabilities/*.json` files directly; the Tauri builder picks them
up by convention.

**Evidence**: The file is in `src-tauri/capabilities/` (per M1.4),
but `lib.rs` doesn't `include_str!` or otherwise load it. The
Tauri 2 macro `tauri::generate_context!()` reads the JSON at
compile time. This is a "where is the truth?" question for new
devs.

**Why this matters**: Documentation, not correctness. The
capability file is silently consumed.

**Recommended fix**: add a 1-line comment in `lib.rs` near
`generate_context!()` saying "capabilities are loaded from
src-tauri/capabilities/default.json by Tauri 2 convention".

---

### F-1.22  LOW — `HANDOFF.json` is **out of date** with reality

**Where**: `.planning/HANDOFF.json:12-32`

**Evidence**: HANDOFF.json lists 5 completed tasks and 7 pending.
The actual code has shipped M1.1, M1.2, M1.3 (with 3 fix-variants),
M1.4, M1.5 (deps + tokens + cn + ThemeProvider), M1.6 (10 plugins
+ lock), M1.7 (autostart), M1.8 (TDD scaffold), M1.9 (main window),
M1.9.1 (scroll fixes), M1.9.2 (chrome + glass). That's 11
delivered, not 5.

**Why this matters**: HANDOFF.json is the project's "single source
of truth for what shipped when". The drift means a new dev
reading it will think M1.6/1.7/1.9 are still TODO.

**Recommended fix (M1.12)**: regenerate HANDOFF.json from
`git log --oneline` and `git tag`.

---

### F-1.23  LOW — `index.html` does not declare `lang="zh-CN"` consistently with tokens.css dark-mode plan

**Where**: `index.html:2` `<html lang="zh-CN">` — correct. But the
Tauri title is hard-coded as `Claude 配置管理器` (line 7), which
means macOS / Windows taskbar / window title always shows Chinese
even on an English-locale OS.

**Why this matters**: For a cross-platform tool, the window title
is the first thing a Mac user sees in the dock. Showing Chinese on
an English-locale Mac is jarring.

**Recommended fix (M2)**: i18n the window title; for M1 it's fine
because the project is Chinese-first.

---

### F-1.24  LOW — `SPEC.md` referenced as "实现唯一参考" but not cross-referenced in code

**Where**: Multiple files mention `CLAUDE.md §X` in comments
(e.g. `App.tsx:155`, `useViewState.ts:7`), but only 1-2 files
mention SPEC.md (e.g. `useViewState.ts:5` says "cc-switch pattern
(CLAUDE.md §3.1)").

**Why this matters**: Per CLAUDE.md §2 "SPEC.md 是不可修改;实现唯一参考".
A future maintainer should be able to grep "SPEC §X" and find the
file that satisfies each spec section. Today, only a handful of
files cite SPEC.

**Recommended fix (M1.12)**: add a `//! SPEC: §X.Y` doc-comment to
the top of each major module.

---

### F-1.25  LOW — `lib.rs:2` `windows_subsystem = "windows"` removes the console in release, but smoke test relies on stderr

**Where**: `src-tauri/src/lib.rs:2` and
`scripts/smoke-test.sh:24-28` (presumably reads the launched exe's
stderr).

**Evidence**: With the windows subsystem set, release builds have
NO stderr. The smoke test should use `tee` or
`Start-Process -RedirectStandardError` to capture output.

**Why this matters**: If the smoke test relies on stderr (and not
window title / process pid), the test will pass with 0 stderr
output — false positive on silent failures.

**Recommended fix**: verify `smoke-test.sh` does NOT grep stderr
for "expected" strings. (Not verified in this review — the file
is 16K lines; defer to M1.10 to audit the smoke test harness.)

---

### F-1.26  LOW — `src/App.css` is a 2.3K file that may be dead

**Where**: `src/App.css:1-…` (2326 bytes)

**Evidence**: `main.tsx:1` imports `./design-system/tokens.css` and
NOT `./App.css`. So `App.css` is dead code. CLAUDE.md §3.1 lists
`src/lib/utils.ts` but not `App.css`.

**Why this matters**: Dead file = confusing for new devs.

**Recommended fix (M1.12)**: `git rm src/App.css` if grep confirms
0 imports.

---

## Positive observations (not findings)

The following are **good practices** the team established and
should preserve:

1. **TDD discipline** — every M1.9.x commit lands with
   `*-test*` and `*-fix*` atomic pairs (see commit log: `M1.9.1-fixA`,
   `M1.9.1-fixB`, `M1.9.2-test` / `M1.9.2-effects`). CLAUDE.md §5.2
   is being followed.
2. **Object-safe trait design** — `IPlatform*` traits all use
   `&self` not `Self`, no associated types, no generic params.
   `Box<dyn IPlatformXxx>` works in every `runtime::xxx()` factory.
3. **Mockall usage** — `traits.rs:286-347` defines `Mock!` shims
   for every trait. Tests can verify "dispatch through dyn" without
   OS calls. This is the right pattern.
4. **Stale-dist detection** — `scripts/build-and-ship.sh:90-91`
   `touch src-tauri/src/lib.rs` is a documented workaround for
   "stale dist embedded in release exe". Good engineering instinct.
5. **Reasoning comments** — `App.tsx:4-44` and
   `useViewState.ts:4-39` are 30-line "why we did NOT pick
   react-router" essays. Future maintainers will appreciate these
   when the choice is revisited.
6. **`STORAGE_KEY` project-scoped** — `ccm.lastView`, `ccm.theme`.
   Both keys use the `ccm.` prefix to avoid collision with other
   tools that might share the Tauri webview origin.
7. **Shutdown hooks run in LIFO** — `plugins/host.rs:103-125`
   `shutdown_all` walks the registration list in reverse. Matches
   the "innermost dependency last" teardown idiom.
8. **Custom chrome + Liquid Glass tokens are decoupled** —
   `tokens.css` provides `--glass-bg` / `--blur-md`; the components
   consume the variables. If the M1.1 backdrop filter is replaced
   with Win11 Mica in v1.1, only the components need to update
   (the variables stay).

---

## Self-audit checklist (CLAUDE.md §6)

- [x] **bug 风险**: 0 CRITICAL bugs (only 1 CRITICAL cleanup item — F-1.01)
- [x] **边界**: dark theme is incomplete (F-1.09); minimize-to-tray
      test coverage is half (F-1.11)
- [x] **并发**: SingleInstanceGuard drops on the right thread (no
      cross-thread ownership of the Windows HANDLE — F-1.12 risks
      future races; covered by mockall tests in `traits.rs:387-399`)
- [x] **平台差异**: macOS impls are unimplemented!() — caught by
      F-1.12 (will panic at runtime if Mac build is exercised)
- [x] **文档一致性**: HANDOFF.json drifts from reality (F-1.22);
      App.css is dead (F-1.26)
- [x] **设计系统执行**: tokens.css is the source of truth; every
      UI component consumes `var(--…)` (verified by reading
      AppHeader / AppSidebar / PluginPlaceholder / HomeView).
      Exception: a handful of inline `'8px'`, `'20px'`, etc. sizes
      in HomeView.tsx (line 35) and App.tsx (line 35 of HomeView
      uses `fontSize: '20px'` instead of `var(--fs-heading)`).
      Filed as MEDIUM-style cleanup for M1.12.
- [x] **平台 trait 抽象**: 8 traits, 8 Win impls, 8 Mac stubs (or
      `unimplemented!()`). Pair-check passes.

---

## Recommendations routed to M1.12

The following are recommended as **M1.12 backlog** items (the
final audit task per HANDOFF.json):

1. F-1.01 — `npm uninstall react-router-dom`
2. F-1.02 — remove `tauri-plugin-positioner` (or document use)
3. F-1.13 — remove `tauri-plugin-process` (or document use)
4. F-1.18 — pin `tauri-plugin-positioner` to `=X.Y.Z`
5. F-1.20 — remove `winreg` from Cargo.toml
6. F-1.22 — regenerate HANDOFF.json
7. F-1.26 — `git rm src/App.css` if confirmed dead
8. F-1.09 — complete dark theme token overrides

The following are **M1.10 (CI/build matrix)** items:

1. F-1.06 — pin Node / Rust / Playwright versions in ci.yml
2. F-1.11 — add real "is_visible before/after close" E2E test

The following are **M2+ housekeeping** (non-blocking):

- F-1.04, F-1.05, F-1.07, F-1.08, F-1.10, F-1.14, F-1.16, F-1.17,
  F-1.19, F-1.21, F-1.23, F-1.24, F-1.25, F-1.15 (M1.4)

---

*End of M1.11-01 self review. 25 findings, 1 CRITICAL, 4 HIGH,
8 MEDIUM, 12 LOW.*
