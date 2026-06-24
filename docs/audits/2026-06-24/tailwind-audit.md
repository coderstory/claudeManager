# Tailwind Utility Class Audit (M2.x-inline)

Date: 2026-06-20
Project: D:\project\winui3
Pipeline status: NO tailwind.config.js / NO postcss.config.js / NO vite plugin
dist/assets/index-*.css: ~2KB tokens + 0 utility rules → all `className="..."` Tailwind utility class in `.tsx` is dead code on real WebView2 release exe.

## Affected files (9 .tsx files containing Tailwind utility className)

### src/App.tsx
- L222 `className="flex flex-col h-screen overflow-hidden"` — already fully inlined via style={}; className is redundant
- L258 `className="flex flex-1 overflow-hidden"` — same
- L304 `className="view-transition"` — design system class from tokens.css, NOT Tailwind utility → keep

### src/components/AppHeader.tsx
- Already fully inlined (M2.15-fix-v2 / a216aff commit); no className Tailwind utility.

### src/components/AppSidebar.tsx
- L159-162 `className={cn('w-full flex items-center gap-2 transition-colors', 'hover:bg-black/5 dark:hover:bg-white/5')}` — still using cn() + Tailwind utility; needs inline migration. Style block is already inline but cn() still emits utility class.

### src/components/PluginPlaceholder.tsx
- L43-45 `className={cn('flex flex-col items-center justify-center h-full p-8 text-center', className)}` — Tailwind utility + external className prop
- L66 `className="mb-4"` — margin
- L70 `className="font-semibold mb-2"` — font weight + margin
- L79 `className="mb-1"`
- L88 `className="font-mono mt-2"` — font + margin

### src/components/QuickSearchModal.tsx
- L510 `className="transition-colors hover:bg-[var(--danger)] hover:text-white dark:hover:bg-[var(--danger)] dark:hover:text-white"` — hover utility, needs data attribute + shared style block

### src/components/WindowControls.tsx
- Already fully inlined (M2.15-fix-v2).

### src/pages/home/index.tsx
- L26 `className="h-full overflow-auto p-8"`
- L29 `className="max-w-4xl mx-auto"`
- L31 `className="font-semibold mb-2"`
- L40 `className="mb-6"`
- L50 `className="grid gap-3"`
- L61-64 `className={cn('w-full text-left p-4 transition-shadow', 'hover:shadow-md focus:outline-none focus:ring-2')}` — Tailwind utility + cn() with hover/focus utility
- L73 `className="font-semibold mb-1"`
- L82 `className="font-mono"`

### src/pages/single-file-deploy/index.tsx
- L123 `className="mx-auto w-full max-w-4xl p-6"`
- L126 `className="mb-6"`
- L127 `className="text-2xl font-semibold text-text-primary"`
- L128 `className="mt-1 text-sm text-text-secondary"`
- L137 `className="mb-4 flex items-start gap-2 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger"`
- L141 `className="mt-0.5 h-4 w-4 flex-shrink-0"` (lucide SVG)
- L148 `className="mb-6 rounded-lg border border-border bg-bg-elevated p-4 shadow-sm"`
- L152 `className="mb-3 text-sm font-medium text-text-secondary"`
- L155 `className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2"`
- L198 `className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary hover:bg-bg-overlay"`
- L201 `className="h-4 w-4"` (lucide SVG)
- L207 `className="mt-3 rounded-lg border border-border bg-bg-elevated p-4 shadow-sm"`
- L211 `className="mb-3 text-sm text-text-secondary"`
- L213 `className="rounded bg-bg-overlay px-1 py-0.5 text-xs text-text-primary"`
- L218 `className="space-y-3"`
- L221 `className="text-xs text-text-muted"`
- L222 `className="mt-1 overflow-x-auto rounded border border-border bg-[#1F2328] p-2 font-mono text-xs text-[#FAFAF7]"`
- L225 `className="mt-1 text-xs text-text-muted"`
- L229 `className="mt-3 text-xs text-text-muted"`
- L252 `className="flex items-baseline gap-3"`
- L253 `className="w-20 flex-shrink-0 text-xs text-text-muted"`
- L255-258 `className={'text-sm text-text-primary ' + (mono ? 'font-mono tabular-nums' : '')}` — dynamic conditional class concatenation

### src/pages/usage-query/index.tsx
- L141 `className="mx-auto w-full max-w-4xl p-6"`
- L144 `className="mb-4"`
- L145 `className="text-2xl font-semibold text-text-primary"`
- L146 `className="mt-1 text-sm text-text-secondary"`
- L153 `className="mb-4 inline-flex rounded-md border border-border bg-bg-elevated p-1"`
- L165-169 `className={'px-4 py-1.5 text-sm rounded transition-colors ' + (state.window === w ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary')}` — dynamic conditional
- L178 `className="mb-6 flex items-center justify-between"`
- L183 `className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary hover:bg-bg-overlay disabled:opacity-60"`
- L188 `className={'h-4 w-4 ' + (state.refreshing ? 'animate-spin' : '')}` — dynamic
- L195 `className="text-xs text-text-muted"`
- L206 `className="mb-4 flex items-start gap-2 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger"`
- L210 `className="mt-0.5 h-4 w-4 flex-shrink-0"` (lucide SVG)
- L216 `className="grid grid-cols-1 gap-4 md:grid-cols-3"`
- L223 `className="text-3xl font-semibold tabular-nums text-text-primary"`
- L235 `className="text-3xl font-semibold tabular-nums text-text-primary"`
- L247 `className="text-3xl font-semibold tabular-nums text-text-primary"`
- L256 `className="mt-6 rounded-lg border border-border bg-bg-elevated p-4"`
- L257 `className="mb-2 flex items-center justify-between"`
- L258 `className="text-sm font-medium text-text-secondary"`
- L261 `className="text-xs text-text-muted"`
- L271 `className="mt-4 text-center text-sm text-text-muted"`
- L275 `className="rounded bg-bg-overlay px-1 py-0.5 text-xs"`
- L298 `className="rounded-lg border border-border bg-bg-elevated p-5"`
- L301 `className="mb-2 text-xs uppercase tracking-wide text-text-muted"`
- L305 `className="h-9 w-24 animate-pulse rounded bg-bg-overlay"`
- L327 `className="h-16 w-full"`
- L337 `className="text-accent"`
- L344 `className="fill-text-muted"`

### src/plugins/stubs/_Placeholder.tsx
- L17 `className="plugin-placeholder"` — **BEM design system class**, NOT Tailwind utility → keep
- L18 `className="plugin-placeholder__title"` — same → keep
- L19 `className="plugin-placeholder__hint"` — same → keep
(This file uses BEM naming for stub pages; these are not Tailwind utility classes. NO inline-ization needed.)

### src/__tests__/integration/m1-9-3.test.tsx
- L226 — `className="view-transition"` appears in a JS comment only. Test asserts the live DOM element has class `view-transition` (which is the design system class). Keep.

## Mapping conventions (used during fix)

| Utility class | Inline style |
|---|---|
| `flex` | `display: 'flex'` |
| `flex-col` | `flexDirection: 'column'` |
| `flex-1` | `flex: '1 1 0%'` or `flex: 1` |
| `items-center` | `alignItems: 'center'` |
| `items-baseline` | `alignItems: 'baseline'` |
| `items-start` | `alignItems: 'flex-start'` |
| `justify-center` | `justifyContent: 'center'` |
| `justify-between` | `justifyContent: 'space-between'` |
| `gap-1` | `gap: 4` |
| `gap-1.5` | `gap: 6` |
| `gap-2` | `gap: 8` |
| `gap-3` | `gap: 12` |
| `gap-4` | `gap: 16` |
| `h-screen` | `height: '100vh'` |
| `h-full` | `height: '100%'` |
| `h-4` | `height: 16` |
| `h-9` | `height: 36` |
| `h-16` | `height: 64` |
| `w-full` | `width: '100%'` |
| `w-4` | `width: 16` |
| `w-20` | `width: 80` |
| `w-24` | `width: 96` |
| `w-9` | `width: 36` |
| `max-w-4xl` | `maxWidth: 896` |
| `min-w-0` | `minWidth: 0` |
| `flex-shrink-0` | `flexShrink: 0` |
| `overflow-hidden` | `overflow: 'hidden'` |
| `overflow-auto` | `overflow: 'auto'` |
| `overflow-x-auto` | `overflowX: 'auto'` |
| `p-1` | `padding: 4` |
| `p-2` | `padding: 8` |
| `p-3` | `padding: 12` |
| `p-4` | `padding: 16` |
| `p-5` | `padding: 20` |
| `p-6` | `padding: 24` |
| `p-8` | `padding: 32` |
| `px-3` | `paddingLeft: 12, paddingRight: 12` |
| `px-4` | `paddingLeft: 16, paddingRight: 16` |
| `px-1` | `paddingLeft: 4, paddingRight: 4` |
| `py-1.5` | `paddingTop: 6, paddingBottom: 6` |
| `py-0.5` | `paddingTop: 2, paddingBottom: 2` |
| `mt-0.5` | `marginTop: 2` |
| `mt-1` | `marginTop: 4` |
| `mt-2` | `marginTop: 8` |
| `mt-3` | `marginTop: 12` |
| `mt-4` | `marginTop: 16` |
| `mt-6` | `marginTop: 24` |
| `mb-1` | `marginBottom: 4` |
| `mb-2` | `marginBottom: 8` |
| `mb-3` | `marginBottom: 12` |
| `mb-4` | `marginBottom: 16` |
| `mb-6` | `marginBottom: 24` |
| `mx-auto` | `marginLeft: 'auto', marginRight: 'auto'` |
| `m-0.5` | `margin: 2` |
| `rounded` | `borderRadius: 4` |
| `rounded-md` | `borderRadius: 6` |
| `rounded-lg` | `borderRadius: 8` |
| `border` | `border: '1px solid var(--border)'` |
| `border-border` | `border: '1px solid var(--border)'` |
| `border-danger/30` | `border: '1px solid rgba(211, 47, 47, 0.3)'` (matches --danger #D32F2F) |
| `bg-bg-elevated` | `background: 'var(--bg-elevated)'` |
| `bg-bg-overlay` | `background: 'var(--bg-overlay)'` |
| `bg-danger/5` | `background: 'rgba(211, 47, 47, 0.05)'` |
| `bg-[#1F2328]` | `background: '#1F2328'` |
| `bg-accent` | `background: 'var(--accent)'` |
| `text-text-primary` | `color: 'var(--text-primary)'` |
| `text-text-secondary` | `color: 'var(--text-secondary)'` |
| `text-text-muted` | `color: 'var(--text-muted)'` |
| `text-accent` | `color: 'var(--accent)'` |
| `text-danger` | `color: 'var(--danger)'` |
| `text-white` | `color: '#fff'` |
| `text-[#FAFAF7]` | `color: '#FAFAF7'` |
| `fill-text-muted` | `fill: 'var(--text-muted)'` |
| `text-2xl` | `fontSize: 24` |
| `text-3xl` | `fontSize: 30` |
| `text-sm` | `fontSize: 14` |
| `text-xs` | `fontSize: 12` |
| `font-mono` | `fontFamily: 'var(--font-mono)'` |
| `font-semibold` | `fontWeight: 600` |
| `font-medium` | `fontWeight: 500` |
| `shadow-sm` | `boxShadow: 'var(--shadow-sm)'` |
| `shadow-md` | `boxShadow: 'var(--shadow-md)'` |
| `truncate` | `whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0` |
| `uppercase` | `textTransform: 'uppercase'` |
| `tracking-wide` | `letterSpacing: '0.025em'` |
| `tabular-nums` | `fontVariantNumeric: 'tabular-nums'` |
| `text-center` | `textAlign: 'center'` |
| `text-left` | `textAlign: 'left'` |
| `space-y-3` | use `gap: 12` on parent flex or `& > * + *` rule |
| `grid grid-cols-1` | `display: 'grid', gridTemplateColumns: 'repeat(1, minmax(0, 1fr))'` |
| `grid grid-cols-1 md:grid-cols-3` | media query in `<style>` block (or just use the same mobile-only layout since project has no Tailwind pipeline and tailwind's md breakpoint is irrelevant) |
| `sm:grid-cols-2` | same |
| `transition-colors` | `transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease'` |
| `transition-shadow` | `transition: 'box-shadow 120ms ease'` |
| `hover:bg-overlay` | data attribute + global style block (or :hover on the element via CSS) |
| `disabled:opacity-60` | use `:disabled` selector in CSS or `[disabled]` attribute selector |
| `focus:outline-none focus:ring-2` | use :focus in CSS or :focus-visible |
| `animate-pulse` | use @keyframes pulse in shared CSS |
| `animate-spin` | use @keyframes spin in shared CSS |

## Plan

1. New `src/design-system/utilities.css` with: view transition stays in tokens.css; add @keyframes pulse / spin / fadeIn-if-needed; add `[data-app-control-hover]` and `[data-app-close-hover]` blocks. Also add `.mb-utility-host` for elements that need transitions on hover.
2. Inline all Tailwind utility className in 5 files (PluginPlaceholder, AppSidebar, QuickSearchModal, home, single-file-deploy, usage-query).
3. App.tsx — remove redundant `className="flex flex-col ..."` since style is already inlined.
4. _Placeholder.tsx — leave alone (BEM design system class).
5. Verify with tsc + vitest + build-and-ship.
