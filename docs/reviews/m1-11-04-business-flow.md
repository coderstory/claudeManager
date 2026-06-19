# M1.11-04 — Business Flow Analysis: 4 Critical User Journeys

> **Scope**: CLAUDE.md §6 step 4 — walk each user-facing flow
> end-to-end, look for breakpoints, rate risk, propose mitigation.
>
> **M1 boundary**: M1.x ships the architecture only — no business
> logic. The 4 flows below exercise the **shell, theming,
> navigation, and platform integration** that the user will see in
> the M1 ship. Each flow is documented as it exists today, with
> honest acknowledgement of where the flow ends at "M2 will do the
> real work".

---

## Flow 1 — First launch (cold start)

### Step-by-step trace

```
[1]  User double-clicks ClaudeConfigManager-M1.1.9.2-fix.exe on desktop.
[2]  Windows PE subsystem loads; main() in src-tauri/src/main.rs runs.
     main() calls claude_config_manager_lib::run() in lib.rs:5.

[3]  lib.rs:16  tauri::Builder::default() builds the runtime.
[4]  lib.rs:17-41  Plugin init chain runs in order:
        - tauri_plugin_opener
        - tauri_plugin_positioner (unused, F-1.02)
        - tauri_plugin_fs / dialog / notification / shell / os
        - tauri_plugin_deep_link
        - tauri_plugin_single_instance (acquires kernel mutex per
          WindowsSingleInstance::try_acquire, src-tauri/src/platform/
          windows/single_instance.rs:28-53)
        - tauri_plugin_store / log / updater / autostart / process
     Each plugin's init() may fail; tauri::Builder propagates errors.

[5]  lib.rs:43-45  invoke_handler registers 2 commands:
        - commands::autostart::get_autostart_status
        - commands::autostart::set_autostart_enabled
     These are accessible from JS via `invoke('get_autostart_status')`.

[6]  lib.rs:46-87  .setup() closure runs ONCE after Tauri context
     is initialized. Steps inside:
        6a) platform::init_for_runtime()  // no-op for M1.x
        6b) Build MenuItem "显示主窗口" + "退出" (Chinese strings,
            lib.rs:52-53)
        6c) Create tray icon with id "main-tray", tooltip
            "Claude 配置管理器", and the show+quit menu
        6d) Register window.on_window_event handler that intercepts
            CloseRequested → hides the window

[7]  tauri::generate_context!() (lib.rs:88) reads
     tauri.conf.json + capabilities/default.json + dist/index.html.
     With the --features tauri/custom-protocol flag (per
     build-and-ship.sh:109), the dist/ files are embedded into the exe.

[8]  .run(tauri::generate_context!()).expect(...) blocks the main
     thread. The Tauri runtime spawns:
        - The webview process (WebView2 on Win11)
        - The IPC bridge (window.__TAURI_INTERNALS__)
        - The tray icon loop (Windows message pump)

[9]  The webview loads the embedded dist/index.html (per
     --features tauri/custom-protocol). Per index.html:6, the page
     has viewport meta `user-scalable=no` and title "Claude 配置管理器".

[10] main.tsx:17-23 renders <ThemeProvider><App /></ThemeProvider>.
[11] main.tsx:15 invokes applyWindowEffects() — fire-and-forget.
     applyEffects.ts:88-109 detects platform via navigator.userAgent
     and calls setEffects({ effects: [Effect.Mica] }) on Win11.
     On Win10 / older, the call rejects; the catch logs to console
     and proceeds (no startup block).

[12] App.tsx:130-144 mounts. useViewState() reads localStorage
     'ccm.lastView' (defaults to 'home'). Renders <AppHeader /> +
     <AppSidebar /> + main pane with HomeView.

[13] HomeView (src/pages/home/index.tsx:23-95) renders the welcome
     heading + 12 home tile buttons (one per plugin id, excluding
     'home' itself).

[14] ThemeProvider (src/design-system/ThemeProvider.tsx:54-102)
     applies the resolved theme to documentElement.dataset.theme.
     On cold start with no localStorage, theme = 'light'.
     tokens.css's :root selector sets all CSS variables.

[15] The user sees:瓷白 (#FAFAF7) background, dark text, glass header
     + sidebar with backdrop blur (or fallback if Mica failed),
     12 plugin tiles, dark window-control buttons on the right.
```

### Breakpoints — where the flow can fail

#### BP-1.01  RISK: HIGH  — `windows_subsystem = "windows"` in lib.rs:2 disables stderr in release

**Where**: `src-tauri/src/lib.rs:2`

**Symptom**: In release builds, the PE subsystem is `windows`,
which means **there is no stderr handle**. If a panic occurs at
step [4] (plugin init) or step [8] (Tauri context init), the user
sees nothing — the exe just doesn't launch. There is no crash
dialog, no log file, nothing.

**Evidence**: `lib.rs:2` `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`.

**Mitigation**:
- Long-term: write panic messages to `AppPaths::logs_dir()` (M2+).
- Short-term: ship the debug build for the M1.x ships (already
  what `scripts/build-and-ship.sh` does) — debug builds keep the
  console subsystem and a panic shows in the parent terminal.
- The current pipeline (release build) is a known limitation,
  documented in STATE.md "M1.1-fix" decision.

#### BP-1.02  RISK: HIGH  — Single-instance mutex check at step [4] can leave a stale handle

**Where**: `src-tauri/src/platform/windows/single_instance.rs:28-53`

**Symptom**: If a previous instance crashed without releasing the
mutex (`Local\\ClaudeConfigManager.lock`), the new instance
acquires nothing (returns `PlatformError::Other("already running")`),
which is then propagated to Tauri, which... does what? The error
path through `tauri_plugin_single_instance::init` is silent — the
Tauri side just runs the new instance anyway (or doesn't, depending
on plugin version).

**Evidence**: `single_instance.rs:41-49` releases the duplicate
handle, but if the user's machine has a stale mutex from a kernel
panic, the new instance can never acquire.

**Mitigation**:
- Add a "stale mutex cleanup" pass in `WindowsSingleInstance::try_acquire`
  that times out after 5 seconds and tries to delete the mutex by
  name (no risk if the mutex is still held by a live process).
- Document "if launch fails twice, run `taskkill /F /IM
  ClaudeConfigManager.exe`" in a README.

#### BP-1.03  RISK: MEDIUM  — `applyWindowEffects` silently fails on Win10 / Linux / older WebView2

**Where**: `src/design-system/applyEffects.ts:88-109`

**Symptom**: On Win10 or a machine where WebView2 is not at the
required version, `setEffects` rejects. The catch logs to
`console.error`. The user sees the app launch with **no Mica
backdrop** — the CSS `backdrop-filter: blur()` fallback in
AppHeader / AppSidebar / PluginPlaceholder covers this
visually. So the user experience is "looks like glass anyway".

**Evidence**: `applyEffects.ts:96-108` try/catch around setEffects.

**Mitigation**: Already handled — the CSS fallback is the visual
floor. No action needed; the catch is correct.

#### BP-1.04  RISK: MEDIUM  — `navigator.userAgent` platform detection is fragile

**Where**: `src/design-system/applyEffects.ts:49-55`

**Symptom**: As P-2 in the peer review noted, `navigator.userAgent`
is being deprecated in Chromium. On a future WebView2 release, it
may return a non-Mac/non-Win string, and `detectPlatform()`
returns `'other'`, and **no native effect is applied**. The CSS
fallback still works, but the team loses the OS-native feel.

**Evidence**: `applyEffects.ts:49-55` uses `.includes('mac')` and
`.includes('win')` substring matches.

**Mitigation**: Use `tauri-plugin-os` (already in deps) via
`@tauri-apps/plugin-os` to get a typed `Os` enum. P-2 fix.

#### BP-1.05  RISK: LOW  — Cold-start localStorage is empty; useViewState falls back to 'home'

**Where**: `src/hooks/useViewState.ts:115-119`

**Symptom**: First-ever launch → localStorage is empty → home view.
This is correct behavior. The home tile grid is rendered. The
user sees the welcome page.

**Evidence**: `readInitialView()` returns `HOME_VIEW` on empty
localStorage.

**Mitigation**: None needed. The flow is correct.

#### BP-1.06  RISK: LOW  — Token CSS is imported at module load (tokens.css → main.tsx:1)

**Where**: `src/design-system/tokens.css` and `src/main.tsx:1`

**Symptom**: If the import chain (main.tsx → tokens.css) breaks
(e.g. a tree-shaking misconfiguration), the page renders without
design tokens. Result: text is browser-default, layout collapses.

**Evidence**: `main.tsx:1` `import "./design-system/tokens.css";`
— single import, no error handling.

**Mitigation**:
- M1.12: add a Vitest test that imports main.tsx in jsdom and
  asserts `getComputedStyle(document.body).background !== ''`.
- M2: tree-shake guard via Vite's `vite-plugin-checker`.

---

## Flow 2 — In-app navigation (route switching)

### Step-by-step trace

```
[1]  User clicks a sidebar item, e.g. "MCP 管理" — the button
     with data-testid="sidebar-item-mcp-management".

[2]  AppSidebar.tsx:154  onClick={() => onNavigate(view)} fires.
     The `view` is the kebab-case id of the clicked item.

[3]  AppSidebar.tsx:111  onNavigate: (view: ViewId) => void — the
     prop was passed from App.tsx:174 <AppSidebar onNavigate={handleNavigate} />.

[4]  handleNavigate is defined in App.tsx:138-143:
        const handleNavigate = useCallback(
          (next: ViewId) => { setView(next); },
          [setView],
        );

[5]  setView(next) is the closure returned by useViewState() (called
     in App.tsx:131). The closure body (useViewState.ts:137-151):
        setViewState((prev) => {
          if (prev === next) return prev;  // no-op for same view
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, next);
          }
          return next;
        });

[6]  setViewState updates React's internal state for `view`.

[7]  App.tsx:130-144 re-renders. The <AppSidebar currentView={view}
     onNavigate={handleNavigate} /> passes the new `view` down.

[8]  AppSidebar re-renders. AppSidebar.tsx:149 isActive =
     currentView === view. The new active item gets the
     accent-colored left border + bg-overlay background.

[9]  App.tsx:200-226 AnimatePresence detects the change in `view`.
     The current <motion.div key={view} /> exits (opacity 0, 150ms).
     A new <motion.div key={next}> enters (opacity 0 → 1, 150ms).

[10] The new motion.div renders either <HomeView> (if view === 'home')
     or <PluginPlaceholder pluginId={view} title={pageTitle(view)}
     description={pageDescription(view)} />.

[11] The sidebar item shows aria-current="page" for accessibility.
```

### Breakpoints

#### BP-2.01  RISK: HIGH  — `setViewState` functional update with localStorage side effect

**Where**: `src/hooks/useViewState.ts:142-148`

**Symptom**: Side effects inside `setViewState` callbacks are
**discouraged** in React 18+ StrictMode. StrictMode invokes the
setter twice in dev to detect side effects; the second invocation
calls `localStorage.setItem` again, which is harmless but
violates the "pure updater" convention. In dev with StrictMode
the smoke test (manual) might show "double write" warnings in
the console.

**Evidence**: `useViewState.ts:142-148` does localStorage write
inside the updater function.

**Mitigation**:
- Move the localStorage write to a `useEffect([view])` block:
  ```ts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, view);
    }
  }, [view]);
  ```
  This is the canonical React pattern. The current code works but
  is unconventional.

#### BP-2.02  RISK: MEDIUM  — AnimatePresence `mode="wait"` is NOT set

**Where**: `src/App.tsx:199-226`

**Symptom**: The current AnimatePresence is the default mode
(`<AnimatePresence initial={false}>` — no `mode` prop = sync mode).
This means the old and new motion.divs **briefly coexist**
during the 150ms transition. If the new view is taller than the
old, the page jumps. The `// No explicit height — the parent <main>
is a flex column with min-height:0` comment (App.tsx:207-211)
acknowledges this.

**Evidence**: App.tsx:199 `<AnimatePresence initial={false}>`.

**Mitigation**: Acceptable per the comment "feels snappier than
`wait`". No action.

#### BP-2.03  RISK: LOW  — Sidebar click on the same item is a no-op (correct)

**Where**: `src/hooks/useViewState.ts:142-144`

**Symptom**: Clicking the currently-active sidebar item is a no-op
(`if (prev === next) return prev;`). This is intentional — the
test `useViewState.test.ts:78-90` pins the behavior. No issue.

#### BP-2.04  RISK: LOW  — Home tile click navigates to plugin placeholder

**Where**: `src/pages/home/index.tsx:55-92`

**Symptom**: Clicking a home tile calls `onNavigate(view)` which
is the same `handleNavigate` from App.tsx. The flow is identical
to sidebar navigation. **No issue**.

---

## Flow 3 — Theme toggle (light → dark)

### Step-by-step trace

```
[1]  User clicks the theme-toggle button — AppHeader.tsx:137-161,
     data-testid="app-header-theme-toggle".

[2]  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
     — toggles between two states, ignoring 'auto'.

[3]  setTheme is the closure from ThemeProvider.tsx:88-90:
        const setTheme = useCallback((next: Theme): void => {
          setThemeState(next);
        }, []);

[4]  setThemeState is React's useState setter. The state update
     triggers a re-render of ThemeProvider.

[5]  ThemeProvider.tsx:62-65 useEffect writes the new theme to
     localStorage:
        useEffect(() => {
          if (typeof window === 'undefined') return;
          window.localStorage.setItem(STORAGE_KEY, theme);
        }, [theme]);

[6]  ThemeProvider.tsx:67-70 useEffect applies the theme:
        useEffect(() => {
          applyTheme(theme);
        }, [theme]);

[7]  applyTheme (ThemeProvider.tsx:48-52):
        function applyTheme(theme: Theme): void {
          if (typeof document === 'undefined') return;
          const root = document.documentElement;
          root.dataset.theme = theme === 'auto' ? readSystemTheme() : theme;
        }

[8]  document.documentElement.dataset.theme = 'dark' triggers CSS
     recomputation. tokens.css:96-113 [data-theme="dark"] block
     overrides:
        --bg-primary, --bg-elevated, --bg-overlay,
        --text-primary, --text-secondary, --text-muted,
        --border, --accent,
        --glass-bg, --glass-bg-strong, --glass-border, --glass-shadow
     NOT overridden (per F-1.09): --success, --warning, --danger,
     --shadow-sm, --shadow-md.

[9]  All CSS variables change. Every component using var(--…) sees
     the new values immediately.

[10] Icon flips from <Moon /> to <Sun /> (AppHeader.tsx:156-160).

[11] Reload: on next mount, ThemeProvider.tsx:55-59 reads the
     localStorage 'ccm.theme' and starts in the persisted theme.
```

### Breakpoints

#### BP-3.01  RISK: HIGH  — Toggle ignores 'auto' mode (degrades to binary toggle)

**Where**: `src/components/AppHeader.tsx:139`

**Evidence**:
```ts
onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
```

**Symptom**: The ThemeProvider supports 3 modes ('light' /
'dark' / 'auto'), but the toggle button only switches between
'light' and 'dark'. If the user's persisted theme is 'auto',
clicking the toggle forces them to 'light' (or 'dark'). The
'auto' mode is **destroyed** by a single click.

**Mitigation**:
- Replace with a 3-state cycle: 'light' → 'dark' → 'auto' → 'light'.
- Or add a separate dropdown for mode selection.

#### BP-3.02  RISK: MEDIUM  — Dark theme is incomplete (F-1.09)

**Where**: `src/design-system/tokens.css:96-113`

**Symptom**: `--success` / `--warning` / `--danger` /
`--shadow-sm` / `--shadow-md` / `--disabled` are not overridden
in dark mode. In dark theme, `--success` (#388E3C) is too
washed-out on dark bg; `--shadow-sm` (rgba(0,0,0,0.04)) is
invisible.

**Mitigation**: F-1.09 fix (M1.12).

#### BP-3.03  RISK: MEDIUM  — Cold-boot race window when stored='auto'

**Where**: `src/design-system/ThemeProvider.tsx:55-59`

**Symptom**: As F-1.04 noted, if the user has 'auto' persisted,
the initial useState reads 'auto' (not the resolved value). The
first render uses `theme='auto'`, but `document.documentElement.dataset.theme`
is empty until the useEffect runs (1 render later).

**Mitigation**: F-1.04 fix.

#### BP-3.04  RISK: LOW  — CSS variables propagate instantly (no animation)

**Where**: `src/design-system/tokens.css:96-113`

**Symptom**: The theme change is instantaneous. Some users prefer
a 200ms fade transition between themes. The tokens.css does not
define `transition: background 200ms` etc.

**Mitigation**: M2 enhancement.

---

## Flow 4 — Close button (minimize-to-tray)

### Step-by-step trace

```
[1]  User clicks the close button — WindowControls.tsx:117-142,
     data-testid="app-header-close".

[2]  onClick (WindowControls.tsx:135-137):
        onClick={() => {
          void safeCall(() => getCurrentWindow().close());
        }}

[3]  safeCall (WindowControls.tsx:65-75):
        async function safeCall(action) {
          try { await action(); }
          catch (err) { console.error('[WindowControls] ...', err); }
        }

[4]  getCurrentWindow() (from @tauri-apps/api/window) returns the
     current WebviewWindow handle. .close() dispatches an internal
     Tauri command: `plugin:window|close`.

[5]  The Tauri runtime fires the WindowEvent::CloseRequested on
     the Rust side (lib.rs:78-83).

[6]  lib.rs:78-83 handler:
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
              api.prevent_close();
              let _ = window_clone.hide();
          }
        });

[7]  api.prevent_close() tells Tauri "do not destroy the window".
[8]  window_clone.hide() hides the window from the user's screen.
     The tray icon stays in the notification area.
[9]  The webview process is still alive. React state is preserved.
     The process is in a "hidden" state — no CPU usage.

[10] User sees: window disappears. Tray icon stays.
[11] User clicks tray icon → ... (the M1.1 spec includes a
     right-click menu with "显示主窗口" + "退出").
```

### Breakpoints

#### BP-4.01  RISK: HIGH  — `safeCall` swallows close errors silently (P-7)

**Where**: `src/components/WindowControls.tsx:65-75, 135-137`

**Symptom**: If `getCurrentWindow().close()` rejects (e.g. the
IPC bridge is broken, or the user has a misconfigured WebView2
install), the error is logged to console but the user sees
**nothing happen**. They click close, the window stays open.
No toast, no dialog, no error.

**Mitigation**: For close specifically, **re-throw** the error
or show a toast. As-is, the user is stuck.

#### BP-4.02  RISK: MEDIUM  — Close interception only fires once (potential race with future handlers)

**Where**: `src-tauri/src/lib.rs:76-83`

**Symptom**: The `window.on_window_event` closure is registered
once at setup. If a future M2 feature (e.g. "always-on-top"
toggle) registers a 2nd handler that doesn't call
`api.prevent_close()`, both handlers fire; whichever returns
first "wins" — but the hide() call is unconditional in the
first handler, so the window will still hide.

Actually, the Rust `on_window_event` model is **last-registered-wins**
for the same event type, not first. So a future handler could
**override** this and let the window close.

**Evidence**: Tauri's `Manager::on_window_event` is
documented as "registers a listener; multiple listeners all
fire", but the actual behavior on `CloseRequested` may differ
across versions.

**Mitigation**: Add a comment + a unit test that verifies the
close-to-hide behavior survives a 2nd handler registration.

#### BP-4.03  RISK: MEDIUM  — `window_clone.hide()` is fire-and-forget — what if it fails?

**Where**: `src-tauri/src/lib.rs:81`

**Symptom**: `let _ = window_clone.hide();` discards the result.
If `hide()` fails (very rare — usually means the window is
already destroyed), the user sees the window close (because
prevent_close was called) and… nothing else. The process keeps
running with no visible window. The tray icon may also be gone.

**Mitigation**: Log the error. Or in M2, if hide() fails, exit
the process.

#### BP-4.04  RISK: LOW  — Right-click tray menu works (M1.1 deliverable)

**Where**: `src-tauri/src/lib.rs:56-73`

**Symptom**: The tray menu has 2 items: "显示主窗口" (show) and
"退出" (quit). Clicking "show" calls `window.show() + set_focus()`.
Clicking "quit" calls `app.exit(0)`. Both paths are well-tested
in the existing M1.1 smoke test.

**Mitigation**: None.

#### BP-4.05  RISK: LOW  — Tray icon tooltip / icon source

**Where**: `src-tauri/src/lib.rs:57`

**Symptom**: `app.default_window_icon().unwrap().clone()` — the
icon comes from the embedded `tauri.conf.json::bundle.icon`
array. If no icon is configured, `unwrap()` panics. The M1.x
ship must have an icon.

**Mitigation**: Verify `tauri.conf.json::bundle.icon` is set
in M1.x. (Not audited in this review — defer to M1.10.)

---

## Risk roll-up

| Risk | Severity | Mitigation status |
|---|---|---|
| BP-1.01 release stderr disabled | HIGH | Known limitation, ships as debug build today |
| BP-1.02 stale mutex | HIGH | **M1.12 fix** — add stale-mutex cleanup |
| BP-1.03 applyEffects fail | LOW | Handled via CSS fallback |
| BP-1.04 userAgent fragile | MEDIUM | **M1.12 fix** — use tauri-plugin-os |
| BP-1.05 cold-start empty LS | LOW | Correct behavior |
| BP-1.06 tokens.css import chain | LOW | **M1.12 test** for body bg |
| BP-2.01 setState side effect | MEDIUM | **M1.12 fix** — move to useEffect |
| BP-2.02 AnimatePresence mode | LOW | Acceptable |
| BP-2.03 same-item no-op | LOW | Correct |
| BP-2.04 home tile nav | LOW | Correct |
| BP-3.01 toggle destroys 'auto' | HIGH | **M1.12 fix** — 3-state cycle |
| BP-3.02 dark theme incomplete | MEDIUM | F-1.09 fix |
| BP-3.03 cold-boot auto race | MEDIUM | F-1.04 fix |
| BP-3.04 no transition | LOW | M2 enhancement |
| BP-4.01 close error swallowed | HIGH | **P-7 fix** — re-throw for close |
| BP-4.02 2nd handler override | MEDIUM | **M1.12 add** unit test |
| BP-4.03 hide() fire-and-forget | MEDIUM | Log error in M2 |
| BP-4.04 tray menu | LOW | Correct |
| BP-4.05 icon unwrap | LOW | Verify icon set in M1.10 |

---

## Action items routed to M1.12

1. **BP-1.02** — stale mutex cleanup in
   `WindowsSingleInstance::try_acquire`.
2. **BP-1.04 / P-2** — switch `applyEffects.ts` to
   `tauri-plugin-os`.
3. **BP-1.06** — Vitest test that imports main.tsx in jsdom and
   asserts body bg is non-empty.
4. **BP-2.01** — move localStorage write to `useEffect([view])`
   in `useViewState.ts`.
5. **BP-3.01** — 3-state theme cycle in `AppHeader.tsx`.
6. **BP-4.01 / P-7** — re-throw close errors.

## Action items routed to M1.10

- **BP-1.01** — write panic messages to
  `AppPaths::logs_dir()` in M2+ (out of M1.x scope; debug build
  ship today is acceptable).
- **BP-4.05** — verify `tauri.conf.json::bundle.icon` is set.

---

*End of M1.11-04 business flow analysis. 4 flows traced, 19
breakpoints found (4 HIGH, 7 MEDIUM, 8 LOW). 6 routed to M1.12,
2 to M1.10, 1 to M2+.*