# Claude Config Manager — Architecture (M1 + M2 invariants)

> **Status**: M1 架构期 locked at `04395dd` (M1.9.2). M2 业务实现期
> done through M2.16 (`d820b82`). Any deviation from locked M1 layers
> requires a documented exception in `STATE.md`.
>
> **Audience**: First-time contributor — read this in 5 minutes before
> opening any source file. This document is the **higher authority for
> code structure**; `CLAUDE.md` is the higher authority for project
> process. In conflict, `CLAUDE.md` wins for process questions.

> **最近更新**: 2026-06-24 — §2 trait 表格行号重生成 (前次偏移 13-50 行) + IPlatformWindowChrome Mac 状态修正为 live (L-M2.08 commit `7efb0f8`)

---

## 0. 30-second overview

```
┌──────────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript 5 + Tailwind/shadcn                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │ AppHeader   │ │ AppSidebar  │ │ pages/<F#>  │ │ design-sys  │ │
│  │ ErrorBanner │ │ WindowCtl   │ │ (12 stubs + │ │ tokens.css  │ │
│  │             │ │             │ │  real impl) │ │ ThemeProv   │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
│         │                │                │              │       │
│         └────────────────┴──── @tauri-apps/api ─────────┘       │
└──────────────────────────┬───────────────────────────────────────┘
                           │ IPC (invoke + emit)
┌──────────────────────────┴───────────────────────────────────────┐
│  Rust (Tauri v2)                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ lib.rs  →  PluginHost::init_all()  →  commands::<F#>::cmd   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│            │                │                  │                  │
│    ┌───────┴────┐  ┌────────┴───────┐  ┌───────┴──────┐         │
│    │ domain/    │  │ services/      │  │ commands/    │         │
│    │ Provider   │  │ ProviderSvc    │  │ fs.rs        │         │
│    │ McpServer  │  │ MarketplaceSvc │  │ marketplace  │         │
│    │ UsageSnap  │  │ ResourceSvc    │  │ resource     │         │
│    └────────────┘  └────────────────┘  └──────────────┘         │
│            │                │                  │                  │
│            └────────────────┴──── infrastructure/ ─────┘         │
│                       (sql_parser / git / fs / http)             │
│                            │                                     │
│              ┌─────────────┴─────────────┐                       │
│              │ platform/traits.rs (8)    │                       │
│              │  ├── windows/  (live)     │                       │
│              │  └── macos/    (M2.16:    │                       │
│              │       7/8 live; 1 stub)   │                       │
│              └───────────────────────────┘                       │
└──────────────────────────────────────────────────────────────────┘
```

The two trees (`src/` + `src-tauri/src/`) are **mirrored**: every
business feature has a Rust backend service + command, a React
frontend page, and a Tauri command wrapper in between. No business
code lives in `lib.rs` or `App.tsx` directly — those are wiring only.

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
| `IPlatformPaths` | `platform/traits.rs:231-294` | `WindowsPaths` | `MacPaths` (unimplemented) | Win live, Mac panic at runtime |
| `IPlatformSingleInstance` | `platform/traits.rs:298-302` | `WindowsSingleInstance` (mutex) | `MacSingleInstance` (unimplemented) | Win live, Mac panic |
| `IPlatformAutostart` | `platform/traits.rs:305-309` | `WindowsAutostart` (delegates to tauri-plugin-autostart) | `MacAutostart` (delegates) | Win + Mac live (via plugin) |
| `IPlatformReveal` | `platform/traits.rs:328-330` | `WindowsReveal` (explorer /select) | `MacReveal` (unimplemented, will use `open -R`) | Win live |
| `IPlatformNotifier` | `platform/traits.rs:379-381` | `WindowsNotifier` (stub, eprintln) | `MacNotifier` (unimplemented) | Stub — replace in M1.4 |
| `IPlatformAppMenu` | `platform/traits.rs:385-387` | `WindowsAppMenu` (NotSupported) | `MacAppMenu` (unimplemented) | Mac-only concept |
| `IPlatformWindowChrome` | `platform/traits.rs:391-393` | `WindowsWindowChrome` (DWM Mica + DwmExtendFrameIntoClientArea) | `MacWindowChrome` (unimplemented, NSVisualEffectView) | Win live (with HWND lookup TODO); Mac live (commit 7efb0f8 L-M2.08, apply_vibrancy via window_vibrancy crate; cfg-gated compile-only on non-macOS targets) |
| `IGitHost` | `platform/traits.rs:397-407` | `WindowsGitHost` (CLI shim via `git`) | `MacGitHost` (unimplemented) | Win live (CLI shim); Mac shares the CLI shim when implemented |

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

12 stub plugins ship in M1.x. **As of M2.16**, the following are
real implementations (replacing the stub):

| ID | Display name | F-number | Stub file | M2.16 status |
|---|---|---|---|---|
| `provider-list` | Provider 列表 | F1 | `src-tauri/src/plugins/stubs/provider_list.rs` | **Real** (M2.1) |
| `provider-switch` | Provider 切换 | F2 | `provider_switch.rs` | **Real** (M2.1) |
| `import-sql` | 导入 .sql | F3 | `import_sql.rs` | **Real** (M2.2) |
| `deeplink-import` | Deeplink 导入 | F4 | `deeplink_import.rs` | **Real** (M2.3) |
| `json-editor` | JSON 编辑器 | F5 | `json_editor.rs` | **Real** (M2.4) |
| `mcp-management` | MCP 管理 | F6 | `mcp_management.rs` | Stub (M2.5 candidate) |
| `usage-query` | 用量查询 | F7 | `usage_query.rs` | Stub |
| `single-file-deploy` | 单文件部署 | F8 | `single_file_deploy.rs` | Stub |
| `resource-browser` | 资源浏览 | F16 | `resource_browser.rs` | **Real** (M2.16 — F9 search + F21 source-group) |
| `marketplace` | 资源市场 | F17 | `marketplace.rs` | **Real** (M2.16 — git clone + scan + install) |
| `optimizer` | 配置优化 | F18 | `optimizer.rs` | **Real** (M2.16 — F23 markdown export) |
| `backup-restore` | 备份与恢复 | F19 | `backup_restore.rs` | Stub |

Additional M2.16 surfaces (not in original 12-stub list):
- **F10 drag-drop .sql** — Tauri `onDragDropEvent` + overlay
  (`src-tauri/src/lib.rs:213` + `src/App.tsx:235-244`)
- **F13 backup** — `settings.json` timeline + diff + rollback
- **F14 export** — single-provider `.json` share (Rust dialog
  + atomic write + provider-list export button)
- **F15 error feedback (横切)** — shared `ErrorBanner` component
  used by provider-list / backup-restore / marketplace / optimizer
- **F20 single-instance + file association** — `tauri-plugin-single-instance`
  + OS file association (`.sql` cold-start → import-sql page)
- **F21 source-group filter** — `infer_resource_group` rename
  of `infer_source_repo` (M2.16-fix-h6)
- **F22 resource detail** — manifest + file list + inline preview

The F-number gap (F9, F11, F12, F24) is intentional — these land
in M2+ as additional surfaces or stay as M3 candidates.

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

## 3.5 Data flow scenarios (3 typical journeys)

### Journey 1 — App startup (cold boot)

```
main.exe
  └→ src-tauri/src/main.rs::main()
      └→ lib::run()
          ├→ Tauri builder
          │   ├→ register plugins (PluginHost::init_all → 12 stubs)
          │   ├→ register commands (commands/mod.rs::invoke_handler)
          │   ├→ setup() callback:
          │   │   ├→ create_tray()
          │   │   ├→ platform::runtime::window_chrome().apply_mica()
          │   │   ├→ check argv for .sql file → cache in AppState.pending_sql_file
          │   │   └→ emit "import-sql-file" (if pending)
          │   └→ on_window_event(close) → hide-to-tray
          └→ app.run()
              └→ webview mounts → React App.tsx mounts
                  ├→ ThemeProvider reads localStorage('ccm.theme')
                  ├→ useViewState reads localStorage('ccm.lastView')
                  └→ invoke('take_pending_sql_file') → if Some, setView('import-sql')
```

### Journey 2 — Switch provider (F2)

```
User clicks "Activate" on provider-list page
  └→ ProviderListPage.tsx::handleActivate(providerId)
      └→ invoke('switch_provider', { providerId })
          └→ commands::provider::switch_provider (Tauri command)
              └→ ProviderService::activate() (services/)
                  ├→ backup current settings.json → settings.json.bak.<ts>
                  ├→ atomic rename new provider.json → settings.json
                  └→ emit "provider-activated" event
                      └→ ProviderListPage listens → reload list + show toast
```

### Journey 3 — Install from marketplace (F17)

```
User pastes git URL in marketplace page
  └→ MarketplacePage.tsx::handleInstall(url)
      └→ invoke('install_marketplace_resource', { url })
          └→ commands::marketplace::install_resource
              └→ MarketplaceService::install_resource()
                  ├→ IGitHost::clone(url, dest_dir)        ← platform trait
                  ├→ ResourceScanner::scan(dest_dir)        ← infrastructure
                  ├→ atomic copy resources → ~/.claude/<type>/<name>/
                  │   (force overwrite → backup to .bak.<ts>)
                  └→ return scan result
                      └→ MarketplacePage refreshes + emits "resource-installed"
                          └→ ResourceBrowserPage listens → reload grid
```

All three journeys obey the same rules: front-end never touches
`fs` directly, OS-specific code lives only in `platform/`, every
write goes through `infrastructure::fs_atomic`.

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

## 8. Known limitations (current scope)

### M2.16 known limitations (active)

- **Mac platform: `IGitHost` still compile-only stub** —
  `MacGitHost::clone` returns `unimplemented!()`. F17 marketplace
  on macOS will panic at runtime. M2.17+ candidate.
- **Mac platform: `IPlatformReveal` unimplemented** — `open -R`
  not wired. Win reveal works.
- **Mica/vibrancy on macOS unverified** — Win11 Mica实测不生效
  (commit `e8b4b56` falls back to CSS). Mac vibrancy deferred to
  real-device test.
- **Tailwind not compiled** — `cn()` merge is no-op for Tailwind
  classes. Components use inline `style={{ var(--token) }}`. M2.17+
  will decide.
- **F17 marketplace overwrite UX** — `DestExists` shows red bar
  only; no "overwrite / skip" dialog yet (M3 candidate).
- **M2.16 review findings (10 MEDIUM + 7 LOW)** — deferred to
  `docs/milestones/M2-REVIEWS.md`. None are CRITICAL.

### M1.x known limitations (mostly resolved by M2)

- ~~`react-router-dom` unused dep~~ — removed in M2.x
- ~~`winreg` leftover in Cargo.toml~~ — removed in M2.x
- ~~Dark theme token overrides incomplete~~ — M2.16 reduced theme
  surface (light瓷白 only; glass variants trimmed per
  `d820b82`); dark mode deferred
- ~~`tauri-plugin-positioner` unused~~ — kept (F4 deeplink
  positioner helper)

### M2+ (not yet in scope)

- All 8 Mac platform impls fully live (7/8 done in M2.16)
- F7 usage query (real impl)
- F8 single-file deploy (depends on M3 notarization)
- F11 / F12 keyboard shortcuts / theme
- F18/F23 optimizer real impl (M2.16 has export but not scan)

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

## 13. 启动流程 (从 git clone 到 .app 跑通)

> 跨平台通用 5 步。具体 macOS 步骤 + 调试工具见 `docs/DEBUG-MAC.md` 第 1 章。

### 13.1 5 步速通

```bash
# 1. 装系统级依赖
# - Node 22 LTS (nvm)
# - Rust stable (rustup)
# - 平台工具链 (macOS: xcode-select --install / Windows: WebView2 + MSVC)

# 2. clone + 装 npm 依赖
git clone <repo>
cd claude-config-manager
npm ci

# 3. 编译前端
npm run build

# 4. 编译 + bundle 应用
# - macOS:  ./scripts/build-mac.sh [--debug]
# - Windows: ./scripts/build-and-ship.sh --milestone M1 --task 1.1 --slug scaffold
# - 通用:    cargo tauri build [--debug] [--no-bundle]

# 5. 启动
# - macOS:   open src-tauri/target/<debug|release>/bundle/macos/ClaudeManager.app
# - Windows: src-tauri/target/release/claude-config-manager.exe
```

### 13.2 验证跑通

- 进程在 5 秒内运行：`pgrep -f <app-name>` (mac) / `Get-Process` (Windows)
- 启动日志无 panic：见 `docs/DEBUG-MAC.md` §Q2 / `docs/investigations/m1.1-launch.md` (Windows)
- 主窗口出现 + WebView2/WKWebView 加载前端


## 14. 编译选项 (cargo tauri build 常用 flag)

> 详细 macOS 编译选项 + 性能调优见 `docs/DEBUG-MAC.md` 第 2 章 + CLAUDE.md §12。

| Flag | 用途 |
|---|---|
| `--debug` | 编译 debug 变体（含调试信息） |
| `--no-bundle` | 只 cargo build，不 bundle（快） |
| `--bundles app` | 只产 .app（不产 .dmg） |
| `--bundles app,dmg` | .app + .dmg |
| `--target aarch64-apple-darwin` | Apple Silicon |
| `--target x86_64-apple-darwin` | Intel |
| `--target x86_64-pc-windows-msvc` | Windows x64 |

### 14.1 常见组合 + 坑

```bash
# ✅ 改 tauri.conf.json / Cargo.toml 后必须做的事
# tauri::generate_context!() 是 proc-macro，cargo incremental 不追踪 tauri.conf.json
# 改 conf 后不重清缓存会导致产物内嵌 OLD 配置（如 identifier）
cd src-tauri && cargo clean -p claude-config-manager && cargo build
# 然后再 bundle
cd .. && cargo tauri bundle --debug --bundles app

# ✅ 日常 dev build
cargo tauri build --debug --no-bundle  # 改 Rust 后快速验编译
npm run build                          # 改前端后必须（beforeBuildCommand）

# ❌ 常见错
cargo tauri bundle --debug --bundles app  # 跳过 cargo build 会报 "can't open main binary"
```

**性能基线**：CLAUDE.md §12（macOS Apple Silicon 冷编 ~5-8 min，含 wry/tao 链；sccache 配后暖编 ~1-2 min）。


## 15. 模块拓扑 (1 段精简)

> 详细 src-tauri 目录树 + 8 trait 表见 `docs/DEBUG-MAC.md` 第 3 章。

```
src-tauri/
├── main.rs / lib.rs       # 入口 / Tauri builder
├── commands/              # Tauri IPC commands (前端 invoke)
├── domain/                # 业务模型 (Provider / McpServer / ...)
├── services/              # 业务逻辑
├── infrastructure/        # 文件 IO / HTTP / git / sqlite
├── platform/              # OS 抽象层 (traits + windows + macos)
└── plugins/               # 插件系统 (M1.x 12 stub, M2+ 实装)
```

业务代码只调 `platform/traits.rs` 定义的 trait，**不**直接 `#[cfg(target_os = "...")]`（CLAUDE.md §3.2）。


## 16. 常见任务速查 (10 FAQ, 跨平台)

> macOS 专属 FAQ 见 `docs/DEBUG-MAC.md` 第 4 章。

### Q1: 如何开 dev mode (Vite HMR + Tauri auto-rebuild)?
`npm run tauri dev` — dev server + Tauri dev build，HMR 实时预览。**不** ship。

### Q2: 如何清 app 缓存?
- macOS: `rm -rf ~/Library/Application\ Support/ClaudeConfigManager`
- Windows: `Remove-Item -Recurse $env:APPDATA\ClaudeConfigManager`
- 下次启动会重建。

### Q3: tauri::generate_context!() panic 怎么办?
通常是 `dist/` 缺失或过期。跑 `npm run build` 重生 dist。

### Q4: 编译报 "method takes N argument but M supplied"?
Tauri API 改了。看 `.cargo/registry/src/.../tauri-<version>/` 源码 + 官方 changelog。**不**降级 Tauri（CLAUDE.md §2.3）。

### Q5: 如何加新 plugin?
M1.x 阶段所有 plugin 写 stub。建 `src-tauri/src/plugins/<id>/`，在 `plugins/mod.rs` 注册。

### Q6: 如何加新 page?
- 前端: `src/pages/<id>/index.tsx` + 在 `App.tsx` router 注册
- 后端: `src-tauri/src/commands/<id>.rs` 注册到 `lib.rs::invoke_handler`

### Q7: 测试在哪个目录?
- Rust 单元: 同文件 `#[cfg(test)] mod tests`
- Rust 集成: `src-tauri/tests/`
- TS 单元: `src/__tests__/`
- E2E: `tests/e2e/`

### Q8: 如何看前端 console.log?
- Dev: 右键 → Inspect Element (默认开 devtools)
- Release: 需临时开 `window.__TAURI_INTERNALS__.invoke('tauri::open_devtools')`

### Q9: 如何 dev 注册 deep-link (ccswitch://)?
- Windows: 注册表自动 (dev 模式)
- macOS: dev 模式需手动。`tauri plugin` 临时注册。生产 bundle 由 tauri-action 自动写 Info.plist。

### Q10: CI 跑哪几个 job?
- `ci.yml`: test-rust (Win) / test-frontend (Win) / e2e (Win) / test-rust-mac
- `release.yml`: macos-latest (aarch64) + windows-latest (x64) matrix
