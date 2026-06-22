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
| A1 M3.10-adapter plugin 适配 | 13 | 12 | 1 | F2 switch + F13 backup_now + 10 个 v3.0 round 1 接入；#9 F18 scan_optimizations 仍 pending |
| A2 v3.0 公证发布 (M4.1~M4.6) | 6 | 0 | 6 | M4.1 证书取消 + M4.5 商店取消 → 主线需重新界定 |
| A3 M4.6 长期 backlog 候选 | 9 | 2 | 7 | 备份 Phase 1 增量 + L-M2.08 MacWindowChrome 完成；其余按需启动 |
| B1 平台/环境限制 | 5 | 1 | 4 | #4 MacWindowChrome 架构统一完成（commit `7efb0f8`）；其余 non-blocking 已记录 |
| B2 测试缺口 | 3 | 1 | 2 | #1 M3.8 usage fixture 8 子任务完成（commit `4f5df37`）；#2 Playwright e2e + #3 unimplemented! 待 #14 余额恢复后处理 |
| B3 M1 遗留设计限制 | 2 | 2 | 0 | #9 dark theme 已解决；#10 Tailwind dead deps v3.0 round 1 移除完成（commit `ed5a3e5`） |
| B4 待拍板决策 | 3 | 2 | 1 | M4.1/M4.5 已拍板；D6 Mac 真机仍待决 |
| B5 已修复 | 3+5 | 3+5 | 0 | v2.0 3 项 + v3.0 round 1 5 项（Tailwind / L-M2.08 / A1 12/13 / M3.8 usage / 备份 Phase1 / M4.3 Phase1） |

**关键**：M3.10 双模式 12/13 plugin 适配生效（#9 F18 scan_optimizations 仍 pending）；v3.0 round 1 完成 6 项主 backlog（详见下表）。

## v3.0 round 1 进行中（2026-06-22 启动）

| 类别 | 本轮完成 | 仍 pending |
|---|---|---|
| A1 M3.10-adapter | 12/13 接入 | #9 F18 scan_optimizations（v3.0 round 2） |
| A2 M4.3 updater | Phase 1 (pubkey+endpoint) | Phase 2 前端 UI / Phase 3 E2E 灰度 |
| A3 备份增强 | Phase 1 增量 (commit `3eadae2`) | Phase 2 云备份 |
| A3 MacWindowChrome (L-M2.08) | ✅ 架构统一（commit `7efb0f8`） | — |
| B2#1 usage 测试 | ✅ 8 子任务补齐（commit `4f5df37`） | — |
| B3#10 Tailwind | ✅ 移除 6 包 + cn util + dead className（commit `ed5a3e5`） | — |
| #14 Playwright e2e | — | 402 余额不足中止，待重派 |
| M4.6 其余 (i18n/SQLite/多窗口/Telemetry/L-M2.02) | — | 未启动 |

**本轮 commits**（按时间顺序，2026-06-22）：
`ed5a3e5` / `f375bf1` / `2e4e75b` / `afd090e` / `8a2650f` / `a9bd4b5` / `f145d38` / `e2d5e06` / `4f5df37` / `3eadae2` / `7efb0f8` / `da6ba67`

**详细状态**见 [v2.0-BACKLOG.md](milestones/v2.0-BACKLOG.md)（A1/A2/A3/B2/B3 段已加 v3.0 round 1 标记 + B5 新增 5 项）。
