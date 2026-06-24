# White-list: Phase 9 Test subagent 新增文件

## 新增清单 (7 个文件, 全部为新增, 无已存在文件修改)

### src-tauri/tests/fixtures/m3-8-usage/ (5 个 fixture)
- `valid-5rec.jsonl` (1057 bytes) — 5 assistant + 1 user, 4 sonnet + 1 opus
- `empty-0rec.jsonl` (0 bytes) — 空文件边界
- `encoding-broken.jsonl` (78 bytes) — 截断 JSON
- `no-usage.jsonl` (34 bytes) — user record 无 usage
- `perf-1mb.jsonl` (1.1 MB, 5000 records) — 性能基准

### src-tauri/tests/ (1 个集成测试)
- `m3_8_usage_ccswitch.rs` (2.1 KB) — 5 个 fixture-existence 测试

### tmp/ (2 个产出文档)
- `reviews/phase9-test-self.md` — Phase 9 test self-review
- `white-list-phase9-test.md` — 本文件

## 严格不碰
- ❌ src-tauri/src/services/usage_provider_ccswitch.rs (Phase 9 主任务产物, 不存在也未创建)
- ❌ src-tauri/Cargo.toml
- ❌ src/ (前端)
- ❌ .planning/
- ❌ CLAUDE.md / SPEC.md
- ❌ 已存在 src-tauri/src/** 文件

## 编译验证
- cargo test --no-run --test m3_8_usage_ccswitch: ✅ (13.32s)
- bash scripts/test-verify.sh: ✅ exit 0 (24.08s, 22 executables)

## 给主 session
Phase 9 subagent 没跑 (STALL C), test subagent 已就位:
- 5 fixture 准备好 — Phase 9 ship 后可直接验计算逻辑
- 集成测试编译过 — Phase 9 完成后 `cargo test --test m3_8_usage_ccswitch` 即可跑

下一步: 主 session 决定是否 retry Phase 9 subagent。
