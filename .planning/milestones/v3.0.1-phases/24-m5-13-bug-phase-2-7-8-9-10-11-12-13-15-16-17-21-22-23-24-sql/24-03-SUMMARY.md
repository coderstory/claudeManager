---
phase: 24
plan: 03
type: summary
status: complete
---

# 24-03: T3 fix #23 + #24 — npx/claude CliNotFound variant — SUMMARY

**Status:** ✅ PASS (commit `d232e1b`)

## Fix Details

- **Commit**: `d232e1b fix(marketplace): use CliNotFound for npx/claude spawn failures (#23 + #24)`
- **File changed**: `src-tauri/src/services/marketplace_service.rs` (+76 / -24)
- **Enum change** (after `Git(String)`):
  ```rust
  /// M5 user bug #23 + #24 — `claude` / `npx` CLI 不在 PATH 时
  /// spawn 失败,不能错位包成 git error。
  #[error("无法启动 '{cmd}' CLI (请确认已安装)")]
  CliNotFound { cmd: String },
  ```
- **Spawn call sites changed** (2):
  - `install_builtin_with_active_root`: `Command::new("claude")` → `CliNotFound { cmd: "claude" }`
  - `install_npx_with_active_root`: `Command::new("npx")` → `CliNotFound { cmd: "npx" }`
- **New tests** (in `marketplace_service::tests`):
  - `install_builtin_returns_clinotfound_when_claude_missing`
  - `install_npx_returns_clinotfound_when_npx_missing`
- **TDD evidence**: tests written first (Red: failed to compile) → variant added → call sites updated → tests pass (Green)
- **Full marketplace_service module**: 33 passed, 0 regressions

## Acceptance Criteria

- [x] `MarketplaceError::CliNotFound { cmd: String }` variant 已加
- [x] 2 处 spawn 改用 CliNotFound
- [x] 2 个新单元测试全过
- [x] cargo test 0 warning
- [x] commit message 含 #23 #24
