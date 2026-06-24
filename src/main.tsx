import "./design-system/base.css";
import "./design-system/tokens.css";
// M2.x-inline: shared style block that provides the (no-Tailwind-pipeline)
// :hover / :focus / @keyframes rules used by AppHeader, AppSidebar,
// HomeView, QuickSearchModal, UsageQueryPage, SingleFileDeployPage.
// See src/design-system/utilities.css for the full rationale.
import "./design-system/utilities.css";
// v3.0 主题专属 CSS (静态 import, 不走 glob — CSS 必须 eager)
import "./design-system/themes/light.css";
import "./design-system/themes/anime.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./design-system/ThemeProvider";

// v3.0 (M3.0.2 fix) — `@tauri-apps/api/core`'s `invoke` reaches for
// `window.__TAURI_INTERNALS__.transformCallback` which is undefined in
// plain browser (vite dev on localhost:1420) AND in the first paint
// of a Tauri release build where the IPC bridge isn't ready yet.
// Calling into that throws "Cannot read properties of undefined
// (reading 'transformCallback')" synchronously, bypassing every
// try/catch in lib/api/*.ts and crashing the React tree. The Tauri
// window then white-screens and dies (white → fade → splash fallback).
//
// We inject a minimal shim whenever the Tauri runtime is missing so
// the page renders an empty-but-stable state in the browser and the
// React tree survives long enough for the real bridge to attach in
// the release build. The shim only sets the property if it doesn't
// already exist (Tauri attaches the real object on window first).
if (
  typeof window !== "undefined" &&
  !("__TAURI_INTERNALS__" in window)
) {
  // No-op callback id allocator — Tauri uses this to map the returned
  // promise back to a callback. We return a unique number so calls
  // are tracked, but the callback registry stays empty (so any
  // later .then() is a no-op rather than throwing).
  let nextCallbackId = 0;
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: (
      _callback: (...args: unknown[]) => unknown,
      _once: boolean,
    ) => {
      const id = nextCallbackId;
      nextCallbackId += 1;
      return id;
    },
    invoke: () => Promise.resolve(null),
  };
}

// v3.0 (M3.0.2 fix) — global error guards. Tauri release builds with an
// in-flight `invoke()` promise rejection used to crash the webview
// before the React error boundary could render. The Tauri window
// then dies (white screen → splash fallback). Swallow + log instead.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    // eslint-disable-next-line no-console
    console.warn("[M3.0.2] unhandled rejection (swallowed):", event.reason);
    event.preventDefault();
  });
  window.addEventListener("error", (event) => {
    // eslint-disable-next-line no-console
    console.warn("[M3.0.2] window error (swallowed):", event.message);
    event.preventDefault();
  });
}

// M2.16-theme-fix: 原生窗口 backdrop（Win11 Mica / macOS vibrancy）的
// 应用已完全移至 Rust setup hook（src-tauri/src/lib.rs 调
// window_vibrancy::apply_mica / apply_vibrancy）。
//
// 此前 main.tsx 还会调一遍 JS applyWindowEffects()（走 Tauri
// getCurrentWindow().setEffects → tao set_effects），这与 Rust 的
// apply_mica 重复，且 tao 的 set_effects 在 decorations:false 无边框
// 窗口上会走 window effects API，可能在 React 挂载时（晚于 setup）
// 重置 DWM 合成状态，导致 WebView2 表面退回不透明，遮住已设置好的
// Mica backdrop（DWMWA_SYSTEMBACKDROP_TYPE=2 被 CDP+原生查询确认已生效，
// 但用户真机仍看到白底）。
//
// 删掉 JS 调用后，Rust apply_mica 是唯一的 backdrop 来源（在 setup
// 同步执行，早于 WebView2 首帧），不再有晚到的 JS 调用干扰合成路径。
// M2.16-cleanup: applyEffects.ts 已删除（整条 JS setEffects 路径退役），
// 前端不再触达窗口效果 API；Mica / vibrancy 由 Rust setup hook 独占。

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
