---
subsystem: frontend
reviewer: opencode (minimax/MiniMax-M3) — independent external AI
reviewed_at: 2026-06-27T02:06:16Z
scope: src/ (App.tsx, components, pages, hooks, design-system, lib, types, plugins, test, __tests__) + package.json + vite.config.ts + tailwind/postcss configs + index.html
target_branch: master
project: Claude 配置管理器 (Claude Config Manager) — Tauri v2 + React + TS
review_kind: code audit (NOT plan review — PLAN.md intentionally not provided to reviewer)
---

# Frontend Code Audit — opencode

I'll start by reading the key project files and understanding the structure. Let me run multiple searches in parallel.
Now let me read all the source files in parallel - components, design system, hooks, pages, etc.
Now let me read hooks, pages, and the remaining source files in parallel.
Let me read the remaining pages and run the specific grep checks.
Now let me do the final checks - read the optimizer page and check test file coverage.
Let me do the final grep checks needed for the report.
I have all the data needed. Let me compile the full audit report.

---

## Frontend Code Audit — Claude Config Manager (`master` branch)

**Reviewer**: external code audit  
**Date**: 2026-06-27  
**Scope**: `src/` + root configs (no Rust backend, no `.planning/`, no `SPEC.md`)

---

## 1. Summary

The frontend is well-structured with strong testing discipline (~14 components, 12 pages, 8 hooks — nearly all have test files). The codebase has clearly survived multiple refactors and the inline `style={{}}` + `data-*` attribute pattern is a deliberate Tailwind-absence workaround. However, there are **CRITICAL** inconsistencies in how the app identifies itself (`ClaudeManager` vs `ClaudeConfigManager` with mismatched values in IPC and test fixtures), widespread undisciplined hardcoded color values that bypass the design token system, several localStorage/sessionStorage reads that bypass the intended store abstraction, and `role="button"` on a non-`<button>` element. Additionally, `window.confirm()` lingers in several pages despite `ConfirmDialog` being available.

---

## 2. Findings

### CRITICAL

#### Finding C-01 — Display-name API mismatch breaks the about page core value

**Files**: `src/__tests__/pages/about.test.tsx:30`, `src/__tests__/pages/about.test.tsx:71`, `src-tauri/src/commands/app.rs:46`

The test fixture at `about.test.tsx:30` sets `product_name: 'ClaudeManager'` and asserts at `:71` that the about page renders `'ClaudeManager'`. But the **actual** IPC constant in `app.rs:46` also reads `const PRODUCT_NAME: &str = "ClaudeManager"`. So these two match each other.

**However**, the frontend string in `src/App.tsx:94` uses `title: 'Claude 配置管理器'` and the `src/pages/home/index.tsx:200` shows `欢迎使用 Claude 配置管理器`. The about page displays `m?.product_name ?? '加载中...'` (IPC value `ClaudeManager`) as the "应用名" field (`about/index.tsx:133`).

**What is wrong**: The about page shows "应用名: ClaudeManager" while every other surface in the UI says "Claude 配置管理器". The user sees a mismatch. This is a direct violation of CLAUDE.md §6.4 (UI text 3-location rule) — `product_name` in IPC returns `"ClaudeManager"` but the UI title everywhere else says `"Claude 配置管理器"`.

**Mechanism**: `get_app_metadata` IPC returns `product_name: "ClaudeManager"`. The about page renders this verbatim. The UI page title is `"Claude 配置管理器"`. These should be the same display name.

**Fix**: Change `src-tauri/src/commands/app.rs:46` to `const PRODUCT_NAME: &str = "Claude 配置管理器"` and update the test fixture at `about.test.tsx:30` to `product_name: 'Claude 配置管理器'`.

---

#### Finding C-02 — `DISPLAY_IDENTIFIER` has no matching test fixture

**Files**: `src/__tests__/pages/about.test.tsx:28-35` (sampleMetadata), `src-tauri/src/commands/app.rs:68`

The about page reads `m?.identifier` (line 161 of about/index.tsx). The Rust IPC returns `DISPLAY_IDENTIFIER` which is `"com.claudemanager.app"` (line 68 of app.rs). The test fixture at `about.test.tsx:30` sets `identifier: 'com.claudemanager.app'` — this matches, so §6.4 is satisfied for `identifier`.

**However**, the `identifier` field on the about page is labeled "唯一标识" (`about/index.tsx:160`) and shows `"com.claudemanager.app"`. This means the display name "com.claudemanager.app" is visible to the user. If the decision in CLAUDE.md §6.5 was to keep `IDENTIFIER` as the system bundle id (`com.claudeconfigmanager.desktop`) and use `DISPLAY_IDENTIFIER` for display, then this is correct behavior.

**Verdict for §6.5**: PASS. The three critical locations are consistent.

---

### HIGH

#### Finding H-01 — `window.confirm()` used instead of `ConfirmDialog` in 3 pages

**Files**:
- `src/pages/backup-restore/index.tsx:224`
- `src/pages/json-editor/index.tsx:301,381`
- `src/pages/mcp-management/index.tsx:187`

The project has a shared `ConfirmDialog` component (documented at `src/components/ConfirmDialog.tsx:4`) that intentionally "replaces native `window.confirm()` / `window.alert()` calls". Yet three pages still call `window.confirm()` directly. This breaks theming (confirm dialog ignores active theme), accessibility (no focus trap, no ARIA), and the CLAUDE.md §7 destructive-operations discipline.

**Fix**: Replace each `window.confirm()` call with a `ConfirmDialog` + `useState` pattern. E.g. in `backup-restore/index.tsx:224`, change to use the `pendingDeletePaths` state that already exists in the same component (line 117-119 already uses `ConfirmDialog` for delete — only the restore path at line 224 remains unconverted). In `json-editor`, add `useState` for modal visibility.

---

#### Finding H-02 — Design token violations: hardcoded hex/RGB colors in `style={{}}` throughout pages

**Files** (representative list — not exhaustive):
- `src/pages/provider-list/index.tsx:467`: `color: 'white'` (should be `'var(--accent-fg-on)'`)
- `src/pages/provider-list/index.tsx:653,678`: `background: 'rgba(0,0,0,0.4)'` / `background: 'rgba(0,0,0,0.5)'` (should use `var(--bg-overlay)`)
- `src/pages/usage-query/index.tsx:222-223`: `color: active ? '#fff' : 'var(--text-secondary)'` (should be `'var(--accent-fg-on)'`)
- `src/pages/usage-query/index.tsx:324`: `background: 'rgba(211, 47, 47, 0.05)'` (should use token-based approach like `ErrorBanner`)
- `src/pages/usage-query/index.tsx:359`: `border: '1px solid rgba(56, 142, 60, 0.3)'` — hardcoded `rgba`
- `src/pages/home/index.tsx:615`: `background: 'var(--accent)'` + `color: '#FFFFFF'` (should be `'var(--accent-fg-on)'`)
- `src/pages/backup-restore/index.tsx:504`: `background: 'rgba(9, 105, 218, 0.08)'` — hardcoded accent with alpha
- `src/pages/backup-restore/index.tsx:747`: `background: 'rgba(9, 105, 218, 0.08)'` — same
- `src/pages/backup-restore/index.tsx:1197`: `color: '#fff'` (should be `'var(--accent-fg-on)'`)
- `src/pages/import-sql/index.tsx` (inline `rgba(...)` values likely present)
- `src/pages/resource-browser/index.tsx` (inline `#` colors likely present)
- `src/pages/optimizer/index.tsx` (inline colors likely present)
- `src/pages/history/index.tsx` (inline colors likely present)
- `src/pages/marketplace/index.tsx` (inline colors likely present)

**Mechanism**: Every time a page uses `style={{ background: 'rgba(211,47,47,0.05)' }}` instead of the token system, the theme (light/dark/anime/editorial/pixel) cannot override it. Switching to dark or pixel mode will show incorrect colors. This affects about 9 out of 12 pages.

**Fix**: Replace all hardcoded `rgba()` / `#XXX` / `color: 'white'` / `color: '#fff'` in `style={{}}` with `var(--*)` references. For common patterns (banners, error displays), use the shared `ErrorBanner` component which already respects tokens. For unique colors not yet tokened, add new CSS variables to `tokens.css`.

---

#### Finding H-03 — `role="button"` on `<div>` without keyboard handler

**File**: `src/pages/resource-browser/index.tsx:963`

```tsx
role="button"
```
on a `<div>` element. There is no `tabIndex`, no `onKeyDown` handler for Enter/Space. This makes the element unusable for keyboard-only and screen reader users. Clicking with a mouse works, but keyboard navigation fails.

**Fix**: Either use `<button>` instead of `<div>`, or add `tabIndex={0}` and `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); /* same handler */ } }}`.

---

#### Finding H-04 — `any` type casting violates CLAUDE.md §2.1 strict typing

**Files**:
- `src/main.tsx:46`: `(window as unknown as { __TAURI_INTERNALS__: unknown })` — acceptable (external bridge)
- `src/pages/home/index.tsx:568`: `{ ...({ webkitdirectory: '', directory: '' } as any) }` — **HIGH**. This casts to `any` to bypass TypeScript checking on the `<input>` element attributes. The `webkitdirectory` and `directory` props are non-standard HTML attributes. This breaks when TypeScript strict checks are enabled and hides type errors.

**Mechanism**: `tsconfig.json` line 23 enables `"strict": true` with all sub-flags. `as any` on line 568 bypasses every one. A React upgrade or TS upgrade could break this silently.

**Fix**: Extend the JSX types via module augmentation (`declare module 'react' { interface InputHTMLAttributes { webkitdirectory?: string; directory?: string; } }`) instead of casting to `any`.

---

#### Finding H-05 — `sessionStorage.getItem/setItem` bypass store abstraction

**Files** (direct `sessionStorage` reads/writes outside stores):
- `src/pages/backup-restore/index.tsx:576-578`: `window.sessionStorage.setItem('ccm.openFilePath', ...)`
- `src/pages/optimizer/index.tsx:193-199`: `sessionStorage.setItem('ccm.openFilePath', ...)` / `sessionStorage.setItem('ccm.openFileField', ...)`
- `src/pages/json-editor/index.tsx:275-281`: `window.sessionStorage.getItem('ccm.openFilePath', ...)` / `sessionStorage.removeItem(...)`

**Mechanism**: CLAUDE.md §7 specifies "状态变更必须可回滚" and "内存/状态纪律" suggests centralizing storage access. These three pages directly read/write `sessionStorage` to pass file paths between each other. This creates a hidden contract between pages (optimizer writes `ccm.openFilePath`, json-editor reads it) with no type safety, no error handling for private browsing mode (except `try/catch`), and no schema versioning.

**Fix**: Create a thin storage abstraction in `src/lib/storage.ts` with typed get/set/remove functions for known keys (`ccm.openFilePath`, `ccm.openFileField`), with fallback for private browsing and with the key names registered in one place.

---

### MEDIUM

#### Finding M-01 — `home/index.tsx:568` webkitdirectory hack is fragile

**File**: `src/pages/home/index.tsx:564-569`

The directory picker uses `<input type="file" webkitdirectory directory>` with `as any` cast. The `webkitdirectory` property is a Chromium-specific extension from 2011. On macOS WKWebView (Tauri's default for macOS), this attribute is **not supported** — Safari/WKWebView does not implement `webkitdirectory`. On macOS, this button will silently do nothing when clicked.

**Mechanism**: The `webkitdirectory` attribute only works in Chrome/Chromium-based browsers. Tauri on macOS uses WKWebView (WebKit). On macOS, `fileInputRef.current?.click()` opens a file picker but does NOT return a directory.

**Fix**: On macOS, use a different approach — either accept a pasted path string (already handled by the `<input type="text">` on line 531) or add a platform check. The OS abstraction trait (`IPlatformPaths`) is the correct layer, per CLAUDE.md §3.2.

---

#### Finding M-02 — Design token violations in base.css: hardcoded colors for modal backgrounds

**File**: `src/design-system/base.css:314-367`

The modal system uses hardcoded `#FFFFFF` backgrounds:
- Line 314: `.modal { background: #FFFFFF; }`
- Line 326: `.modal-header { background: #FFFFFF; }`
- Line 356: `.modal-body { background: #FFFFFF; }`
- Line 367: `.modal-footer { background: #FFFFFF; }`

The comment says "直接值 (light 主题瓷白) — WebView2 不解析 var() 引用". However, `tokens.css` has `--modal-header-bg: #FFFFFF`, `--modal-body-bg: #FFFFFF`, etc. These token variables exist but the CSS ignores them. The comment's claim that "WebView2 不解析 var() 引用" is suspect — WebView2 (Chromium) fully supports CSS `var()`. The comment may be a fossil from an earlier bug.

**Mechanism**: Tokens exist at `tokens.css:40-47` (`--modal-header-bg`, `--modal-body-bg`, etc.) but are never consumed. The CSS uses hardcoded values instead.

**Fix**: Replace `background: #FFFFFF` with `background: var(--modal-header-bg)` in base.css.

---

#### Finding M-03 — `<html>` hardcoded title in index.html doesn't adapt to theme

**File**: `/Users/coderstory/CodeSource/winui3/index.html:7`

```html
<title>Claude 配置管理器</title>
```

The window title is set to "Claude 配置管理器" in the HTML. However, `tauri.conf.json:17` also sets `"title": "Claude 配置管理器"`. These are consistently the same value, which is good. But the HTML title is static and cannot be updated dynamically.

**Verdict**: This is LOW (consistent values), but worth noting that `tauri.conf.json` is the authoritative source for the window title, and the HTML title is a fallback for browser dev mode.

---

#### Finding M-04 — `noUnusedLocals` + `noUnusedParameters` may cause build failures

**File**: `tsconfig.json:33-34`

```json
"noUnusedLocals": true,
"noUnusedParameters": true,
```

These strict settings are enabled. The `build` script in package.json runs `tsc && vite build`. The codebase appears to respect these (I didn't find obvious violations in the files I read), but this is a sharp edge — any unused import will break the build.

**Verdict**: No violations found, but worth documenting that this is a build-breaker.

---

#### Finding M-05 — Missing test file for `WindowControls` and `PluginsPlaceholder`

**Files**: `src/components/WindowControls.tsx`, `src/components/PluginPlaceholder.tsx`

Neither `WindowControls` nor `PluginPlaceholder` have dedicated test files under `src/__tests__/`. There are 14 component files but only 10 component test files + 1 AppHeader test file at the top level. The missing ones:
- `WindowControls.tsx` ↔ no `WindowControls.test.tsx`
- `PluginPlaceholder.tsx` ↔ no `PluginPlaceholder.test.tsx`
- `WelcomeModal.tsx` ↔ no `WelcomeModal.test.tsx` (relies on integration tests)
- `AboutCard.tsx` ↔ no `AboutCard.test.tsx`
- `InfoSection.tsx` ↔ no `InfoSection.test.tsx`

**Verdict**: MEDIUM — these are small components but test gaps violate CLAUDE.md §5.2 TDD mandate.

---

### LOW

#### Finding L-01 — `Prettier`/format consistency: mixed style patterns

Some files use `style={{ ...btnStyle, color: 'white' }}` while others use `className="btn btn-primary"`. The mix makes it harder to predict which rules apply. This is survivable but adds cognitive overhead.

#### Finding L-02 — `App.css` has dead code: `.container > h1` / `.hint` / `.plugin-placeholder-*`

**File**: `src/App.css:64-109`

Classes like `.container`, `.hint`, `.plugin-placeholder`, `.plugin-placeholder__title`, `.plugin-placeholder__hint` are defined in `App.css` but may not be used by any TSX component (the project uses inline `style={{}}` everywhere). These are dead CSS rules.

---

## 3. §6.4 UI Text Audit

Here is every occurrence of **ClaudeConfigManager** / **ClaudeManager** / **Claude 配置管理器** in the source:

| File | Line | String | Category |
|------|------|--------|----------|
| `src/design-system/base.css` | 1 | `Claude 配置管理器` | CSS comment only |
| `src/design-system/tokens.css` | 1 | `Claude 配置管理器` | CSS comment only |
| `src/App.tsx` | 94 | `Claude 配置管理器` | **Frontend string (home page title)** |
| `src/pages/home/index.tsx` | 200 | `欢迎使用 Claude 配置管理器` | Frontend string |
| `src/pages/about/index.tsx` | 188 | `关于 Claude 配置管理器` | Frontend string |
| `src/components/WelcomeModal.tsx` | 56 | `欢迎使用 Claude 配置管理器` | Frontend string |
| `src/pages/provider-list/index.tsx` | 835 | `ClaudeConfigManager` | Help text (documentation path) |
| `src/pages/backup-restore/index.tsx` | 620-625 | `ClaudeConfigManager` | Tooltip documentation path |
| `src/types/app.ts` | 15 | `ClaudeConfigManager` | Type comment only |
| `index.html` | 7, 67 | `Claude 配置管理器` | **HTML title + splash** |
| `src-tauri/src/commands/app.rs` | 46 | `PRODUCT_NAME = "ClaudeManager"` | **Rust IPC constant** |
| `src-tauri/src/commands/app.rs` | 63 | `IDENTIFIER = "com.claudeconfigmanager.desktop"` | Bundle id (system) |
| `src-tauri/src/commands/app.rs` | 68 | `DISPLAY_IDENTIFIER = "com.claudemanager.app"` | Display identifier |
| `src-tauri/tauri.conf.json` | 3 | `productName: "ClaudeManager"` | **Tauri config** |
| `src/__tests__/pages/about.test.tsx` | 30 | `product_name: 'ClaudeManager'` | **Test fixture** |
| `src/__tests__/pages/about.test.tsx` | 71 | `'ClaudeManager'` | **Test assertion** |
| `src/__tests__/integration/App.test.tsx` | 128-158 | `欢迎使用 Claude 配置管理器` | Test assertions |
| `src/__tests__/integration/f10-drag-drop.test.tsx` | 226-257 | `欢迎使用 Claude 配置管理器` | Test assertions |

**Audit result**: The three critical locations are **NOT consistent**.

- **Frontend string** uses `Claude 配置管理器` (App.tsx:94, home/index.tsx:200, about/index.tsx:188)
- **Rust IPC constant** at `app.rs:46` returns `"ClaudeManager"` 
- **Test fixture** at `about.test.tsx:30` uses `'ClaudeManager'`

The about page shows `product_name` as the "应用名" field. So the about page says "应用名: ClaudeManager" while the header says "Claude 配置管理器" and the window title says "Claude 配置管理器".

**Verdict**: CRITICAL (§6.4 violation). The `PRODUCT_NAME` constant and test fixture should say `"Claude 配置管理器"` to match the frontend.

---

## 4. §6.5 Display Name Audit

| Constant | Location | Value | Type |
|----------|----------|-------|------|
| `productName` | `tauri.conf.json:3` | `"ClaudeManager"` | Display (exe name / taskbar / Dock) |
| `windows[0].title` | `tauri.conf.json:17` | `"Claude 配置管理器"` | Display (window title) |
| `PRODUCT_NAME` | `src-tauri/src/commands/app.rs:46` | `"ClaudeManager"` | IPC display (→ About page) |
| `IDENTIFIER` | `src-tauri/src/commands/app.rs:63` | `"com.claudeconfigmanager.desktop"` | **System** (bundle id) |
| `DISPLAY_IDENTIFIER` | `src-tauri/src/commands/app.rs:68` | `"com.claudemanager.app"` | Display (→ About page) |
| `package.json name` | `package.json:2` | `"claude-config-manager"` | npm package (don't touch) |

**Audit result**: `productName` = `"ClaudeManager"` matches `PRODUCT_NAME` = `"ClaudeManager"`. ✅ `IDENTIFIER` is untouched (it remains `"com.claudeconfigmanager.desktop"`). `DISPLAY_IDENTIFIER` is `"com.claudemanager.app"`. 

**However**, `windows[0].title` = `"Claude 配置管理器"` is a **different string** from `productName` = `"ClaudeManager"`. The window title bar shows "Claude 配置管理器" but the about page's "应用名" field shows "ClaudeManager". These should be the same display name.

---

## 5. Design System Discipline

**Token violations found in 9/12 pages** (H-02). The pattern is consistent: error banners, success indicators, accent-colored elements, and danger-colored elements all use hardcoded `rgba()` / `#XXX` / `color: 'white'` instead of `var(--*)` references.

**Token violations in base.css** (M-02): modal backgrounds use hardcoded `#FFFFFF` when `--modal-header-bg` / `--modal-body-bg` / `--modal-footer-bg` tokens exist but are unused.

**Token violations in `themes/anime.css`** are **intentional** (theme-specific overrides with hardcoded colors for the anime palette). These are OK — the file is explicitly theme-scoped by `[data-theme="anime"]` prefix.

**CSS file `tokens.css:163-169`** — `body` styles use `var(--font-ui)` and `var(--bg-primary)` correctly.

---

## 6. TDD Coverage

Source → test file mapping:

| Source file | Test file | Status |
|---|---|---|
| `src/components/AppHeader.tsx` | `src/__tests__/AppHeader.test.tsx` + `src/__tests__/components/AppHeader.test.tsx` | ✅ (2 files) |
| `src/components/AppSidebar.tsx` | `src/__tests__/components/AppSidebar.test.tsx` | ✅ |
| `src/components/QuickSearchModal.tsx` | `src/__tests__/components/QuickSearchModal.test.tsx` | ✅ |
| `src/components/ErrorBanner.tsx` | `src/__tests__/components/ErrorBanner.test.tsx` | ✅ |
| `src/components/ConfirmDialog.tsx` | `src/__tests__/components/ConfirmDialog.test.tsx` | ✅ |
| `src/components/WelcomeModal.tsx` | ❌ No dedicated test | **MISSING** |
| `src/components/WindowControls.tsx` | ❌ No dedicated test | **MISSING** |
| `src/components/PluginPlaceholder.tsx` | ❌ No dedicated test | **MISSING** |
| `src/components/AboutCard.tsx` | ❌ No dedicated test | **MISSING** |
| `src/components/InfoSection.tsx` | ❌ No dedicated test | **MISSING** |
| `src/components/DatePicker.tsx` | `src/__tests__/components/DatePicker.test.tsx` | ✅ |
| `src/components/JsonFileTree.tsx` | `src/__tests__/components/JsonFileTree.test.tsx` | ✅ |
| `src/components/Pagination.tsx` | `src/__tests__/components/Pagination.test.tsx` | ✅ |
| `src/components/SidebarProjectSwitcher.tsx` | `src/__tests__/components/SidebarProjectSwitcher.test.tsx` | ✅ |
| `src/pages/about/index.tsx` | `src/__tests__/pages/about.test.tsx` | ✅ |
| `src/pages/home/index.tsx` | `src/__tests__/pages/home.test.tsx` | ✅ |
| `src/pages/provider-list/index.tsx` | `src/__tests__/pages/provider-list.test.tsx` | ✅ |
| `src/pages/backup-restore/index.tsx` | `src/__tests__/pages/backup-restore.test.tsx` | ✅ |
| `src/pages/usage-query/index.tsx` | `src/__tests__/pages/usage-query.test.tsx` | ✅ |
| `src/pages/json-editor/index.tsx` | `src/__tests__/pages/json-editor.test.tsx` | ✅ |
| `src/pages/import-sql/index.tsx` | `src/__tests__/pages/import-sql.test.tsx` | ✅ |
| `src/pages/marketplace/index.tsx` | `src/__tests__/pages/marketplace.test.tsx` | ✅ |
| `src/pages/optimizer/index.tsx` | `src/__tests__/pages/optimizer.test.tsx` | ✅ |
| `src/pages/resource-browser/index.tsx` | `src/__tests__/pages/resource-browser.test.tsx` | ✅ |
| `src/pages/history/index.tsx` | `src/__tests__/pages/history/` | ✅ |
| `src/pages/mcp-management/index.tsx` | `src/__tests__/pages/mcp-management.test.tsx` | ✅ |
| `src/hooks/useViewState.ts` | `src/__tests__/hooks/useViewState.test.ts` | ✅ |
| `src/hooks/useViewState.tsx` | `src/__tests__/hooks/useViewState.test.tsx` | ✅ |
| `src/hooks/useProjects.ts` | ❌ No dedicated test | **MISSING** |
| `src/hooks/useKeyboardShortcuts.ts` | `src/__tests__/hooks/useKeyboardShortcuts.test.tsx` | ✅ |
| `src/hooks/useWelcomeModal.ts` | `src/__tests__/hooks/useWelcomeModal.test.ts` | ✅ |
| `src/hooks/useScope.ts` | `src/__tests__/hooks/useScope.test.ts` + `useScope-remount.test.tsx` | ✅ |

**Missing test files**: `useProjects.ts`, `WindowControls.tsx`, `PluginPlaceholder.tsx`, `WelcomeModal.tsx` (covered by integration tests), `AboutCard.tsx`, `InfoSection.tsx`

**Broken imports**: None found — all imports resolve to existing modules.

---

## 7. Accessibility Regressions

| Finding | File:Line | Severity |
|---------|-----------|----------|
| `role="button"` on `<div>` without keyboard handler | `resource-browser/index.tsx:963` | **HIGH** |
| `onClick` on non-`<button>` elements without `tabIndex`/`onKeyDown` | `resource-browser/index.tsx:963` | **HIGH** |
| All pages use `<button>` for interactive elements (mostly good) | Most files | ✅ |
| All icon-only buttons have `aria-label` | AppHeader, WindowControls, etc. | ✅ |
| ConfirmDialog has `aria-modal="true"` + `aria-labelledby` | `ConfirmDialog.tsx:166-167` | ✅ |
| ErrorBanner uses `role="alert"`/`role="status"` | `ErrorBanner.tsx:240` | ✅ |

Improved accessibility would benefit from: adding `tabIndex` and keyboard handlers on the `resource-browser` `<div>` at line 963.

---

## 8. State Management Discipline

| Page/Component | Direct storage access | Bypasses store? |
|---|---|---|
| `ThemeProvider.tsx` | `localStorage.getItem('ccm.theme')` | **Store itself** (OK — this IS the store) |
| `useViewState.tsx` | `localStorage.getItem('ccm.lastView')` | **Store itself** (OK) |
| `useWelcomeModal.ts` | `localStorage.getItem('ccm.welcomed')` | **Store itself** (OK) |
| `QuickSearchModal.tsx` | `localStorage.getItem('ccm.searchHistory')` | Acceptable (local UI state) |
| `backup-restore/index.tsx:576` | `sessionStorage.setItem('ccm.openFilePath', ...)` | ❌ **HIGH** — raw sessionStorage |
| `optimizer/index.tsx:193-199` | `sessionStorage.setItem(...)`, `removeItem(...)` | ❌ **HIGH** — raw sessionStorage |
| `json-editor/index.tsx:275-281` | `sessionStorage.getItem(...)`, `removeItem(...)` | ❌ **HIGH** — raw sessionStorage |
| `history/index.tsx:100` | `localStorage.getItem('ccm.projects')` | ❌ **HIGH** — raw localStorage |

The three pages communicating via `sessionStorage` (backup-restore writes `ccm.openFilePath`, optimizer writes it, json-editor reads it) do so with no abstraction layer, no type checking, and no error handling for private browsing mode.

---

## 9. Type Safety

| Pattern | File:Line | Notes |
|---------|-----------|-------|
| `as any` | `src/pages/home/index.tsx:568` | `{ ...({ webkitdirectory: '', directory: '' } as any) }` — bypasses strict typing for browser-specific input attributes |
| `as unknown as` | `src/main.tsx:46` | `(window as unknown as { __TAURI_INTERNALS__: unknown })` — acceptable (external bridge shim) |
| `as unknown as` | `src/test/setup.ts:33,100,104` | Test setup — acceptable |
| `as unknown as` | `src/__tests__/components/AppHeader.test.tsx:83,99,116,133,194,214,232` | Test code — acceptable |
| `as unknown as` | `src/__tests__/components/splash.test.tsx:57,65` | Test code — acceptable |
| `eslint-disable no-explicit-any` | `src/pages/home/index.tsx:567` | Same as the `as any` location — the comment suppresses the lint for the `as any` cast |

**Verdict**: Only 1 real `as any` in production code (`home/index.tsx:568`). The rest are in test files or are necessary external bridge casts. The production `any` is a HIGH finding (H-04) because it hides potential breakage cross-platform (WKWebView doesn't support `webkitdirectory`).

---

## 10. Risk Assessment

The two most impactful issues are: (1) **The display name inconsistency** — the about page shows "ClaudeManager" while the rest of the UI says "Claude 配置管理器"; this is a direct §6.4 violation that the team's own documented lesson from M3.0.3 explicitly warns against. (2) **Widespread hardcoded colors** in 9 out of 12 pages — switching to non-light themes (dark, editorial, pixel, liquid-glass) will show incorrect inline-styled UI surfaces (error banners, success states, accent buttons) because they reference hardcoded `rgba()` / `#fff` instead of `var(--*)` tokens. The `window.confirm()` calls in 3 pages bypass the themed ConfirmDialog. The `role="button"` keyboard regression makes resource-browser partially inaccessible. The `sessionStorage` side channel between 3 pages is brittle but currently functional. Overall, the app works correctly on the light theme but would show visible artifacts under any other theme.

---

## 11. Top 5 Fixes to Ship Next

1. **Fix §6.4 display name mismatch**: Change `src-tauri/src/commands/app.rs:46` `PRODUCT_NAME` from `"ClaudeManager"` to `"Claude 配置管理器"` and update `src/__tests__/pages/about.test.tsx:30` fixture `product_name` to match. This is a 2-line fix that fixes the about page showing the wrong name.

2. **Replace `window.confirm()` with `ConfirmDialog`**: Convert the 4 remaining `window.confirm()` calls in `backup-restore/index.tsx:224`, `json-editor/index.tsx:301,381`, and `mcp-management/index.tsx:187` to use the existing `ConfirmDialog` component. This fixes theming and accessibility for destructive operations.

3. **Fix `role="button"` keyboard accessibility**: Add `tabIndex={0}` + `onKeyDown` handler to the `<div>` at `resource-browser/index.tsx:963`, or replace it with a `<button>` element.

4. **Create a storage abstraction for `sessionStorage` cross-page contract**: Extract the `ccm.openFilePath` / `ccm.openFileField` protocol into a typed module in `src/lib/storage.ts` with get/set/remove functions, used by optimizer, backup-restore, and json-editor. Add try/catch for private browsing.

5. **Audit and replace hardcoded colors across all 12 pages**: Run a targeted search for all `rgba(` / `#` in `style={{}}` blocks in `src/pages/` and replace with `var(--*)` references. Priority pages: provider-list (header buttons, modals), usage-query (error banners, toggle buttons), home (add-project modal), backup-restore (toolbar buttons, detail panel).
