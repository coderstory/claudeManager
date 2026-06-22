# Phase 9: M3.8 用量查询 (cc-switch JSONL) - Summary

**Status**: PARTIAL (5 fixture + 集成测试已建, 8 子任务 TBD, M3.8 ship 未生成)
**D14 决策**: D 选 (cc-switch-main JSONL 读法, 2026-06-22)
**Stall 根因**: Phase 9 subagent stream watchdog 600s stall (与 M3.1/M3.3/M3.6/M3.7 stall 同模式)

## 已 ship 部分
- ✅ 5 场景 fixture: `src-tauri/tests/fixtures/m3-8-usage/`
  - valid-5rec.jsonl (1057 bytes, 5 assistant + 1 user, 4 sonnet + 1 opus)
  - empty-0rec.jsonl (0 bytes)
  - encoding-broken.jsonl (78 bytes, 截断 JSON)
  - no-usage.jsonl (34 bytes)
  - perf-1mb.jsonl (1.1 MB, 5000 records)
- ✅ 集成测试: `src-tauri/tests/m3_8_usage_ccswitch.rs` (2.1 KB, 5 fixture-existence test, 编译通过 13.32s)
- ✅ scripts/test-verify.sh exit 0 (22 test executables)
- ✅ D14 调研 2 文档: `docs/investigations/m3-8-usage-bug.md` (280 行) + `docs/design/cc-switch-usage-pattern.md` (320 行)

## TBD (Phase 9 subagent 实际 stall, 未完成)
- [ ] 1. usage_provider_ccswitch.rs 新增 (cc-switch 移植)
- [ ] 2. usage_service.rs 改造 (read_local_usage_json → compute_usage_from_jsonl)
- [ ] 3. commands/usage.rs 改造 (get_current_usage + get_usage_history)
- [ ] 4. UI 重构 (src/pages/usage-query/index.tsx 表格 + ErrorBanner)
- [ ] 5. 价格表 constants
- [ ] 6. Rust 单测 (5 场景 fixture-existence 已有, 需补功能测试)
- [ ] 7. vitest 表格渲染
- [ ] 8. playwright 交互

## 用户 JSONL 数据
- `~/.claude/projects/<encoded>/<session>.jsonl` (393601 bytes, 192 行)
- 79 条记录有 usage 字段 (真实生产数据可消费)
- 格式: `{"type":"assistant","message":{"id":"msg_xx","model":"claude-sonnet-4","usage":{"input_tokens":N,"output_tokens":N,"cache_creation_tokens":N,"cache_read_tokens":N},"timestamp":"..."}}`

## Retry 决策 (主 session)
- M3.8 估时 5 天压缩 ≤ 30 分钟 stall 风险高
- 用户后续决定:
  - (a) 派 subagent retry (D14 调研已落地, 5 天估时足够)
  - (b) 主 session 慢慢做 (大工作量)
  - (c) 接受 M3.8 partial, v3.0 (M4.x) 后补
