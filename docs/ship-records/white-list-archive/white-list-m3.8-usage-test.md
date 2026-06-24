# M3.8 usage fixture 8 子任务功能测试补齐 — 白名单

**Task**: v2.0-BACKLOG B2#1
**Date**: 2026-06-22
**范围**: 本次改动的所有文件

## 改动文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `src-tauri/tests/m3_8_usage_ccswitch.rs` | 修改 | 已有 fixture-existence test 5 个,新增 8 个功能测试(子任务 1-8) |

## 未改动文件(明确列出)

| 文件 | 状态 |
|------|------|
| `src-tauri/src/services/usage_service.rs` | 0 changes(已有 9 个 unit test,M3.12 加 2 个,均不动) |
| `src-tauri/src/services/usage_provider_ccswitch.rs` | 0 changes(已有 11 个 unit test,不动) |
| `src-tauri/src/domain/usage.rs` | 0 changes(已有 10 个 unit test,不动) |
| `src-tauri/src/commands/usage.rs` | 0 changes |
| `src-tauri/tests/fixtures/m3-8-usage/*.jsonl` (5 files) | 0 changes(已 ship) |
| 前端 / `src/**` | 0 changes |
| `SPEC.md` / `.planning/research/**` | 0 changes |
| `platform/` | 0 changes |

## 编译验证

- `cargo check --lib` ✅ 1.98s
- `cargo build --tests` ✅ 33.11s (1 pre-existing unrelated warning in
  `optimizer_fix.rs`,本次不引入新 warning)
- 未跑 `cargo test`(本机环境问题 0xC0000139,见 feedback)
- 未 ship 新 exe(零 runtime 行为变化)

## commit

待提交:`test(M3.8): 补齐 usage fixture 8 子任务功能测试 (B2#1)`
- 不 amend 之前 commit
- 不 push
- 只动 `src-tauri/tests/m3_8_usage_ccswitch.rs` 一个文件
