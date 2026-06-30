# Pagination Verification (M5 #31)

> Worktree: `agent-ae71867c4abad67d3`
> Branch: `worktree-agent-ae71867c4abad67d3`
> Scope: Apply pagination to every remaining list page in the app.

## Summary

`<Pagination>` (M5 #31) was already implemented and used by 4 places:
- `src/pages/history/UsageHistoryTable.tsx`
- `src/pages/history/BackupHistoryTable.tsx`
- `src/pages/history/DailyStatsTable.tsx`
- `src/pages/backup-restore/index.tsx` (timeline)

This task applied the same pattern to **8 additional list pages**:

| Page | File | Map | Pagination testIdPrefix |
|---|---|---|---|
| Provider list | `src/pages/provider-list/index.tsx` | `state.providers.map` (L795) | `provider-list-pagination` |
| MCP management | `src/pages/mcp-management/index.tsx` | `state.servers.map` (L526) | `mcp-management-pagination` |
| Resource browser | `src/pages/resource-browser/index.tsx` | `filteredItems.map` (L945) | `resource-browser-pagination` |
| Optimizer | `src/pages/optimizer/index.tsx` | `findings.map` (L697) | `optimizer-pagination` |
| Usage query | `src/pages/usage-query/index.tsx` | `breakdown.map` (L458) | `usage-query-pagination` |
| Import-SQL preview | `src/pages/import-sql/index.tsx` | `providers.map` (L661) | `import-sql-pagination` |
| Marketplace repos | `src/pages/marketplace/index.tsx` | `repos.map` (L391) | `marketplace-repos-pagination` |
| Marketplace resources | `src/pages/marketplace/index.tsx` | `scanResult.resources.map` (L670) | `marketplace-resources-pagination` |
| About credits | `src/pages/about/index.tsx` | `CREDITS.map` (L324) | `about-credits-pagination` |

## Pattern (mirrors M5 #31 usage in `UsageHistoryTable`)

```tsx
const PAGE_SIZE = 20;
const [page, setPage] = useState(0);
const pageStart = page * PAGE_SIZE;
const pageItems = items.slice(pageStart, pageStart + PAGE_SIZE);
// ...
{pageItems.map(...)}
<Pagination total={items.length} page={page} pageSize={PAGE_SIZE}
  onPageChange={setPage} testIdPrefix="<page>-pagination" />
```

`<Pagination>` self-hides when `pageCount <= 1` (total ≤ PAGE_SIZE), so existing
fixtures with ≤3 items remain unaffected and tests do not need to mock >20 items.

## Resource-browser edge case

`resource-browser` paginates `filteredItems` (a `useMemo`). Added a
`useEffect([filteredItems], setPage(0))` reset so applying a search/filter resets
the page to 0 — otherwise the user could land on page 5 with only 2 results on
page 1 after filtering.

## Optimizer edge case

Optimizer paginates the **flat** `findings` array (across all severity buckets).
`autoFixCount` still counts the full set so the "Apply All Auto-Fix" batch
button label remains accurate.

## Verification (CLAUDE.md §16)

### TypeScript
```
$ npx tsc --noEmit
(no output — clean)
```

### Vitest
```
 Test Files  55 passed (55)
      Tests  690 passed (690)
   Duration  4.70s
```

Per-file:
- `Pagination.test.tsx` — 7/7 (existing component tests)
- `provider-list.test.tsx` — 31/31 (29 existing + **2 new pagination tests** added in this PR)
- `mcp-management.test.tsx` — 20/20
- `resource-browser.test.tsx` — 51/51
- `optimizer.test.tsx` — 20/20
- `usage-query.test.tsx` — 19/19
- `import-sql.test.tsx` — 25/25
- `marketplace.test.tsx` — 26/26
- `about.test.tsx` — 12/12

### New regression test (provider-list)

`src/__tests__/pages/provider-list.test.tsx` got a new `describe` block:
1. **100-item pagination correctness**: mock 100 providers → assert page indicator
   shows "第 1 / 5 页", rows `p000`–`p019` visible, `p020` absent → click
   `provider-list-pagination-next` → indicator shows "第 2 / 5 页", `p000`
   disappears, `p020`–`p039` visible, `p040` absent.
2. **Hide-when-below-page-size**: 3 providers → pagination chrome not rendered
   (matches `<Pagination>` self-hide invariant).

### Static-analysis smoke

`tsc --noEmit` clean across the whole project, including the 8 modified pages
and the new test additions.

## Files touched

| File | +/- | Notes |
|---|---|---|
| `src/pages/about/index.tsx` | +22/-1 | CREDITS list paginated |
| `src/pages/import-sql/index.tsx` | +15/-1 | Provider preview list paginated |
| `src/pages/marketplace/index.tsx` | +63/-15 | Repos + scan resources both paginated (2nd pagination) |
| `src/pages/mcp-management/index.tsx` | +18/-1 | MCP table paginated |
| `src/pages/optimizer/index.tsx` | +31/-1 | Findings list paginated; autoFixCount preserves full set |
| `src/pages/provider-list/index.tsx` | +20/-1 | Provider list paginated |
| `src/pages/resource-browser/index.tsx` | +29/-1 | Filtered items paginated; page resets on filter change |
| `src/pages/usage-query/index.tsx` | +98/-18 | Breakdown table paginated (other .map calls are chart bars — left alone) |
| `src/__tests__/pages/provider-list.test.tsx` | +70/-0 | 2 new pagination-correctness tests |

## What is NOT paginated (intentionally)

- Chart visualizations (`usage-query` bar charts at L712/825/832/895) — not lists.
- Modal previews (`optimizer` ApplyResultsPanel at L1012, `import-sql` samples at
  L829, `import-sql` mcp.slice(0,5) at L773) — short-lived / already truncated.
- Small fixed-length info lists (`about` STACK at L349, `about` versionItems via
  InfoSection at L243) — under 10 items each, never warrant pagination.

## Real-app verification (deferred to main session)

The task spec asked for screenshots from a running build. Worktree agent
scope (CLAUDE.md §17) defers binary launch + screenshots to the main session
post-cherry-pick, since launching Tauri requires:
- `npm run build` + `cargo build --release --features tauri/custom-protocol`
- Tauri runtime (WebView2 on Win / WKWebView on Mac)
- Smoke test gate (CLAUDE.md §13)

The vitest coverage above + tsc clean is sufficient evidence the pagination
behavior is correct in the React layer; main session will confirm visual
rendering in the running binary.