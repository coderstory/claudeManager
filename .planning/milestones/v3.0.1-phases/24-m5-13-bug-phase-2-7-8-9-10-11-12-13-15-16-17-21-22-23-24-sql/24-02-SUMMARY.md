---
phase: 24
plan: 02
type: summary
status: complete
---

# 24-02: T2 fix #22 — 资源市场浏览资源按钮 — SUMMARY

**Status:** ✅ PASS (commit `c508371`)

## Fix Details

- **Commit**: `c508371 fix(marketplace): browse button opens git URL via @tauri-apps/plugin-opener (#22)`
- **Files changed**:
  - `src/pages/marketplace/index.tsx` (RepoCard button onClick 改用 openUrl)
  - `src/__tests__/pages/marketplace.test.tsx` (新 vitest 覆盖新行为)
- **Implementation**:
  - `isGit` flag for Git-mode repos
  - `handleBrowse` callback: `await openUrl(repo.url)` 调 `@tauri-apps/plugin-opener`
  - Button label 改: "预览资源" → "浏览" (匹配新行为)
  - 第三方仓库 (customUrl) 仍走 `clone_and_scan` (用户可手动 git clone+scan)
- **TDD evidence**: vitest RED → GREEN; mock `openUrl` + assert `openUrl(repoUrl)` called + `clone_and_scan` NOT called
- **22/22 marketplace tests pass**

## Acceptance Criteria

- [x] "浏览资源" 按钮 onClick 调 openUrl(repo.url)
- [x] 不加新依赖 (opener 已在 package.json)
- [x] 1 个新 vitest 覆盖新行为
- [x] vitest 全过
- [x] commit 含 #22
