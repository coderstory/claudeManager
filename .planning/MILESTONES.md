# Milestones Archive Index

## v3.2 M6 用户实测反馈修复 (Shipped: 2026-06-27)

**Phases completed:** 5 phases, 8 plans, 0 tasks

**Key accomplishments:**

- 31-v3-2-m6-integration-int-01-06-tag-v3-2

---

| Version | Name | Shipped | Phases | Tag | Notes |
|---|---|---|---|---|---|
| v1.0 | 架构期 (M1.1~M1.12) | 2026-06-19 | 12 | - | Tauri v2 scaffold + OS 抽象 + plugin host + TDD |
| v1.5 | 业务期 (M2.1~M2.16) | 2026-06-21 | 16 | - | F1~F16 全功能 ship |
| **v2.0** | **用户反馈修复 + 双模式 (M2.17 + M3.1~M3.10)** | **2026-06-22** | **11** | **v2.0** | **27 条清单全修复 + M3.10 双模式架构 + D14 cc-switch JSONL** |
| **v3.0-M4** | **e2e 框架 (14 端到端场景 ship gate)** | **2026-06-26** | **4** | **v3.0-M4** | **黑盒端到端测试 (真 .app + 真 FS) + test-all.sh stage 6 硬关卡** |
| **v3.0.1** | **M5 用户 bug 修复 (33 bug)** | **2026-06-26** | **4** | **v3.0.1** | **33/33 bug 修完 (4 critical 5 / 业务 13 / 重构 9 / A 类 5+整合) + ClaudeManager.app 14M rebuild + tag v3.0.1** |
| **v3.2** | **M6 用户实测反馈修复 (critical 5 + 业务 7 + 重构 9 + A 类 5 + 整合)** | **2026-06-27** | **5** | **v3.2** | **Phases 27-31: BUG-CR-01~05 critical 5 / BUG-BZ-01~07 真修+08~13 留空 / BUG-RF-01~09 重构 9 / UI-A-01~05 A 类 5 / INT-01~06 整合验证 (test-all 6 stages + M4 e2e 15/15 + ClaudeManager.app 14M rebuild + smoke 10/10 macOS)** |
| **v3.3** | **M7 代码审计修复 (opencode M6 audit 37 issue)** | **planning** | **5** | **v3.3 (待)** | **Phases 32-36: P0 release 2 (P0-01 签名 OUT-OF-SCOPE) + P1 runtime 5 / P2 CI 4 + P3 arch 6 / P4 quality 12 (主题重构中,需 re-verify) / P5 nice 7 / INT-01~06 整合; ⚠️ VERIFY-FIRST 纪律 (项目仍在开发,每 phase 先核实 audit file:line 是否漂移)** |

## v2.0 关键产物

- 12 个 ship exe (~30 MB each) 在 `~/Desktop/ClaudeConfigManager-M3/`
- 11 phase SUMMARY 在 `.planning/phases/`
- v2.0-MILESTONE-AUDIT.md (status=passed, D8 user OK)
- 3 个 session 沉淀 (feedback/gsd-planning-fits / pattern/ship-and-commit-stall-recovery / feedback/tauri-cargo-test-status-entrypoint)

## v3.0-M4 关键产物

- 4 phase 8 commits (driver libs + 14 scenarios + test-all stage 6 wired)
- `tests/M4-e2e/` 完整框架 (orchestrator + 4 lib + 15 scenarios + 1 fixture)
- 14/14 scenarios PASS + 00-stub soft-skip (15 scenarios total)
- v3.0-M4-ROADMAP.md (本目录, archived)
- `scripts/test-all.sh` 第 6 阶段 m4-e2e 硬关卡 + `--skip-m4-e2e` 快迭代旗标
- macOS 优先 (AppleScript + System Events); Windows driver 是 Phase 5 stub

## v2.0 → v3.0 backlog（完整清单见 [v2.0-BACKLOG.md](milestones/v2.0-BACKLOG.md)）

| 类别 | 总数 | 已完成 | 未完成 | 说明 |
|---|---|---|---|---|
| A1 M3.10-adapter plugin 适配 | 13 | 13 | 0 | F2 switch + F13 backup_now + 11 个 v3.0 round 1 接入；#9 F18 scan_optimizations `scan_with_root` 已 ship (commit `2e4e75b`) |
| A2 v3.0 公证发布 (M4.1~M4.6) | 6 | 0 | 6 | M4.1 证书取消 + M4.5 商店取消 → 主线需重新界定 |
| A3 M4.6 长期 backlog 候选 | 9 | 2 | 7 | 备份 Phase 1 增量 + L-M2.08 MacWindowChrome 完成；**2026-06-26 用户拍板废弃 Phase 19/20/21(云备份 + updater UI + 长尾项)**;其余按需启动 |
| B1 平台/环境限制 | 5 | 1 | 4 | #4 MacWindowChrome 架构统一完成（commit `7efb0f8`）；其余 non-blocking 已记录 |
| B2 测试缺口 | 3 | 1 | 2 | #1 M3.8 usage fixture 8 子任务完成（commit `4f5df37`）；#2 Playwright e2e + #3 unimplemented! 待 #14 余额恢复后处理 |
| B3 M1 遗留设计限制 | 2 | 2 | 0 | #9 dark theme 已解决；#10 Tailwind dead deps v3.0 round 1 移除完成（commit `ed5a3e5`） |
| B4 待拍板决策 | 3 | 2 | 1 | M4.1/M4.5 已拍板；D6 Mac 真机仍待决 |
| B5 已修复 | 3+5 | 3+5 | 0 | v2.0 3 项 + v3.0 round 1 5 项（Tailwind / L-M2.08 / A1 12/13 / M3.8 usage / 备份 Phase1 / M4.3 Phase1） |

**关键**：M3.10 双模式 13/13 plugin 适配生效（#9 F18 scan_optimizations `scan_with_root` 已 ship, commit `2e4e75b`);v3.0 round 1 完成 7 项主 backlog（详见下表）。

## v3.0 round 1 进行中（2026-06-22 启动）

| 类别 | 本轮完成 | 仍 pending |
|---|---|---|
| A1 M3.10-adapter | ✅ 13/13 接入（含 #9 F18 scan_optimizations `scan_with_root`, commit `2e4e75b`） | — |
| A2 M4.3 updater | Phase 1 (pubkey+endpoint) | ~~Phase 2 前端 UI / Phase 3 E2E 灰度~~ **2026-06-26 废弃** |
| A3 备份增强 | Phase 1 增量 (commit `3eadae2`) | ~~Phase 2 云备份~~ **2026-06-26 废弃** |
| A3 MacWindowChrome (L-M2.08) | ✅ 架构统一（commit `7efb0f8`） | — |
| B2#1 usage 测试 | ✅ 8 子任务补齐（commit `4f5df37`） | — |
| B3#10 Tailwind | ✅ 移除 6 包 + cn util + dead className（commit `ed5a3e5`） | — |
| #14 Playwright e2e | ✅ 已 ship (commits `4fb03b5` + `dddc255` + `b8361ce`) — Phase 18 6/6 spec PASS | — |
| M4.6 其余 (i18n/SQLite/多窗口/Telemetry/L-M2.02) | — | ~~未启动~~ **2026-06-26 废弃** |

**本轮 commits**（按时间顺序，2026-06-22）：
`ed5a3e5` / `f375bf1` / `2e4e75b` / `afd090e` / `8a2650f` / `a9bd4b5` / `f145d38` / `e2d5e06` / `4f5df37` / `3eadae2` / `7efb0f8` / `da6ba67`

**详细状态**见 [v2.0-BACKLOG.md](milestones/v2.0-BACKLOG.md)（A1/A2/A3/B2/B3 段已加 v3.0 round 1 标记 + B5 新增 5 项）。
