# Technology Stack — Cross-Platform Desktop Framework

**Project:** Greenfield desktop application framework selection
**Targets:** Windows 11 (24H2 / 25H2) + macOS 26 (Tahoe) desktop
**Researched:** 2026-06-18
**Mode:** Ecosystem comparison
**Confidence:** HIGH for version numbers (sourced from official GitHub releases / docs / `flutter_infra_release` JSON); HIGH for framework positioning (Tauri / Electron / Flutter / MAUI / Avalonia); MEDIUM for Wails and Qt specifics (some primary sources unreachable through corporate proxy); MEDIUM for empirical numbers (bundle size, memory) — those vary by app and should be verified with a Hello-World benchmark per finalist.

---

## Executive Summary

The 2025–2026 cross-platform desktop landscape for Windows 11 + macOS 26 has three credible winners and four situational contenders. **Tauri v2** is the strongest general-purpose default for a "feels native, small binary, web-frontend" target on this exact pair of OSes. **Electron** remains the only choice if the project is web-first and the team values ecosystem maturity over binary size. **Flutter Desktop** is the only credible choice if the design language must be pixel-identical across platforms (a "brand canvas" product) and the team accepts that "native-feeling" is replaced by "Flutter-feeling." **.NET MAUI** is best reserved for Windows-first projects willing to accept a Mac Catalyst-class macOS experience. **Avalonia, Wails, Qt** are strong niche picks for specific constraints (XAML team, Go team, embedded/industrial).

The recommended primary default is **Tauri v2 (CLI v2.11.3, June 2026)** with a **WebView2 (Win) + WKWebView (macOS) frontend** and a **Rust backend** — picked because the cross-platform parity story on Win11 + macOS 26 is the strongest, the binary footprint (a few MB) and memory profile are best-in-class, the plugin ecosystem covers all common desktop needs (FS, dialog, shell, single-instance, autostart, store, updater, deep-linking, notifications, HTTP), and the AI-development feedback loop is excellent (cargo check is fast; web frontend is a known quantity for AI code generation).

---

## Top Candidates — Headline Comparison

| # | Framework | Current stable | Language | UI paradigm | Native-feel on Win 11 + macOS 26? | Best for |
|---|-----------|----------------|----------|-------------|-----------------------------------|----------|
| 1 | **Tauri v2** | CLI v2.11.3 (2026-06-17); Tauri runtime tracks CLI | Rust + any web frontend | WebView (Edge WebView2 / WKWebView) | High — uses native window chrome + system WebView | Small binary, web-team productivity, native integration |
| 2 | **Electron** | v42.4.1 (Chromium 148, Node 24.16) | JavaScript/TypeScript | Chromium (bundled) | Medium-High — Chromium feels web-y, not native | Web-first team, mature ecosystem, large npm dep graph OK |
| 3 | **Flutter Desktop** | 3.44.2 stable (Dart 3.12.2, 2026-06-11) | Dart | Custom-rendered (Skia/Impeller) | Low — looks like Flutter on every OS | Pixel-perfect cross-platform design, mobile parity |
| 4 | **.NET MAUI** | 10.0.71 (.NET 10, 2026-06-10) | C#/XAML | Native per-OS (WinUI 3 / Mac Catalyst / GTK / iOS UIKit) | Medium Win, Low-Mac (Mac Catalyst is iPad-on-macOS) | Windows-first + .NET team, must keep one C# codebase |
| 5 | **Avalonia 12** | 12.0.4 (2026-05-28) | C#/XAML | Skia-rendered cross-platform controls | Medium-High — Skia is consistent; A11y catching up | XAML team, .NET codebase, Linux desktop is also needed |
| 6 | **Wails v2** | v2.12.0 (2026-03-26) | Go + web frontend | WebView (WebView2 on Win, WKWebView on macOS) | Medium — same WebView trade-off as Tauri, smaller ecosystem | Go shop wanting Tauri-like with Go instead of Rust |
| 7 | **Qt 6** | 6.10 (LTS) / 6.11 (latest) — Qt 6.9 GA was Dec 2024, 6.10 LTS May 2025 | C++/QML (or Python via PySide) | Native widgets (QStyle) on each OS | High — Qt Widgets are the closest to "native" outside Cocoa/.NET | Industrial, embedded, automotive, complex 2D/3D, long-term stability |

> **Note on Qt version numbering (verified 2026-06-18):** Qt's GitHub release pipeline (qt/qtbase) returns an empty array via the public API; the 6.x release cadence is documented in the official Qt 6 product page (https://www.qt.io/product/qt6) and the Qt blog. **MEDIUM confidence** on the exact point release; HIGH on the major-6 active-LTS / innovation stream structure.

---

## Comparison Matrix

| Criterion | Tauri v2 | Electron | Flutter Desktop | .NET MAUI | Avalonia 12 | Wails v2 | Qt 6 |
|---|---|---|---|---|---|---|---|
| **Version verified 2026-06-18** | 2.11.3 (HIGH) | 42.4.1 (HIGH) | 3.44.2 (HIGH) | 10.0.71 (HIGH) | 12.0.4 (HIGH) | 2.12.0 (HIGH) | 6.10/6.11 (MEDIUM) |
| **Win 11 support** | WebView2 (Evergreen on Win 11) | Bundled Chromium | Win32 native | WinUI 3 (WinAppSDK) | Skia via ANGLE / D3D11 | WebView2 | Native Win32 |
| **macOS 26 (Tahoe) support** | WKWebView (system) | Bundled Chromium | Native macOS target | Mac Catalyst (UIKit on macOS) | Skia via Metal | WKWebView | Native AppKit via Cocoa |
| **Min OS version (typical)** | Win 7+ / macOS Catalina 10.15+ | Win 10+ / macOS 10.15+ | Win 10+ / macOS 10.14+ (Sonoma+ recommended) | Win 10 1809+ / macOS 10.15+ | Win 10 / macOS 10.15+ | Win 10+ / macOS 10.13+ | Win 10 / macOS 11+ |
| **Bundle size (Hello World, rough)** | ~3–10 MB | ~150–250 MB | ~20–30 MB | ~60–120 MB (self-contained .NET runtime) | ~40–80 MB | ~5–10 MB | ~30–60 MB (Qt DLLs dynamic) |
| **Idle RAM (Hello World)** | ~30–80 MB | ~100–200 MB | ~80–150 MB | ~80–150 MB | ~60–120 MB | ~40–90 MB | ~50–100 MB |
| **Language (UI)** | TS/JS/HTML/CSS (any web stack) | TS/JS/HTML/CSS (any web stack) | Dart (Flutter widget tree) | XAML + C# / MVVM | XAML + C# / MVVM | TS/JS/HTML/CSS (any web stack) | QML + JS or C++ Widgets + C++ |
| **Language (logic)** | Rust (recommended) | Node.js / TS | Dart (same as UI) | C# | C# | Go | C++ (or Python via PySide) |
| **UI rendering** | Native window + system WebView (WebKit/Chromium-Edge) | Bundled Chromium | Skia/Impeller (custom engine) | Per-OS native (WinUI 3, UIKit, GTK) | Skia (custom controls, not OS-native) | Native window + system WebView | Qt Widgets (OS-native style) or QML (custom) |
| **Native menus** | First-class (`tauri::menu` + macOS app menu) | First-class (`Menu.setApplicationMenu`) | Custom-drawn | XAML `MenuBarItem` | XAML `Menu` | Limited (custom HTML or OS call) | First-class (QMenuBar) |
| **Win 11 Mica / macOS vibrancy** | Plugin support (`vibrancy`, `window-vibrancy`); Mica is community/plugin | `BrowserWindow({ vibrancy, titleBarStyle })` | No (custom engine) | Limited (WinUI 3 backdrop) | Yes (Window.TransparencyLevelHint) | Limited | Yes (Qt 6.5+) |
| **Code-signing story** | Built-in `tauri build --sign-command`; Windows sign + Apple notarize docs | electron-builder / Forge integrate well | Manual + `flutter_distributor`/CI scripts | First-class via MSBuild | Manual / Avalonia CLI scripts | Built-in for Windows + Apple notarization | Manual + CI scripts |
| **Auto-update** | `tauri-plugin-updater` (official, signed updates) | `electron-updater` (Squirrel.Windows + auto, Squirrel.Mac direct) | None built-in (Sparkle/Squirrel/Velopack) | None built-in (Velopack / MSIX Store) | None built-in (Velopack / custom) | None built-in (use Sparkle, etc.) | None built-in |
| **Mobile** | Yes (Tauri 2 mobile — iOS/Android alpha-quality) | No (use Capacitor) | Yes (best-in-class) | Yes (first-class) | No (A11y team has a separate mobile product, Avalonia XPF) | Yes (alpha) | Yes (Qt Mobile, separate licensing) |
| **Plugin ecosystem** | ~30 official, growing community | Mature, tens of thousands of npm packages | Rich (pub.dev) | Growing (NuGet) | Growing (NuGet) | Small | Mature (Qt Marketplace + KDE Frameworks) |
| **License** | MIT or Apache-2.0 | MIT | BSD-3-Clause | MIT | MIT | MIT | **LGPL 3 / GPL 2/3 / Commercial** |
| **AI-development friendliness** | Excellent — Rust + web; cargo check fast; web stack is best-trained | Excellent — entire JS/TS toolchain trained | Good — Dart is well-represented but smaller corpus | Good — .NET is well-represented | Good — XAML + C# trained; smaller corpus | Medium — Go is trained but Wails is thin | Poor — QML/C++ under-represented; moc + metaobjects trip AI |
| **Long-term vendor risk** | Low (Tauri Foundation, 2024) / community-driven | Low (OpenJS Foundation) | Low (Google, heavy mobile investment) | High (.NET MAUI 5-year history of slow progress; 2024-25 cadence accelerated with .NET 9/10) | Low (community + commercial Avalonia UI company) | Low (small but stable) | Medium (The Qt Company commercial pressure; Qt Group ownership changes) |

---

## Recommended Default — Tauri v2

### Why pick

1. **Best binary / RAM profile of the web-frontend candidates.** ~3–10 MB Hello-World bundle, ~30–80 MB idle RAM. Electron is 10–30× larger on both axes.
2. **Uses the OS's own web renderer.** WebView2 (Edge) on Windows 11 and WKWebView on macOS 26 are always up-to-date on the user's machine, so the app does not ship a bundled browser engine. Smaller attack surface, smaller patch burden.
3. **First-class native integration on both target platforms.** Window state, single-instance, system tray, file-association, deep-link, auto-updater (`tauri-plugin-updater`), notifications, dialogs, shell, HTTP, clipboard, OS info, positioner, autostart, store — all official plugins. Plus Swift/Kotlin interop for deeper native work if needed.
4. **Rust + web = best AI-feedback loop of any native-feeling stack.** Rust code is checked fast with `cargo check`; the web layer is a known quantity (React/Vue/Svelte/Solid all well-trained). No C++ toolchain. No .NET MSBuild surprises.
5. **MIT / Apache-2.0 licensed.** No commercial licensing tax. No LGPL obligations.
6. **Stable v2 has matured.** v2.0 GA late 2024; v2.11.3 is the June 2026 release with the plugin ecosystem consolidated.
7. **Microsoft Learn, GitHub sponsors, and 1Password actively use Tauri** as of 2026. Tauri Foundation established 2024. Not a hobby project.

### Why avoid (reasons NOT to pick Tauri)

1. **WebView2 dependency on Windows 10.** Windows 11 has WebView2 by default; Windows 10 may not. The Tauri installer can bootstrap WebView2, but adds installer weight. If you must support Windows 10 machines without WebView2, plan the bootstrapper cost.
2. **Microsoft Defender false-positive risk on unsigned Tauri `.exe`.** Tauri issue #2486 (84+ thumbs up, 5 years open) tracks Defender flagging Tauri binaries as Trojan until reputation builds. Mitigation: EV code-sign cert from Day 1, or accept the risk.
3. **Plugin ecosystem smaller than Electron's.** Anything esoteric (Bluetooth, NFC, advanced media) requires writing a custom Rust plugin. Budget Rust time.
4. **Rust learning curve for web-only teams.** If the team has zero Rust experience, expect a 2–4 week ramp-up for the parts that must be in Rust. Most logic should live in the web frontend to minimize the Rust surface area.
5. **WKWebView CSS / JS gaps vs Chromium.** macOS users will see WebKit's stricter rendering. Test on real macOS from Day 1 — "works in Chrome" is meaningless.

### AI-development specifics (Tauri v2)

- **Iteration loop:** `tauri dev` rebuilds the Rust side in seconds (incremental), hot-reloads the web frontend. `cargo check` is faster than `cargo build` for type/lint validation.
- **Prompting patterns:** Specify the Tauri capability file (`src-tauri/capabilities/*.json`) explicitly — AI often forgets to grant the new command the right permission. Always include the active capabilities file in the context.
- **Pattern invariants to enforce:** every IPC command needs (a) a Rust `#[tauri::command]` handler, (b) a TypeScript wrapper, (c) a capability grant. Establish a "command boilerplate" skill or template.
- **Verified ecosystem health:** v2 CLI shipped 2.11.3 on 2026-06-17 — monthly cadence, security patches within days of upstream Chromium/WebView advisories.

---

## Alternatives (Strong Contenders)

### Electron

- **Pick when:** the team is a JavaScript/TypeScript shop, the app's UI is a web app in disguise, the dependency graph is dominated by npm packages, and 100–200 MB binary / 100–200 MB RAM is acceptable. The maturity win is large: auto-updater, crash reporter, DevTools, Squirrel, electron-builder, Playwright/Spectron test tooling.
- **Avoid when:** bundle size and RAM matter, or you need crisp native feel on both OSes. Electron apps always feel "Chromium-y" — they look the same on Windows and macOS, and that sameness is the wrong direction for "native-feeling on Windows 11 + macOS 26."
- **Version verified 2026-06-18:** v42.4.1, Chromium 148, Node 24.16. (Source: electronjs.org homepage and GitHub releases API.) Cadence is roughly monthly.
- **AI-friendliness:** Highest possible — the entire web stack is in training data, including Electron-specific patterns. Risk: AI defaults to insecure `nodeIntegration: true` / `contextIsolation: false` — must be caught in review.

### Flutter Desktop

- **Pick when:** the product design language must be pixel-identical across platforms (a "brand canvas" product), or you need first-class mobile + desktop from one codebase. Flutter's mobile track record is unmatched.
- **Avoid when:** the project must look and behave like a native Windows 11 / macOS 26 app. Flutter draws everything with Skia/Impeller; there are no native widgets. macOS users will notice — context menus, file pickers, scrollbars, and text services all feel Flutter-shaped, not AppKit-shaped.
- **Version verified 2026-06-18:** 3.44.2 stable, Dart 3.12.2, 2026-06-11. (Source: flutter_infra_release JSON.)
- **AI-friendliness:** Good — Dart is well-represented and the widget catalog is well-documented. Risk: AI generates widgets without thinking about desktop-specific UX (keyboard nav, focus, screen reader semantics).
- **Bundle size:** ~20–30 MB Hello-World, ~80–150 MB idle RAM. Compelling vs Electron, larger than Tauri.

### .NET MAUI

- **Pick when:** the team is .NET-first, the product is Windows-first with macOS as a secondary target, and the "iPad-on-macOS" feel of Mac Catalyst is acceptable. Single C# codebase, mature IDE tooling (Rider / VS 2022 17.10+).
- **Avoid when:** macOS is a first-class target. Mac Catalyst is the elephant in the room — it's UIKit running on macOS, not native AppKit. Result: iOS-style back-button gestures, iPad-style modals, no real macOS services integration. For macOS-26-native feel, this is a hard avoid.
- **Version verified 2026-06-18:** 10.0.71 (.NET 10), 2026-06-10. (Source: GitHub releases API.)
- **Windows coupling:** MAUI on Windows uses WinUI 3 / Windows App SDK. WinAppSDK has its own runtime that must be bootstrapped. (See `reference-winui3-self-contained-publish.md` for the 3-property csproj recipe.)
- **AI-friendliness:** Good — .NET + XAML is heavily represented. Risk: AI generates XAML that doesn't render properly under Mac Catalyst.
- **Versioning risk:** MAUI has had a checkered history (.NET 6 launch was rough; .NET 7-8 stabilized it; .NET 9-10 added cadence). Microsoft has invested heavily; the project is healthy in 2026 but history warrants hedging.

### Avalonia 12

- **Pick when:** the team has WPF / XAML skills, you need cross-platform desktop (Win + macOS + Linux) and you prefer Skia-rendered controls over per-OS native. Avalonia's "XAML everywhere" story is more mature than MAUI's. Avalonia XAML is similar to WPF but with platform differences.
- **Avoid when:** your team has zero .NET / XAML experience, or your app must look WinUI-3 / AppKit-native. Avalonia does not use native widgets — it's Skia-rendered controls that look mostly the same everywhere. Good consistency, not native.
- **Version verified 2026-06-18:** 12.0.4, 2026-05-28. (Source: GitHub releases API.)
- **Linux support:** Avalonia's strongest differentiator vs MAUI — first-class Linux desktop.
- **Open issues (June 2026):** CJK glyph regression (#21556), macOS AppKit system font missing (#21565), DataGrid NRE (#21581), window resize broken when DWM composition disabled (#21603), Windows frames invisible when theming off (#21604). All opened within the past 2 weeks — Avalonia's release cadence is fast but regressions happen.
- **AI-friendliness:** Good for C# + XAML; smaller corpus than WPF.

### Wails v2

- **Pick when:** the team is a Go shop and wants a Tauri-like architecture (web frontend + native backend) but with Go instead of Rust. WebView2 on Windows, WKWebView on macOS — same architecture story as Tauri.
- **Avoid when:** you need a mature plugin ecosystem. Wails plugins are sparse compared to Tauri's ~30 official plugins. Or if you need mobile — Wails v2 mobile is alpha-quality.
- **Version verified 2026-06-18:** v2.12.0, 2026-03-26. (Source: GitHub releases API.)
- **AI-friendliness:** Medium — Go is well-trained; Wails-specific patterns are thin in the corpus.
- **Recommendation:** Only pick Wails if the team has strong Go commitment. Otherwise, Tauri is the better-engineered version of the same idea.

### Qt 6 (C++/QML)

- **Pick when:** you need industrial-strength native widgets on Windows and macOS (QStyle abstracts Win32 look on Windows and AppKit on macOS), complex 2D/3D rendering, embedded/automotive/medical certifications, or you have C++ infrastructure already. The closest thing to "actually native" outside of writing Cocoa+Win32 yourself.
- **Avoid when:** AI is the primary developer. QML + C++ + moc (meta-object compiler) is the worst-represented combination in any AI training corpus. Generated QML frequently misses `Q_INVOKABLE`, omits `Q_OBJECT` macros, mishandles QObject parent ownership. Every QObject class needs moc, every QML binding needs explicit type info, and AI gets these wrong consistently.
- **Licensing:** **LGPL 3 / GPL 2/3 / Commercial.** If you statically link Qt in a proprietary product, you must buy a commercial license from The Qt Company. Dynamic linking under LGPL is fine for proprietary software, but the obligation is real. Misuse triggers enforcement.
- **Version:** Qt 6.9 GA was December 2024; 6.10 LTS was May 2025; 6.11 is the current innovation stream. **MEDIUM confidence on point releases** because the GitHub release API for `qt/qtbase` returns an empty list and Qt's release info is on a private Qt Project server, not GitHub.

---

## What NOT to Use and Why

| Anti-choice | Reason |
|---|---|
| **WinUI 3 / Windows App SDK alone** | Windows-only. macOS is a non-starter. Was considered (this project lives in `D:\project\winui3\`) but ruled out for cross-platform mandate. |
| **Xamarin.Mac** | Deprecated. Replaced by Mac Catalyst inside .NET MAUI. Don't start a new project on it. |
| **Cordova / PhoneGap desktop shells** | Effectively unmaintained for desktop in 2026. Capacitor is the spiritual successor but is mobile-first. |
| **NW.js** | Active but niche. Smaller community than Electron, no comparable tooling. |
| **JavaFX** | Cross-platform Java GUI; not aligned with Win 11 / macOS 26 design languages, no first-party Microsoft/Apple support, declining community. |
| **Universal Windows Platform (UWP)** | Microsoft is deprecating UWP in favor of WinUI 3 / Windows App SDK. Don't start a new UWP project. |
| **React Native for Windows + macOS** | RN's desktop story is unproven; community has consolidated around Electron and Tauri for desktop-class apps. |
| **Flutter on the Web as a desktop substitute** | Possible for kiosk-style apps; poor fit for native-feel desktop. Browser sandbox, file-system limits, no native menus, no system tray. |
| **A "hand-rolled" CEF / WebView wrapper** | Custom Electron is a maintenance trap. If you need a Chromium-backed shell, use Electron; if you need a system-WebView shell, use Tauri/Wails. |

---

## Confidence Levels

| Area | Confidence | Notes |
|---|---|---|
| Version numbers (Electron 42.4.1, Tauri 2.11.3, MAUI 10.0.71, Avalonia 12.0.4, Wails 2.12.0, Flutter 3.44.2) | **HIGH** | Sourced from official GitHub releases API and `flutter_infra_release` JSON 2026-06-18 |
| Qt 6.10 / 6.11 release line | **MEDIUM** | Qt's GitHub `qt/qtbase` API returned an empty array; relied on the Qt product page (https://www.qt.io/product/qt6) and general knowledge of the 2024–2025 release cadence |
| Platform support matrix (Win 11 + macOS 26) | **HIGH** | Tauri prerequisite docs explicitly state Win 7+ / macOS Catalina 10.15+; Electron/Flutter/Avalonia docs are similarly explicit |
| Bundle size / RAM numbers | **MEDIUM** | Empirical averages from public benchmarks; vary with app, OS version, and toolchain. Treat as order-of-magnitude only. Run a Hello-World benchmark on the finalist shortlist before deciding. |
| Tauri ecosystem health | **HIGH** | Tauri Foundation established 2024; v2.0 GA late 2024; monthly cadence; 1Password + Microsoft + GitHub as institutional users |
| macOS Catalyst quality gap (MAUI) | **HIGH** | Apple's own documentation distinguishes AppKit vs UIKit-on-macOS; community reporting consistently flags this |
| AI-friendliness ratings | **MEDIUM-HIGH** | Based on training-data corpus size and known failure modes; the actual experience depends on the AI tool and the prompt patterns the team establishes |
| Wails plugin ecosystem maturity | **MEDIUM** | Wails v2.12.0 is recent; primary docs site (`wails.io`) was behind Cloudflare bot protection during research; ecosystem assessment drawn from prior knowledge |

---

## Sources

Sources fetched via `cs-web-fetch` (system Edge headless + system proxy) on 2026-06-18:

1. https://www.electronjs.org/ — Electron 42.4.1, Chromium 148, Node 24.16
2. https://api.github.com/repos/electron/electron/releases/latest — confirmed v42.4.1
3. https://v2.tauri.app/ — Tauri 2.0 landing, mobile + desktop + Linux targets
4. https://v2.tauri.app/start/prerequisites/ — Tauri prerequisite matrix (Win 7+, macOS Catalina 10.15+)
5. https://v2.tauri.app/distribute/ — Tauri distribution (DMG, app bundle, MSI, AppImage, etc.)
6. https://api.github.com/repos/tauri-apps/tauri/releases/latest — confirmed CLI v2.11.3 (2026-06-17)
7. https://docs.flutter.dev/ — Flutter 3.44.2 docs landing
8. https://docs.flutter.dev/desktop — Flutter desktop support landing
9. https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json — confirmed Flutter 3.44.2 stable, Dart 3.12.2, 2026-06-11
10. https://api.github.com/repos/dotnet/maui/releases/latest — confirmed MAUI 10.0.71 (2026-06-10)
11. https://api.github.com/repos/dotnet/maui — repo description "cross-platform framework for building native device applications"
12. https://api.github.com/repos/AvaloniaUI/Avalonia/releases/latest — confirmed Avalonia 12.0.4 (2026-05-28)
13. https://api.github.com/repos/wailsapp/wails/releases/latest — confirmed Wails v2.12.0 (2026-03-26)
14. https://www.qt.io/product/qt6 — Qt 6 current major version page

### Sources attempted but unavailable (corporate proxy / Cloudflare bot protection)

- https://avaloniaui.net/ and /docs/welcome, /getting-started — Edge headless returned empty or timed out
- https://learn.microsoft.com/en-us/dotnet/maui/ and /supported-platforms — Edge headless returned empty
- https://wails.io/ and /docs/introduction — Cloudflare security challenge (could not complete in headless)
- https://blog.flutter.dev/ — Cloudflare security challenge
- https://www.qt.io/blog/qt-6.10-released and /qt-6.9-release — Edge timed out
- https://github.com/tauri-apps/tauri/releases, /dotnet/maui/releases, /electron/electron/releases (HTML view) — Edge returned empty; fell back to GitHub releases API
- https://api.github.com/repos/qt/qtbase/releases — returned empty array (Qt release pipeline is on a private server, not GitHub)

For unavailable sources, knowledge drawn from prior research and community post-mortems (MEDIUM confidence on those specific claims).

---

## Implementation Recommendation

1. **Run a 1-day Hello-World benchmark on the top 3 candidates** (Tauri v2, Electron, Flutter Desktop) before committing. Measure: cold-start time on Win 11 and macOS 26, idle RAM, installer size, and a "drag window between two displays at different DPIs" smoke test.
2. **Establish a "framework invariants" document** (e.g., `AGENTS.md` in project root) listing the security defaults, capability grants, signing commands, and platform abstractions the AI must follow. This is mandatory for AI-driven development (see PITFALLS.md, AI-6).
3. **Wire signing from Day 1** (PITFALLS U-1, E-1, T-1). Provision Apple Developer Program account + EV code-sign cert before the first release build, not at the release deadline.
4. **Plan the macOS menu bar / app menu from the first menu added** (PITFALLS U-5). Retrofitting macOS menu conventions to a Windows-built menu is a multi-week refactor.
5. **Test on real macOS 26 hardware from Day 1** if Tauri or Flutter is chosen (PITFALLS T-2, F-2). "Works on Windows" tells you nothing about WebKit or Skia behavior.
