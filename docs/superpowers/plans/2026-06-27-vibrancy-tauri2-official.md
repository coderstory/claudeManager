# Vibrancy (Tauri 2 官方方案) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Tauri 2 官方 transparent titlebar + custom background color 方案, 让窗体背景透明, 用户能看到桌面壁纸 (macOS 完整支持 + Win11 真机待定).

**Architecture:** `WebviewWindowBuilder::title_bar_style(TitleBarStyle::Transparent)` (macOS 走 NSVisualEffectView 自动 vibrancy) + `NSWindow::setBackgroundColor(Color(0,0,0,0))` (objc2 FFI). Win11 通过 DWM (不实装, 留待真机).

**Tech Stack:** Tauri 2.11 + objc2-app-kit 0.3.2 (macOS only) + Rust 1.x

## Global Constraints

- **CLAUDE.md §2.3** 锁版本: 不升级 Tauri / Cargo deps (objc2-app-kit 0.3.2 是新加, 但用 [target.cfg] 隔离)
- **CLAUDE.md §2.4** 谨慎改文件: 每次改前说明, 不超出本 plan
- **CLAUDE.md §10** 不在 SPEC.md / .planning/research/ 改
- **CLAUDE.md §11** 主 session 不做开发任务, 派 subagent
- **必须配 visual self-check** (CLAUDE.md §5.3 TDD): Edge headless 截图验证, **不能只信 log**
- tauri.conf.json 不能有 `transparent:true` (老方案, 移除)
- 不调 `WebviewWindow::set_background_color` (那是 webview 不是 native window, Tauri 官方文档明确)
- 不调 `apply_vibrancy` / `apply_mica` (Tauri 2 官方 transparent 方案不依赖这些, 旧 M2.16 路径有 main thread bug, 弃用)
- 不影响 5 主题 (CLAUDE.md §6.4 显示 vs 系统标识分层): 窗体透明与主题独立

## Pre-Flight Findings (调研结论, 2026-06-27)

来源: `https://v2.tauri.app/learn/window-customization/` (render-url 验证)

Tauri 2 官方 transparent titlebar + custom background color 标准做法:

1. **tauri.conf.json**: 删 `decorations:false / titleBarStyle / transparent:true` (老方案, 不再用)
2. **Cargo.toml** 加依赖 (macOS only):
   ```toml
   [target."cfg(target_os = \"macos\")".dependencies]
   objc2-app-kit = { version = "0.3.2", features = ["NSColor", "NSWindow", "objc2-core-foundation"] }
   ```
3. **Rust** 改用 `WebviewWindowBuilder` + `title_bar_style(TitleBarStyle::Transparent)`
4. **Rust** 加 `NSWindow::setBackgroundColor(Color(0,0,0,0))` (通过 objc2)
5. **前端 body 改 `background: transparent`** (让 native 透明透出)

## File Structure (Plan Target)

```
src-tauri/
├── Cargo.toml                              # 改: 加 objc2-app-kit macOS-only 依赖
├── tauri.conf.json                         # 改: 删 transparent/decorations 老字段
├── src/
│   ├── lib.rs                              # 改: 改用 WebviewWindowBuilder + NSWindow setBackgroundColor
│   └── platform/
│       ├── mod.rs                          # 不改 (保留 trait 抽象)
│       ├── traits.rs                       # 不改
│       ├── macos/
│       │   ├── window_chrome.rs            # 删 (弃用 apply_vibrancy 路径)
│       │   └── set_transparent.rs          # 新建: objc2 NSWindow setBackgroundColor 封装
│       └── windows/
│           └── window_chrome.rs            # 删 (待 Win11 真机)
src/
├── App.css                                 # 改: body { background: transparent }
├── design-system/tokens.css                # 改: body { background: transparent }
```

---

## Task 1: 加 Cargo.toml 依赖 (objc2-app-kit macOS-only)

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: (none, fresh dep)
- Produces: `[target."cfg(target_os = \"macos\")".dependencies] objc2-app-kit = "0.3.2"` with features

- [ ] **Step 1: Read current Cargo.toml**

Run: `grep -A3 "target.os\|objc2\|cocoa" /Users/coderstory/CodeSource/winui3/src-tauri/Cargo.toml`

- [ ] **Step 2: Add objc2-app-kit to [target] dependencies**

If no `[target."cfg(target_os = \"macos\")".dependencies]` block exists, add at end of Cargo.toml:

```toml
[target."cfg(target_os = \"macos\")".dependencies]
objc2-app-kit = { version = "0.3.2", features = ["NSColor", "NSWindow", "objc2-core-foundation"] }
```

- [ ] **Step 3: Verify cargo check**

Run: `cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check 2>&1 | tail -5`
Expected: builds without error on macOS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(M31-vibrancy): 加 objc2-app-kit macOS-only 依赖 (Tauri 2 官方方案)"
```

---

## Task 2: 删 tauri.conf.json 老 transparent 字段

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Read current tauri.conf.json**

Run: `grep -A3 "decorations\|titleBarStyle\|transparent" /Users/coderstory/CodeSource/winui3/src-tauri/tauri.conf.json`

- [ ] **Step 2: Remove decorations / titleBarStyle / transparent**

Edit `src-tauri/tauri.conf.json` so the main window config has:
- ✅ `label`, `title`, `width`, `height`, `minWidth`, `minHeight`, `resizable`, `fullscreen`, `visible`
- ❌ `decorations: false` (REMOVE)
- ❌ `titleBarStyle: "Overlay"` (REMOVE)
- ❌ `transparent: true` (REMOVE)

Final config (the windows section under `app.windows[0]`):
```json
{
  "label": "main",
  "title": "Claude 配置管理器",
  "width": 1024,
  "height": 640,
  "minWidth": 720,
  "minHeight": 480,
  "resizable": true,
  "fullscreen": false,
  "visible": true
}
```

- [ ] **Step 3: Verify JSON valid**

Run: `python3 -m json.tool < /Users/coderstory/CodeSource/winui3/src-tauri/tauri.conf.json > /dev/null && echo OK`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(M31-vibrancy): 删 tauri.conf.json 老 transparent 字段 (改用 WebviewWindowBuilder)"
```

---

## Task 3: Rust 改用 WebviewWindowBuilder + NSWindow setBackgroundColor

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/platform/macos/set_transparent.rs`
- Delete: `src-tauri/src/platform/macos/window_chrome.rs` (if exists, 弃用)
- Delete: `src-tauri/src/platform/windows/window_chrome.rs` (if exists, 弃用)

**Interfaces:**
- Consumes: Cargo.toml objc2-app-kit
- Produces: `set_transparent_background(&WebviewWindow)` 函数 in `set_transparent.rs`

- [ ] **Step 1: Find current window creation code in lib.rs**

Run: `grep -n "WebviewWindowBuilder\|title_bar_style\|set_background_color\|MainWindow\|setup" /Users/coderstory/CodeSource/winui3/src-tauri/src/lib.rs | head -20`

- [ ] **Step 2: Create set_transparent.rs**

Create `src-tauri/src/platform/macos/set_transparent.rs`:

```rust
//! M31 — Tauri 2 官方方案: NSWindow setBackgroundColor 透明.
//!
//! 通过 objc2-app-kit FFI 调用 macOS 原生 API, 设 NSWindow 背景为
//! Color(r, g, b, a) = Color(0, 0, 0, 0). 这让 Tauri webview 后面
//! 桌面壁纸透出, 实现 transparent 窗体效果.
//!
//! 必须在 main thread 调用 (Tauri 2 RunEvent::Ready 或 .setup
//! 闭包内不直接调, 走 builder.build().run() 的 .run event loop).

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
pub fn set_transparent_background(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSWindow};
    use objc2::runtime::AnyObject;

    let ns_window_ptr = window
        .ns_window()
        .map_err(|e| format!("ns_window() failed: {e}"))?
        as *mut NSWindow;

    unsafe {
        let bg_color = NSColor::colorWithRed_green_blue_alpha(0.0, 0.0, 0.0, 0.0);
        (*ns_window_ptr).setBackgroundColor(Some(&bg_color));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_transparent_background(_window: &WebviewWindow) -> Result<(), String> {
    // Stub for non-macOS targets. Win11 真机待 DWM 实现.
    Ok(())
}
```

- [ ] **Step 3: Add to platform/mod.rs module list**

Edit `src-tauri/src/platform/mod.rs` to add: `pub mod set_transparent;` (or appropriate module declaration depending on existing structure).

- [ ] **Step 4: Use WebviewWindowBuilder with TitleBarStyle::Transparent in lib.rs**

In `src-tauri/src/lib.rs`, replace the existing window creation with:

```rust
use tauri::{Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

// ... in setup() or run():

let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
    .title("Claude 配置管理器")
    .inner_size(1024.0, 640.0)
    .min_inner_size(720.0, 480.0)
    .resizable(true)
    .visible(true);

#[cfg(target_os = "macos")]
let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

let window = win_builder.build().expect("failed to build main window");

// Apply transparent background on main thread (RunEvent::Ready)
let app_handle = app.handle().clone();
.run(move |app_handle, event| {
    if matches!(event, RunEvent::Ready) {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Err(e) = crate::platform::macos::set_transparent::set_transparent_background(&window) {
                eprintln!("[M31] set_transparent_background failed: {e}");
            }
        }
    }
});
```

- [ ] **Step 5: Verify cargo check + build**

```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check 2>&1 | tail -5
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo build 2>&1 | tail -5
```

Expected: builds clean on macOS, no compilation errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/platform/macos/set_transparent.rs src-tauri/src/platform/mod.rs
git commit -m "feat(M31-vibrancy): WebviewWindowBuilder + NSWindow setBackgroundColor (Tauri 2 官方)"
```

---

## Task 4: 前端 body 改 transparent (让 native 透明透出)

**Files:**
- Modify: `src/App.css` (line 34: `background: #FAFAF7` → `background: transparent`)
- Modify: `src/design-system/tokens.css` (line 257: `body { background: var(--bg-primary) }` → `body { background: transparent }`)

- [ ] **Step 1: Read current body background rules**

Run: `grep -B1 -A2 "^body {" /Users/coderstory/CodeSource/winui3/src/App.css`
Run: `grep -B1 -A4 "^body {" /Users/coderstory/CodeSource/winui3/src/design-system/tokens.css`

- [ ] **Step 2: Edit App.css body**

Replace:
```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1F2328;
  background: transparent; /* M31: Tauri 2 NSWindow setBackgroundColor 透出 */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 3: Edit tokens.css body**

Replace:
```css
body {
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
  background: transparent; /* M31: Tauri 2 NSWindow setBackgroundColor 透出. 页面背景改在 .main 元素 */
  transition: background-color 200ms ease, color 200ms ease;
}
```

- [ ] **Step 4: Verify dev server starts + HMR reloads**

Run: `pkill -9 -f "tauri dev" 2>/dev/null; sleep 2; cd /Users/coderstory/CodeSource/winui3 && npm run tauri dev > /tmp/tauri-dev.log 2>&1 &`

Wait 60s, then:
Run: `grep -E "M31|set_transparent|RunEvent::Ready|ERROR|panic" /tmp/tauri-dev.log | head -5`

Expected: `[M31]` log appears, no panic, no error

- [ ] **Step 5: Commit**

```bash
git add src/App.css src/design-system/tokens.css
git commit -m "feat(M31-vibrancy): body 改 transparent 让 NSWindow 透出桌面"
```

---

## Task 5: Visual self-check (Edge headless 截图验证)

**Files:**
- Create: `/tmp/vibrancy-verify.mjs` (Playwright 脚本, 仅验证用)

- [ ] **Step 1: Read existing playwright config**

Run: `head -30 /Users/coderstory/CodeSource/winui3/playwright.config.ts`

- [ ] **Step 2: Write visual verification script**

Create `/tmp/vibrancy-verify.mjs`:

```javascript
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Step A: 截图 dev server URL (Vite)
await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/vibrancy-vite.png' });

// Step B: 检查 body computed background
const bodyBg = await page.evaluate(() => {
  const bg = window.getComputedStyle(document.body).backgroundColor;
  return { bg, hasImage: bg.includes('gradient') || bg.includes('url') };
});
console.log('body bg:', bodyBg);

// Step C: 模拟 macOS 桌面壁纸 (PNG data URL) 作为 body 背景, 看 body 是否真的 transparent
await page.evaluate(() => {
  document.body.style.background = 'url("data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"200\" height=\"200\" fill=\"%23ff6600\"/></svg>")';
});
await page.screenshot({ path: '/tmp/vibrancy-overlay.png' });

await browser.close();
```

- [ ] **Step 3: Run script and verify**

Run: `node /tmp/vibrancy-verify.mjs 2>&1 | tail -10`

Expected:
- `body bg: { bg: 'rgba(0, 0, 0, 0)', hasImage: false }` (transparent)
- 2 PNG files saved

- [ ] **Step 4: Read screenshots**

Use Read tool on:
- `/tmp/vibrancy-vite.png` (current Tauri dev rendering)
- `/tmp/vibrancy-overlay.png` (with simulated orange wallpaper)

If overlay.png shows orange showing through (body is transparent), PASS. If overlay.png shows no orange, FAIL — body still has solid background.

- [ ] **Step 5: Commit verification artifact (optional)**

If screenshots saved to project, commit them. Otherwise skip.

```bash
# Optional: git add docs/superpowers/specs/2026-06-27-vibrancy/screenshots/
# git commit -m "test(M31): visual self-check screenshots"
```

---

## Task 6: 5 主题实装测试回归验证 (5 主题仍可用)

**Files:**
- (none, 验证已有测试)

- [ ] **Step 1: Run all vitest**

Run: `cd /Users/coderstory/CodeSource/winui3 && npx vitest run 2>&1 | tail -10`
Expected: same 3 pre-existing failures as baseline (no new failures from M31)

- [ ] **Step 2: Run Playwright e2e**

Run: `cd /Users/coderstory/CodeSource/winui3 && PLAYWRIGHT_BASE_URL=http://127.0.0.1:1420 npx playwright test tests/e2e/theme-design-system.spec.ts 2>&1 | tail -10`
Expected: 8/8 e2e pass (5 主题 + macOS 按钮 + 字体)

- [ ] **Step 3: No-commit verification report**

If new failures appear, dispatch a fix subagent. Otherwise just summarize in ledger.

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ tauri.conf.json 老字段删除 (Task 2)
- ✅ Cargo.toml 依赖 (Task 1)
- ✅ WebviewWindowBuilder + TitleBarStyle::Transparent (Task 3)
- ✅ NSWindow::setBackgroundColor (Task 3)
- ✅ body transparent (Task 4)
- ✅ Visual self-check (Task 5)
- ✅ 5 主题回归 (Task 6)

**2. Placeholder scan:** 无 TBD / TODO / "implement later"

**3. Type consistency:** `set_transparent_background` 签名一致, 跨 macOS / non-macOS 都有 stub

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-vibrancy-tauri2-official.md`**

**6 个任务, 估算工作量**:
- Task 1-2 (config): ~10m
- Task 3 (Rust): ~30m
- Task 4 (前端): ~5m
- Task 5 (视觉验证): ~20m
- Task 6 (回归): ~15m

**总计 ~1.5h**

**两个执行选项**:
1. **Subagent-Driven** (推荐) — 派 subagent 实施
2. **Inline Execution** — 主 session 串行执行

**按 CLAUDE.md §11, 主 session 不做开发, 选 Subagent-Driven**.

**重要**: Task 5 (视觉自检) 不可省, 防止 subagent 再次"代码成功但视觉无效".
