# Domain Pitfalls — Cross-Platform Desktop on Windows 11 + macOS 26 (Tahoe)

**Project:** Greenfield desktop application framework selection
**Target platforms:** Windows 11, macOS 26 (Tahoe)
**Researched:** 2026-06-18
**Confidence:** HIGH for the framework-specific pitfalls documented below (sourced from official docs and active GitHub issues), MEDIUM for universal pitfalls (drawn from community wisdom and prior post-mortems).

This file catalogs the gotchas that bite AFTER you commit to a cross-platform desktop framework. Each pitfall includes **Warning signs**, **Prevention strategy**, and the **Phase** in the roadmap that should address it (Setup / Build / Ship).

---

## Universal Pitfalls (Any Framework)

These pitfalls apply regardless of which framework is chosen. They are the single largest source of post-launch pain.

### U-1. Code signing & notarization failures

**What goes wrong:** Windows SmartScreen blocks the unsigned/untrusted `.exe` with a full-screen warning ("Windows protected your PC"). macOS Gatekeeper blocks the unnotarized `.app` with "cannot be opened because the developer cannot be verified." Developers frequently discover this at release time, not at dev time.

**Why it happens:**
- Apple **requires notarization** since macOS 10.14.5 for Developer-ID-distributed software and macOS 10.15 for all Developer-ID software built after June 1, 2019.
- Microsoft **requires EV code signing certificates** since June 2023 to avoid SmartScreen warnings. OV certificates produce SmartScreen warnings until reputation builds.
- Apple requires `altool` replacement (`notarytool`) since Nov 1, 2023.
- Hardened Runtime + `Disable Library Validation Entitlement` interplay trips developers loading plug-ins.

**Warning signs:**
- "Done Adding Additional Store / Successfully signed" but SmartScreen still warns → wrong cert type (OV vs EV).
- Notarization fails with "The binary is not signed with a valid Developer ID certificate" → ad-hoc or wrong identity.
- App runs locally but launch dialog still shows "cannot be verified" → ticket not stapled or notarization skipped.
- macOS plug-in fails to load → host missing entitlement (e.g., `com.apple.security.cs.allow-jit`).

**Prevention (Day 1 / Setup phase):**
- Provision an Apple Developer Program account ($99/yr) AND an EV code-signing certificate from DigiCert / GlobalSign / Sectigo / SSL.com BEFORE writing release pipeline.
- Acquire a hardware-token or cloud-signing account for EV cert (FIPS 140 Level 2 required, key cannot be exported to CI).
- Configure automated signing and notarization in CI from the first signed build, not later.
- Use the App Store Connect API key path for notarization (preferred over Apple ID + app-specific password) — survives credential rotation and 2FA.

**Roadmap phase:** Setup (Day 1) — signing must be wired before the first "real" release build, but can be skipped for early debug builds.

---

### U-2. Auto-update edge cases (delta updates, channel switching, rollback)

**What goes wrong:** Auto-updater silently fails on the user's machine (proxy, TLS interception, missing write permissions, broken install path). Users end up running a mix of old + new binaries. Channel switches (stable → beta) leave dangling app data. No rollback path means a bad release bricks installs.

**Why it happens:**
- Updates over HTTPS fail behind corporate proxies with self-signed certs.
- Delta update formats differ per framework; macOS DMG vs Windows MSI/NSIS/Squirrel behavior diverges.
- macOS MAS build **disables `autoUpdater`** entirely (sandbox restriction).
- Web-based updaters can't auto-restart in locked environments.

**Warning signs:**
- Update check succeeds, download completes, but app never relaunches with new version.
- Users report running v1.2 while auto-update says v1.3 is installed (in-place patch failure).
- Beta channel users can't switch back to stable without manual uninstall.

**Prevention (Build + Ship phases):**
- Plan update UX **before** writing code: full vs delta; mandatory vs opt-in; channel switching rules.
- Pick one auto-updater per platform and **use it consistently** (Electron Squirrel.Windows + electron-updater; Tauri `tauri-plugin-updater`; MAUI no built-in — use Squirrel.Windows or Velopack; Flutter `msix` + custom updater).
- Implement a "last-known-good" rollback file path on Windows (rename old binary to `.old` before replacing).
- macOS DMG updates cannot be fully silent — accept user password prompt or move to PKG/MSI.
- Test update flow with a **downgraded** build (older → newer) AND with a network drop mid-download.

**Roadmap phase:** Ship phase — defer until a stable v1.0; address in a dedicated "release pipeline" milestone.

---

### U-3. Path / encoding / line-ending bugs

**What goes wrong:** Apps that read user files break on Windows paths with spaces (`C:\Program Files\`), Unicode names, mixed line endings, or case-mismatched filenames. File system operations silently corrupt data or fail at runtime on a subset of machines.

**Why it happens:**
- Windows is **case-insensitive but case-preserving**; macOS APFS default is case-insensitive (but case-sensitive variant exists); Linux is case-sensitive. Path comparisons that work on dev box fail on production.
- macOS HFS+/APFS normalizes filenames to **NFD Unicode** (decomposed). Files copied from Windows arrive NFC (precomposed). `é` is one codepoint on Windows, two on macOS. File lookups by exact string fail.
- Windows uses CRLF; macOS uses LF. Node/Python/Rust default text-mode I/O differs per OS.
- `C:\Program Files\MyApp\` has a space; many shell-quoting bugs hide here.

**Warning signs:**
- "File not found" errors only on user machines, never in dev/CI.
- Unicode filenames display correctly on Windows but break on macOS (or vice versa).
- Build artifacts fail signature verification because line endings changed.

**Prevention (Build phase):**
- Centralize all path operations through a platform abstraction (e.g., Tauri's path plugin, `path.join` in Node, `Path.Combine` in .NET).
- Use NFC normalization for any cross-platform string comparison of file content.
- Open files in **binary mode** unless text-mode is required, then normalize EOL on read.
- Add a CI matrix that tests on Windows + macOS with `git config core.autocrlf` set to `false` and `input` to catch EOL regressions.

**Roadmap phase:** Build phase — set up path/encoding utilities in the foundation phase before feature work.

---

### U-4. High-DPI / Retina scaling bugs

**What goes wrong:** UI looks crisp on the dev's 1x monitor but is tiny on Retina, blurry on 4K, or laid out incorrectly when dragged between displays with different scale factors. Native chrome (menus, titlebars) sits at wrong position relative to content.

**Why it happens:**
- Windows 11 defaults to per-monitor DPI awareness v2; macOS Retina is 2x or 3x by default.
- Cross-platform frameworks vary in DPI handling: Tauri uses logical pixels; Electron uses device-pixel-ratio; MAUI uses device-independent units; Flutter uses logical pixels; Avalonia uses device-independent pixels.
- Frameworks that ship **WebView-based UIs** (Electron, Tauri, Wails, Flutter Web fallback) get CSS pixel semantics layered on top of native window scaling.

**Warning signs:**
- Text is crisp on 1x display, fuzzy on 4K display.
- Window content shifts when dragged between displays of different scale.
- Menu bar / title bar height doesn't match content area on Windows 11.
- Icons render at 16px on a Retina display instead of 32px.

**Prevention (Build phase):**
- Configure the framework to declare **per-monitor DPI awareness** at startup (Windows: `app.manifest` with `<dpiAwareness>PerMonitorV2`).
- Test on a 4K + 1080p dual-display setup from Day 1, not at release.
- Use the framework's logical-pixel APIs exclusively — never hardcode device pixels.
- For WebView-based stacks, set `<meta name="viewport">` correctly and use CSS `device-pixel-ratio` queries.

**Roadmap phase:** Build phase — DPI handling must be set up with the first window, retrofitted later causes widespread layout breakage.

---

### U-5. Native menu / menu bar differences

**What goes wrong:** Developers build a "File / Edit / View" menu and either (a) place it inside the window on macOS, which feels wrong; or (b) ship a single Windows-style menu bar on macOS that ignores system-wide services (Spotlight, dictation, third-party text services); or (c) lose the macOS app menu (About / Hide / Quit / Services) entirely.

**Why it happens:**
- Windows attaches menus to the window. macOS uses a **single system-wide menu bar at the top of the screen**, with one mandatory "app menu" (the bold-named app name menu with About, Preferences, Quit, etc.) that frameworks won't generate automatically.
- Framework abstractions differ: Electron has `Menu.setApplicationMenu` (macOS) vs `Menu.buildFromTemplate` (in-window). Tauri has `tauri::menu` with platform-specific `set_menu_bar` (macOS) vs `attach_to_window` (Win/Linux). MAUI has `MenuBarItem` that does both.

**Warning signs:**
- macOS users complain "no About menu" or "can't quit with Cmd+Q".
- Cmd+C / Cmd+V / Spotlight don't see your app's text fields.
- "Quit" appears twice (once in app menu, once in File menu).
- On Windows the menu sits inside the window; on macOS it disappears.

**Prevention (Build phase):**
- Decide on a single menu API and use it from the start. Do not retro-fit macOS menus to a Windows-built app.
- Wire the macOS app menu (About / Preferences / Hide / Quit / Services) explicitly, even if it's empty.
- Disable system menu items you don't support (Services → nothing) to avoid confusing users.

**Roadmap phase:** Build phase — when the first menu is added.

---

### U-6. Window chrome inconsistencies (titlebar, traffic lights, vibrancy, Mica)

**What goes wrong:** Apps have a Windows 11-style title bar on Windows but a generic gray title bar on macOS that ignores traffic-light button positioning, dark mode, vibrancy, or Mica (Win 11's backdrop effect). On macOS the traffic-light (close/min/max) buttons sit at fixed position; on Win 11 the user expects Snap Layouts hints when hovering maximize.

**Why it happens:**
- Custom titlebars need different APIs per OS: Win 11 `DWMWA_SYSTEMBACKDROP_TYPE` for Mica, `IF_WINDOW_PRESENTATION_PARAMETERS`, `DwmSetWindowAttribute`. macOS uses `NSWindow.titlebarAppearsTransparent`, `titleVisibility`, and vibrancy via `NSVisualEffectView`.
- Traffic lights on macOS are managed by AppKit; some frameworks hide the title bar entirely without giving an in-window replacement.
- Mica is **only available on Win 11 22H2+**; back-compat to Win 10 needs a fallback backdrop.

**Warning signs:**
- macOS title bar is "windows-looking" gray; no vibrancy; feels un-native.
- Win 11 users can't trigger Snap Layouts because the maximize button is replaced.
- Dark mode doesn't propagate to title bar text/icons on either OS.

**Prevention (Build phase):**
- Use the framework's official titlebar extension API from Day 1: Tauri `tauri-plugin-window-state` + `vibrancy`; Electron `BrowserWindow({ titleBarStyle: 'hiddenInset' })` for macOS; MAUI Shell customization; Avalonia `Window.TransparencyLevelHint`.
- Test Snap Layouts on Win 11 explicitly — it's the most-clicked Windows 11 feature.
- Test in dark mode on both platforms from Day 1.

**Roadmap phase:** Build phase (window setup) and Ship phase (polish).

---

### U-7. File dialog & sandbox issues

**What goes wrong:** On macOS, file dialogs return bookmark URLs that expire when the app is moved/updated, breaking re-open of "recent files." On Windows, sandboxed apps (MSIX/Packaged) lose arbitrary filesystem access, breaking legacy file workflows. Sandboxed apps silently lose write access to user-selected files after restart without persistence.

**Why it happens:**
- macOS App Sandbox (mandatory for MAS, optional for direct distribution) grants access only to user-selected files via security-scoped bookmarks. App must call `startAccessingSecurityScopedResource()` on every access.
- Windows MSIX apps run in a restricted AppContainer; full FS access requires a `runFullTrust` capability, which blocks Store submission.
- Tauri/Electron file dialogs return OS-native paths, but persistence layer often forgets to save security-scoped bookmarks.

**Warning signs:**
- "Recent files" list populates correctly on first session, empty after restart.
- macOS: `EPERM` when re-opening a previously opened file from a saved path.
- Windows MSIX: works during dev (running unpackaged) but fails when installed from Store.

**Prevention (Build phase):**
- For MAS-targeted apps: design for sandbox from Day 1 — no hidden filesystem assumptions.
- For non-MAS macOS: opt out of sandbox; document the trade-off (users will see Gatekeeper warning unless you notarize).
- For Windows MSIX: declare `runFullTrust` early if your app needs full FS; if Store-targeted, design around MSIX virtualized FS (`LocalAppData`).
- Persist security-scoped bookmarks, never raw paths.

**Roadmap phase:** Build phase — first time a file is opened or saved.

---

### U-8. Crash reporting & telemetry

**What goes wrong:** Apps ship without crash reporting. When users encounter bugs, there's no traceback, no symbolicated stack, no count of affected users. Developers rely on anecdotal reports. macOS crashes need `.ips` / `.crash` files that must be symbolicated against the **exact dSYM build** that shipped.

**Why it happens:**
- Different platforms ship crash reports in different formats to different locations.
- Electron crashes need `breakpad` symbols; Tauri/Rust crashes need dSYMs and `addr2line`/Symbolicator; .NET needs PDBs; Flutter needs `--obfuscate` + symbol files.
- Cross-platform crash services (Sentry, Bugsnag, Crashpad) require per-platform init and dSYM/PDB upload to your CI.

**Warning signs:**
- "Crash happens sometimes" with no reproducible steps and no logs.
- Sentry/Bugsnag stack traces are unhelpful because symbols weren't uploaded.
- Telemetry shows "0 crashes" because the crash happens before the reporter initializes.

**Prevention (Ship phase — but plan Day 1):**
- Wire a crash reporter (Sentry, BugSplat, or self-hosted) from the first internal build.
- Upload dSYMs/PDBs/symbol files as part of every release CI step.
- Initialize the reporter **before** anything else in `main()`.
- Distinguish: first-chance crash (capture immediately) vs after-init crash (capture at startup).

**Roadmap phase:** Ship phase — but the crash reporter SDK dependency and dSYM upload step must be added to CI from Day 1 of release work.

---

## Electron Pitfalls

### E-1. Chromium weight (binary size + memory)

**What goes wrong:** A "Hello World" Electron app is ~150–250 MB and consumes 100+ MB RAM at idle. Per-window Chromium processes multiply the cost. Users notice immediately; reviews and uninstall rates suffer.

**Why it happens:**
- Electron bundles Chromium + Node.js into every app binary. There is no way to share system Chromium.
- Each `BrowserWindow` is a separate renderer process. Multi-window apps leak RAM quickly without aggressive cleanup.

**Warning signs:**
- Install size > 200 MB for a productivity app.
- RAM usage > 500 MB for a single-window chat client.
- App boots in 1+ second on Windows (cold start).

**Prevention (Setup phase):**
- If size/RAM matter to your users, eliminate Electron from consideration before committing. Tauri/MAUI/Avalonia are 10–30 MB.
- If size is acceptable: enable ASAR packaging, exclude dev-only files, use `electron-builder` `--arm64` builds to avoid Intel-only fallback.
- Limit `BrowserWindow` count; reuse web contents when possible.

**Roadmap phase:** Setup — this is a framework-selection gate, not a fixable defect.

---

### E-2. Security CVEs from misconfiguration (nodeIntegration, contextIsolation, sandbox)

**What goes wrong:** Apps ship with `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false` — the historical Electron defaults. Loading any remote content (or any XSS in local content) gives attackers Node.js access to the user's machine. Electron security is **the developer's responsibility**; the defaults are permissive.

**Why it happens:**
- Electron inherits from Chromium's permissive era. Many tutorials still show insecure defaults.
- `webPreferences` is verbose: `nodeIntegration`, `contextIsolation`, `sandbox`, `webSecurity`, `allowRunningInsecureContent`, `experimentalFeatures` each affect the attack surface.
- Electron's own security checklist exists but isn't enforced.

**Warning signs:**
- `nodeIntegration: true` anywhere in your codebase.
- Direct IPC from renderer (`ipcRenderer.send`) without preload script mediation.
- Using `remote` module (deprecated, removed).
- Loading any cross-origin iframe without explicit sandbox.

**Prevention (Day 1 / Setup phase):**
- Set secure defaults in your window factory:
  ```js
  new BrowserWindow({
    webPreferences: {
      contextIsolation: true,    // ALWAYS
      nodeIntegration: false,    // ALWAYS
      sandbox: true,             // ALWAYS when possible
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  ```
- Expose all Node functionality through `contextBridge.exposeInMainWorld()` in preload.
- Disable `webview` tag if not needed; configure `webviewTag` permissions if it is.
- Run `npm audit` and Snyk on every CI build; treat Electron CVEs as P0.

**Roadmap phase:** Setup (Day 1) — bake secure defaults into window factory; add CI check.

---

### E-3. Preload script bugs

**What goes wrong:** Preload scripts become untyped megafiles. Async/await across the contextBridge boundary produces serialization errors. The renderer gets a stale "API" that doesn't match what `main` actually exposes. Memory leaks accumulate because `addEventListener` in preload is never removed.

**Why it happens:**
- Preload is the only safe boundary; everything must flow through it.
- IPC is async and serializes via structured clone — no functions, no DOM nodes, no class instances.
- Many devs copy-paste the preload scaffold and never refactor it.

**Warning signs:**
- Preload file > 500 lines.
- `Error: An object could not be cloned` in console.
- `ipcRenderer.on` listeners without corresponding `removeListener` on window close.
- Renderer errors: `window.api.X is not a function`.

**Prevention (Build phase):**
- One preload per window type, not one mega preload.
- Type the bridge: `declare global { interface Window { api: Api } }` with shared types.
- Auto-clean listeners in `window.onbeforeunload`.
- Cover IPC handlers with integration tests using `electron-playwright-helper` or Spectron alternatives.

**Roadmap phase:** Build phase — first IPC call.

---

### E-4. Auto-updater and macOS MAS sandbox limitations

**What goes wrong:** Electron's built-in `autoUpdater` is disabled in the MAS build (App Sandbox requirement). Apps submitted to the Mac App Store must use App Store's own update mechanism, not `electron-updater`. Apps distributed outside MAS use Squirrel.Mac / Squirrel.Windows via `electron-updater`.

**Why it happens:**
- Electron's `autoUpdater` calls privileged APIs blocked by App Sandbox.
- MAS sandbox blocks `crashReporter` too — apps must integrate an external crash service from JS only.
- Developers often write the auto-update logic first and discover MAS incompatibility at submission time.

**Warning signs:**
- App works fine in dev, MAS submission rejected for using `autoUpdater`.
- Auto-update works on Win + direct-distribution macOS, fails silently on MAS.
- Crash reports work on Win + direct-distribution macOS, return "access denied" on MAS.

**Prevention (Setup phase — decide distribution before coding):**
- Decide macOS distribution channel (MAS vs direct) BEFORE building update flow.
- For MAS: use Sparkle alternative or App Store updates; external crash reporter from main process via XPC.
- For direct: use `electron-updater` with code-signing-aware update manifests.
- Test both channels — they diverge significantly in permissions.

**Roadmap phase:** Setup (distribution decision) and Build (updater code).

---

### E-5. Native module rebuild pain (node-gyp, electron-rebuild)

**What goes wrong:** Native dependencies (sqlite3, bcrypt, sharp, node-canvas) require C++ compilation against the exact Electron Node ABI. When Electron upgrades, all native modules break until rebuilt. CI fails when build tools are missing. macOS ARM builds require x86_64 → arm64 cross-compilation.

**Why it happens:**
- Node.js ABI changes between major versions; Electron Node ABI differs from system Node.
- `electron-rebuild` / `@electron/rebuild` runs `node-gyp` which needs Python + MSVC on Windows, Xcode CLT on macOS.
- Prebuilt binaries exist for popular modules but lag Electron releases.

**Warning signs:**
- CI fails with "no Node ABI match found" after Electron upgrade.
- Local install works on dev's machine, fails on CI.
- ARM Mac can't load x86 module → runtime crash on Apple Silicon.

**Prevention (Setup + Build phases):**
- Use `@electron/rebuild` in postinstall script.
- Pin Electron version; treat upgrades as migration events.
- Prefer pure-JS deps; native deps cost 10x in CI time.
- Use Electron Forge with prebuilt native module support.

**Roadmap phase:** Setup (CI image with build tools) + Build (every Electron upgrade).

---

## Tauri v2 Pitfalls

### T-1. WebView2 dependency on Windows (runtime bootstrap)

**What goes wrong:** Tauri apps on Windows rely on **Edge WebView2 runtime**, which is installed by default on Windows 11 but NOT on older Windows 10 versions. Users without WebView2 see a download prompt or a blank window. Enterprise machines with WebView2 disabled by policy show nothing.

**Why it happens:**
- Tauri **deliberately does not bundle WebView2** (Apple does the same with WebKit). Smaller binaries but external runtime dependency.
- WebView2 has an "Evergreen" mode (auto-updated via Edge) and a "Fixed Version" mode (enterprise side-by-side).
- Microsoft Defender has flagged Tauri-built `.exe` files as Trojan in false positives (Tauri issue #2486 — 84+ thumbs up, opened Aug 2021, still unresolved).
- Confirmed open issues: WebView2 IME/TSF freezes on CJK input (#15436), WACK certification fails for fresh v2 project (#14935), Windows signing bugs (#15018, #14995).

**Warning signs:**
- Tauri GitHub issue #2486 ([Windows] Trojan alert from windows defender and other anti-virus providers) — 84 upvotes, 5 years unresolved.
- Windows 10 users report "blank window" or "WebView2 missing" error.
- SmartScreen + Defender double-flagging on first install.

**Prevention (Setup phase):**
- Add WebView2 bootstrapper to the installer (Tauri's `bundle.windows.webviewInstallMode` can be `downloadBootstrapper`, `embedBootstrapper`, or `fixedRuntime`).
- For enterprise: use `fixedRuntime` with a specific WebView2 version.
- Code-sign with EV certificate from Day 1 to defang Defender false positives.
- If Defender false-positive is unacceptable, pick a different framework.

**Roadmap phase:** Setup — bootstrapper configuration is part of tauri.conf.json.

---

### T-2. WKWebView quirks on macOS

**What goes wrong:** macOS WKWebView (which Tauri uses via wry/tao) has subtle differences from Chrome/Safari: certain CSS features (e.g., `backdrop-filter`, `mix-blend-mode` with some filters, custom scrollbars), missing `prefers-color-scheme` reactivity in some versions, and stricter cookie partitioning.

**Why it happens:**
- WKWebView is WebKit, not Chromium. CSS support lags.
- WebKit is more conservative than Chromium for new web standards.
- Tauri adds platform abstractions, but feature gaps remain.

**Warning signs:**
- UI renders correctly in Tauri dev on Windows (Chromium-based), breaks on macOS (WebKit).
- macOS users see plain scrollbars when Windows users see styled ones.
- Backdrop blur effect missing on macOS (works on Windows).

**Prevention (Build phase):**
- Test CSS early on both platforms — don't trust "it works in Chrome."
- Use `-webkit-` prefixes for backdrop-filter and other WebKit-laggy properties.
- Provide a CSS reset that works for both WebKit and Chromium.
- Subscribe to Tauri release notes for wry/tao changes.

**Roadmap phase:** Build phase — first UI rendering.

---

### T-3. Plugin ecosystem maturity

**What goes wrong:** Tauri's plugin ecosystem is smaller than Electron's. Common needs (auto-update, native notifications, deep linking, biometrics, geolocation, SQL) are covered by official plugins, but anything esoteric (Bluetooth, NFC, advanced media) often requires writing a custom Rust plugin. Some plugins are v2-incompatible; some are community-only with thin docs.

**Why it happens:**
- Tauri v2 stabilized plugin API only recently (v2 GA in late 2024). Many v1 plugins are still being ported.
- Tauri requires Rust for any non-trivial native feature, raising the floor on contributors.

**Warning signs:**
- Your required feature has no plugin and would need a custom Rust crate.
- Plugin's last commit is 18+ months ago and targets v1.
- Plugin docs only cover happy path; integration tests missing.

**Prevention (Setup phase):**
- Audit the [Tauri plugin list](https://v2.tauri.app/plugin/) against your feature requirements BEFORE committing to Tauri.
- Plan for 1–2 custom plugins if your feature set is unusual (Rust dev time required).
- Pin all plugin versions; treat upgrades as breaking-change events.

**Roadmap phase:** Setup — feature audit.

---

### T-4. Mobile-parity confusion

**What goes wrong:** Developers choose Tauri expecting "Tauri mobile" parity with desktop and discover Tauri Mobile is alpha/beta quality, plugin coverage is thinner, and the iOS/Android story has different toolchain requirements (Xcode, Android NDK). Some "Tauri 2" features are desktop-only.

**Why it happens:**
- Tauri v2 added mobile as a goal, but iOS/Android support is younger than desktop.
- Tauri docs emphasize desktop; mobile sections are growing but less mature.

**Warning signs:**
- A plugin works on desktop but crashes on mobile with no error message.
- Tauri mobile docs link to desktop examples without iOS-specific callouts.
- App size on Android/iOS balloons due to Rust + WebView + bundled assets.

**Prevention (Setup phase):**
- If you only target Win + macOS, ignore mobile — Tauri desktop is solid.
- If you need mobile, prototype the mobile build **before** committing to Tauri.
- Read Tauri mobile plugin docs explicitly; don't assume parity.

**Roadmap phase:** Setup — framework decision.

---

### T-5. Custom sign command regressions (Tauri v2 bug)

**What goes wrong:** Tauri v2 introduced a regression where custom sign commands fail to sign the uninstall.exe in Windows installers (issue #15018, #14995, opened 2026). Developers using `signCommand` end up shipping unsigned uninstallers that Defender flags.

**Why it happens:**
- Tauri CLI 2.10.0 broke signing of auxiliary binaries.
- Regression is acknowledged but unfixed at the time of research.

**Warning signs:**
- Tauri GitHub issue #14995 (priority: 1 high) — "Windows .exe not being signed on latest @tauri-apps/cli (version 2.10.0)."
- `tauri build` reports success but `signtool verify` fails on uninstall.exe.

**Prevention (Build phase):**
- Pin `@tauri-apps/cli` to a known-good version; test upgrades carefully.
- Add `signtool verify` step in CI after every build.
- Subscribe to [Tauri releases](https://github.com/tauri-apps/tauri/releases) for security-relevant fixes.

**Roadmap phase:** Build phase — every release.

---

### T-6. Rust toolchain pain for web developers

**What goes wrong:** Teams with web-only backgrounds underestimate the Rust learning curve. Compile times are long (5–15 minutes for first build, 30s–2min incremental). "Just add a Rust dep" cascades into recompiling the world.

**Why it happens:**
- Rust compile times are notoriously slow for cold builds.
- Tauri's `cargo tauri dev` triggers full Rust rebuilds on certain changes.

**Warning signs:**
- PR cycle time > 30 min because Rust rebuild dominates.
- Team members avoiding Rust features because they don't want to fight the borrow checker.

**Prevention (Setup phase):**
- Allocate for Rust learning curve in schedule.
- Use `cargo-chef` for Docker builds, `sccache` for incremental CI.
- Keep Rust code thin — most logic should be in the frontend; Rust only handles system boundaries.

**Roadmap phase:** Setup — team skills.

---

## .NET MAUI Pitfalls

### M-1. macOS Catalyst quality gap

**What goes wrong:** MAUI macOS apps run as **Mac Catalyst** — iPad apps running on macOS — not as native AppKit apps. The result feels un-native: iOS-style back-button gestures, iPad-style modals, missing macOS sidebar conventions, poor integration with macOS services. Performance is worse than AppKit-native due to UIKit-on-macOS translation layer.

**Why it happens:**
- MAUI is built on top of .NET for iOS + Mac Catalyst, which inherits UIKit-on-macOS limitations.
- Apple deprecated AppKit bindings in Xamarin.Mac; the Mac Catalyst path is the future.
- Microsoft has invested heavily in Catalyst but quality lags.

**Warning signs:**
- MAUI app on macOS looks like an iPad app, including title bar, gestures, sheets.
- Performance issues only on macOS — WinUI 3 (Windows) version is snappy.
- Missing macOS services integration (Spotlight, Quick Look, Services menu).

**Prevention (Setup phase):**
- If macOS UX must be native, eliminate MAUI from consideration.
- If acceptable as "good enough": test on real macOS hardware from Day 1.
- For Windows-first + acceptable macOS, MAUI is reasonable.

**Roadmap phase:** Setup — framework decision.

---

### M-2. Windows App SDK coupling

**What goes wrong:** MAUI on Windows uses **Windows App SDK (WinAppSDK / WinUI 3)** under the hood. WinAppSDK is itself moving fast (1.4 → 1.5 → 1.6), has breaking changes, requires specific Visual Studio / Windows SDK / .NET combinations, and ships a runtime that must be deployed with the app or installed via bootstrapper.

**Why it happens:**
- MAUI's Windows head was forked from WinUI 3; coupling is deep.
- WinAppSDK's MSIX deployment model is opinionated.
- The MAUI + WinUI combo is younger than WPF; many edge cases are still being discovered.

**Warning signs:**
- MAUI app builds and runs in dev but fails on a clean Windows 10 install without WinAppSDK runtime.
- WinAppSDK upgrade breaks MAUI controls.
- MSIX deployment requires app to be sandboxed.

**Prevention (Setup phase):**
- Add WinAppSDK runtime bootstrapper to installer (self-contained or via WindowsAppSDK installer).
- Pin WinAppSDK version; test upgrades.
- For unpackaged deployment, ensure the WinAppSDK framework dependency is satisfied (Microsoft offers framework packages or self-contained).

**Roadmap phase:** Setup — installer pipeline.

---

### M-3. Performance vs WPF (especially complex UI)

**What goes wrong:** Apps ported from WPF to MAUI show measurable slowdowns (startup time, scrolling, data virtualization). MAUI's handler architecture adds indirection. Complex DataGrid / ListView with virtualization has known gaps.

**Why it happens:**
- MAUI's handler/control mapper adds indirection vs WPF's native visual tree.
- Some MAUI controls are still less mature than their WPF counterparts (CollectionView virtualization).
- Some Windows-specific features (rich text, ink, media) are in flux.

**Warning signs:**
- Scroll lag on lists with > 1000 items.
- Slow startup time on Windows compared to WPF baseline.
- Memory pressure on complex screens.

**Prevention (Build phase):**
- Benchmark against WPF for data-heavy screens.
- Use `CollectionView` with explicit `ItemsLayout` and recycling.
- Avoid handler indirection in hot paths by accessing native platform controls directly when needed.

**Roadmap phase:** Build phase — first data-heavy screen.

---

### M-4. Smaller ecosystem and tooling gap

**What goes wrong:** NuGet packages for MAUI are sparse vs the WPF / WinForms ecosystem. Many community libraries target WPF, not MAUI. Designer support in VS / Rider is improving but not on par with WPF.

**Warning signs:**
- A required NuGet package targets `netstandard2.0` but breaks under MAUI's iOS/Android targets.
- Visual Studio XAML designer randomly fails to load MAUI preview.
- Community samples are mostly WPF; MAUI patterns must be inferred.

**Prevention (Setup phase):**
- Audit NuGet dependencies for MAUI compatibility before adoption.
- Use Rider or VS 2022 17.10+ for best designer experience.
- Plan to write more code yourself than for a WPF project.

**Roadmap phase:** Setup — dependency audit.

---

## Flutter Desktop Pitfalls

### F-1. Impeller engine stability on desktop

**What goes wrong:** Flutter's Impeller rendering engine (now default on macOS, iOS, and recent Android) has had desktop-specific issues: GPU driver compatibility on Windows (especially Intel HD on older laptops), Vulkan vs OpenGL backend quirks, and reports of animation jank on macOS with multi-monitor setups.

**Why it happens:**
- Impeller is younger than Skia; desktop GPU driver coverage is thinner than mobile.
- Some Windows GPU drivers (Intel UHD 600-series, older AMD) have Impeller-specific bugs.
- Impeller has less runtime fallback than Skia.

**Warning signs:**
- Jank / tearing / wrong colors only on specific GPU/driver combos.
- "GL_INVALID_OPERATION" warnings on Windows.
- Flutter team recommending `--no-enable-impeller` for certain hardware.

**Prevention (Build phase):**
- Test on target hardware matrix (Intel, AMD, NVIDIA on Win; Intel + Apple Silicon on macOS).
- Have a Skia fallback ready (`flutter run --no-enable-impeller`).
- Subscribe to [Flutter Impeller issues](https://github.com/flutter/flutter/issues?q=is%3Aissue+impeller).

**Roadmap phase:** Build phase — UI polish.

---

### F-2. No native widgets (Skia draws everything)

**What goes wrong:** Flutter does NOT use native widgets. Everything — buttons, sliders, scrollbars, context menus, file pickers — is painted with Skia/Impeller. This means accessibility is approximated, OS conventions are reinvented (often imperfectly), and screen readers / native input methods may misbehave.

**Why it happens:**
- Flutter's "single codebase" promise requires its own widget set.
- OS-level widgets are platform-specific; replicating them is expensive.

**Warning signs:**
- Screen readers (NVDA, VoiceOver) announce Flutter controls inconsistently.
- macOS users notice context menus look like a Flutter widget, not AppKit.
- Native text services (spellcheck, grammar) don't work in Flutter text fields.

**Prevention (Build phase):**
- Use Flutter's `Semantics` widget aggressively for accessibility.
- Test with VoiceOver (macOS) and NVDA (Windows) from Day 1.
- Accept the "looks the same everywhere" trade-off; don't try to mimic native.

**Roadmap phase:** Build phase — first interactive UI.

---

### F-3. Accessibility gaps on desktop

**What goes wrong:** Flutter's accessibility is mature on mobile but lags on desktop. Keyboard navigation, focus rings, high-contrast mode, and screen-reader navigation all need explicit `FocusableActionDetector` and `Semantics` configuration.

**Warning signs:**
- Tab key doesn't move focus predictably through controls.
- Screen reader reads "button, button, button" without descriptive labels.
- High-contrast Windows theme doesn't apply.

**Prevention (Build phase):**
- Use `FocusableActionDetector` and `Shortcuts` widgets for keyboard nav.
- Test with screen reader from Day 1.
- Provide explicit `Semantics` labels for icon buttons.

**Roadmap phase:** Build phase — keyboard nav.

---

### F-4. Desktop distribution & auto-update gap

**What goes wrong:** Flutter desktop has no built-in auto-update. macOS distribution requires a notarized `.app`; Windows distribution uses MSI, MSIX, or plain `.exe`. Squirrel-style auto-update is not provided; you must integrate Squirrel.Windows, Sparkle (mac), or a custom solution.

**Warning signs:**
- App ships without auto-update; users run stale versions indefinitely.
- Manual MSI upgrades leave old files behind.

**Prevention (Ship phase):**
- Choose and integrate an auto-update library per platform from the start.
- For macOS: Sparkle (mature) or custom Squirrel-like.
- For Windows: Squirrel.Windows + Velopack, or MSIX with auto-update via Store.

**Roadmap phase:** Ship phase.

---

## Other Frameworks

### Avalonia (XAML for cross-platform .NET)

**Pitfall A-1. Smaller ecosystem.** Avalonia has 31k stars but is dwarfed by WPF's decades of NuGet / StackOverflow / blog content. Many libraries target WPF; Avalonia ports exist but lag.
- **Warning signs:** A needed NuGet only supports WPF/WinForms; community samples assume WPF; MVVM toolkits don't all work out of the box.
- **Prevention:** Audit dependencies; budget for writing more platform-specific code than WPF; check [Avalonia UI Samples](https://github.com/AvaloniaUI/Avalonia.Samples) for working patterns.
- **Phase:** Setup — dependency audit.

**Pitfall A-2. XAML dialect differences.** Avalonia XAML is similar to WPF but not identical — `Setter`, `Style`, `ControlTemplate` work but namespace differences, missing triggers, and different default controls trip WPF developers.
- **Warning signs:** WPF XAML copies don't compile; binding syntax differences; missing some triggers / actions.
- **Prevention:** Treat as a "learn a new dialect" project; use Avalonia-specific docs; avoid blindly copying WPF code.
- **Phase:** Build — first UI.

**Pitfall A-3. Open issues seen during research (June 2026).** AvaloniaUI/Avalonia has 1.8k open issues including: CJK glyph lookup regression (#21556), Apple AppKit system font missing on macOS (#21565), DataGrid NullReferenceException (#21581), window resize broken when DwmIsCompositionEnabled is false (#21603), Windows frames not visible when theming off (#21604). All opened within the past 2 weeks of research.
- **Warning signs:** CJK text rendering regressions on either platform; macOS not using Apple system fonts.
- **Prevention:** Subscribe to Avalonia releases; test CJK rendering explicitly; have a fallback for AppKit font on macOS.
- **Phase:** Build — text-heavy screens.

---

### Wails (Go)

**Pitfall W-1. v2 maturity.** Wails v2 is the current major; some plugins (especially mobile) are still being stabilized. Documentation is thin compared to Electron.
- **Warning signs:** Plugins without recent commits; unclear upgrade path; minimal StackOverflow content.
- **Prevention:** Pin versions; evaluate with a small prototype before committing; check Wails Discord for support volume.
- **Phase:** Setup — feature audit.

**Pitfall W-2. Mobile support claims vs reality.** Wails v2 advertises mobile (Android/iOS) templates but mobile is in alpha — many desktop features don't work, and the developer experience is rough.
- **Warning signs:** Mobile build succeeds but features missing at runtime.
- **Prevention:** If only Win + macOS, ignore mobile. If mobile matters, prototype first.
- **Phase:** Setup — framework decision.

**Pitfall W-3. Fewer integrations.** Go ecosystem has fewer "batteries included" desktop integrations than Electron. Native dialogs, system tray, notifications often need hand-rolled solutions or third-party Go libs.
- **Prevention:** Audit Go ecosystem for required features; expect to write more glue code than Electron.
- **Phase:** Setup — feature audit.

---

### Qt

**Pitfall Q-1. Licensing complexity (LGPL vs commercial).** Qt is dual-licensed: LGPL (free, must dynamically link, share modifications to Qt itself) or commercial (paid, can statically link, no LGPL obligations). Misuse triggers legal action from The Qt Company.
- **Warning signs:** Static linking of Qt in a non-open-source product; modifications to Qt source not shared; no commercial license on file.
- **Prevention:** Decide commercial vs LGPL before first line of code; consult Qt licensing FAQ; pay for commercial if statically linking in proprietary software.
- **Phase:** Setup — legal review.

**Pitfall Q-2. Build complexity.** Qt has its own build system (qmake → CMake migration), moc (meta-object compiler), rcc (resource compiler), and per-platform toolchains. Windows requires MSVC or MinGW + Qt installer; macOS requires Xcode + Qt; CI must match dev environment.
- **Warning signs:** "Works on my machine" because dev uses MSVC 2019 but CI uses MSVC 2022; moc not invoked for new Q_OBJECT classes; resource paths differ per platform.
- **Prevention:** Use Qt's online installer for matched toolchains; containerize CI with exact dev image; use CMake (qmake is being deprecated).
- **Phase:** Setup — CI image.

**Pitfall Q-3. AI-tooling fit.** Qt's QML + C++ is less well-represented in AI coding assistants than web stacks (React/Vue/Swift) or .NET. Generated code may have wrong moc annotations, missing `Q_OBJECT` macros, or QML binding mistakes.
- **Warning signs:** AI generates QML that compiles but doesn't bind; missing `Q_INVOKABLE` for slots called from QML; C++ code missing parent ownership for QObjects.
- **Prevention:** Constrain AI to specific framework patterns in prompts; always review for Qt-specific idioms; add CI tests covering AI-generated code paths.
- **Phase:** Build — code review.

**Pitfall Q-4. AI/ML and modern integration story.** Qt lacks first-party AI/ML libraries (no equivalent of ML.NET, PyTorch C++, CoreML). For AI-heavy features, you'll integrate third-party C++ libraries with complex ABI.
- **Prevention:** Verify which AI/ML C++ libs you need and whether they build cleanly with your Qt toolchain.
- **Phase:** Setup — feature audit.

---

## AI-Development Pitfalls

These pitfalls are specific to the workflow implied by the milestone context: pure AI-driven development, no human-team skill preference.

### AI-1. Build environments with cross-compilation quirks

**What goes wrong:** AI-generated build scripts assume Linux paths, bash syntax, or one-platform toolchains. Cross-compiling Windows binaries from macOS, or macOS from Windows, hits native toolchain errors the AI doesn't anticipate.
- **Concrete examples:**
  - `apt install` in a Windows-targeted Dockerfile.
  - `brew install` on a Windows runner.
  - Cargo cross-compiling for Windows GNU vs MSVC ABI mismatch.
  - Xcode-only steps (`xcrun`, `codesign`) in a Linux CI.
- **Warning signs:** CI fails on the "other" platform; AI suggests `cargo build --target=x86_64-pc-windows-msvc` from macOS without vcvarsall.
- **Prevention:**
  - Use one platform per CI matrix step (Win runner for Win builds, mac runner for mac builds) — don't cross-compile.
  - Provide the AI with explicit "OS X is Linux, OS Y is Windows, this is the cross-compile matrix" context per phase.
  - Containerize dev environments (`Dockerfile`, `devcontainer.json`).
- **Roadmap phase:** Setup — CI matrix.

---

### AI-2. Long compile/test cycles blocking iteration

**What goes wrong:** Rust, C++, .NET MAUI all have multi-minute cold builds. AI agents waste tokens and time waiting for compile output before knowing if code is correct.
- **Warning signs:** Agent submits code, runs `cargo build`, waits 10 minutes for an error, retries. Loop continues.
- **Prevention:**
  - Use `cargo check` instead of `cargo build` during iteration (faster, no codegen).
  - Pre-warm incremental build caches in CI (`cargo-chef`, `sccache`).
  - Have the AI run linters (`cargo clippy`, `eslint`, `flutter analyze`) before full builds.
  - For Tauri/Electron, use `tauri dev` / `electron .` for fast iteration; reserve full build for release.
- **Roadmap phase:** Build — every iteration.

---

### AI-3. Native dependency installation pain (vcpkg, brew, system libraries)

**What goes wrong:** AI scaffolds projects that depend on system libraries (OpenSSL, libxml2, sqlite) but doesn't include the install steps in CI. Build fails on a clean machine. Brew, apt, vcpkg, conan each have their own pitfalls.
- **Concrete examples:**
  - Tauri requires `webkit2gtk-4.0` on Linux; AI forgets to add `sudo apt install`.
  - macOS app uses OpenSSL via Homebrew; CI uses system OpenSSL; ABI mismatch.
  - Windows MSVC project links against `libsodium`; AI forgets vcpkg manifest.
- **Warning signs:** "Cannot find -lssl", "Package 'webkit2gtk-4.0' was not found", "missing vcruntime140.dll."
- **Prevention:**
  - Pin native deps via package manager manifests (`vcpkg.json`, `Cargo.toml [dependencies]`, `brew bundle`).
  - Use package managers' official CI images.
  - For AI agents: explicitly provide the platform's package manager in prompts.
- **Roadmap phase:** Setup — CI image + dependency pinning.

---

### AI-4. Code signing setup complexity for CI/CD

**What goes wrong:** AI sets up signing by hardcoding certificates in source, or skipping signing entirely "for now," or assuming a developer machine has the cert installed. CI fails because certificate isn't available. Apple notarization credentials leak into git history.
- **Concrete examples:**
  - `signtool sign /f cert.pfx /p MyPassword` checked into git.
  - `APPLE_PASSWORD=actual-password` in `.env` committed.
  - Apple notarization JSON credentials committed.
- **Warning signs:** `git log --diff-filter=A` shows `.pfx`, `.p12`, `.env` files. CI fails with "certificate not found."
- **Prevention:**
  - Use CI secret stores (GitHub Actions Secrets, Azure Key Vault, HashiCorp Vault).
  - Never commit certs or passwords; use `.gitignore` + secret references.
  - For Apple notarization: use App Store Connect API key (one-time download) over Apple ID + app-specific password.
  - For AI agents: explicitly forbid hardcoded credentials; provide `.env.example` templates.
- **Roadmap phase:** Setup — secret management; Ship — release pipeline.

---

### AI-5. AI scaffolding inconsistent project structure across platforms

**What goes wrong:** AI generates per-platform code paths in scattered locations (`src/win/`, `src/mac/`, `src/win_special/`) with no clear pattern. As project grows, finding platform-specific code becomes a hunt. The AI also re-implements platform abstractions each session.
- **Warning signs:** Multiple files named `platform_utils_win.cs`, `platform_utils_mac.cs`, `platform_utils_v2.cs`. Conditional compilation scattered with no central registry.
- **Prevention:**
  - Establish a strict platform abstraction pattern (`Platform/Windows/`, `Platform/MacOS/`, `Platform/Shared/`).
  - AI prompt should always reference the project's directory convention.
  - Use `RuntimeInformation` / conditional compilation in a single file per platform, not scattered.
- **Roadmap phase:** Setup — directory convention; Build — enforced by review.

---

### AI-6. Long-running AI sessions lose context of framework-specific idioms

**What goes wrong:** AI forgets that Tauri uses `tauri::command` macros, that Electron requires `contextIsolation`, that MAUI on macOS is Catalyst. Generates code that compiles locally but breaks framework invariants.
- **Warning signs:** Generated Tauri code without capability definitions; Electron code with `nodeIntegration: true`; MAUI XAML that doesn't render in Catalyst.
- **Prevention:**
  - Maintain a "framework invariants" document in `.claude/` or `AGENTS.md` per project.
  - Add linters / static analysis: `eslint-plugin-security` for Electron, `cargo clippy` for Tauri.
  - Keep AI prompts short and per-feature rather than mega-prompts.
- **Roadmap phase:** Setup — invariants doc; Build — enforced.

---

## Phase-Specific Warnings

| Phase / Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Setup: signing | EV cert not provisioned, SmartScreen warnings | Acquire EV cert + Azure Artifact Signing account before first release build |
| Setup: notarization | `altool` deprecation, Apple ID 2FA breaks CI | Use App Store Connect API key; use notarytool |
| Setup: CI matrix | Cross-compilation fails | One runner per OS, don't cross-compile native binaries |
| Setup: WebView2 bootstrap | Tauri Windows 10 users see blank window | Embed WebView2 bootstrapper in installer |
| Build: path utilities | Mixed separators, Unicode NFD/NFC | Central path abstraction + CI matrix |
| Build: high-DPI | Fuzzy text on 4K, layout shifts across displays | Test on dual-display 1x + 2x from Day 1 |
| Build: menus | macOS app menu missing | Wire macOS app menu explicitly with framework API |
| Build: file dialog | macOS sandbox bookmark expired | Persist security-scoped bookmarks |
| Build: native modules | node-gyp fails in CI | `@electron/rebuild` in postinstall; pin Electron version |
| Build: Rust compile time | Slow iteration | `cargo check` during iteration; `cargo-chef` in CI |
| Build: MAUI WinAppSDK | Missing runtime on user machines | Bootstrapper in installer; pin WinAppSDK version |
| Build: Flutter Impeller | Jank on specific GPUs | Skia fallback; test on hardware matrix |
| Build: Avalonia CJK | Glyph regression | Subscribe to Avalonia issues; test CJK rendering |
| Build: Tauri v2 signing regression | uninstall.exe unsigned | Pin `@tauri-apps/cli`; add `signtool verify` to CI |
| Ship: auto-update | Update silently fails behind proxies | Plan rollback path; test with downgraded build |
| Ship: crash reporting | No symbol files, raw stack traces | Upload dSYMs/PDBs as part of CI release |
| Ship: Defender false positive | Tauri apps flagged | EV cert + Microsoft submission for reputation |
| Ship: MAS submission | MAUI/Electron sandbox incompat | Verify MAS sandbox limits before MAS submission |

---

## Sources

Sources fetched via cs-web-fetch (system Edge headless + system proxy):

1. https://www.electronjs.org/docs/latest/tutorial/security — Electron security model and pitfalls (fetched 2026-06-18)
2. https://www.electronjs.org/docs/latest/tutorial/code-signing — Electron Windows/macOS signing (OV/EV certs, Azure Artifact Signing) (fetched 2026-06-18)
3. https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide — MAS sandbox, entitlements, build limitations (fetched 2026-06-18)
4. https://v2.tauri.app/security/ — Tauri trust boundaries, IPC, permissions model (fetched 2026-06-18)
5. https://v2.tauri.app/distribute/sign/windows/ — Tauri Windows code signing, OV vs EV, Azure Key Vault, Azure Artifact Signing (fetched 2026-06-18)
6. https://v2.tauri.app/distribute/sign/macos/ — Tauri macOS signing, notarization via App Store Connect API / Apple ID (fetched 2026-06-18)
7. https://github.com/tauri-apps/tauri/issues?q=is%3Aissue+webview2+is%3Aopen — Tauri WebView2 open issues (Trojan false positive #2486, IME/TSF CJK #15436, WACK #14935, signing #15018/#14995) (fetched 2026-06-18)
8. https://github.com/electron/electron/issues?q=is%3Aissue+is%3Aopen+notarization — Electron open notarization issues (#45802 macOS safestorage) (fetched 2026-06-18)
9. https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution — Apple notarization requirements, hardened runtime, entitlements (fetched 2026-06-18)
10. https://docs.flutter.dev/desktop — Flutter desktop support overview (fetched 2026-06-18)
11. https://flutter.dev/desktop — Flutter desktop marketing landing (fetched 2026-06-18)
12. https://doc.qt.io/qt-6/known-issues.html — Qt known issues stub (redirects to Qt Bug Tracker) (fetched 2026-06-18)
13. https://doc.qt.io/qt-6/ — Qt 6.11 module overview (fetched 2026-06-18)
14. https://github.com/AvaloniaUI/Avalonia/issues?q=is%3Aissue+is%3Aopen — Avalonia open issues (CJK regression #21556, macOS AppKit font #21565, DWM theming #21603/#21604) (fetched 2026-06-18)

### Sources attempted but unavailable

- https://learn.microsoft.com/en-us/dotnet/maui/macios-quirks — Edge headless returned empty content (Microsoft Learn anti-bot)
- https://learn.microsoft.com/en-us/dotnet/maui/ — Empty content
- https://learn.microsoft.com/en-us/windows/msix/package/sign-certificate — Empty content
- https://github.com/tauri-apps/tauri/issues?q=is%3Aissue+is%3Aopen+macos+label%3Abug — Edge timed out
- https://github.com/electron/electron/issues?q=is%3Aissue+is%3Aopen+contextIsolation — Edge timed out
- https://wails.io/docs/introduction — Site timed out
- https://github.com/wailsapp/wails/issues — Edge timed out
- https://avaloniaui.net/ — Edge returned empty content
- https://docs.avaloniaui.net/docs/getting-started — 404 page

For unavailable sources, knowledge drawn from prior research and community post-mortems (MEDIUM confidence on those specific claims).
