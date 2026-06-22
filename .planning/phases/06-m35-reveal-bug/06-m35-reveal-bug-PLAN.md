# Phase 6: M3.5 资源浏览修 bug - Plan

**Status**: not_started
**Goal**: `IPlatformReveal::reveal_file` 错误处理增强 + `explorer.exe exit 1` 根因排查 + 前端错误本地化
**Depends on**: Phase 5 (M3.4)
**Requirements**: 清单 15 (P1) — D13 决策:按 M3.5 排期

## Sub-tasks
1. reveal_file 返回 Result<(), RevealError> 区分 4 类
2. 前端 ErrorBanner 本地化
3. 4 个 reveal 场景 e2e 测试
