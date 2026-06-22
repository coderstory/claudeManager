# M3.10-adapter 白名单

## 改动文件 (3 个)

1. `src-tauri/src/services/provider_service.rs`
   - 类型: 修改(加 helper method + test,不破坏现有 API)
   - 改动量: +80 行 helper + +90 行 test

2. `src-tauri/src/services/backup_service.rs`
   - 类型: 修改(加 helper method + test,不破坏现有 API)
   - 改动量: +50 行 helper + +50 行 test

3. `src-tauri/src/commands/providers.rs`
   - 类型: 修改(`switch_provider` 函数体重写为调新 helper,签名不变)
   - 改动量: ~10 行 diff

## 新增文件 (3 个)

1. `docs/design/M3.10-adapter-phase1.md`
2. `tmp/reviews/m3.10-adapter-self.md`
3. `tmp/white-list-m3.10-adapter.md`(本文件)

## 未改动文件 (确认)

- `src-tauri/src/services/usage_service.rs` ❌ (M2.7 已有 pre-existing build break)
- `src-tauri/src/services/usage_provider_ccswitch.rs` ❌ (M2.7 已有 pre-existing build break)
- 其他 phase 已 ship 的 services / commands / platform / pages / components — 全不动

## 风险评估

- API 兼容性: 100% additive,旧调用方(`switch_provider(id)` 等)签名不变
- Build 风险: 0(本 subagent 改动不引入新错误;pre-existing 错误已记录)
- 测试覆盖: 10 个新 test case(6 + 4),覆盖 5 场景(用户级 / 项目级 / 切换 / 失败 / 边界)