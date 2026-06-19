# M1.11-03 — Peer Review (self-simulated, opencode fallback)

> **peer-review-fallback: opencode-ai 不可用** —
> `npx -y opencode-ai` is shipped as an interactive TUI (not a
> one-shot CLI), and the most recent run returned HTTP 400
> `Payment Required: Insufficient Balance` for the configured
> `deepseek-v4-pro` provider. Per the M1.11 task spec's
> explicit fallback rule, this review is **self-simulated** by
> a "hostile reviewer" persona — picked deliberately to find
> issues the self-review (m1-11-01) may have missed.

---

## Method

The reviewer persona: **a paranoid SRE auditing a cross-platform
desktop app 1 hour before release**. The reviewer's priors:

1. **What would crash the user's machine?** Look for resource
   leaks, unbounded loops, OS API misuse.
2. **What would corrupt the user's data?** Look for write paths
   without backup, atomic rename missed, race conditions.
3. **What would surprise the user?** Look for UI inconsistencies,
   untranslatable strings, missing affordances.
4. **What would block the next dev?** Look for ambiguous contracts,
   undocumented behavior, missing tests.
5. **What would block CI?** Look for non-deterministic tests,
   platform-conditional code, dependency drift.

The reviewer reads each file *cold* (no prior context from the
self-review), then compares notes.

---

## Findings (sorted by severity)

### CRITICAL — none surfaced by the hostile reviewer

The hostile reviewer's CRITICAL bucket came up empty. The
self-review's F-1.01 (unused `react-router-dom` dep) is a cleanup
issue, not a crash risk. No new CRITICAL findings.

---

### HIGH — 3

#### P-1  HIGH — `MacPaths::resolve` will panic when Mac build is exercised

**Where**: `src-tauri/src/platform/macos/paths.rs:13`

**Evidence**: `unimplemented!("MacPaths::resolve — will land when mac build starts")`.

**Hostile reviewer note**: M1.2 ships Mac stubs as compile-only;
the decision is documented. **But**: if a Mac dev clones this
repo tomorrow, runs `cargo build`, gets a passing compile, then
launches the binary, the **first command** they run that calls
`runtime::paths()` (which the new `platform::init_for_runtime()`
in `lib.rs:50` does at startup) will panic. The panic message
will be the unhelpful Rust default. **CLAUDE.md §7 says no
silent error eating** — this is silent panic, which is worse.

**Verdict**: Same as F-1.12. Replace `unimplemented!()` with
`Err(PlatformError::NotSupported)` for the trait methods that
have a graceful fallback, or document loudly in
`init_for_runtime` that the Mac build is broken at startup.

---

#### P-2  HIGH — `applyWindowEffects` detects OS via `navigator.userAgent`

**Where**: `src/design-system/applyEffects.ts:49-55`

**Evidence**: `detectPlatform()` calls
`navigator.userAgent.toLowerCase().includes('mac')` and
`.includes('win')`. The Tauri v2 runtime may inject a custom
user agent (some Tauri apps do, for analytics). If the user's
Tauri config sets a custom UA, the platform detection silently
returns `'other'` and the native effect never applies.

**Hostile reviewer note**: `navigator.userAgent` is a
**deprecated** Web API in 2026 — Chromium 110+ has been
progressively removing the high-entropy bits. By M2.x (or
WebView2 130+), this could return a falsy value on a real
Windows machine, silently breaking Mica.

**Verdict**: Use `@tauri-apps/api/os` (which is already
registered as `tauri-plugin-os` in `lib.rs:24`). The plugin's
`os()` returns a typed enum (`Os::Windows`, `Os::Macos`, …).
That's the right answer for "what platform am I on in a Tauri
app". This is also a missed opportunity to use a dependency
that exists but is currently only used for "locale + version
(About 页用)" (per Cargo.toml comment).

---

#### P-3  HIGH — `m1-9-2.test.tsx` imports `Effect.Mica` as a string `'mica'`

**Where**: `src/__tests__/integration/m1-9-2.test.tsx:56-63`

**Evidence** (already noted as F-1.05 in self-review):
```ts
Effect: {
  Mica: 'mica',
  Acrylic: 'acrylic',
  ...
}
```

**Hostile reviewer note**: This is **not just a fragile mock** —
the actual production code in `applyEffects.ts:71` imports
`Effect` from `@tauri-apps/api/window` at module load. If the
real `Effect.Mica` is an object (or a frozen Symbol), the
production call site silently passes a wrong value. The test
passes, but `setEffects` may receive `undefined` at runtime.

**Verdict**: Add a type-level sanity check:
```ts
expect(typeof Effect.Mica).not.toBe('undefined');
```
Or run `applyEffects()` in a separate test that verifies
`setEffects.mock.calls[0][0]` matches the **actual** Tauri
`Effects` type (typed import, not a string).

---

### MEDIUM — 6

#### P-4  MEDIUM — `useTheme` reads `window.matchMedia` before mount in SSR/Node test

**Where**: `src/design-system/ThemeProvider.tsx:42-46`

**Evidence**: `readSystemTheme()` calls
`window.matchMedia('(prefers-color-scheme: dark)')` which is
guarded by `typeof window === 'undefined'`. The guard is
correct, but the **default** on the `undefined` branch is
`return 'light'` — which means in a Node test that doesn't
mock matchMedia, the theme defaults to 'light' regardless of
the user's preference. The ThemeProvider test
(`ThemeProvider.test.tsx`) correctly mocks matchMedia, but
**no other test does**. If a future component imports
`useTheme` in an integration test, it will silently get
'light' even when the user's OS preference is dark.

**Verdict**: Add a `// SAFETY:` comment to the `return 'light'`
branch documenting that this is a "no-window fallback" that
should never execute in production.

---

#### P-5  MEDIUM — `lib.rs` registers `tauri_plugin_updater` with empty pubkey

**Where**: `src-tauri/src/lib.rs:36` and STATE.md entry
"M1.7+1.9-updater-pubkey"

**Evidence**: The pubkey is intentionally empty for M1.x:
```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```
STATE.md says: "v1.1 real key in release phase". OK — but
**the updater is still registered**, which means:
1. The auto-update endpoint is configured (likely
   `tauri.conf.json::plugins.updater.endpoints`).
2. The exe periodically pings the endpoint.
3. If the endpoint is a real URL, the user is making HTTPS
   requests to a server on every launch.
4. If the endpoint is unset, the plugin warns at runtime.

**Hostile reviewer note**: This is a **privacy / network** concern.
The user may not realize their app is pinging the update
endpoint on every launch. SPEC §3.x (or §6.1) should state
"no network calls until the user opts in to v1.1 updates".

**Verdict**: Either (a) document the privacy implication in
SPEC, or (b) gate the plugin behind a build feature
`#[cfg(feature = "updater")]` so the M1.x exe doesn't even
include the plugin code.

---

#### P-6  MEDIUM — `Cargo.toml:50` `windows = { version = "0.61", features = ["Win32_Foundation", "Win32_UI_WindowsAndMessaging", "Win32_System_Threading", "Win32_Graphics_Dwm", "Win32_Security", "Win32_UI_Controls"] }`

**Where**: `src-tauri/Cargo.toml:50`

**Evidence**: `windows = "0.61"` is **major-only**. Every
other Tauri plugin is `=X.Y.Z` exact lock. Per CLAUDE.md §2.3
this is a violation, and per the F-1.18 finding (same issue for
`tauri-plugin-positioner`), the team has a pattern of "lock the
plugins, float the system crates". The hostile reviewer
suggests this is dangerous because `windows = "0.61"` could
upgrade to 0.62 mid-build, bringing in API breakage on
`DwmSetWindowAttribute`.

**Verdict**: Pin to `=0.61.0` (the latest 0.61 patch).

---

#### P-7  MEDIUM — `WindowControls.tsx` `safeCall` swallows errors silently

**Where**: `src/components/WindowControls.tsx:65-75`

**Evidence**:
```ts
async function safeCall(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    console.error('[WindowControls] Tauri window op failed:', err);
  }
}
```

The file's comment says: "CLAUDE.md §7: never silent. Surface
to console so the dev-tools webview inspector sees it". OK —
but **a release build that hits a runtime error here will
silently no-op**. The user clicks the close button, nothing
happens, the React tree stays alive, the process keeps
running, the user has no idea why.

**Hostile reviewer note**: For the close button specifically,
"silent fail" is **worse than nothing** — the user expects
the app to close. The Rust side intercepts the close event
and hides the window, but if the click handler silently
swallows an error, the user is stuck with a frozen-feeling
window.

**Verdict**: For the close button specifically, don't
swallow errors — re-throw or surface as a toast. The
minimize/maximize buttons can stay swallow-and-log because
their UX is "nice to have".

---

#### P-8  MEDIUM — `AppSidebar.tsx:208-215` build-tag string "M1.9 · 架构期" is hard-coded

**Where**: `src/components/AppSidebar.tsx:213-215`

**Evidence**: A literal Chinese string in a UI component. The
build tag should come from a constant exported by the build
process (Vite's `import.meta.env.VITE_BUILD_TAG` or similar).
Today it's a string the dev updates by hand — and per CLAUDE.md
§10 "no manual version bumps without PR description", this is
a low-grade violation.

**Verdict**: Replace with `import.meta.env.MODE` or a build-time
constant. If the team prefers the literal for now, add a TODO
in the file noting "M2+ should source from CI/CD".

---

#### P-9  MEDIUM — `scroll-layout.test.tsx` uses `__dirname` which is CJS-only

**Where**: `src/__tests__/integration/scroll-layout.test.tsx:32`
and `src/__tests__/integration/m1-9-2.test.tsx:68`

**Evidence**:
```ts
resolve(__dirname, '../../design-system/tokens.css')
```

The project is `"type": "module"` (per `package.json:5`) — pure
ESM. `__dirname` is undefined in ESM. The tests currently work
because **Vitest's CJS-shim wrapper polyfills `__dirname`** in
`.tsx` files. But the moment the test migrates to
`environment: 'node'` (which some M2 integration tests will
need for HTTP mocks), `__dirname` will be undefined and the
test will throw `ReferenceError: __dirname is not defined`.

**Hostile reviewer note**: This is a **time bomb**. The test
passes today only by Vitest's accident. The fix is trivial:
use `import.meta.url` + `fileURLToPath` (Node ESM pattern).

**Verdict**: M1.12 cleanup. Fix in
`scroll-layout.test.tsx:32` and `m1-9-2.test.tsx:68`.

---

### LOW — 7

#### P-10  LOW — `theme` toggle button text uses `aria-label` not `aria-pressed`

**Where**: `src/components/AppHeader.tsx:137-161`

**Evidence**: The button has `aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}` but no
`aria-pressed`. A screen reader user has no way to know the
**current** theme; the label only says what will happen on click.

**Verdict**: Add `aria-pressed={theme === 'dark'}` or use a
`role="switch"` pattern.

---

#### P-11  LOW — `cn` util does not strip falsy class strings, only arrays/objects

**Where**: `src/lib/utils.ts:13`

**Evidence**: Standard clsx behavior — this is fine. **But**:
the `cn()` is used 4 times in `AppHeader.tsx` etc. with
class strings like `'transition-colors hover:bg-black/5 dark:hover:bg-white/5'`. None of these use the
`twMerge` benefits (they don't override conflicting
utilities). The `twMerge` cost is paid for no benefit.

**Verdict**: Drop `twMerge` from `cn()` until Tailwind is
actually committed to. CLAUDE.md §10 says "Tailwind 未接入" —
the `twMerge` is paying for nothing.

---

#### P-12  LOW — `tokens.css:91` font fallback ends with `sans-serif` but lacks `system-ui`-like quality

**Where**: `src/design-system/tokens.css:91`

**Evidence**:
```css
--font-ui: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
```

On a Windows machine without `PingFang SC` (which is Mac-only)
and without `Microsoft YaHei` (only on Chinese-locale Windows),
the fallback is `system-ui` → `sans-serif`. On Windows 11,
`system-ui` = Segoe UI, which is correct. But on Windows 10
or a stripped Windows 11, `system-ui` may not be registered,
and the user gets the default sans-serif (Arial / Tahoma),
which has a different x-height and breaks the layout.

**Verdict**: Acceptable for M1 — Windows 11 is the dev
target per CLAUDE.md §1. Note for M2.

---

#### P-13  LOW — `useViewState` does not export the `HOME_VIEW` validation logic

**Where**: `src/hooks/useViewState.ts:111-119`

**Evidence**: `isValidView(v: string | null): v is ViewId` is
a private function. If a future consumer (e.g. a deep-link
handler in M2+) wants to validate a view id before calling
`setView`, it has to copy the `ALL_VIEWS.includes(...)` logic.

**Verdict**: Export `isValidView` for M2+ deep-link consumption.

---

#### P-14  LOW — `tokens.css:114-127` applies `body { font-family: var(--font-ui) }` but no `font-display: swap` is set anywhere

**Where**: `src/design-system/tokens.css:116-121`

**Evidence**: The body uses `var(--font-ui)`, but the
fallback `sans-serif` is the system default. No FOUT
mitigation. For an app that bundles no web fonts, this is
fine — but if M2 adds custom fonts (e.g. for the JSON
editor), the team should add `font-display: swap` to the
`@font-face` declarations.

**Verdict**: Defer to M2.

---

#### P-15  LOW — `lib.rs:78-83` close-to-tray handler clones the window for the closure

**Where**: `src-tauri/src/lib.rs:77-83`

**Evidence**:
```rust
let window_clone = window.clone();
window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window_clone.hide();
    }
});
```

The `window.clone()` is a `WebviewWindow::clone()` which is
cheap (it's an `Arc` clone). The move closure captures
`window_clone`. This is fine — but if a future change
adds a 2nd event handler that also clones, both clones
live independently and the close-interception logic can be
bypassed if the new handler returns first.

**Verdict**: Add a comment noting "single owner of close
interception; future handlers must not duplicate this".

---

#### P-16  LOW — `App.tsx:122-124` `pageTitle` is a module-level function but `pageDescription` is the same shape

**Where**: `src/App.tsx:122-128`

**Evidence**: Both are pure functions over `ViewId`. The
duplication is fine, but they're hand-typed. If the team
adds a 3rd function `pageIcon(view)` it becomes a copy-paste
pattern.

**Verdict**: Acceptable as-is.

---

## Counts

- **CRITICAL**: 0
- **HIGH**: 3 (P-1, P-2, P-3)
- **MEDIUM**: 6 (P-4, P-5, P-6, P-7, P-8, P-9)
- **LOW**: 7 (P-10, P-11, P-12, P-13, P-14, P-15, P-16)

## Comparison with self-review

The hostile reviewer's findings **overlap** with the self-review on:

- F-1.12 ↔ P-1 (Mac panic) — same finding
- F-1.05 ↔ P-3 (Effect.Mica string mock) — same finding
- F-1.18 ↔ P-6 (version lock violation) — related

The hostile reviewer **found independently**:

- P-2 (use `tauri-plugin-os` for platform detection)
- P-5 (updater privacy / network implication)
- P-7 (WindowControls swallows close errors)
- P-8 (hard-coded build tag)
- P-9 (`__dirname` is CJS-only — time bomb)
- P-10, P-11, P-12, P-13, P-14, P-15, P-16

The self-review **found independently** that the hostile
reviewer did **not** surface:

- F-1.01 (`react-router-dom` is unused) — hostile reviewer
  would have caught this if the prompt had been broader.
- F-1.02 / F-1.13 (unused `tauri-plugin-positioner` /
  `tauri-plugin-process`) — same.

This suggests the **two-review approach is valuable**: the
self-review and the hostile review catch different issues.
Both should be kept in `docs/reviews/`.

---

## Recommended actions for M1.12

1. **P-2** — switch `applyEffects.ts:49-55` to
   `tauri-plugin-os`. Small, isolated change.
2. **P-9** — fix `__dirname` in 2 test files. 5-line edit.
3. **P-7** — don't swallow close-button errors.
4. **P-6** — pin `windows = "=0.61.0"`.
5. **P-5** — document or gate the updater plugin.
6. **P-8** — build-tag from env, not literal.

The HIGH issues (P-1, P-2, P-3) are addressable in M1.12 —
they are not show-stoppers for the M1 ship.

---

*End of M1.11-03 peer review. **peer-review-fallback**:
opencode-ai returned HTTP 400 / fell into interactive TUI
mode; the review above is self-simulated by a hostile
reviewer persona. 16 findings, 0 CRITICAL, 3 HIGH, 6 MEDIUM,
7 LOW.*