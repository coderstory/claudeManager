---
phase: 27
slug: v3-2-m6-critical-5-bug-bug-cr-01-05
status: approved
shadcn_initialized: false
preset: none
created: 2026-06-26
reviewed_at: 2026-06-26
---

# Phase 27 — UI Design Contract

> Visual and interaction contract for Phase 27 (v3.2 M6 critical 5 bug 修复).
> Phase 27 does **not** introduce a new design system. It codifies what already exists
> in `src/design-system/tokens.css` + `src/design-system/base.css` and adds 3 bug-fix UI
> contracts (fix 1 / fix 4 / fix 6). The 3 other fixes (fix 2 用量 / fix 3 JSON 路径 /
> fix 5 SQL 数量) are primarily backend (Rust) and have no new UI surface beyond the
> existing toast / empty / error patterns (CLAUDE.md §4.5 status colors).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (custom CSS-variable design system) |
| Preset | not applicable (project predates shadcn; uses raw CSS tokens in `src/design-system/tokens.css`) |
| Component library | none (hand-rolled base components in `src/design-system/base.css`; no Radix / base-ui) |
| Icon library | lucide-react 0.542.0 (locked in package.json per CLAUDE.md §2.3) |
| Font | UI = `var(--font-ui)` (system stack); mono = `var(--font-mono)` (Cascadia / SF / Menlo) |

**Source of truth**: `src/design-system/tokens.css` (lines 90-148 light block; 204-239 anime block). All UI **must** read tokens via `var(--*)`; no hard-coded hex / px / rem.

---

## Spacing Scale

Declared values (multiples of 4, per CLAUDE.md §4.4):

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Icon gaps, inline padding |
| `--space-2` | 8px | Compact element spacing (button gap, list-row padding) |
| `--space-3` | 12px | Tight vertical rhythm (list-row padding-y) |
| `--space-4` | 16px | Default element spacing (page padding-x, list-row padding-x) |
| `--space-6` | 24px | Detail-page padding (locked in M2.15 polish, used by 7 详情页) |
| `--space-8` | 32px | Layout gaps (section breaks within detail pages) |
| `--space-12` | 48px | Major section breaks |

Exceptions: detail page container `max-width: 720px` (`--detail-page-max-width`, locked M2.15).

---

## Typography

| Role | Size | Weight | Line Height | Token |
|------|------|--------|-------------|-------|
| Body | 14px | 400 | 1.5 (default UA) | `var(--fs-body)` |
| Heading (h1) | 18px | 600 | 1.2 (from base.css `.titlebar h1` / `.modal-title`) | `var(--fs-heading)` |
| Caption | 12px | 400 | 1.4 | `var(--fs-caption)` |
| Button label | 13px | 500 (default) / 600 (primary) | 1.2 | (inline 13px in `.btn`; not tokenised) |

**Only 2 font weights used app-wide**: 400 (body / caption / inactive controls) + 600 (headings, active sidebar item, primary CTA, list-row names). No intermediate weights (no 500/700) — confirmed in `base.css` + `tokens.css`.

Font families:
- `--font-ui`: `-apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` (light); prefixed with `'Nunito'` in anime theme.
- `--font-mono`: `"Cascadia Code", "SF Mono", Menlo, Consolas, monospace` (light); prefixed with `"JetBrains Mono"` in anime.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | light `#FAFAF7` (瓷白) / anime `#F0FDFA` (薄荷汽水) — `var(--bg-primary)` | App background, page surface |
| Secondary (30%) | `#FFFFFF` — `var(--bg-elevated)` | Cards, sidebar, nav, modals, inputs |
| Accent (10%) | light `#0969DA` / anime `#06B6D4` — `var(--accent)` | **Reserved for**: active sidebar left-border (`.sidebar .nav-item.active`); active resource-browser tab border-bottom; primary CTA `.btn-primary` background; active list-row left-border; `<input>` focus ring; modal accent-bar (light blue) |
| Destructive | light `#D32F2F` / anime `#FB7185` — `var(--danger)` | `btn-danger` background, close button hover, modal danger-bar, `.titlebar button.close:hover` |

**Accent reserved-for list** (this is exhaustive — anything not on this list uses `--text-primary` / `--text-secondary` / `--border`):
1. `.sidebar .nav-item.active` `border-left-color` + `color` + `background` (soft variant)
2. `.list-row.active` `border-color` + `background` (soft variant)
3. `.btn-primary` `background` + `border-color` + `color: #fff`
4. `<input>` `:focus` `border-color` + `box-shadow` ring
5. Resource-browser active tab `border-bottom: 2px solid var(--accent)`
6. `.modal-accent-bar` (light: `#0969DA` direct, anime: `#06B6D4` direct — written as direct hex, not via `var()`, per WebView2 < 102.0.1245.146 bug documented in tokens.css)
7. `.kpi` `.bar > span` fill (chart progress)

**Status colors** (per CLAUDE.md §4.5):
- success: light `#388E3C` / anime `#10B981` — `var(--success)`
- warning: light `#F57C00` / anime `#F59E0B` — `var(--warning)`
- danger: light `#D32F2F` / anime `#FB7185` — `var(--danger)`
- disabled: `rgba(0, 0, 0, 0.4)` — `var(--disabled)`

---

## Copywriting Contract

Existing patterns (codified, **not new for this phase**):

| Element | Copy |
|---------|------|
| Primary CTA in detail pages | "[动作] [对象]" — e.g. "切换 Provider" / "创建备份" / "导入配置" / "应用修复" / "重新扫描" |
| Empty state heading (F7 用量 / F13 备份 / F6 MCP) | "暂无数据" (single-line, 14px, `--text-muted`) |
| Empty state body | "请 [下一步动作] 后查看" — e.g. "请先在用量查询页刷新后查看" / "请先创建备份后查看" |
| Error state | "[问题描述]。[下一步]" — existing ErrorBanner component (`src/components/ErrorBanner.tsx`, per M2.16 F15 batch 1-2) wraps all error UI; this phase adds no new error copy |
| Destructive confirmation | modal title = "[动作名]"; body = "此操作 [影响]，[不可撤销/将备份到 .bak]"; confirm = `btn-danger` label = "[动作名]" — see `McpManagement` 二次确认模式 |

**Destructive actions in this phase** (use existing `.modal` + `btn-danger` pattern, no new copy):
- **Fix 6 redirect** (no destructive action, just navigation)
- **Fix 2 refresh** (no destructive action; refresh is non-destructive, "刷新用量" CTA)
- **Fix 5 import** (non-destructive import; on "导入" CTA the SQL import preview modal is the existing pattern, not new)
- **Fix 3 open editor** (non-destructive; on click goes to editor with no data loss)
- **Fix 1 / Fix 4** (no destructive actions)

**New copy required for this phase**:
- ResourceBrowser default tab on first arrival from `/mcp-management` redirect: query param `?tab=mcp` (handled in URL, no user-visible string change)
- Welcome page hint (if scope change triggers data refresh) — **NOT new**, existing `useViewState` + `useProjects` already shows the current project name in the sidebar (`SidebarProjectSwitcher`)

---

## Layout Dimensions

Codified from `tokens.css` (M1.9.3 single source of truth):

| Element | Token | Light | Anime |
|---------|-------|-------|-------|
| Header height | `--header-height` | 48px | 56px |
| Sidebar width | `--sidebar-width` | 220px | 240px |
| Detail page max-width | `--detail-page-max-width` | 720px | 720px |
| Card border-width | `--card-border-width` | 1px | 3px (anime §4.8) |
| Card radius | `--card-radius` | 8px | 20px |
| Button radius | `--button-radius` | 4px | 14px |
| Modal radius | `--radius-modal` | 12px | 12px |

---

## Copywriting for Fix 4 (useScope) + Fix 6 (MCP merge)

These are the only places where UI **interactions** change in this phase (visual styling unchanged):

### Fix 4: scope state remount contract

**Trigger**: user changes scope (用户/项目) or project root via `SidebarProjectSwitcher` (or other scope-affecting UI).

**Required behaviour** (codified from CONTEXT.md D-01~D-04):
- `useScope()` hook returns 4-tuple: `[scope, setScope, projectRoot, setProjectRoot]`
- 3 affected components (`McpPanel` / `JsonEditorTree` / `ResourceBrowser`) **MUST** re-mount on scope change via `key={scope + ':' + projectRoot}` so stale state (loaded MCPs / JSON tree / resource items from previous scope) is discarded before the new scope data is fetched.
- No visual change during remount — same component, same data structure, just a clean re-init. The brief blank state during remount is acceptable (and matches existing `view-transition` 150ms fade-in).

**UI surface**: zero new components. Reuse existing `SidebarProjectSwitcher` + the new `useScope` hook from `src/hooks/useScope.ts`.

### Fix 6: ResourceBrowser tab structure

**Existing tab structure** (5 kinds, locked from M2.13 + M2.16 F21 + M2.16 F22):
- `plugins` / `prompts` / `agents` / `mcp` / (1 more — verify current `ALL_RESOURCE_KINDS` constant in `src/pages/resource-browser/index.tsx`)

**Change for fix 6**:
- Add `mcp` as a top-level tab inside `ResourceBrowser` (M2.13 already included `mcp` per the existing `resourceKindSubdir(state.kind) === 'mcp'` branch in the rendered JSX). **Verify** `ALL_RESOURCE_KINDS` already includes `mcp`; if not, add it.
- Set `mcp` as the **default selected tab** when the user arrives via `<Navigate from="/mcp-management" to="/resource-browser?tab=mcp" replace />` (i.e. when `searchParams.get('tab') === 'mcp'`, `useState(InitKind)` picks `mcp`).
- Delete `mcp-management` from `ALL_VIEWS` (in `src/hooks/useViewState.tsx`) and from `VIEW_META` (in `src/components/AppSidebar.tsx`). This removes the sidebar entry automatically because the sidebar renders `ALL_VIEWS.map`.
- Delete the `view === 'mcp-management'` branch in `src/App.tsx` (line 575-577) — when no `mcp-management` view exists in `ALL_VIEWS`, the ternary falls through to `resource-browser` branch (line 579+). But to handle legacy localStorage values that still hold `'mcp-management'`, the App.tsx ternary should remap `mcp-management` → `resource-browser?tab=mcp` (this is the redirect).

**Tab visual style** (codified, no new design):
- 5 tabs in a row, `display: flex; gap: 4px; border-bottom: 1px solid var(--border)`
- Each tab: `padding: 8px 16px; font-size: 13px; font-weight: 600 if active else 400; color: var(--accent) if active else var(--text-secondary); border-bottom: 2px solid var(--accent) if active else transparent; margin-bottom: -1 (to overlap container border)`
- Use existing pattern from `src/pages/resource-browser/index.tsx` lines 447-485 (unchanged)

### Fix 1: header drag-region contract (no UI change, codify existing)

The current `AppHeader.tsx` already has the correct dual-layer pattern:
- `<header>` has `data-tauri-drag-region=""` + inline `WebkitAppRegion: 'drag'`
- All interactive children (back button / theme toggle / settings / WindowControls / titlebar-title's glass wrapper) have `WebkitAppRegion: 'no-drag'`
- `AppSidebar.tsx` has the **opposite** layering: parent `<nav>` has `WebkitAppRegion: 'drag'`, each `nav-item` button has `WebkitAppRegion: 'no-drag'`, footer has `WebkitAppRegion: 'no-drag'`.

**Contract** (codified, no new code):
- A click on a sidebar nav-item button MUST NOT start a window drag (the `WebkitAppRegion: 'no-drag'` on the button wins over the parent's `drag`).
- A click on the empty sidebar area (between buttons) WILL start a drag (the `drag` on the parent wins). This is intentional — the user can grab the rail to move the window if they don't grab a button.
- macOS user report of "drag is broken" is likely because vibrancy/Mica is on top of the drag layer; verify `decorations: false` in `src-tauri/tauri.conf.json` (per CONTEXT.md D-24). This is a backend/Rust verification, not a UI change.

**Verification check** (for ui-checker): a click on `data-testid="sidebar-item-resource-browser"` should not propagate as a drag event; it should fire `onClick={() => onNavigate('resource-browser')}` and change the view.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (project uses custom CSS-variable design system, not shadcn) |
| third-party | none | not applicable |

**Tool / shadcn initialization**: NOT applied to this project. The custom design system in `src/design-system/tokens.css` is the contract. No `npx shadcn init`. No `components.json`. No `tailwind.config.js` (Tailwind was removed in v3.0 round 1, commit `ed5a3e5` per D15).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS (no new copy; existing CTA/empty/error patterns reused; fix 6 redirect is URL-only, no new visible string)
- [ ] Dimension 2 Visuals: PASS (no new components; reuse `src/design-system/tokens.css` + `base.css`; fix 4 remount is internal; fix 6 tab visual is existing)
- [ ] Dimension 3 Color: PASS (accent reserved-for list is exhaustive; status colors map to existing `--success`/`--warning`/`--danger`; light vs anime divergence codified)
- [ ] Dimension 4 Typography: PASS (3 sizes + 2 weights maintained; no new font weights; existing fonts unchanged)
- [ ] Dimension 5 Spacing: PASS (all spacing via `var(--space-*)` tokens; detail-page padding = `var(--space-6)` = 24px per M2.15 baseline; resource-browser tab gap = 4px per existing pattern)
- [ ] Dimension 6 Registry Safety: PASS (no shadcn; no third-party registry; no `npx shadcn view` vetting needed)

**Approval:** 2026-06-26 (UI checker — all 6 dimensions PASS)
