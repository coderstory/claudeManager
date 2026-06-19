import "./App.css";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ALL_ROUTES } from "./plugins/registry";

/**
 * App root.
 *
 * Wires React Router to the frontend plugin registry. Every route
 * declared by a plugin (via `FrontendPlugin.routes`) is mounted as a
 * `<Route>` here — the registry is the single source of truth.
 *
 * `HashRouter` is used instead of `BrowserRouter` because Tauri
 * serves the frontend from a custom protocol (`tauri://`) and
 * history-style deep links don't survive a full reload. Hash URLs
 * (`#/mcp`, `#/import`, …) are also safer if the user navigates via
 * deep link from a deeplink-import action in M2+.
 */
function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <main className="container">
          <h1>Claude 配置管理器</h1>
          <p className="hint">
            M1.3 — 插件系统骨架就绪（12 个 plugin stub 已注册）。
            业务功能将在 M2+ 替换 stub 实现。
          </p>
          <Routes>
            {ALL_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<r.component />}
              />
            ))}
            {/* Catch-all 404 — every plugin route is registered above,
                anything else is a typo or a future page not yet wired. */}
            <Route
              path="*"
              element={
                <div className="plugin-placeholder">
                  <h2>404 — 页面不存在</h2>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default App;
