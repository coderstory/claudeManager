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

// ---------------------------------------------------------------------------
// F20 — 文件关联 .sql 读取 (M2.16)
// ---------------------------------------------------------------------------

/**
 * F20 — 读取任意路径的 `.sql` 文件内容(文件关联双击导入用)。
 *
 * 与 `readFile` 的区别:`readFile` 的安全作用域是 `~/.claude/`(F5 JSON
 * 编辑器用),而 F20 的 `.sql` 文件来自文件管理器双击(任意路径:桌面 /
 * 下载 / U 盘等)。后端 `read_sql_file` 做两层校验:
 *   1. 扩展名必须是 `.sql`(大小写不敏感)
 *   2. 路径不含 `..` 组件(防目录穿越)
 *
 * 调用场景:App.tsx 收到 `import-sql-file` 事件(带 .sql 绝对路径)→
 * 跳 import-sql view → ImportSqlPage 用本函数读文件内容 → 走 F3 既有
 * `parseSqlPreview` 流程。
 *
 * @param path  .sql 文件绝对路径(来自 single-instance / setup 的 argv 解析)。
 * @returns     文件 UTF-8 字符串内容。
 * @throws      Tauri IPC error:非 .sql 扩展名 / 含 `..` / 读取失败。
 */
export function readSqlFile(path: string): Promise<string> {
  return invoke<string>('read_sql_file', { path });
}

// ---------------------------------------------------------------------------
// M2.16 — F20 冷启动 .sql 路径取走(冷启动缓存)
// ---------------------------------------------------------------------------

/**
 * M2.16 — F20 冷启动 .sql 路径取走。
 *
 * 双击 .sql 冷启动应用时,Rust `setup` 阶段 webview 尚未挂载,直接
 * emit `import-sql-file` 事件会丢(broadcast 不缓存给晚注册的 listener)。
 * 所以后端把路径先存到 `AppState.pending_sql_file`,前端 mount 后立即
 * 调一次本命令取走。
 *
 * take 语义:调用一次后状态清空,避免重复触发同一文件。无路径时返回
 * `null`。
 */
export function takePendingSqlFile(): Promise<string | null> {
  return invoke<string | null>('take_pending_sql_file');
}