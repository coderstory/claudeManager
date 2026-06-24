# M3.12 A 组 F1 + F3 接入白名单

本次 commit 改动的所有文件清单:

## 主代码 (2 个)
- `D:\project\winui3\src-tauri\src\commands\providers.rs`
  - `list_providers` (line 45-49): 改 → 读 active_root_dir + 调 service 新方法
  - `list_providers_with_warnings` (line 53-69): 改 → 同上
  - `import_providers_from_sql` (line 158-173): 改 → 读 active_root_dir + 调 service 新方法

- `D:\project\winui3\src-tauri\src\services\provider_service.rs`
  - `list_providers_with_active_root` (新增): F1 接入核心
  - `import_providers_from_sql_with_active_root` (新增): F3 接入核心
  - `provider_path_for_active_root` (新增): helper
  - 6 个新测试 (list_providers_with_active_root_* / import_providers_from_sql_with_active_root_*)

## 文档产物 (2 个)
- `D:\project\winui3\tmp\reviews\m3.12-f1-f3-providers-self.md`
- `D:\project\winui3\tmp\white-list-m3.12-f1-f3-providers.md` (本文件)

## 不在本白名单 (CLAUDE.md §2.4 最小化)
- ❌ 其他 plugin (mcp/backup/resource/marketplace/usage) — 并行 subagent 做
- ❌ platform/ 层 — M3.10 已就位
- ❌ 前端代码 — IPC 签名未变
- ❌ SPEC.md
- ❌ Cargo.toml / package.json — 无依赖变化
- ❌ .planning/ — 状态文件由 ship 流程统一更新
