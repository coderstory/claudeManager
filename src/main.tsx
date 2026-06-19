import "./design-system/tokens.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./design-system/ThemeProvider";
import { applyWindowEffects } from "./design-system/applyEffects";

// M1.9.2 — request the native window backdrop before mount.
// Fire-and-forget: applyWindowEffects() resolves silently on
// success and logs+swallows on failure (Linux / Win10 / missing
// capability). The CSS backdrop-filter fallback in AppHeader /
// AppSidebar / PluginPlaceholder is the visual floor — the app
// always shows a Liquid-Glass-like surface even when the OS
// refuses the effect.
void applyWindowEffects();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
