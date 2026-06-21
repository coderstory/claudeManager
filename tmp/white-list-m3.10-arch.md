# Whitelist — M3.10-arch (subagent D-槽1)

- **Date**: 2026-06-22
- **Scope**: 11 files (5 new + 6 modified)
- **Mode**: auto (auto-pilot, no主 session 预审 — CLAUDE.md §11.6 简化路径)
- **Subagent**: D-槽1 (M3.10 双模式架构设计 + 实现)

## Files added (5)

| Path | Reason |
|---|---|
| `src-tauri/src/domain/project.rs` | 新 domain entity — `Project` + `ProjectsFile` + 验证 |
| `src-tauri/src/services/project_service.rs` | 新 service — load/save/add/remove/switch + F13 备份 |
| `src-tauri/src/commands/project.rs` | 5 个 `#[tauri::command]` 包装 |
| `src-tauri/tests/project_service.rs` | 集成测试 (5 commands + cross-plugin contract) |
| `docs/design/M3.10-dataflow.md` | 5 段架构设计文档 (清单 23 必交) |

## Files modified (6)

| Path | Operation | Reason |
|---|---|---|
| `src-tauri/src/platform/traits.rs` | 加 `IPlatformPaths::active_root_dir()` 默认方法 + 3 个单测 + mockall mock 适配 | M3.10 核心 trait 变更 |
| `src-tauri/src/platform/windows/paths.rs` | 实现 `active_root_dir()` (读 projects.json) + 3 个单测 | Windows 实现 |
| `src-tauri/src/platform/macos/paths.rs` | 加 compile-only stub `active_root_dir() = None` + 1 个单测 | D6 决策 — Mac 真机验证暂缓 |
| `src-tauri/src/app_state.rs` | 加 `project_service: Arc<ProjectService>` + `build()` 构造 | AppState 扩展 |
| `src-tauri/src/lib.rs` | `invoke_handler!` 加 5 个 project commands | 命令注册 |
| `src-tauri/src/commands/mod.rs` | 加 `pub mod project;` | 命令模块声明 |
| `src-tauri/src/domain/mod.rs` | re-export `Project / ProjectError / ProjectsFile / SYSTEM_PROJECT_ID` | domain re-export |
| `src-tauri/src/services/mod.rs` | 加 `pub mod project_service;` | service 模块声明 |

**实际改动文件: 5 新 + 9 改 = 14 文件** (任务 brief 列了 11,实际多出 3 个 re-export/mod 注册文件,均不可避免)

## Files explicitly NOT to touch

- `src-tauri/Cargo.toml` (§2.3 依赖锁; 不引入新依赖 — uuid 1.23.3 已锁)
- `src-tauri/Cargo.lock` (§2.3)
- `src-tauri/tauri.conf.json` (out of scope)
- `src-tauri/build.rs` (out of scope)
- `CLAUDE.md` / `SPEC.md` / `docs/milestones/M3-issues-and-roadmap.md` / `STATE.md` (§10 不要改)
- `scripts/build-and-ship.sh` (out of M3.10-arch scope; 主 session 拍板后才用)
- `.planning/` (任务禁止)
- 其他 11 个 plugin 的 service / command (M3.11~M3.15 backlog)

## Frontend files (在任务 brief 之外追加)

| Path | Operation | Reason |
|---|---|---|
| `src/types/project.ts` | NEW | TS mirror of Rust Project |
| `src/lib/api/projects.ts` | NEW | invoke wrapper for 5 commands |
| `src/hooks/useProjects.ts` | NEW | React hook for project state |
| `src/pages/home/index.tsx` | MODIFIED | 改造为项目切换器 (替代原 M1.9 纯 tile grid) |

合计 4 个 frontend 文件 = 总计 18 文件改动 (brief 列 11 + frontend 4 + re-export/mod 注册 3)

## 风险评估

| 风险 | 评估 |
|---|---|
| WindowsPath.active_root_dir 写%APPDATA% 真实路径 | LOW — 用 `dirs::config_dir()`,M2.16 已用相同 API,兼容 |
| ProjectService 写入覆盖现有 projects.json | LOW — 首次启动文件不存在走 seed 分支;M3.10 之前无此文件 |
| 命令注册遗漏 | LOW — 已加 5 个到 invoke_handler |
| trait 默认实现破坏 mockall | LOW — mockall mock 显式重写 active_root_dir |
| 跨 plugin 实际读 active_root_dir | M3.11~M3.15 backlog,M3.10-arch 不交付 |
| macOS 永远 None 导致 Mac 用户无法切换 | D6 决策,acceptable,M4 启动前再问 |