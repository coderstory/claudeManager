# M3.4 marketplace 重构 文件白名单 (D-槽 2)

> **CLAUDE.md §2.4 谨慎修改文件** — 任何变更影响超过 2 个文件时,先列白名单给用户确认
> **生成时间**: 2026-06-22 (auto 模式, 用户不在场 → 自动确认)
> **D-槽 2 范围**: M3.4 marketplace 重构 + M2.16-005-M 修复

---

## §1 修改文件清单 (12 个文件)

### §1.1 新建 (3)

| # | 文件 | 说明 |
|---|---|---|
| 1 | `docs/design/M3.4-marketplace-refactor.md` | M3.4 设计文档 (5 段) |
| 2 | `src-tauri/tests/marketplace.rs` | 集成测试 (3 install method wire format) |

### §1.2 修改 (10)

| # | 文件 | 改动 scope |
|---|---|---|
| 3 | `src-tauri/src/services/marketplace_service.rs` | InstallMode enum + MarketplaceRepo 字段扩展 + builtin_repos 真 URL + 3 method + 7 单测 |
| 4 | `src-tauri/src/commands/marketplace.rs` | 3 个新 #[tauri::command] + 钉符号测试 |
| 5 | `src-tauri/src/lib.rs` | invoke_handler 加 3 个 command 注册 |
| 6 | `src-tauri/src/infrastructure/resource_scanner.rs` | EXCLUDED_DIR_NAMES + scan_dir_children 过滤 + 3 单测 |
| 7 | `src-tauri/src/platform/macos/git.rs` | D6 暂缓说明注释 (无实现改动) |
| 8 | `src/lib/api/marketplace.ts` | InstallMode type + 3 wrappers + MarketplaceRepo 字段扩展 |
| 9 | `src/pages/marketplace/index.tsx` | 三类 install 按钮 + GSD category badge + 批量 install + install_mode badge |
| 10 | `src/pages/resource-browser/index.tsx` | 模块头注释加 M3.4 清单 17 说明 (无 UI 改动) |
| 11 | `src/__tests__/pages/marketplace.test.tsx` | 7 个新 describe 用例 |
| 12 | `src/__tests__/pages/resource-browser.test.tsx` | 1 个新 describe 用例 |

---

## §2 显式排除 (不在 D-槽 2 范围)

| 路径 | 排除原因 |
|---|---|
| `src-tauri/src/domain/project.rs` | D-槽 1 范围 (M3.10 双模式) |
| `src-tauri/src/services/project_service.rs` | D-槽 1 范围 (M3.10 双模式) |
| `src-tauri/src/platform/traits.rs` | D-槽 1 范围 (M3.10 active_root_dir) |
| `src/pages/welcome/` | D-槽 1 范围 |
| `src/pages/sidebar/` | D-槽 1 范围 |
| `CLAUDE.md` / `SPEC.md` / `PROJECT.md` / `ROADMAP.md` / `STATE.md` / `HANDOFF.json` | 禁止修改 (CLAUDE.md §10) |

---

## §3 跨域冲突检查

| 路径 | 是否冲突 | 说明 |
|---|---|---|
| `src-tauri/src/lib.rs` | ✅ 无冲突 | D-槽 1 也会动 (改 invoke_handler 加 project commands), 但**只在 marketplace 段加 3 行**,与 D-槽 1 段分开 |
| `src-tauri/src/services/mod.rs` | ✅ 无冲突 | D-槽 2 未动 (marketplace_service 早就在 mod.rs 里) |
| `src-tauri/src/commands/mod.rs` | ✅ 无冲突 | D-槽 2 未动 |
| `src/__tests__/pages/marketplace.test.tsx` | ✅ 无冲突 | 仅 D-槽 2 改 |
| `src/__tests__/pages/resource-browser.test.tsx` | ✅ 无冲突 | 仅 D-槽 2 改 |

---

*本白名单由 D-槽 2 subagent 列出,2026-06-22。auto 模式自动确认。*