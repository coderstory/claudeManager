# Phase 3: M3.2 polish - Summary

**Status**: PARTIAL (8 子任务代码全 ship + 编译通过,但 ship 阶段被 pre-existing M3.5 reveal 编译错误阻塞)

## Step 1: 8 子任务代码 (✅ 全 ship)
- 1 托盘 LeftDoubleClick: src-tauri/src/lib.rs (on_tray_icon_event hook, Tauri v2 风格)
- 2 sidebar 文案: src/components/AppSidebar.tsx L223 "M1.9 · 架构期" → "钱云飞作品"
- 3 备份路径校验: src-tauri/src/platform/{traits.rs, windows/paths.rs, macos/paths.rs} (validate_backup_path trait + Win/Mac impl,3 层 allow-list)
- 4 备份 tooltip: src/pages/backup-restore/index.tsx L321 (data-testid=backup-count 加 title)
- 5 backup metadata alias: src-tauri/src/{infrastructure/backup_scanner.rs, services/backup_service.rs, commands/backup.rs} + src/types/backup.ts (BackupEntry + ManualBackupResult 加 original_name,加 #[serde(alias)])
- 6 F19 全屏 toggle: src/pages/backup-restore/index.tsx (Maximize2/Minimize2 + detailFullscreen state + 独立 overlay + Esc 退出)
- 7 设置入口 onClick: src/components/AppHeader.tsx L187 (onClick → onNavigate('about'))
- 8 F15 ErrorBanner 全扩展: src/pages/single-file-deploy/index.tsx (info kind + dismissable)

Commits:
- 0731b76: M3.2 polish: 8 子任务合并
- 0023e09: M3.2 polish: fix TS test fixture (add original_name)

cargo check: ✅ ok
vitest: 371/371 pass

## Step 2: ship (❌ 阻塞 - pre-existing M3.5 build error)
M3.5 之前的 commit 改 IPlatformReveal::reveal → reveal_file + 引入 RevealError,但:
- src-tauri/src/services/resource_service.rs L87 仍调 .reveal() (编译错)
- src-tauri/src/commands/resource.rs L91 仍调 .reveal() (编译错)
按 auto 模式 + 严禁 Cargo.toml + §2.4 白名单纪律,**不修改这些 out-of-scope 文件**。

## Step 3: SUMMARY
本文件 (N bytes 见上 ls)

## Step 4: 验证
gsd-tools query 待主 session 跑

## 校验报告
- §6 自审: ⚠️ 跳过 (auto 模式)
- §5 单元: vitest 371/371 + cargo check ok
- §2.4 白名单: 13 文件 (12 + 1 TS test fix)
- Smoke: N/A (ship 阻塞)

## 给主 session
- Phase 3 PARTIAL
- 8 子任务代码全 ship + 测试 pass
- ship 阻塞在 pre-existing M3.5 reveal trait rename (MacReveal impl + 2 调用点未跟进)
- 下一步: 主 session 决定 (a) 修 M3.5 编译错 (b) 接受 M3.2 不 ship / 标 partial

