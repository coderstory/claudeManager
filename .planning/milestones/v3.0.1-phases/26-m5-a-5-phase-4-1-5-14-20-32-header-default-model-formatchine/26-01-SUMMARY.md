---
phase: 26
plan: 01
type: summary
status: complete
---

# 26-01: T1 verify-5-shipping — SUMMARY

**Status:** ✅ PASS (5/5 A-class fix commits verified on master)

## Per-Commit Verification

| Bug | Commit | Title | Files |
|-----|--------|-------|-------|
| #1  | `aae1ad8` | fix(design-system): anime 主题 header 菜单名字加独立背景色 chip | `src/__tests__/design-system/base.test.ts` (+18) |
| #5  | `50d364a` | fix(ui): Default Model label 去掉 "(ANTHROPIC_MODEL)" 后缀 | `src/__tests__/pages/provider-list.test.tsx` (+18) |
| #14 | `9f116eb` | fix(usage-query): tokens_used >= 1亿 显示 "X 亿 Y 万" | `src/__tests__/pages/usage-query.test.tsx` (+20) |
| #20 | `959bd80` | fix(ui): 重新扫描按钮 min-width + nowrap 防止文字换行 | `src/__tests__/pages/optimizer.test.tsx` (+13) |
| #32 | `4f0bc0c` | fix(about): 项目主页单独一行展示 | `src/__tests__/pages/about.test.tsx` (+24) |

## Acceptance Criteria

- [x] 5 fix commits for A-class bugs exist on master
- [x] Each commit message includes correct bug number
- [x] Each commit ships paired vitest
- [x] No new dependencies
