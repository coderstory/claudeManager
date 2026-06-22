# M3.12 A1#6+A1#8 — F13 list_backups + F19 restore_backup 白名单

## 改动的文件 (2 个)
- `D:\project\winui3\src-tauri\src\services\backup_service.rs`
  - 改 1 个区域: `list_backups` (签名 + 体, 接收 `active_root_dir: Option<&Path>`)
  - 改 1 个区域: `restore_backup` (签名 + 体, 接收 `active_root_dir: Option<&Path>` + 安全边界 root-must-exist 拒绝 mkdir)
  - 改 1 个区域: `resolve_safe_path` (签名, 接收 `active_root_dir`, 用 `allowed_directories_for_active_root` 代替原 `allowed_directories`)
  - 加 1 个测试区: 5 个新 unit test 覆盖 5 个场景
  - 5 个旧 test (list_backups / read_backup_content / diff_backups / restore_backup / backup_now) 签名随 `restore_backup`/`list_backups` 调用点更新
- `D:\project\winui3\src-tauri\src\commands\backup.rs`
  - 改 2 个 `#[tauri::command]` 调用点: `list_backups` (注入 active_root), `restore_backup` (注入 active_root)
  - `backup_now` / `read_backup_content` / `diff_backups` 不在本任务范围 (backup_now 已接入 M3.10-arch / read/diff 无 active_root_dir 接入需求,因为只读用户选定的 backup 文件,不需要路由)
  - 实际: read_backup_content + diff_backups 改调用 service 方法时需传 active_root (resolve_safe_path 签名变了)

## 新增文件 (0 个)

## 严禁改动 (再次确认)
- ❌ platform/ 层 (M3.10 已就位, 不动)
- ❌ 其他 plugin 的 commands/services (本次只动 F13/F19)
- ❌ 前端代码 (list/restore 命令接口不变,前端零改动)
- ❌ SPEC.md (实现参考文档, 不可改)
- ❌ 任何"既然要改 backup 顺便清理 X"
- ❌ 自动 mkdir 未知 root (安全边界, 拒绝 mkdir, 与 F18 apply_optimizations 对齐)

## 安全边界 (与 F18 apply_optimizations 一致)
- `restore_backup` 在 `Some(root)` + root 不存在时 → 拒绝还原 + 返回 `BackupError::PathNotAllowed` 或新 `BackupError::ActiveRootMissing` variant
- **不**mkdir 未知 root (CLAUDE.md §7 不允许静默创建未知路径)
- 保留现有 atomic rename + double-backup (pre-restore + fs_atomic .bak.<ts>) — v2.0-BACKLOG B5#1 M2.6 fix 锁死的逻辑不能破

## 测试代码
5 个新 test 全部在 `src-tauri/src/services/backup_service.rs` 的 `#[cfg(test)] mod tests` 内,
不创建独立测试文件,符合 CLAUDE.md §2.4 最小化影响原则。

## Review / 白名单文件
- 自审: `D:\project\winui3\tmp\reviews\m3.12-f13-f19-backup-self.md`
- 白名单: 本文件