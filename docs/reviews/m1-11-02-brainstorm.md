# M1.11-02 — Brainstorm: Adversarial Review of M1 Design Decisions

> **Scope**: CLAUDE.md §6 step 2 — for each design decision M1
> landed, attempt to **break it**. Output is "accept status quo" or
> "recommend change". No code changes here; this is a paper review
> only.
>
> **Method**: pick the 7 most load-bearing decisions, argue the
> opposite position, then deliver a verdict.

---

## Decision 1: No react-router, use `useState<View>` + localStorage

### The decision
`App.tsx:4-44` and `useViewState.ts:4-39` argue that
react-router's `<HashRouter><Routes>…</Routes></HashRouter>` is
overkill for an app that renders **exactly one** primary view at a
time. Instead, the team shipped a 50-line `useViewState` hook that
keeps a `ViewId` in `useState` and persists it under
`localStorage[ccm.lastView]`.

### Adversarial position
"Use react-router anyway." Here's why:
1. **The 12-plugin future will have nested routes.** When F1
   (Provider 列表) eventually has a sub-route per provider
   (`/providers/:id`), and F17 (marketplace) has a
   `/marketplace/:repo/:item` view, the useState pattern breaks —
   there is no place to put the params. The team will have to bolt
   on a path parser.
2. **Deep links are coming.** F4 (deeplink import) ships in M2+.
   When a user clicks `ccswitch://v1/import?…`, the app must
   navigate to `/import`. With useState, the frontend has to
   listen to a Tauri deep-link event, parse the URL, and call
   `setView('import-sql')` — duplicating what react-router would
   do automatically.
3. **The "no URL sharing" argument is weak.** The team writes:
   "we never share URLs between sessions". But the Tauri webview
   URL is `tauri://localhost/main` — there IS a URL, and
   hash-fragment routing on it works fine. Users can't share
   `tauri://` URLs, but they CAN copy-paste the fragment within
   a debugging session, and that fragment is currently lost.
4. **The "13-line useState vs 13-line Routes" framing is
   misleading.** A future contributor who wants to add a 2nd
   `<Route>` (e.g. for a Settings drawer that's a child of the
   home view) now has to add a new useState slot, new
   localStorage key, new fallback logic, new tests. The
   complexity grows linearly with the number of "parallel"
   concerns, whereas react-router handles it declaratively.

### Counter-arguments to the adversarial position
- **Switching to react-router is a 1-day migration** later. The
  cost of being wrong is low.
- **The team explicitly chose cc-switch's pattern.** cc-switch is
  the reference app; the team is copying its UX. Maintaining
  parity is itself a goal.
- **`PluginRoute` already exists in the backend** as a structured
  shape. The frontend can read it via a Tauri command and feed
  react-router when the migration lands.

### Verdict
**Accept status quo, with a forward-looking note.**

The useState pattern is fine for M1 because:
- It ships faster (5 lines vs 50).
- All current tests pass (`useViewState.test.ts` has 9 tests
  covering the contract).
- The migration to react-router is straightforward and gated on
  M2+ actually needing nested routes.

**Action**: Add a comment to `App.tsx:4-44` saying
"Migrate to `<HashRouter>` when F1 sub-routes or F4 deeplink
auto-navigate land in M2.x — see the rationale in
`docs/reviews/m1-11-02-brainstorm.md`."

---

## Decision 2: `useViewState` persists to `localStorage` instead of `tauri-plugin-store`

### The decision
`useViewState.ts:60` `STORAGE_KEY = 'ccm.lastView'` uses the
browser's `localStorage` (which in Tauri = the webview's local
storage). The alternative was `tauri-plugin-store` (which is
registered in `lib.rs:34`).

### Adversarial position
"Use tauri-plugin-store." Here's why:
1. **Tauri's `tauri-plugin-store` writes to a real file**
   (typically `%APPDATA%/ClaudeConfigManager/store.json`). This
   is what the user expects from a "native desktop app" — settings
   live in a discoverable file.
2. **`localStorage` is wiped on app uninstall** in some setups
   (the webview's profile is owned by the WebView2 user data dir;
   on uninstall, that's removed).
3. **The two are out of sync.** M1.5 ships a `useTheme` hook
   that also uses localStorage (`ccm.theme`). M1.7 ships autostart
   that uses... well, nothing yet. If the user backs up
   `%APPDATA%`, none of those settings travel.
4. **`tauri-plugin-store` is already in the binary** (per
   `Cargo.toml:39`). Not using it = dead dep.

### Counter-arguments
- **Tauri's localStorage in v2 is already persistent across
  app restarts** and is backed by the webview's data dir. The
  "wiped on uninstall" argument applies equally to anything in
  the user's profile.
- **`tauri-plugin-store` is async** (returns Promises). The
  current `useViewState` is sync — using the store means a render
  race (the initial render would show 'home' before the stored
  value is loaded, then flicker to the right value). React 18+
  has a `useSyncExternalStore` API to handle this, but it's
  not in the project today.
- **The M1.10 build matrix will pick one.** If `tauri-plugin-store`
  wins, the migration is mechanical (replace localStorage with
  the store). If localStorage wins, `tauri-plugin-store` becomes
  the dead-dep problem from F-1.13.

### Verdict
**Accept status quo, file migration to M1.10.**

**Action**: When M1.10 (build matrix) lands, decide:
- If the team wants a single `%APPDATA%/ClaudeConfigManager/state.json`
  → migrate all 3 hooks (`useViewState`, `useTheme`, future
  `useSettings`) to `tauri-plugin-store`.
- If the team prefers the simplicity of localStorage → remove
  `tauri-plugin-store` from `Cargo.toml:39` and `lib.rs:34` (per
  F-1.13).

---

## Decision 3: Platform traits vs `#[cfg(target_os)]` inline

### The decision
`src-tauri/src/platform/traits.rs` defines 8 traits (`IPlatformPaths`,
`IPlatformSingleInstance`, etc.) and the `mod.rs::runtime` block
picks the right `Box<dyn IPlatformXxx>` per OS. The contract is:
"business code only goes through the trait; never `#[cfg(target_os)]`".

### Adversarial position
"`#[cfg(target_os)]` is fine for a 2-platform project." Here's why:
1. **You only have 2 platforms.** A trait is justified when you
   have N≥3, or when the impls are independently developed. For 2,
   the indirection adds 3-4 files per trait and 200+ lines of
   mockall shims.
2. **The `unimplemented!()` macOS stubs are dead code.** They
   compile but the moment a Mac dev tries to run the app, they
   panic (F-1.12). A `#[cfg(target_os = "macos")]` block would
   either be implemented or not compiled.
3. **The Mockall shims are heavy.** `traits.rs:286-347` defines 8
   `mock! {}` blocks. That's 60+ lines of code that exists solely
   to prove "the trait is dispatchable". A `#[cfg(target_os)]`
   version would test the impl directly on the host OS and skip
   the mocks.
4. **The Tauri framework itself uses `#[cfg(target_os)]`** for
   the autostart plugin's `MacosLauncher` enum. The team's choice
   to wrap that in another trait is layer-cake that the framework
   already provides.

### Counter-arguments
- **The trait is a placeholder for M2+ additions** (e.g. a 3rd
  platform — Linux, Web). The 8-trait interface is the project's
  long-term shape; cc-switch's pattern is also trait-based.
- **The mockall shims catch a real bug class**: a non-object-safe
  trait. If a future dev adds `async fn` to a trait, the compiler
  would not catch it but the `Mock! {}` shim would (object safety
  is enforced by mockall's macro expansion). This is a real
  benefit.
- **M1.7's autostart migration proved the trait helps.** When the
  team switched from hand-rolled `winreg` to
  `tauri-plugin-autostart`, only the `WindowsAutostart` impl
  changed; the trait surface stayed stable. The 5 frontend
  commands, the test, and the dispatcher (lib.rs) were untouched.
  This is the exact win that the trait is designed to deliver.

### Verdict
**Strongly accept status quo.**

The trait abstraction paid off in M1.7 (autostart rewrite with
zero command-surface churn). The 200 lines of mockall shims
caught exactly the kind of bug they were designed to catch (an
early `async fn is_enabled()` draft was reverted). The 8 `unimplemented!()`
macOS stubs are by design — they make the macOS work
discoverable when a Mac dev picks it up.

**Action**: None. Document in `docs/ARCHITECTURE.md` (M1.11
deliverable) that the trait + mockall pattern is the
**M1.7-winning bet** and should be preserved.

---

## Decision 4: CSS inline styles + tokens.css variables vs Tailwind classes

### The decision
The team ships `tokens.css` as the source of truth for colors,
spacing, radius, font sizes. Components consume them via inline
`style={{ color: 'var(--text-primary)' }}` or via
`backdropFilter: 'blur(var(--blur-md))'`. Tailwind is in
`devDependencies` but not compiled (no `tailwind.config.ts`, no
`@tailwind` directives). Some components use a few Tailwind
classes (`flex items-center gap-2`) as a no-op — the classes
exist for future Tailwind adoption.

### Adversarial position
"Just commit to Tailwind." Here's why:
1. **The cn() util already exists.** `src/lib/utils.ts` exports
   `cn(...inputs)` via `twMerge(clsx(inputs))`. This is the
   idiomatic shadcn/ui pattern. If you have cn(), you have
   Tailwind, and you have it now.
2. **Inline styles are verbose and miss compiler hints.** A
   typo like `var(--text-primray)` is a silent CSS error (the
   property falls back to the inherited value). A Tailwind class
   like `text-primary` is a TS error in a properly-typed setup.
3. **The shadcn/ui ecosystem depends on Tailwind.** Radix
   primitives, headless-ui, shadcn/ui's own components — they all
   emit Tailwind classes. Adopting them is a 1-day install
   (`npx shadcn@latest init`) and a 2-day per-component
   conversion. Without Tailwind, every component is a hand-rolled
   inline-styled monster.
4. **The "Tailwind is in devDependencies but not compiled"
   middle state is the worst of both worlds.** Devs add classes
   that look like they'll work, then they don't.

### Counter-arguments
- **The tokens.css pattern is what cc-switch uses** (per
  `App.tsx:8` "Mirrors cc-switch's theme-provider interface").
  Tailwind isn't in cc-switch.
- **CLAUDE.md §4 says CSS variables are the design system
  baseline**, not Tailwind. Switching to Tailwind would
  effectively change the design system contract.
- **The team can have both.** `tailwind.config.ts` can read from
  the CSS variables (`colors: { primary: 'var(--bg-primary)' }`).
  This is the actual shadcn/ui pattern; the dev just hasn't
  written the config yet.
- **The App.tsx:155 inline comment explicitly acknowledges this**:
  "this project doesn't ship a Tailwind config". The team
  **knows** they're deferring it.

### Verdict
**Accept status quo; flag the deferral cost in STATE.md.**

The current "tokens.css + inline + dead Tailwind classes" state
is fine for M1 (all 4 components work, all tests pass). But the
deferral cost grows with each new component. **M1.12 should
decide**: either (a) commit to Tailwind in M1.5.x and write
`tailwind.config.ts`, or (b) commit to no-Tailwind and remove
`tailwindcss`, `autoprefixer`, `postcss`, `cn()` from the project.

**Action**: Add a M1.12 entry: "Decide Tailwind direction. Either
adopt (write tailwind.config.ts that maps tokens.css) or remove
(deps + cn util + all `className=` props that aren't used as
no-ops)."

---

## Decision 5: 12 plugin stubs in M1 vs smaller subset

### The decision
`src-tauri/src/plugins/stubs/mod.rs:12-23` registers 12 plugins:
F1..F8 (core) + F16..F19 (L1 features). F9..F15 and F20..F24 are
deferred to M2+ (per CLAUDE.md §3.3). The frontend mirrors this
in `src/plugins/registry.ts:39-52`.

### Adversarial position
"5 stubs would be enough." Here's why:
1. **8 of 12 are F-numbers that don't ship in M1.x** — they're
   in the registry to satisfy CLAUDE.md §3.3's "plugin = unit of
   M2+ work" pattern, but they don't unlock any user-visible
   behavior.
2. **The plugin architecture is proven by 3 stubs**, not 12.
   `register` / `unregister` / `init_all` / `shutdown_all` /
   `all_routes` / `all_services` are all tested in
   `plugins/host.rs:151-455` with 3-4 plugins. Adding 8 more
   doesn't exercise any new code path.
3. **The frontend `registry.ts` is a single 50-line file** that
   exists to be the "single source of truth" for plugin ids.
   With 12 plugins, it's already 12 lines long. With 5 plugins,
   it would be 5 lines — and the test for "ALL_PLUGINS.length ===
   12" in `plugin-registry.test.ts:8` becomes a 5-length assertion
   that the team can refactor toward 12 incrementally.
4. **The CLAUDE.md "12 plugin F-numbers" is a wishlist**, not a
   spec. The product spec (SPEC.md) says F1..F24 are the
   feature surface; the plugin list is the team's internal
   decomposition. The team chose 12 because that's "what
   cc-switch has" (per M1.3 commit msg). But the team also
   invented 8 of the 12 F-numbers (F9..F15, F20..F24) — those
   aren't in SPEC §3.1, they're synthetic.

### Counter-arguments
- **The 12 stubs exercise the "all 12 work" UI.** The user
  opening the M1 ship sees "12 tiles" — that's the visual
  signal that "all features are registered, even if not
  implemented". A 5-tile UI would look like a half-built app.
- **The "24 F-numbers" in CLAUDE.md §3.3 is a contract.** If
  the team later decides to add F25, the natural extension is
  "add to plugin stubs/mod.rs + plugins/registry.ts + useViewState
  union". With 5 stubs, the team has to invent a new naming
  convention for the rest.
- **The 12 tiles = a "feature roadmap" UI.** HomeView.tsx:55-92
  renders 12 cards; each card is a click-to-enter stub. M2.1
  (Provider 列表) will be the first card to "go live" — a
  one-line swap from PluginPlaceholder to ProviderListPage.

### Verdict
**Accept status quo.**

12 stubs is the right number for a milestone demo. The 24
F-numbers in CLAUDE.md are aspirational, but the 12 that
exist now exercise every architecture concern (route
contribution, service registration, plugin init order,
shutdown LIFO).

**Action**: None. Note in `docs/ARCHITECTURE.md` that "12
stubs is the M1 demo surface; F9..F15 and F20..F24 land in
M2.x".

---

## Decision 6: `tauri-plugin-autostart` over hand-rolled `winreg` (M1.7)

### The decision
`src-tauri/src/platform/windows/autostart.rs:37-58` delegates to
`tauri-plugin-autostart` (Cargo.toml:42 `=2.5.1`). M1.7 replaced
a hand-rolled `winreg` implementation that wrote to
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.

### Adversarial position
"Hand-roll winreg, like cc-switch does." Here's why:
1. **`tauri-plugin-autostart` is a generic plugin** that handles
   N platforms and N cases. It has its own bugs, its own version
   cadence, its own opinion about how `LSUIElement` apps should
   behave on macOS. The hand-rolled version is 30 lines and
   does exactly what this project needs.
2. **The hand-rolled version is testable in isolation** (you can
   mock the registry). The plugin version requires a live
   `AppHandle` (see F-1.03 — same problem).
3. **`winreg` is still in the Cargo.toml** (per F-1.20) — the
   migration is incomplete. The plugin replaces one usage but
   the dep is still pulled in (transitively, but it's there).
4. **cc-switch's pattern is hand-roll.** The reference app uses
   its own `winreg` code. Following the reference means the
   team inherits cc-switch's bug fixes (when they happen).

### Counter-arguments
- **The M1.7 commit message is clear: "the hand-rolled winreg
  code that used to live here was retired in M1.7 because the
  official plugin already handles all the edge cases (path
  quoting, --minimized flag, error mapping)"**. This is a
  strong reason. Path quoting on Windows (esp. for paths with
  spaces) is the #1 source of "I added myself to startup but
  the entry is broken" bugs. The plugin gets it right.
- **The plugin handles macOS for free** — without it, the Mac
  impl would have to write a LaunchAgent plist by hand, which
  is the Mac equivalent of winreg.
- **The plugin's `MacosLauncher::LaunchAgent` enum** lets you
  swap between LaunchAgent and AppleScript on macOS. Hand-rolling
  would mean picking one and re-implementing later.
- **The trait abstraction means the choice is reversible.** If
  the plugin turns out to be a bad fit, `WindowsAutostart` is
  60 lines of code; reverting to winreg is a single commit.

### Verdict
**Strongly accept status quo.**

This is the clearest "M1 paid for itself" decision. The
`IPlatformAutostart` trait lets M1.7 swap the impl without
touching the test, the Tauri command, the frontend, or the
autostart-using services. **The hand-rolled version would
have been 30 lines today and 300 lines in M2 (when
internationalization, signing, and notarization add new
edge cases).**

**Action**: None. This is the case study in `docs/ARCHITECTURE.md`
for "why we have the platform trait layer".

---

## Decision 7: Build profile — release for ship, debug for dev

### The decision
`scripts/build-and-ship.sh:75-110` builds with
`cargo build --release --features tauri/custom-protocol` for
shipping, with a documented workaround (`touch src-tauri/src/lib.rs`)
to force Cargo to relink when `dist/` is newer than the source.

### Adversarial position
"Use `tauri build` instead of `cargo build --release`." Here's why:
1. **`tauri build` is the documented entry point.** Tauri 2 ships
   with a `tauri-cli` that handles the full pipeline (frontend
   build → Rust build → code signing → bundler). The
   `beforeBuildCommand` hook in `tauri.conf.json` can be set to
   `npm run build`, eliminating the manual `touch` workaround.
2. **The `touch` workaround is fragile.** It works because
   `src-tauri/src/lib.rs` is the only file `cargo build` checks
   for the "is anything in the dependency graph dirty" decision.
   If a future refactor moves the `tauri::generate_context!()`
   macro to a separate `context.rs` file, the touch stops
   working silently — and the user ships a stale exe that
   renders a 3-week-old `dist/`.
3. **`tauri build` is faster end-to-end** for release because it
   runs the bundler (`tauri-bundler`) in parallel with the
   Rust build, rather than as a separate step.
4. **The current approach has a known failure mode** documented
   in STATE.md as "M1.3-pipeline-fix-v2: Tauri custom-protocol
   feature required". The fix added `--features tauri/custom-protocol`
   manually. `tauri build` enables this by default.

### Counter-arguments
- **The current approach works.** It has shipped M1.1, M1.2, M1.3,
  M1.4, M1.8 — all 5 milestones. The 19MB exe is the documented
  ship size.
- **`tauri build` requires more configuration.** The `productName`,
  `identifier`, `bundle.targets`, `bundle.publisher` etc. all
  need to be set in `tauri.conf.json`. The current build-and-ship
  script doesn't use any of them — it just compiles the .exe.
  This is a deliberate choice (M1.x ships a single .exe, not a
  .msi installer).
- **The `touch` workaround is documented and tested.** The smoke
  test (Test 7) greps the exe for the `dist/` JS bundle
  fingerprint; if the touch fails, Test 7 fails and the ship is
  blocked.
- **The team is the M1.10 owner of this decision.** M1.10 (build
  matrix) is the right time to migrate to `tauri build`, not
  M1.11.

### Verdict
**Accept status quo, defer migration to M1.10.**

The current pipeline works, is documented, is tested. M1.10 is
explicitly tasked with "build/package/sign/CI matrix" — the
migration to `tauri build` belongs there, not in a review-only
pass.

**Action**: Add to M1.10 scope: "Migrate `scripts/build-and-ship.sh`
to use `tauri build` instead of `cargo build --release --features
tauri/custom-protocol`. Use `tauri.conf.json::beforeBuildCommand` to
wire `npm run build`. Drop the `touch src-tauri/src/lib.rs`
workaround once `tauri build` is the source of truth."

---

## Summary verdicts

| # | Decision | Verdict | Action |
|---|---|---|---|
| 1 | No react-router | Accept | M2+ migration note in App.tsx |
| 2 | localStorage over tauri-plugin-store | Accept | M1.10 unification or removal |
| 3 | Platform traits over cfg(target_os) | **Strong accept** | Document in ARCHITECTURE.md |
| 4 | tokens.css + inline + dead Tailwind | Accept with cost note | M1.12 decision: adopt or remove |
| 5 | 12 plugin stubs | Accept | None |
| 6 | tauri-plugin-autostart over hand-roll | **Strong accept** | Document as case study |
| 7 | cargo build --release over tauri build | Accept | M1.10 migration |

**Decisions to revisit**: 1, 2, 4, 7 (all have natural M1.10 or M2
gates).

**Decisions to lock in**: 3, 5, 6 (these paid for themselves in M1).

**Decisions with M1.12 cleanup**: 4 (the Tailwind direction).

---

*End of M1.11-02 brainstorm. 7 decisions reviewed, 2 strong
accepts, 5 accepts with future action items, 0 rejects.*
