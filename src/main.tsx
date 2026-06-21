import "./design-system/tokens.css";
// M2.x-inline: shared style block that provides the (no-Tailwind-pipeline)
// :hover / :focus / @keyframes rules used by AppHeader, AppSidebar,
// HomeView, QuickSearchModal, UsageQueryPage, SingleFileDeployPage.
// See src/design-system/utilities.css for the full rationale.
import "./design-system/utilities.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./design-system/ThemeProvider";

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
