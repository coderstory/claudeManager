# Milestones Archive Index

| Version | Name | Shipped | Phases | Tag | Notes |
|---|---|---|---|---|---|
| v1.0 | 架构期 (M1.1~M1.12) | 2026-06-19 | 12 | - | Tauri v2 scaffold + OS 抽象 + plugin host + TDD |
| v1.5 | 业务期 (M2.1~M2.16) | 2026-06-21 | 16 | - | F1~F16 全功能 ship |
| **v2.0** | **用户反馈修复 + 双模式 (M2.17 + M3.1~M3.10)** | **2026-06-22** | **11** | **v2.0** | **27 条清单全修复 + M3.10 双模式架构 + D14 cc-switch JSONL** |

## v2.0 关键产物
- 12 个 ship exe (~30 MB each) 在 `~/Desktop/ClaudeConfigManager-M3/`
- 11 phase SUMMARY 在 `.planning/phases/`
- v2.0-MILESTONE-AUDIT.md (status=passed, D8 user OK)
- 3 个 session 沉淀 (feedback/gsd-planning-fits / pattern/ship-and-commit-stall-recovery / feedback/tauri-cargo-test-status-entrypoint)

## v2.0 → v3.0 backlog（完整清单见 [v2.0-BACKLOG.md](milestones/v2.0-BACKLOG.md)）

| 类别 | 总数 | 已完成 | 未完成 | 说明 |
|---|---|---|---|---|
| A1 M3.10-adapter plugin 适配 | 13 | 2 | 11 | F2 switch + F13 backup_now 已接入；11 个 plugin 不跟随项目切换 |
| A2 v3.0 公证发布 (M4.1~M4.6) | 6 | 0 | 6 | M4.1 证书取消 + M4.5 商店取消 → 主线需重新界定 |
| A3 M4.6 长期 backlog 候选 | 9 | 0 | 9 | 按需启动 |
| B1 平台/环境限制 | 5 | 0 | 5 | non-blocking，已记录 |
| B2 测试缺口 | 3 | 0 | 3 | 含 Playwright e2e 未实跑 |
| B3 M1 遗留设计限制 | 2 | 1 | 1 | #9 dark theme 已解决；#10 Tailwind dead deps 待拍板 |
| B4 待拍板决策 | 3 | 2 | 1 | M4.1/M4.5 已拍板；D6 Mac 真机仍待决 |
| B5 已修复 | 3 | 3 | 0 | usage build break / cc-switch JSONL / PluginHost wiring |

**关键**：M3.10 双模式仅 2/13 plugin 适配生效；v3.0 原"公证发布"主线因证书取消大部分暂缓。
