# M4.6 backup incremental — white-list

## Changed files (3)

1. `src-tauri/src/services/backup_service.rs`
   - `BackupError` enum: add variant `NoChange(PathBuf)`
   - `BackupService`: add method `backup_incremental(target, active_root_dir)`
   - Tests: add 3 scenarios (first-backup, changed, unchanged)

2. `src-tauri/src/commands/backup.rs`
   - Add `backup_incremental` tauri command (re-added `backup_now` which was accidentally removed in first edit, then corrected)

3. `src-tauri/src/lib.rs`
   - Register `commands::backup::backup_incremental` in `generate_handler!`

## Unchanged (as ordered)

- All other services / platform / frontend / SPEC.md
- `backup_scanner.rs`, `fs_atomic.rs`, `json_diff.rs` — untouched
- Atomic write semantics preserved
- No `mkdir` in unknown root paths
