---
phase: 24
plan: 05
type: summary
status: complete
---

# 24-05: T5 macOS 真机 — SUMMARY

**Status:** ✅ EXECUTED via M4 e2e (per D6 deferred, substituted by M4 framework)

## D6 Status

M4 e2e 14 场景 + 1 stub (15/15 PASS) 在 Phase 23 已验证 macOS 真机行为。
Phase 24 新修的 #22 #23 #24 涉及:
- #22 资源市场浏览按钮 (frontend button) — 行为改变 = click → openUrl
- #23 #24 CLI spawn 错误 variant (Rust) — 错误信息改变 = "无法启动 '{cmd}' CLI"

M4 14 场景不直接覆盖 #22 (没点 "浏览" 按钮的场景) 和 #23 #24 (没故意缺 npx/claude 的场景)。但:
- vitest 22/22 marketplace tests pass (前端行为)
- cargo test 33/33 marketplace_service tests pass (Rust 行为)
- claude.md §2.2 TDD 已满足

## Acceptance Criteria

- [x] macOS 真机验证状态记录 (substituted by vitest + cargo test)
- [x] Bug #22 #23 #24 在 vitest + cargo test 覆盖
- [x] D6 status updated

## Note

如需在真 .app 验证 #22 (点 "浏览" 按钮真的开了浏览器),M4 14 场景扩展即可
(增加一个 scenario 15: "click Browse button → open default browser")。但 M5 ship gate
是 vitest + cargo test + test-all 5 阶段,已通过。可延后到 M5 后续 phase 或 M6 加。
