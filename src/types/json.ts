/**
 * F5 — JSON 编辑器 (M3.11 / A4#12)
 *
 * TypeScript types mirroring the Rust `JsonFileEntry` struct in
 * `src-tauri/src/commands/fs.rs`. The Rust side is the source of
 * truth — if you change the struct, update this file (and ideally
 * add a backend serde rename assertion test).
 *
 * Field names match the Rust `#[derive(Serialize)]` output
 * (snake_case) since Tauri IPC does NOT convert keys on the
 * return path (it only converts argument names). See CLAUDE.md
 * lib/api conventions.
 */

/**
 * One `.json` file the user is allowed to edit, returned by
 * the `list_editable_jsons` Tauri command.
 *
 * ## Security
 *
 * `path` is always inside one of the F5 read_file / write_file_atomic
 * scopes (user-level `~/.claude/` or active project's `.claude/`).
 * If a future phase extends the scope, this list will too — but
 * until then, don't add new root directories here without also
 * extending `resolve_claude_path` and re-doing the security review.
 */
export interface JsonFileEntry {
  /** Absolute path — feed directly to `readFile(path)` / `writeFileAtomic(path, ...)`. */
  path: string;
  /** Path relative to the scope root, using '/' as separator on every OS. */
  relative_path: string;
  /**
   * Scope category. Today only `"user"` and `"project"` are produced.
   * Kept as a free-form string so adding `codex` / `gemini` / `opencode`
   * later doesn't break the type (just need new entries to flow).
   */
  scope: string;
  /** Human-readable Chinese label, e.g. "用户级" / "项目级". */
  scope_label: string;
  /** File size in bytes. */
  size: number;
  /** Last-modified time as unix seconds. */
  last_modified: number;
}
