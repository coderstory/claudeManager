# Phase 2: M3.1 启动优化 - Plan

**Status**: done
**Goal**: 冷启动事件链路 (Tauri setup → splash → window show → webview ready → first paint) 时序修复 + 透明度闪烁根因 + webview 预加载优化

> **⚠️ Superseded by M3.13.2 (commit `fdaaaa5`)**
>
> 原 M3.1 计划中的 Implementation 清单与代码存在漂移：
> - `src/components/Splash.tsx` (透明度) — **文件从未创建**;splash 逻辑在 `src/App.tsx:308-396` + `index.html` (内联 CSS+HTML)
> - `src-tauri/src/lib.rs` (setup/show 时序) — **M3.1 commit `03e062a` 仅 +2 行,且为 M3.7 的 about 命令注册,非 M3.1 启动时序**
> - `src/main.tsx` (Suspense fallback) — **从未添加 Suspense 边界**
> - `src-tauri/tauri.conf.json` (splash config) — **M3.1 无专属 splash config** (现有 `transparent: true` 在 M3.1 之前已存在)
>
> 真正的冷启动 splash 修复在 **M3.13.2 (commit `fdaaaa5`)** 完成:
> - React-first-paint (useEffect + 双层 requestAnimationFrame) 替换 `tauri://ready` 事件驱动
> - 根因: Tauri v2 在 Win WebView2 上不 dispatch `tauri://ready`,老逻辑 fallback 到 8s failsafe → loading 屏长时间不消失
> - `MIN_SPLASH_MS=1200ms` floor 保证 splash 至少显示 1.2s,避免 fast machine 上的 flash 感
> - 保留 `tauri://ready` 作为可选 early-hide 信号 (idempotent);保留 8s failsafe + index.html 4.5s failsafe
> - 4 个 splash 测试覆盖 (主路径 / failsafe / display:none 延迟 / tauri://ready 向后兼容)
>
> 当前 `src/App.tsx:308-396` 是 M3.13.2 代码。`webview 预加载优化` 子项仍未实现 (lib.rs 无 `with_webview` 或 preload hook)。
>
> See `.planning/phases/02-m31-startup-optimization/02-VERIFICATION.md` for the goal-backward audit.

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
