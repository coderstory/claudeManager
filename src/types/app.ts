/**
 * F8 — 单文件部署 / app metadata types (M2.8).
 *
 * Mirrors the Rust `AppMetadata` struct in
 * `src-tauri/src/commands/app.rs`. Field names use snake_case to match
 * the `#[serde(rename_all = "snake_case")]` on the Rust side — Tauri
 * does NOT auto-convert here because we declare the rename explicitly.
 */

export interface AppMetadata {
  /** Semver from Cargo.toml, e.g. "0.1.0". */
  version: string;
  /** Bundle identifier, e.g. "com.claudeconfigmanager.app". */
  identifier: string;
  /** Product name, e.g. "ClaudeConfigManager". */
  product_name: string;
  /** Short git SHA at build time, or "unknown". */
  git_commit: string;
  /** "<os>/<arch>", e.g. "windows/x86_64". */
  build_target: string;
  /** Unix epoch seconds at build time. 0 means unavailable. */
  build_timestamp: number;
}
