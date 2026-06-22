# Phase 1: M2.17 收尾期 - Summary

**Status**: done (8/8 plans shipped 2026-06-22)
**Goal**: M2.16 收尾 + M1 架构期遗留 3 件套 + 17 MEDIUM/LOW 已知限制全评估 + F15 ErrorBanner 接入剩余页面 + D9 桌面清理

## Plan 1 — M2.17-3.1 (SHIPPED 2026-06-22)
PluginHost wiring + CI gates + build pipeline refresh + tsconfig strict + F15-batch3 (provider-list + mcp-management InfoBars).

- [x] M2.17-3.1: PluginHost wiring (lib.rs::run + shutdown on RunEvent::Exit) — `d5443c3` + `18d4b29` + `2e575c7`
- [x] M2.17-C1+C2: CI gates (npm run build in test-frontend + e2e skip with macos matrix) — `a980eeb`
- [x] M2.17-C3: build-and-ship.sh refresh (cargo → `tauri build`) — `8ef961d`
- [x] M2.17-C4: tsconfig.json 8 strict sub-flags explicit — `cc07178`
- [x] M2.17-F15-batch3: ErrorBanner → provider-list InfoBars — `02e5b14` + `b771041`
- [x] M2.17-docs: docs refresh — `f7196e8`

## Plan 2 — M2.17-batch4 (SHIPPED 2026-06-22)
剩余收尾：D9 桌面清理 + D10 17 限制评估 + F15 ErrorBanner 接入剩余页面。

- [x] M2.17-D10: 17 MEDIUM/LOW 限制评估 — `docs/investigations/m2.16-limitations-eval.md` (290 行, 17 条全 cover, 50+ file:line + 13 commit hash 引用)
- [x] M2.17-D9: 桌面清理 — 2 个 M2.16 exe 移到 `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/` (归档目录, mv not rm)
- [x] M2.17-F15-batch4: ErrorBanner 接入剩余页面 — 实际完成 4 个 commits (`d8e5728` batch1 provider-list ExportInfoBar + `5de839f` batch2 marketplace/optimizer + `b771041` batch3-c2 mcp-management + `02e5b14` batch3-c3 provider-list)

## 8/8 完成总结
- 3 件套 (PluginHost + CI + build pipeline): done
- 17 限制评估: done (C 评估完整)
- F15 ErrorBanner 全扩展: done (4 个 batch 共 8 个页面)
- 桌面清理: done (归档到 ~/.archive/)

## 关键 commit 链
- `2e575c7` M2.17-3.1-tests re-add plugin_host_wiring
- `a980eeb` M2.17-C1+C2 CI gates
- `8ef961d` M2.17-C3 build-and-ship.sh
- `cc07178` M2.17-C4 tsconfig strict
- `18d4b29` M2.17-3.1-impl PluginHost wiring
- `b771041` M2.17-F15-batch3-c2 mcp-management InfoBar
- `02e5b14` M2.17-F15-batch3-c3 provider-list InfoBars
- `d820b82` M2.16-theme-trim (L-M2.09 已关闭)
- `f7196e8` M-finalize 编译 + 测试同步
- `c724f9a` M-finalize M3.7 ship flaky 记录

## 已知限制 / 后续
- 桌面 `~/Desktop/ClaudeConfigManager-M3/` 含 M3 启动门 3 exe + M3 首批 4 exe (4/4 ship 闭环)
- M2.16 archive 在 `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`
- 17 MEDIUM/LOW 限制评估表已写,后续 M3/M4 phase 按表逐条评估修复
