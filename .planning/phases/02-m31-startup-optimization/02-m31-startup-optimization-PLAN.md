# Phase 2: M3.1 启动优化 - Plan

**Status**: done
**Goal**: 冷启动事件链路 (Tauri setup → splash → window show → webview ready → first paint) 时序修复 + 透明度闪烁根因 + webview 预加载优化

## Implementation
- src-tauri/src/lib.rs (setup/show 时序)
- src-tauri/tauri.conf.json (splash config)
- src/components/Splash.tsx (透明度)
- src/main.tsx (Suspense fallback)
- src/__tests__/components/splash.test.tsx (vitest)

## Ship
- ClaudeConfigManager-M3.1-startup-optimization.exe (30.4 MB)
- Smoke: 7/7
- Commit: f7196e8 (含编译/测试同步)
