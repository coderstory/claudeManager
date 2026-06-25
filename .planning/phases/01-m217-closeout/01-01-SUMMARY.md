# Phase 1 Plan 1: M2.17-3.1 - Summary

**Status**: done (shipped 2026-06-22)
**Goal**: M2.16 收尾 + M1 架构期遗留 3 件套 (PluginHost wiring + CI gates + build pipeline refresh + tsconfig strict) + F15-batch3 (provider-list + mcp-management InfoBars) + docs refresh

## Shipped 任务 (6/6)
- [x] M2.17-3.1: PluginHost wiring (lib.rs::run + shutdown on RunEvent::Exit) — `d5443c3` + `18d4b29` + `2e575c7`
- [x] M2.17-C1+C2: CI gates (npm run build in test-frontend + e2e skip with macos matrix) — `a980eeb`
- [x] M2.17-C3: build-and-ship.sh refresh (cargo → `tauri build`) — `8ef961d`
- [x] M2.17-C4: tsconfig.json 8 strict sub-flags explicit — `cc07178`
- [x] M2.17-F15-batch3: ErrorBanner → provider-list InfoBars — `02e5b14` + `b771041`
- [x] M2.17-docs: docs refresh — `f7196e8`

## Retroactive confirmation (2026-06-26)
本 Plan 的所有子任务在 2026-06-22 M2.17 ship 周期内完成。Phase 1 整体 SUMMARY（`01-m217-closeout-SUMMARY.md`）已记录"8/8 plans shipped 2026-06-22"。本次 autonomous rerun 由主 session 补全 SUMMARY 文件以让 plan index 正确识别 plan 已完成，避免重复执行。

## 关键 commit
- `2e575c7` M2.17-3.1-tests re-add plugin_host_wiring
- `18d4b29` M2.17-3.1-impl PluginHost wiring
- `a980eeb` M2.17-C1+C2 CI gates
- `8ef961d` M2.17-C3 build-and-ship.sh refresh
- `cc07178` M2.17-C4 tsconfig strict
- `b771041` M2.17-F15-batch3-c2 mcp-management InfoBar
- `02e5b14` M2.17-F15-batch3-c3 provider-list InfoBars
- `f7196e8` M-finalize 编译 + 测试同步
