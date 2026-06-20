/**
 * Frontend wrapper for the F5 file I/O Tauri commands (M2.4).
 *
 * The functions in this module are the single source of truth
 * for "how the frontend reads / writes a `.json` file inside
 * `~/.claude/`". Pages must import `readFile` / `writeFileAtomic`
 * from here — they MUST NOT call `invoke('read_file', ...)` directly
 * (so the IPC shape is refactorable in one place).
 *
 * ## Tauri IPC arg-name convention
 *
 * Tauri converts camelCase JS arg names to snake_case on the Rust side
 * (and back). So `readFile({ filePath })` arrives at the Rust command
 * as `file_path: String`. We keep snake_case keys here to match the
 * Rust convention, which keeps the contract obvious for anyone
 * reading both files.
 *
 * ## Error semantics
 *
 * Both functions reject on any backend failure (file missing,
 * path outside scope, atomic rename failed). The caller (page)
 * is responsible for catching + showing the user-readable error
 * (SPEC §6.5: "不允许静默吞错").
 */
import { invoke } from '@tauri-apps/api/core';

/**
 * F5 — read a `.json` file inside `~/.claude/`.
 *
 * @param path Absolute or `~/`-prefixed path. The backend rejects
 *             anything outside `<home>/.claude/` (case-insensitive).
 *
 * @returns  The file content as a UTF-8 string.
 *
 * @throws   Tauri IPC error: backend rejection string (e.g.
 *           `"路径超出允许范围(只允许 ~/.claude/**): /etc/passwd"`).
 */
export function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

/**
 * F5 — atomically write a `.json` file inside `~/.claude/`.
 *
 * The backend takes a timestamped backup of the existing file
 * (if any), writes to a temp file, then renames into place
 * (Windows MoveFileEx / POSIX rename(2) — both atomic on the
 * same filesystem). See `infrastructure::fs_atomic::write_with_backup`.
 *
 * @param path     Destination path (must be inside `~/.claude/`).
 * @param content  New file content (UTF-8 string).
 *
 * @throws   Tauri IPC error on backend rejection or I/O failure.
 */
export function writeFileAtomic(path: string, content: string): Promise<void> {
  return invoke<void>('write_file_atomic', { path, content });
}