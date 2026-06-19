# Claude Config Manager — Architecture (M1 invariants)

> **Status**: M1 架构期 final. Locked at commit `04395dd` (M1.9.2)
> + review commits `6ea5e97` (self-review) through
> `51e78c5` (business flow). Any deviation requires a
> documented exception in STATE.md.

This document is the **framework invariant** reference. It tells
the next contributor what is and is not allowed to change without
explicit design discussion. The rules here supersede CLAUDE.md
when in conflict (CLAUDE.md is the higher authority for project
process; this document is the higher authority for *code* structure).

---

## 1. Module boundaries (CLAUDE.md §3.1, locked)

The Rust + TypeScript trees are organised into 5 layers. Business
code MUST live in the right layer.

```
src-tauri/src/
├── main.rs           ← entry — DO NOT add logic here (delegate to lib::run)
├── lib.rs            ← Tauri builder + plugin registration + tray + close-hook
├── domain/           ← M2+ — pure data structs (Provider, McpServer, UsageSnapshot)
├── services/         ← M2+ — ProviderService, McpService, UsageService
├── infrastructure/   ← M2+ — file IO, HTTP client, git client
├── platform/         ← OS abstraction (LOCKED structure — see §2)
│   ├── traits.rs     ← 8 traits + mockall shims + PlatformError + AppPaths
│   ├── mod.rs        ← runtime::xxx() factory functions
│   ├── windows/      ← Windows impls (1 file per trait, named after the trait)
│   └── macos/        ← macOS impls (compile-only `unimplemented!()` for M1.x)
├── plugins/
│   ├── traits.rs     ← IPlugin + PluginContext + PluginRoute + PluginService
│   ├── host.rs       ← PluginHost (registry + lifecycle, LIFO shutdown)
│   ├── mod.rs        ← init_all() — the single entry point lib.rs calls
│   └── stubs/        ← 12 stub plugins (F1..F8 core + F16..F19 L1)
└── commands/         ← Tauri command surface (1 module per F-number)
    ├── autostart.rs  ← M1.7 — get/set autostart_status

src/
├── main.tsx          ← React entry — ThemeProvider + App; invokes applyEffects()
├── App.tsx           ← Top-level layout + view router (useViewState-based)
├── design-system/    ← tokens.css + ThemeProvider + applyEffects (LOCKED boundary)
├── components/       ← AppHeader, AppSidebar, PluginPlaceholder, WindowControls
├── pages/            ← 1 subdir per plugin (M1.x: each renders PluginPlaceholder)
├── plugins/          ← Frontend registry + 12 stubs (mirrors src-tauri/plugins/)
├── hooks/            ← useViewState (M1 only; M2+ adds useSettings, useProvider)
├── stores/           ← M2+ (Zustand stores for cross-plugin state)
├── lib/              ← utils (cn)
└── test/             ← Vitest setup
```

### Hard rules

1. **`lib.rs` is the only file in `src-tauri/src/` that may import
   `tauri::*` directly**. Everything else uses the platform traits
   or commands.
2. **No `#[cfg(target_os)]` outside `src-tauri/src/platform/`**.
   Business code goes through traits.
3. **No direct Tauri API calls from React components**. The
   `WindowControls` component uses `getCurrentWindow()` from
   `@tauri-apps/api/window` because that's the documented Tauri v2
   pattern for window chrome; **this is the only allowed exception**
   in M1.x.
4. **No `useState` for cross-component state in M2+**. Use Zustand
   stores (`src/stores/`) or React Context (for one-off shared
   values like theme).
5. **Page files in `src/pages/<plugin>/index.tsx` MUST re-export
   the corresponding plugin's stub from `src/plugins/stubs/`**. The
   stub is the "M2 contract" the page fills in.

---

## 2. Platform trait list (CLAUDE.md §3.2, locked)

Eight traits, two impls each, plus a runtime factory. The
`macos/` impls are stubbed `unimplemented!()` bodies that exist
so the contract compiles and so a Mac dev can find the work.

| Trait | File | Win impl | Mac impl | M1.x status |
|---|---|---|---|---|
| `IPlatformPaths` | `platform/traits.rs:217-225` | `WindowsPaths` | `MacPaths` (unimplemented) | Win live, Mac panic at runtime |
| `IPlatformSingleInstance` | `platform/traits.rs:229-233` | `WindowsSingleInstance` (mutex) | `MacSingleInstance` (unimplemented) | Win live, Mac panic |
| `IPlatformAutostart` | `platform/traits.rs:236-240` | `WindowsAutostart` (delegates to tauri-plugin-autostart) | `MacAutostart` (delegates) | Win + Mac live (via plugin) |
| `IPlatformReveal` | `platform/traits.rs:244-246` | `WindowsReveal` (explorer /select) | `MacReveal` (unimplemented, will use `open -R`) | Win live |
| `IPlatformNotifier` | `platform/traits.rs:249-251` | `WindowsNotifier` (stub, eprintln) | `MacNotifier` (unimplemented) | Stub — replace in M1.4 |
| `IPlatformAppMenu` | `platform/traits.rs:255-257` | `WindowsAppMenu` (NotSupported) | `MacAppMenu` (unimplemented) | Mac-only concept |
| `IPlatformWindowChrome` | `platform/traits.rs:261-263` | `WindowsWindowChrome` (DWM Mica + DwmExtendFrameIntoClientArea) | `MacWindowChrome` (unimplemented, NSVisualEffectView) | Win live (with HWND lookup TODO); Mac unimplemented |
| `IGitHost` | `platform/traits.rs:267-277` | `WindowsGitHost` (CLI shim via `git`) | `MacGitHost` (unimplemented) | Win live (CLI shim); Mac shares the CLI shim when implemented |

### Runtime factory

`src-tauri/src/platform/mod.rs::runtime` exposes 8 factory functions
(`paths()`, `single_instance()`, `autostart(&app)`, `reveal()`,
`notifier()`, `app_menu()`, `window_chrome()`, `git_host()`).
Each returns a `Box<dyn IPlatformXxx>`. The `#[cfg(target_os)]`
selection lives ONLY here — never in business code.

### Object safety

All 8 traits are object-safe. `Box<dyn IPlatformXxx>` is the
storage form. Mocks (`mockall::mock! {}` in `traits.rs:286-347`)
prove the dispatch contract.

### M1.x Mac note

Per the M1.2 decision, macOS impls are compile-only stubs. The
moment a Mac dev runs the binary, **paths()** and
**single_instance()** will panic. This is documented in
`docs/reviews/m1-11-01-self-review.md` (F-1.12) and is on the
M1.12 backlog.

---

## 3. Plugin system (CLAUDE.md §3.3, locked)

12 stub plugins ship in M1.x. Real implementations land in M2+.

| ID | Display name | F-number | Stub file | Status |
|---|---|---|---|---|
| `provider-list` | Provider 列表 | F1 | `src-tauri/src/plugins/stubs/provider_list.rs` | Stub |
| `provider-switch` | Provider 切换 | F2 | `provider_switch.rs` | Stub (action-only, no route) |
| `import-sql` | 导入 .sql | F3 | `import_sql.rs` | Stub |
| `deeplink-import` | Deeplink 导入 | F4 | `deeplink_import.rs` | Stub |
| `json-editor` | JSON 编辑器 | F5 | `json_editor.rs` | Stub |
| `mcp-management` | MCP 管理 | F6 | `mcp_management.rs` | Stub |
| `usage-query` | 用量查询 | F7 | `usage_query.rs` | Stub |
| `single-file-deploy` | 单文件部署 | F8 | `single_file_deploy.rs` | Stub |
| `resource-browser` | 资源浏览 | F16 | `resource_browser.rs` | Stub |
| `marketplace` | 资源市场 | F17 | `marketplace.rs` | Stub |
| `optimizer` | 配置优化 | F18 | `optimizer.rs` | Stub |
| `backup-restore` | 备份与恢复 | F19 | `backup_restore.rs` | Stub |

The F-number gap (F9..F15, F20..F24) is intentional — these land
in M2+ as additional plugins.

### Adding a new plugin

1. Write a new stub under `src-tauri/src/plugins/stubs/<id>.rs`.
2. Register it in `src-tauri/src/plugins/mod.rs::init_all`.
3. Add a frontend stub under `src/plugins/stubs/<id>.tsx`.
4. Register it in `src/plugins/registry.ts::ALL_PLUGINS`.
5. Add the ViewId literal to `src/hooks/useViewState.ts::ViewId`.
6. Add the entry to `src/App.tsx::PAGE_META`.
7. Add an entry to `src/components/AppSidebar.tsx::VIEW_META`.

The drift-detector test in `src/__tests__/hooks/useViewState.test.ts:108-131`
fails if any of steps 4-5 is missed.

---

## 4. Design system (CLAUDE.md §4, locked)

### Token surface (`src/design-system/tokens.css`)

**Colors** (light + dark variants):
`--bg-primary`, `--bg-elevated`, `--bg-overlay`, `--text-primary`,
`--text-secondary`, `--text-muted`, `--accent`, `--success`,
`--warning`, `--danger`, `--disabled`, `--border`.

**Effects**:
`--shadow-sm`, `--shadow-md`,
`--blur-sm` (10px), `--blur-md` (20px), `--blur-lg` (30px),
`--glass-bg`, `--glass-bg-strong`, `--glass-border`, `--glass-shadow`.

**Spacing** (4px grid):
`--space-1` (4), `--space-2` (8), `--space-3` (12),
`--space-4` (16), `--space-6` (24), `--space-8` (32), `--space-12` (48).

**Radius**:
`--radius-card` (8), `--radius-button` (4), `--radius-modal` (12).

**Typography**:
`--fs-heading` (18), `--fs-body` (14), `--fs-caption` (12),
`--font-ui`, `--font-mono`.

### Hard rules

1. **No hard-coded color, font-size, spacing, or radius values
   in components**. Always `var(--token-name)`.
2. **Dark theme must override EVERY color token**. Current
   `tokens.css:96-113` is incomplete — `--success` / `--warning`
   / `--danger` / `--shadow-*` / `--disabled` are missing dark
   variants. **M1.12 fix** (F-1.09).
3. **Theme application uses `data-theme` attribute on
   `documentElement`**, not `classList`. The CSS selector is
   `[data-theme="dark"]`.
4. **`auto` mode is supported in ThemeProvider but not in the
   header toggle button**. The button cycles light ↔ dark only
   (this is a known UX gap; M1.12 fix BP-3.01).

### Components consuming tokens

- `AppHeader.tsx` — header surface (glass-bg, blur-md)
- `AppSidebar.tsx` — rail (glass-bg, blur-md)
- `PluginPlaceholder.tsx` — placeholder card (glass-bg-strong, blur-sm)
- `WindowControls.tsx` — chrome buttons (transparent, hover --bg)
- `HomeView.tsx` — tile grid (bg-elevated, accent, shadow-sm)

Every component reads `tokens.css` via inline `style={{ ... }}` or
via Tailwind classes (which are currently no-ops because Tailwind
is not compiled — see §4).

### Tailwind status

Tailwind is in `devDependencies` (`tailwindcss@3.4.17`,
`autoprefixer`, `postcss`) but **not compiled**. The `cn()` util
uses `twMerge(clsx(...))` so the merge step is a no-op for
non-Tailwind classes. This is "option to adopt" — M1.12 must
decide.

---

## 5. State management (locked for M1.x)

### React-side state

Three pieces of state in M1.x:

1. **Theme** — `useTheme` hook + `ThemeProvider` context.
   Storage key `ccm.theme`. Values: `'light' | 'dark' | 'auto'`.
2. **View routing** — `useViewState` hook (no context, just a
   stateful hook). Storage key `ccm.lastView`. Values: 1 of 13
   `ViewId` literals (12 plugin ids + 'home').
3. **No global app state**. M2+ adds Zustand stores for
   `providerList`, `mcpServers`, `usageSnapshots`, etc.

### Rust-side state

- **Tauri commands** (stateless, all async, return
  `Result<T, String>`).
- **Tauri State** — `tauri-plugin-autostart` registers an
  `AutoLaunchManager` as State. Accessed via
  `app.autolaunch()` extension.
- **No M1.x application-level state**. M2+ adds
  `ProviderService`, `McpService`, etc. as State.

### Persistence (front-end)

| Key | Stored value | TTL | Notes |
|---|---|---|---|
| `ccm.theme` | `light` / `dark` / `auto` | Until cleared | ThemeProvider.tsx:33 |
| `ccm.lastView` | kebab-case ViewId | Until cleared | useViewState.ts:60 |

### Persistence (back-end)

- `tauri-plugin-store` is registered in `lib.rs:34` but
  **not currently used by any feature**. M1.10 / M2 may migrate
  the front-end localStorage keys here for unified persistence
  (decision pending per `docs/reviews/m1-11-02-brainstorm.md`
  Decision 2).

---

## 6. Testing pyramid (CLAUDE.md §5, locked)

Three layers, all required for any feature landing in M2+.

### Unit (Vitest / cargo test)

- **TS**: `src/__tests__/**/*.test.{ts,tsx}` (Vitest, jsdom).
  Currently 9 files, ~30 tests. All green.
- **Rust**: `#[cfg(test)] mod tests` in each module. Currently
  in `platform/traits.rs`, `platform/windows/{autostart,
  paths, single_instance, reveal, window_chrome}`,
  `platform/macos/paths`, `plugins/host.rs`. ~25 tests.

### Integration (Vitest with shared modules)

`src/__tests__/integration/{App,scroll-layout,m1-9-2}.test.tsx`
mount the full App tree in jsdom with `tokens.css` injected
and `@tauri-apps/api/window` mocked. These catch regressions in
the App shell that unit tests miss.

### UI e2e (Playwright via tauri-driver)

`tests/e2e/{launch,tray,close-minimize}.spec.ts` — 5 specs
covering: app launches + window size, Tauri IPC bridge alive,
no console errors, close hides window, page stays mounted.
Runs in CI via `.github/workflows/ci.yml::e2e` job.

### TDD discipline

Every M1.9.x commit followed the pattern
`<id>-test` (Red) → `<id>-fix` (Green) → `<id>-refine`
(Refactor). This is the project's "must follow" TDD rhythm.

---

## 7. Build matrix (locked for M1.x)

| Build | Profile | Use case | How |
|---|---|---|---|
| Dev | `cargo build` (debug) | `npm run tauri dev` for HMR | Hot-reload, console subsystem |
| M1.x ship | `cargo build --release --features tauri/custom-protocol` | Ships to `~/Desktop/ClaudeConfigManager-M1/` | `scripts/build-and-ship.sh --milestone M1 --task 1.9 --slug ...` |
| M2+ ship | `tauri build` (deferred) | Auto-update, MSI/NSIS bundles | M1.10 migration |
| CI test | `cargo test` + `npm test` + `npx playwright test` | Every push / PR | `.github/workflows/ci.yml` |

### Why `cargo build --release --features tauri/custom-protocol`

Tauri v2's `tauri::generate_context!()` proc-macro checks the
`custom-protocol` cargo feature at compile time. Without it, the
embedded asset list is empty and the runtime tries to load from
the dev server → "ERR_CONNECTION_REFUSED". `tauri build` enables
this feature automatically; `cargo build --release` does not.
The build script enforces this.

### Why `touch src-tauri/src/lib.rs`

Cargo skips relink if no Rust source has changed. If the front-end
`dist/` is updated but no `.rs` file is touched, the new bundle
isn't embedded. `build-and-ship.sh` runs `touch src-tauri/src/lib.rs`
between `npm run build` and `cargo build --release`. This is a
**workaround for M1.x** — M1.10 migrates to `tauri build` which
handles this correctly.

---

## 8. Known limitations (M1.x scope)

The following are **explicitly accepted** limitations of the M1.x
ship. They are filed in M1.12 / M1.10 / M2 backlogs.

### M1.12 (final audit)

- F-1.01 — `react-router-dom` unused dep; remove
- F-1.02 — `tauri-plugin-positioner` unused; document or remove
- F-1.04 — ThemeProvider cold-boot race for 'auto' theme
- F-1.09 — Dark theme token overrides incomplete
- F-1.11 — close-to-hide has no real e2e test
- F-1.13 — `tauri-plugin-process` unused
- F-1.14 — `useViewState.test.ts` registry id list is hard-coded
- F-1.15 — `WindowsNotifier` stub panics in release (no stderr)
- F-1.18 — `tauri-plugin-positioner` not pinned to =X.Y.Z
- F-1.20 — `winreg` still in Cargo.toml after M1.7 autostart rewrite
- F-1.22 — HANDOFF.json drifts from reality
- F-1.26 — `src/App.css` may be dead
- P-2 — `applyEffects` uses `navigator.userAgent` instead of
  `tauri-plugin-os`
- P-5 — Updater plugin enabled with empty pubkey (privacy concern)
- P-6 — `windows = "0.61"` not pinned to =0.61.0
- P-7 — `WindowControls` swallows close-button errors
- P-8 — Build tag literal "M1.9 · 架构期" should be env-derived
- P-9 — Vitest `__dirname` is CJS-only; use `import.meta.url`
- BP-1.02 — stale kernel mutex cleanup
- BP-1.06 — Vitest test for tokens.css body bg
- BP-2.01 — `setViewState` side effect should move to `useEffect`
- BP-3.01 — Theme toggle destroys 'auto' mode
- BP-4.01 / P-7 — close-button error swallowing
- BP-4.02 — 2nd window event handler could override close-to-hide

### M1.10 (build / CI matrix)

- F-1.06 — CI workflow doesn't pin Node / Rust / Playwright
- BP-1.01 — write panic to `AppPaths::logs_dir()` (debug build
  ship today is the workaround)
- BP-4.05 — verify `tauri.conf.json::bundle.icon` is set
- Migrate `scripts/build-and-ship.sh` to use `tauri build`

### M2+ (not in M1.x scope)

- All `domain/`, `services/`, `infrastructure/` modules
- All 12 plugin implementations (replacing stubs)
- All 24 F-numbers (currently 12 stubs, 12 missing)
- Settings drawer (header has a placeholder button)
- Deep-link auto-routing (F4)
- Tailwind adoption (M1.12 decision pending)
- macOS platform impls (compile-only today)

---

## 9. Migration playbook (M1.x → M1.10 → M2)

```
M1.9.2 (current) ────────────────────────────────────────────┐
   12 stubs + shell + chrome + autostart                      │
   ↑                                                          │
   M1.10 build/CI/signing ──────────────────────────────────┐ │
   │  - Migrate to `tauri build`                             │ │
   │  - Pin CI versions                                       │ │
   │  - Configure bundle.icon + signing keys (placeholder)    │ │
   │                                                          │ │
   M1.11 CI + framework invariants ────────────────────────┐ │ │
   │  - This document                                         │ │ │
   │  - AGENTS.md                                             │ │ │
   │  - 4 review docs (self / brainstorm / peer / flow)       │ │ │
   │                                                          │ │ │
   M1.12 final audit ─────────────────────────────────────┐ │ │ │
   │  - Apply F-1.x + P-x + BP-x fixes                      │ │ │ │
   │  - Decide Tailwind direction                            │ │ │ │
   │  - Regenerate HANDOFF.json                              │ │ │ │
   │                                                       │ │ │ │
   M2.x — First real feature (Provider 列表 F1)            │ │ │ │
   │  - Replace ProviderListPage stub with real impl         │ │ │ │
   │  - Add ProviderService + ProviderList state            │ │ │ │
   │  - Write tests at all 3 layers                          │ │ │ │
   │                                                       │ │ │ │
   M2.x — Plugin implementations                            │ │ │ │
   │  - One commit per F-number                              │ │ │ │
   │  - Each: domain struct + service + e2e test            │ │ │ │
   │                                                       │ │ │ │
   v1.1 release                                             │ │ │
   │  - Enable updater with real pubkey                      │ │ │ │
   │  - Migrate Mica to v1.1 platform-native API             │ │ │ │
   │  - First real ship to users                             │ │ │ │
   └──────────────────────────────────────────────────────┘ │ │
   └────────────────────────────────────────────────────────┘ │
   └──────────────────────────────────────────────────────────┘
```

---

*End of M1 framework invariants. ~330 lines, 9 sections.*