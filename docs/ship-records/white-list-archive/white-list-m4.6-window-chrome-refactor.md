# M4.6 WindowChrome 架构统一 — 文件白名单

## 本次改动文件 (3)
1. `src-tauri/src/platform/macos/window_chrome.rs` — no-op → real apply_vibrancy (cross-compile safe)
2. `src-tauri/src/platform/mod.rs` — window_chrome() factory 签名: () → (&WebviewWindow)
3. `src-tauri/src/lib.rs` — 移除 #[cfg] 块，改为 IPlatformWindowChrome trait dispatch

## 未改动 (严格遵守)
- `src-tauri/src/platform/windows/window_chrome.rs` — Windows impl 不变
- `src-tauri/src/platform/traits.rs` — trait 签名不变
- `src-tauri/Cargo.toml` — 依赖不变
- 任何前端 / 业务代码 / SPEC.md / .planning/
