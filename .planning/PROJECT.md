# Claude 配置管理器 (Claude Config Manager)

## What This Is

跨平台桌面工具，帮助已经在终端里使用 Claude Code 的用户在多个 provider 配置（公司代理 / 自费 DeepSeek / 自费第三方等）之间**快速切换 + 安全管理 + 实时监控用量**，免去手编 `~/.claude/settings.json` 的负担。

技术栈：Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust（后端）。目标平台 Windows 11（开发主平台）+ macOS 26 (Tahoe)。

## Core Value

**"Provider 切换 1 秒搞定，绝不出错"** — 其他所有功能（F13 备份 / F19 恢复 / F7 用量 / F18 优化）都可以失败或缺失；切换的可靠性、原子性、可回滚性是核心，不能妥协。

## Business Context

内部工具 / 自我研发项目，非商业化产品。

- **Customer**: 项目作者本人（钱云飞 / e-Yunfei.Qian）作为 Claude Code 重度用户
- **Revenue model**: 无（个人项目）
- **Success metric**: 桌面 ship 的 Claude Config Manager 安装包能稳定切换 ≥3 个 provider 不出错
- **Strategy notes**: 无（项目方向由 STATE.md 决策日志 + 用户反馈清单驱动）

## Current Milestone

- ✅ **v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1~M3.10)** — 11/11 ship, smoke 7/7
- 📋 **v3.0 公证发布 (M4.1~M4.6)** — 6 phases, planned

## Requirements

### Validated

> Shipped and confirmed working. 完整 ship 清单见 `~/Desktop/ClaudeConfigManager-M1/`、`~/Desktop/ClaudeConfigManager-M2/` 与 `~/Desktop/ClaudeConfigManager-M3/`, 详细 git 提交见 git log。

- [x] **Tauri v2 scaffold + 托盘 + 最小化到托盘** — M1.1 (commit `2914342`)
- [x] **OS 抽象层 (8 traits × Win/Mac)** — M1.2 (commit `13290b3`)
- [x] **Plugin host + 12 stubs (F1~F24 全功能占位)** — M1.3 + 3 个 fix (commits `77e070a` + `050eac8` + `50abbe6` + `038aa4f`)
- [x] **Tauri capabilities with WHY 注释** — M1.4 (commit `cc47b7d`)
- [x] **Frontend deps + 设计系统 (Cream White #FAFAF7 tokens)** — M1.5 (commits `5b46d51`, `3343db5`, `e44972e`, `16c90ae`, `be955c3`)
- [x] **Rust backend deps + version lock (12 tauri-plugin-*)** — M1.6
- [x] **Autostart 集成 (Win 注册表 + Mac LaunchAgent)** — M1.7
- [x] **TDD + UI e2e 框架 (Vitest + Playwright + tauri-driver + CI)** — M1.8 (commit `6814a7a`)
- [x] **主窗口 framework + 12 路由占位 + 自定义 chrome + Liquid Glass** — M1.9.x (commits `6737fd3` ~ `04395dd`)
- [x] **Build/package/sign/CI matrix** — M1.10 (commit `d35b81a`)
- [x] **CI + framework invariants 文档 + 3 阶段 review** — M1.11 (commit `d79575d`)
- [x] **最终自审 + brainstorm + peer review + 业务流分析** — M1.12 (commit `9776ee9`)
- [x] **F1 provider-list + F3 import-sql + F4 deeplink-import** — M2.1/M2.2/M2.3
- [x] **F2 provider-switch (原子备份→写入→reload Claude)** — M2.4
- [x] **F6 MCP 管理 (6 commands)** — M2.5
- [x] **F13 备份 + F19 恢复 (自动备份 + 字段级 diff)** — M2.6
- [x] **F7 用量查询 (5-min cache + fallback)** — M2.7
- [x] **F8 单文件部署 (drag-drop + 导出 .json)** — M2.8
- [x] **F18 优化器 (13 内置规则 + auto-backup)** — M2.9
- [x] **Theme 3-state + AppHeader chrome cluster** — M2.10
- [x] **F9 search (QuickSearchModal + fuzzy + 历史)** — M2.11
- [x] **kill-app.sh 修复 + scripts/tests** — M2.12
- [x] **F16 resource-browser (5 类资源 + reveal)** — M2.13
- [x] **F15 error feedback 横切 (shared ErrorBanner)** — M2.14
- [x] **Page padding/h1 字号统一 (polish)** — M2.15
- [x] **9 new plugins + macOS compat + splash + cleanup** — M2.16 (commit `d820b82`)
- [x] **M2.17 收尾期 (D9/D10/F15-batch4)** — commit `03e062a` + `f7196e8` + `c724f9a`
- [x] **M3.1 启动优化** — commit `f7196e8`
- [x] **M3.2 F2/托盘/InfoBar polish** — commit `0731b76` + `0023e09`
- [x] **M3.3 配置优化 16 规则** — M-finalize
- [x] **M3.4 资源市场重构** — commit `5e06296` + `c8d17f5`
- [x] **M3.5 资源浏览修 bug** — commit `e040a48`
- [x] **M3.6 Provider CRUD** — M-finalize
- [x] **M3.7 单文件部署重构 + 关于页** — M-finalize
- [x] **M3.8 用量查询 (cc-switch JSONL)** — D14 D 选
- [x] **M3.9 SQL 导入命名 + 校验** — commit `3ed3ff3`
- [x] **M3.10 双模式 用户/项目** — commit `98429b5`

### Active

> v2.0 milestone 已 ship 11/11 phase。当前空 — 等待 v3.0 公证 (M4.1~M4.6) 启动。

- [ ] **M4.1~M4.6**：代码签名证书 / 公证 / updater / 双轨打包 / 应用商店（可选）/ 长期 backlog

### Out of Scope

- ❌ **其他 Claude client 应用 (Codex / Cursor / Gemini / OpenCode)** — SPEC.md §1.4 硬约束;M4 不考虑
- ❌ **云同步 / 多人协作** — SPEC.md §1.4 硬约束;无服务器依赖
- ❌ **M2.17 业务 4 槽之外的新功能** — 4 槽上限 (D11);不插队
- ❌ **macOS 应用商店 / Microsoft Store 上架** — M4.5 标"可选",需用户拍板

## Context

- **技术栈定型**: Tauri v2 已在 EVALUATION-REPORT.md (`.planning/research/EVALUATION-REPORT.md`) 中对比 7 框架后确认最佳 (包体积 / 内存最低 + 系统 webview + Rust + 跨平台)
- **架构纪律**: 见 `D:\project\winui3\CLAUDE.md` §2-11 (架构先行 / TDD / 版本锁 / 谨慎修改 / UI 一致性 / 三层测试 / 评审纪律 / 4-slot concurrent subagent / iteration ship 流程)
- **当前进度**: M1 + M2 全 ship (40+ exes),M2.17 收尾中 (3 件套 + 17 已知限制),M3 启动门 4 槽待派 (待 M2.17 首批完成 + D14 用户回答 + D9 桌面清理)
- **已知阻塞**: D14 (M3.8 用量查询方向) 待用户回答;这是 M3 启动前唯一硬阻塞
- **桌面状态**: `~/Desktop/ClaudeConfigManager-M1/` (5 exes) + `~/Desktop/ClaudeConfigManager-M2/` (26+ exes);D8 抽查 2 个 + D9 清空策略已拍板
- **Review 文档**: `docs/REVIEWS/M1-REVIEWS.md` + `docs/REVIEWS/M2-REVIEWS.md` 已归档
- **M3 草案详细**: `docs/milestones/M3-issues-and-roadmap.md` (359 行,27 用户反馈 + M3.1~M3.10 + M4.1~M4.6 + D6~D13 决策)

## Constraints

- **Tech stack**: Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust. 禁止换栈 (CLAUDE.md §2.3).
- **依赖版本**: 全部锁在 `Cargo.lock` / `package-lock.json`. 禁止"依赖不行就换版本" (CLAUDE.md §2.3).
- **目标平台**: Windows 11 (开发主) + macOS 26 (Tahoe). Linux 不在范围.
- **Tauri release build**: 必须 `--features tauri/custom-protocol` 否则 webview 加载 vite dev server 报 ERR_CONNECTION_REFUSED (CLAUDE.md §9 + memory `feedback/tauri-v2-custom-protocol-required`). 脚本 `scripts/build-and-ship.sh` 已固化.
- **Smoke test**: 必须 7/7 通过 (含 WebView2 child + title + dist fingerprint). 不允许跳过 (CLAUDE.md §9.4).
- **4 槽并发上限**: M2.17 / M3 启动门 ≤4 subagent 同时 (D11).
- **macOS 真机验证**: M2/M3 阶段 Windows dev box 上 mac impl 是 compile-only stubs;Mac 真机验证 D6 暂缓待 M4 启动前再问.
- **SPEC.md 只读**: 不可修改 (`D:\project\winui3\SPEC.md` 实现唯一参考).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **Tauri v2 over Electron/Flutter/MAUI/Avalonia/Wails/Qt** | EVALUATION-REPORT.md 详细对比,包体积/内存/生态综合最优 | ✓ Good (M1~M2 全部 ship 验证) |
| **`cargo build --release --features tauri/custom-protocol`** 而非 `tauri build` | 同样 embed,更快迭代,但 feature flag 强制 (memory `feedback/tauri-v2-custom-protocol-required`) | ✓ Good (M2.17-C3 已切到 `tauri build`) |
| **Smoke test 必须验证结构标记** (WebView2 child + title + dist fingerprint) | 原 4-test 版本 false positive,blank/ERR 都通过 | ✓ Good (Test 5/6/7 已加,捕获过回归) |
| **macOS impl = Windows dev box 上 compile-only stub** | CLAUDE.md §3.2 + Mac dev box 暂不可用 | ⚠️ Revisit (D6 待 M4 启动前问) |
| **CLAUDE.md = 项目级 (非全局)** | 用户选择 2026-06-19;跨项目 Windows 工具入全局 memory | ✓ Good |
| **D7**: F15 ErrorBanner 扩到全部页面 (M3.2 顺手做) | 一致性 > 部分覆盖 | — Pending |
| **D8**: 抽查 2 个 M2.16 ship exe (review-fixes + f15-batch2) | 26+ exe 逐个审不现实,抽查覆盖 CRITICAL/HIGH + 横切 | — Pending (待用户运行) |
| **D9**: M2.16 26+ exe 桌面清空到归档 (`.archive/2026-06-21-m2.16-final/`) | 桌面堆积,保留 D8 抽查 2 个作代表 | — Pending (M2.17 启动时执行) |
| **D10**: 17 MEDIUM/LOW 已知限制按 M2.16-001-M~010-M 顺序全评估 | 不修但必须评估,避免遗漏 | — Pending |
| **D11**: M2.17 + M3 启动门 4 槽并发首批全选 | 最大化 4 槽利用率 | — Pending (M2.17 首批完成) |
| **D12**: 清单 20 (JSON 编辑器路径 bug) 挂入 M3 启动门槽 3,**不**插队 | P0 但需充分测试,启动门半日可消化 | — Pending |
| **D13**: 清单 15 reveal 报错按 M3.5 排期 | P1,不与 D12 抢启动门 | — Pending |
| **D14**: M3.8 用量查询方向 (A 重写 / B 修 stub / C 外部 API) — **待用户拍板** | 决定 M3.8 技术路线,**主 session 必问** | — **BLOCKED** |

---

*Last updated: 2026-06-21 after M2.16 close + M2.17 start + M3/M4 roadmap draft (commit `d62ba75`)*
</content>
</invoke>