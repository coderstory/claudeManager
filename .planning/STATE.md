M1.1 ✓ accepted by user at 2026-06-19 00:26:16

## M1.2 — OS abstraction layer (8 traits × Win+Mac)
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.2-platform-abstractions.exe
- Smoke: 4/4 PASS
- Commit: 13290b3

## M1.3 — Plugin host + 12 stubs
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.3-plugin-host.exe
- Smoke: 4/4 PASS + 6 vitest pass / 1 skip
- Commit: 77e070a

## M1.4 — Tauri capabilities with WHY
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.4-platform-plugins-capabilities.exe
- Smoke: 4/4 PASS (no behavior change, capability-only)
- Commit: cc47b7d

## M1.8 — TDD + UI e2e framework
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.8-tdd-scaffold.exe
- Smoke: 4/4 PASS + Playwright + CI + Vitest configured
- Commit: 6814a7a


## M1.3-fix: rebuild release exe to embed latest frontend bundle
- Status: ✅ Fixed (no source changes)
- Root cause: Stale `dist/` embedded in release exe. Cargo skipped relink because Rust source unchanged.
- Workaround: `touch src-tauri/src/lib.rs` to invalidate cache, then `cargo build --release`.
- **Lesson (MUST document in CLAUDE.md §9):** Release build pipeline must always end with `cargo build --release`. If `dist/index.html` mtime > exe mtime, the exe is stale.
- **Permanent fix (M1.10):** Add `beforeBuildCommand` to tauri.conf.json that runs `npm run build` + `cargo build --release` atomically, OR have a build script that always re-links when dist/ is newer.
- Ship: `ClaudeConfigManager-M1.1.3-plugin-host-fix.exe` (19.8 MB, 6月 19 11:21)

## M1.3-pipeline-fix-v2: Tauri custom-protocol feature required
- Status: ✅ Fixed (commit 50abbe6)
- Root cause: `cargo build --release` (without `tauri build`) does NOT enable the `custom-protocol` cargo feature on the `tauri` crate. Without this feature, `tauri::generate_context!()` emits `EmbeddedAssets::default()` (zero dist files embedded) and runtime `manager::get_app_url` returns `devUrl` ("http://localhost:1420"), so the webview tries to load the vite dev server, which isn't running → "ERR_CONNECTION_REFUSED".
- Fix: `cargo build --release --features tauri/custom-protocol` (added to `scripts/build-and-ship.sh`).
- Smoke Test 7 added: greps exe for `dist/` JS bundle fingerprint (e.g. `index-0_uwNIGD.js`) — 0 hits = dist not embedded = regression.
- Ship: `ClaudeConfigManager-M1.1.3-plugin-host-fix-v2.exe` (19.0 MB, 6月 19 11:48)
- Memory: `feedback/tauri-v2-custom-protocol-required` (already exists, fully documented).

## M1.3-fix: viewport meta + CSS reset (no browser scrollbars)
- Status: ✅ Fixed (commit 038aa4f, awaiting user review)
- Root cause: html/body/#root had no CSS reset (default 8px body margin) → horizontal scrollbar. `.app-shell` used `min-height: 100vh` + content taller than 640px → vertical scrollbar.
- Fix: `src/App.css` global reset (`overflow:hidden`, `height:100%`, `box-sizing:border-box`) + `index.html` viewport meta. `.container` set to `overflow:auto` (scroll inside, not browser).
- Smoke: 7/7 PASS (includes Test 7 dist fingerprint check, hash=`index-0_uwNIGD`)
- Ship: `ClaudeConfigManager-M1.1.3-plugin-host-fix-v3.exe` (19.0 MB, 6月 19 12:06) ⏳ pending user verification

## kill-app.sh fix: taskkill -F not /F
- Status: ✅ Fixed (commit dd4456b)
- Root cause: Git Bash msys path conversion mangles `/F` in `taskkill /F /IM` as `F:/` → "invalid option" error, process not killed, tray icon stays.
- Fix: Use `taskkill -F -IM foo.exe` (dash, not slash).
- Memory: `feedback/taskkill-dash-flags-not-slash.md` (new, written this session).

## M1.2 / M1.3 / M1.4 / M1.8 user review status
- M1.2 (commit 13290b3): ⏳ Pending user review (functional behavior unchanged vs M1.1; only adds platform abstraction layer in code)
- M1.3 (commit 77e070a, superseded by 038aa4f for exe): ⏳ Pending user review of v3 exe
- M1.4 (commit cc47b7d): ⏳ Pending user review (no behavior change, capability-only)
- M1.8 (commit 6814a7a): ⏳ Pending user review (test framework, no exe change visible to user)

## Memory written this session
- `feedback/taskkill-dash-flags-not-slash.md` — Git Bash taskkill /F → -F (cross-project Windows tooling)
- `feedback/cs-web-fetch-for-internet.md` — cs-web-fetch for subagent network access (cross-project)

## Outstanding M1 tasks (not yet started)
- M1.5: 前端依赖 + 设计系统基线（瓷白主题 + CSS 变量）
- M1.6: Rust 后端依赖 + 版本锁
- M1.7: 自启动集成（Win 注册表 + Mac LaunchAgent）
- M1.9: 主窗口框架 + 12 路由占位
- M1.10: 构建/打包/签名/CI matrix
- M1.11: CI + 框架不变量文档 + 三阶段评审
- M1.12: 最终自审 + 头脑风暴 + 同行评审 + 业务流程分析
