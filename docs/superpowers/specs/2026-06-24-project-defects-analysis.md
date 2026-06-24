# Claude Config Manager — 项目缺陷盘点 (C-扫描)

## 元信息

- **任务**: 全量盘点 6 维度缺陷 (跨平台架构 / 代码质量 / 工程流程 / 产品UX / 测试覆盖 / 文档管理)
- **扫描日期**: 2026-06-24
- **扫描前提**: Wave 0 跳过 (用户确认未改代码 + 4 冲突文件已干净 + `tsc --noEmit` 退出码 0)
- **主 session**: Claude Code Opus 4.8
- **引用资产**: 6 份子报告 (`docs/superpowers/specs/defects-analysis/*/REPORT.md`) + 6 份既有 audit (`tmp/audit-*.md` + `tmp/tailwind-audit.md`) + `tmp/retro-2026-06-25-sccache-discipline.md` + `STATE.md` + `.planning/STATE.md`
- **设计依据**: `docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md` §3 主报告结构
- **方法**: Read 6 子报告 + 6 audit + 关键 STATE/CLAUDE 段 + Grep 交叉引用 + Bash (wc / ls) 只读统计

---

## 1. 项目当前状态摘要

### 1.1 里程碑进度

| 阶段 | 状态 | 备注 |
|---|---|---|
| M1 架构期 | ✅ 完成 | 12 子任务全部 ship (M1-final-report) |
| M2 业务实现期 | ✅ 完成到 M2.16 | 12 plugin stub + 业务逻辑 12/15 落地 |
| v3.0 主题重构 | ✅ 完成 (含 round-2 修复 3 atomic commit) | `46acaf7` / `1231b59` / `fc2b3a6` |
| M4.6 集成 | 🚧 WIP (3 阻塞) | Phase 21-D 集成测试 + smoke + ship 收尾中; Wave 0 已确认 4 冲突文件实际干净 |
| M4.1/M4.5 (商店 + 签名) | ❌ 永久砍 (2026-06-22 user 决定) | CLAUDE.md §15.7 永久砍清单 |

### 1.2 跨平台范围

- **主平台**: Windows 11 (开发主)
- **次平台**: macOS 26 Tahoe (dev-only, 无 release)
- **不在范围**: Linux (CLAUDE.md §1)
- **当前 ship 流程**: Windows 桌面交付 (`build-and-ship.sh`); macOS dev 走 `scripts/build-mac.sh --debug`

### 1.3 测试 baseline

- **npm test -- --run 实测 (2026-06-24)**: 470 tests, **25 failed / 445 passed / 13 errors**, 8 文件失败
- **STATE.md 漂移**: STATE.md:60 标 18 个, 实测 25 个 (+7, 与 v3.0 round-2 + M4.6 WIP 累积)
- **cargo test dev box**: 跑不起来 (0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND, 缺 `vcruntime140_1.dll` — E-1)
- **e2e CI**: 永久禁用 (`ci.yml:125` `if: ${{ false }}`, 28 Playwright spec 0 跑过 — E-2)

### 1.4 文档资产

| 文档 | 行数 | 状态 |
|---|---|---|
| `CLAUDE.md` | 652 | 持续膨胀 (§15 macOS 86 行 / §9 迭代 80 行 / §11 派单 60 行) |
| `SPEC.md` | 1434 | 不可修改 (实现唯一参考) |
| `docs/ARCHITECTURE.md` | 654 | §2 trait 表 8 行号错位 (F-1) |
| `README.md` | 163 | 快速开始命令 Win-only (F-5) |
| `AGENTS.md` | 212 | — |
| `STATE.md` | 107 (精简) vs `.planning/STATE.md` 1475 (详) | 双份漂移 (F-6) |
| **核心文档合计** | **~3220 行** | |

### 1.5 临时诊断资产

- `tmp/` 目录: **73 文件 / 8.8M** (无 INDEX)
  - 36 white-list-*.md (派单纪律历史, 1.7K 行)
  - 6 audit-*.md (1.1M, 2026-06-24 批次)
  - 11 test/smoke-failures-*.md
  - 2 retro-*.md (sccache-discipline + scripts-usage-guide)
  - 20+ 其他 (probe / .cjs / build-perf / target-cleanup-plan 等)

### 1.6 6 维度子报告 Top 严重度分布

| 维度 | CRITICAL | HIGH | MEDIUM | LOW | 总计 |
|---|---|---|---|---|---|
| A 跨平台架构 | 3 | 6 | 1 | 0 | **10** |
| B 代码质量 | 3 | 3 | 4 | 0 | **10** |
| C 工程流程 | 4 | 4 | 2 | 0 | **10** |
| D 产品/UX | 1 | 4 | 4 | 1 | **10** |
| E 测试覆盖 | 2 | 4 | 3 | 1 | **10** |
| F 文档管理 | 3 | 4 | 3 | 0 | **10** |
| **合计** | **16** | **25** | **17** | **2** | **60** |

> **60 条问题**, 其中 CRITICAL 16 条 (27%), HIGH 25 条 (42%)。其中 ≥8 条问题在多维度交叉出现 (详见 §3)。

---

## 2. 6 维度摘要 (每维 1 段 + Top 3)

### 2.A 跨平台架构 — Top 3 (A.1 / A.2 / A.3)

**段落摘要**: 跨平台架构层 (CLAUDE.md §3.2 OS 抽象层纪律) 在 Windows 主平台上完整, 但 **macOS 路径在 scripts/ 层严重缺失**: 4 个核心脚本 (`smoke-test.sh` / `kill-app.sh` / `run-e2e.sh` / `build-and-ship.sh`) 整脚本 Windows-only, 27 处不兼容点 (audit-scripts 报告); 平台抽象层 (IPlatform*) 业务代码 0 处违反纪律, 但 `infrastructure/fs_atomic.rs:251-326` 跨 cfg 调用 Win32 `GetTimeZoneInformation` 直接 FFI 泄漏, 违反 §3.2 "业务代码只调接口" 纪律。dev box 是 Windows, macOS 真机验证依赖用户; CLAUDE.md §15.7 已砍掉 release CI 改造, 但 dev 阶段仍可做 macOS fork。

| # | 问题 | 严重度 | 关联子报告 |
|---|---|---|---|
| **A.1** | `smoke-test.sh` 整脚本 Windows-only (PowerShell + cygpath + Win32 P/Invoke), 9 处不兼容; macOS 完全无法跑 (Win32 `EnumChildWindows` 不可移植) | **CRITICAL** | A-platform-architecture/REPORT.md §A.1 |
| **A.2** | `kill-app.sh` 整脚本 Windows-only (tasklist/taskkill + powershell heredoc), 6 处不兼容; `EXE_NAME="claude-config-manager.exe"` 硬编码后缀 | **CRITICAL** | A-platform-architecture/REPORT.md §A.2 |
| **A.3** | `run-e2e.sh` 绑死 msedgedriver.exe + cygpath + powershell, 6 处不兼容; macOS 需 `safaridriver` 协议; CI 端 e2e 整体 skip | **CRITICAL** | A-platform-architecture/REPORT.md §A.3 |

**其他 7 条**: A.4 fs_atomic OS 调用泄漏 / A.5 lib.rs 测试 fixture `.exe` 硬编码 / A.6 build-and-ship.sh 5 处不兼容 / A.7 test-verify.sh 3 处 / A.8 build-only.sh EXE_SUFFIX 路径不完整 / A.9 cdp-f3 Windows-only / A.10 entitlements 平台分发缺失 (MEDIUM)

---

### 2.B 代码质量 — Top 3 (B-1 / B-2 / B-3)

**段落摘要**: 代码质量层 (CLAUDE.md §2 工程纪律) 在 `tsc --noEmit` strict 模式下全代码库无错误 (Wave 0 后), 但 **15 处 `unimplemented!()` stub (B-3) 是 release exe 的 P0 风险** — 任何 IPC 调用都触发进程 panic, 整个 Tauri 进程崩溃, 无 user-friendly 错误。Tailwind utility class 死代码 (B-1) 影响 6 个核心文件, WebView2 release exe 在这些位置静默回退到 `display: block`, 布局错乱/动画丢失。集成测试在 macOS 编译失败 (B-2) 与 E-6 跨维度重复, 同根因 — 测试文件直接 `use platform::windows::WindowsPaths` 违反 §3.2 抽象层纪律。`mockall` 已在 dev-dep 中, 修复成本可控。

| # | 问题 | 严重度 | 关联子报告 |
|---|---|---|---|
| **B-1** | Tailwind utility class 死代码 (6 文件, 60+ className), 真实 WebView2 release exe 不渲染; 无 tailwind 管线 (无 config / 无 postcss / 无 Vite plugin), utility 在 CSS bundle 里根本不存在 | **CRITICAL** | B-code-quality/REPORT.md §B-1; tmp/tailwind-audit.md |
| **B-2** | 集成测试在 macOS 编译失败 (跨平台 cfg 泄漏): `tests/project_service.rs:15` + `tests/history_integration.rs:22` 报 `unresolved import ...platform::windows`; 测试套件完全跑不起来 | **CRITICAL** | B-code-quality/REPORT.md §B-2; tmp/audit-rust.md §2.2 |
| **B-3** | 15 处 `unimplemented!()` stub (8 个 commands/*.rs 文件), release exe 调用即进程崩溃, 无 user-friendly 错误返回 | **CRITICAL** | B-code-quality/REPORT.md §B-3 |

**其他 7 条**: B-4 71 clippy warning / B-5 5 个 Rust 文件 >1000 行 / B-6 13 个 TS 页面 >500 行 / B-7 7 处 `as React.CSSProperties` 强转 / B-8 8 处 `.exe` 测试 fixture / B-9 1113 unwrap + 70 expect / B-10 25 vitest failures 漂移

---

### 2.C 工程流程 — Top 3 (C.1 / C.2 / C.3, 含 v3.0 ship 阻塞)

**段落摘要**: 工程流程层 (CLAUDE.md §11 派单纪律) 是当前 v3.0 ship 阻塞的根因归类维度, **CRITICAL 4 条全部是流程缺陷**: v3.0 round-1 4 文件 merge conflict 反复 (C.1/C.2) + A3 subagent 反复失败 4 次未 pause (C.3) + sccache subagent 擅自 commit (C.4)。`STATE.md` 与实测 baseline 漂移 (C.7 标 18, 实测 25) 反映流程纪律弱化。`tmp/` 膨胀 36 white-list + 73 文件无 INDEX (C.8) 反映派单记录未归档。subagent 卡死 20+ min 案例 (C.9) 出现 ≥4 次, sonnet 在 opus 4.8 父代理下兼容性差, 切 haiku 可解。

| # | 问题 | 严重度 | 关联子报告 |
|---|---|---|---|
| **C.1** | v3.0 ship 反复阻塞: base.css + anime.css 落地顺序错误; round-1 第 1 轮只覆写不补 base, smoke test 9 项过但页面是空白; round-2 才补 base.css (commit `46acaf7`) | **CRITICAL** | C-engineering-process/REPORT.md §C.1; STATE.md:73-104 |
| **C.2** | 多 subagent 并发 stash pop → 6 文件 merge conflict (v3.0 round-2 收尾 f47f253); v3.0 round-1 4 文件 merge 阻塞仍未解 (STATE.md:92) — 同模式再现 | **CRITICAL** | C-engineering-process/REPORT.md §C.2; .planning/STATE.md:1432-1451 |
| **C.3** | A3 subagent 反复失败 4 次 (v1 503 / v2 race / v3 文件损坏 / v4 被 kill) 才派 v5, 违反 §11.7 三次失败规则; 跳过 pause → retro → 改方案中间步骤 | **CRITICAL** | C-engineering-process/REPORT.md §C.3; .planning/STATE.md:1423 |

**其他 7 条**: C.4 sccache subagent 擅自 commit (commit `645680b`) / C.5 UI 文案 3 处同步反复失败 5 轮 / C.6 §11.8 核定未到派 ship 类 subagent / C.7 vitest 18 vs 25 漂移 / C.8 tmp/ 膨胀无 INDEX / C.9 subagent 卡死模式 / C.10 §11.4.1 临时命令未脚本化

---

### 2.D 产品/UX — Top 3 (D-1 / D-2 / D-3, 含 radius 反向误判修订)

**段落摘要**: 产品/UX 层 (CLAUDE.md §2.5 + §4 设计系统基线 + SPEC §5) **CRITICAL 1 条** = `--button-radius: 6px` token 与 SPEC §4.4 "按钮 4px" 不一致 (D-1)。D 子报告原版误判 "radius alias 方向反向", 主 session 验证后修订: 真实问题是 token 抄错值 (SPEC 4px → 写 6px), 不是 alias 方向。94 处硬编码 `borderRadius: 4/6/8` 绕开 token (D-2) + 5 处 `fontFamily: 'monospace'` 字符串绕开 `--font-mono` (D-3) 是 token 化推进半途的累积债。base.css 落地顺序 (D-4) v3.0 round-2 已修 1 次, 但无测试保证。键盘导航 (D-5) 14 内页仅 6 处 `onKeyDown`/`tabIndex`, 与 CLAUDE.md §2.5 "UI/UX 是头等大事" 原则冲突。

| # | 问题 | 严重度 | 关联子报告 |
|---|---|---|---|
| **D-1** | `--button-radius: 6px` 与 SPEC §4.4 "按钮 4px" 不一致; 全代码库 58 处硬编码 `borderRadius: 4` (与 token 6 冲突), 24 处用 `var(--radius-button)` 拿到 6px (违反 SPEC 4px) | **CRITICAL** | D-product-ux/REPORT.md §D-1; tokens.css:101; SPEC §4.4 L551 |
| **D-2** | 大量硬编码 `borderRadius: 4/6/8` 绕开 token: `borderRadius: 4` ×58, `borderRadius: 8` ×20, `borderRadius: 6` ×6, 共 94 处; 仅 24 处用 `var(--radius-*)` (~80% 绕开设计系统) | HIGH | D-product-ux/REPORT.md §D-2 |
| **D-3** | font-family 硬编码 `monospace` 字符串 (5 处) + 硬编码完整 fallback 链 (4 处) 绕开 `--font-mono`; 跳过 CSS fallback 链, 跨平台字形不稳定 | HIGH | D-product-ux/REPORT.md §D-3 |

**其他 7 条**: D-4 base.css 落地顺序风险 / D-5 键盘导航 6 处 / D-6 交互状态缺位 / D-7 加载 110 / 空 22 不均 / D-8 Tailwind 死代码 UX 后果 (10 文件未接主题系统) / D-9 12 处硬编码 hex 颜色 / D-10 anime.css 6 token 写死注释

---

### 2.E 测试覆盖 — Top 3 (E-1 / E-2 / E-3)

**段落摘要**: 测试覆盖层 (CLAUDE.md §5 TDD 强制) **3 重病**: cargo test 在 dev box 跑不起来 (E-1, 0xC0000139) → 50 个 `#[test]` 0 可跑; e2e CI job 永久禁用 (E-2) → 28 Playwright spec 0 跑过; backup 命令 0 测试 (E-3) → F13 备份与恢复核心 IPC 无回归保护。`vitest` baseline 25 failed 漂移 (E-5, 与 C-7 / B-10 跨维度重复) 反映 pre-existing failures 长期未修。集成测试 macOS 编译挂 (E-6) 与 B-2 同根因。smoke-test 10 项只在 Windows 跑 (E-9) 跨平台缺口 (CLAUDE.md §15.7 已砍 release CI 改造, dev 阶段仍可做 macOS fork)。

| # | 问题 | 严重度 | 关联子报告 |
|---|---|---|---|
| **E-1** | `cargo test` 在 dev box 跑不起来 (WebView2Loader.dll STATUS_ENTRYPOINT_NOT_FOUND 0xC0000139); 50 个 `#[test]` 跑不到, 是工具链问题非代码问题 | **CRITICAL** | E-test-coverage/REPORT.md §E-1; tmp/test-failures-m3.10-rust.md §3 |
| **E-2** | e2e CI job 永久禁用 (`ci.yml:125` `if: ${{ false }}`); 28 个 Playwright spec 在 CI 0 跑过, 仅本地 tauri-driver (6 个 M1.8 spec) | **CRITICAL** | E-test-coverage/REPORT.md §E-2 |
| **E-3** | `commands/backup.rs` 7 commands 完全裸奔 (0 unit + 0 integration tests): list_backups / read_backup_content / diff_backups / restore_backup / backup_now / delete_backup / backup_incremental | HIGH | E-test-coverage/REPORT.md §E-3 |

**其他 7 条**: E-4 autostart.rs 仅 compile-time type-check / E-5 25 vitest failures 漂移 / E-6 macOS integration test 编译挂 (B-2 cross-dim) / E-7 provider-switch/ 0 测试 / E-8 page test 极度不均 (home 4 vs resource-browser 46) / E-9 macOS smoke test 无等价 / E-10 test fixture 复用度低

---

### 2.F 文档/知识管理 — Top 3 (F-1 / F-2 / F-3)

**段落摘要**: 文档/知识管理层 **3 CRITICAL**: ARCHITECTURE.md §2 trait 表格与代码 drift (F-1, 8 trait 行号错位 13-50 行 + IPlatformWindowChrome 状态描述过期), 实际 `mac/window_chrome.rs:29-50` 已在 commit `7efb0f8` 实装 vibrancy, 但 ARCHITECTURE.md 仍标 "Mac unimplemented"; tmp/ 73 文件 8.8M 无 INDEX (F-2, 与 C.8 同根因); docs/SIGNING.md 与 M4.1 取消决策漂移 (F-3, 2026-06-22 user 拍板不买证书, 但 SIGNING.md 文件未删/未 ARCHIVED, 仍列 5 个 Apple secret + Developer Program enrollment 流程)。CLAUDE.md 652 行膨胀 (F-4) 反映项目规则失控。STATE.md 双份漂移 (F-6, docs/milestones/STATE.md 67 行 vs .planning/STATE.md 1475 行) 反映文档双轨维护未选权威源。

| # | 问题 | 严重度 | 关联子报告 |
|---|---|---|---|
| **F-1** | docs/ARCHITECTURE.md §2 trait 表格与代码 drift: 8 traits 行号错位 13-50 行 + IPlatformWindowChrome 状态描述过期 (实际 commit `7efb0f8` 已实装 vibrancy, 文档仍标 "Mac unimplemented") | **CRITICAL** | F-documentation-knowledge/REPORT.md §F-1; ARCHITECTURE.md:127-134 |
| **F-2** | tmp/ 目录膨胀 (8.8M, 73 文件, 36 white-list + 11 test-failures + 6 audit + 多份 retro), 无目录索引, 分类混乱 | **CRITICAL** | F-documentation-knowledge/REPORT.md §F-2; 维度 C.8 同根因 |
| **F-3** | docs/SIGNING.md 与 M4.1 取消决策漂移 (2026-06-22 user 拍板不买证书); CLAUDE.md §15.7 永久砍清单含 "❌ docs/SIGNING.md 维护", 但 SIGNING.md 文件未删/未 ARCHIVED, 仍列 5 个 Apple secret + Developer Program enrollment 完整流程 | **CRITICAL** | F-documentation-knowledge/REPORT.md §F-3; PROJECT.md:93; CLAUDE.md:623-649 |

**其他 7 条**: F-4 CLAUDE.md 652 行膨胀 / F-5 README.md 快速开始命令 Win-only / F-6 docs/milestones/ 覆盖断档 (M3-final / M4-roadmap 缺失) / F-7 SPEC.md §3.1 §3.2 无平台标注列 / F-8 ARCHITECTURE.md §3 plugin 表无平台标注列 / F-9 v3.0-ROUND1-CLOSURE.md 不提 Mac / F-10 CLAUDE.md §15.7 与 macos-p2-backlog.md 顶部段重复

---

## 3. 跨维度交叉问题 (出现 ≥2 维度的根因)

> 本节识别 **5 个跨 ≥2 维度的根因**, 每个根因引出 2-3 个具体子问题。仅汇总, 不引入新问题。

### 3.1 跨维度根因 1: merge conflict 反复出现 (C + E + F)

**根因**: 多 subagent 并发改同工作区 + 无 conflict pre-check + 派单白名单未归档导致状态不可追。

| 维度 | 子问题 | 引用 |
|---|---|---|
| **C** (流程) | C.2 多 subagent 并发 stash pop → 6 文件 merge conflict (v3.0 round-2 f47f253) | C-engineering-process/REPORT.md §C.2 |
| **C** (流程) | C.1 v3.0 ship 反复阻塞 (base.css/anime.css 落地顺序错误), 同一 session 反复修同根问题 | C-engineering-process/REPORT.md §C.1 |
| **E** (测试) | E-5 25 vitest failures 漂移 = 8 文件 failed, 与 merge conflict 后未跑测试累积相关 (STATE.md 标 18, 实测 25) | E-test-coverage/REPORT.md §E-5 |
| **F** (文档) | F-2 tmp/ 36 white-list 散落, 派单白名单未归档; 找"哪些文件已 ship"需 ls + grep | F-documentation-knowledge/REPORT.md §F-2 |

**修复方向**: subagent 强制走 git worktree (progress.md:18 决策"不使用 worktree" 需重新评估) + 加 `scripts/conflict-pre-check.sh` + 派单白名单 ship 后归档到 `docs/ship-records/`。

---

### 3.2 跨维度根因 2: Tailwind 死代码 (B-1 + D-8 + 隐含 C)

**根因**: 项目 M1 阶段用 Tailwind 写 UI, 后来切换到"design system token + inline style" 路径, 没回头清理 utility class。同根因影响代码质量 (B-1) + 产品/UX (D-8) + 隐含流程 (C-8 tmp/ 散落未跟进的 dead code 跟踪)。

| 维度 | 子问题 | 引用 |
|---|---|---|
| **B** (代码) | B-1 6 文件 60+ Tailwind utility class 死代码, WebView2 release exe 静默回退 `display: block` | B-code-quality/REPORT.md §B-1; tmp/tailwind-audit.md |
| **D** (产品UX) | D-8 10 文件 (含核心 shell App.tsx + AppHeader + AppSidebar) 未接 v3.0 theme 系统; 切 anime 主题时视觉断裂 | D-product-ux/REPORT.md §D-8 |
| **F** (文档) | F-5 README.md 快速开始命令 Win-only 反映 design system 入口未在文档统一 (Mac 入口散落 §15) | F-documentation-knowledge/REPORT.md §F-5 |

**根因诊断**: `tailwind-audit.md` 2026-06-20 记录 9 文件 + 50+ utility 映射, 2026-06-24 仍未落实修复 (4 天后仍未改)。属"已识别但无主 session 跟进" 模式。

**修复方向**: 按 mapping table 1:1 替换 6 文件 + 新建 `src/design-system/utilities.css` 加 `@keyframes` (替代 `animate-spin` / `animate-pulse`) + 加 ESLint 禁 `className` 包含 utility 字符串。

---

### 3.3 跨维度根因 3: UI/文档 3 处同步失败 (C.5 + D + F.3)

**根因**: 决策 (改名 / 取消 / 删功能) 后, **代码 + IPC 常量 + 测试 fixture + 文档** 4 处需要同步, CLAUDE.md §6.4 教训段明确 3 处 (前 3 处), 但第 4 处 (文档) 经常漏。

| 维度 | 子问题 | 引用 |
|---|---|---|
| **C** (流程) | C.5 UI 文案反复失败 5 轮才改全 (ClaudeConfigManager → ClaudeManager): tauri.conf.json productName / app.rs:46 PRODUCT_NAME / about.test.tsx:30 sampleMetadata mock, smoke test 不检测 UI 文本 | C-engineering-process/REPORT.md §C.5; CLAUDE.md §6.4 |
| **D** (产品UX) | D-1 --button-radius: 6px 与 SPEC §4.4 4px 不一致 (设计 token 抄错值, "SPEC 与 token 不同步" 镜像) | D-product-ux/REPORT.md §D-1 |
| **F** (文档) | F-3 docs/SIGNING.md 未删/未 ARCHIVED, 与 CLAUDE.md §15.7 "本项目不做发布" 决策漂移; PROJECT.md:93 决策源头已写, 但 SIGNING.md 文件本身未触动 | F-documentation-knowledge/REPORT.md §F-3 |

**根因诊断**: 决策源头 (PROJECT.md / CLAUDE.md) 更新, 但**下游影响文件**未检查。M3.0.3 lesson 在 §6.4 沉淀 3 处同步规则, 但 §6.4 仅覆盖 IPC + 文本, 未涵盖 docs/ 影响范围。

**修复方向**: PROJECT.md §Out of Scope 加 "影响文档" 段, 决策时同步检查 docs/ 下相关文件; 加 `scripts/check-decision-sync.sh` 扫描决策源头 vs docs/ 内容一致性。

---

### 3.4 跨维度根因 4: subagent 卡死模式 (A/B/C/D/E/F 全部受影响)

**根因**: sonnet 模型在 opus 4.8 父代理下某些工具栈兼容问题, 持续 20+ min 不动; haiku (cheapest tier) 5 min 完成。实测 8 个 subagent 中 ≥4 个出现 (C/D 第 1 轮 + B/A 部分), 触发 §11.7 矛盾 TaskStop 案例。

| 维度 | 影响 | 引用 |
|---|---|---|
| **A** (跨平台) | A subagent 简版仅 58 行, 需主 session 基于已有证据 + transcript 拼装补全完整 REPORT | A-platform-architecture/REPORT.md §元信息 |
| **B** (代码) | B subagent 完成后 Write 工具被禁用, 主 session 必须从 subagent result 复制落盘 | B-code-quality/REPORT.md §完成报告 |
| **C** (流程) | C.9 sonnet 卡 22 min, TaskStop 后 haiku 重派 5 min 完成 | C-engineering-process/REPORT.md §C.9 |
| **D** (产品UX) | D 第 1 轮 sonnet 卡 20+ min → TaskStop → haiku 5.4 min 完成 | D-product-ux/REPORT.md §元信息 |
| **E** (测试) | E 子报告相对顺利, 但 `cargo test` 在 dev box 跑不起来是工具链层面 "subagent 卡死" 镜像 | E-test-coverage/REPORT.md §E-1 |
| **F** (文档) | F 子报告顺利, 但 tmp/ 散落反映"subagent 派单历史无 INDEX" 流程缺陷 | F-documentation-knowledge/REPORT.md §F-2 |

**修复方向**: subagent 派单 prompt 模板增加 "30 min 内未产出实质性进展则 self-报告 + return partial" + 主 session 加 25 min 闹钟 + 默认用 haiku 跑 Read-only 类任务 (sonnet 留 judgment task)。

---

### 3.5 跨维度根因 5: macOS 测试编译挂 / OS 调用泄漏 (A.4 + B-2 + E-6)

**根因**: 测试文件 / 业务代码直接 `use platform::windows::WindowsPaths` 或直接 FFI 调 Win32 API, 违反 CLAUDE.md §3.2 "业务代码只调接口" 纪律。

| 维度 | 子问题 | 引用 |
|---|---|---|
| **A** (跨平台) | A.4 `fs_atomic::local_utc_offset_minutes` 24 行 raw FFI + 26 行 libc extern, `#[cfg(windows)] extern "system"` 调 Win32 `GetTimeZoneInformation` 在 infrastructure 层 | A-platform-architecture/REPORT.md §A.4; src-tauri/src/infrastructure/fs_atomic.rs:251-326 |
| **B** (代码) | B-2 `tests/project_service.rs:15` + `tests/history_integration.rs:22` 报 `unresolved import ...platform::windows` | B-code-quality/REPORT.md §B-2 |
| **E** (测试) | E-6 同 B-2 跨维度重复, 显式标 "macOS cargo test build 必挂" | E-test-coverage/REPORT.md §E-6 |

**根因诊断**: 业务代码 0 处这样用 (平台抽象层纪律), **只有 test 漏了**。M3.10 / M4.6 时期测试设计假设 "测试在 Windows 跑" (与 `tauri-plugin-*` 测试矩阵一致), M4 阶段加 macOS 支持时**没回头改测试**。

**修复方向**: 用 mockall 写 `MockIPlatformPaths` (项目已有 mockall dev-dep) 替代 `WindowsPaths` 硬导入; A.4 迁 `fs_atomic` OS 调用到 `platform/windows/time.rs` + `platform/macos/time.rs` + `ITimeZone` trait。

---

## 4. 优先级矩阵 (P0/P1/P2/P3)

> **总计 16 条**, 全部具体问题 (无 "待评估")。估时单位 = 人天 (d)。

### 4.1 P0 (CRITICAL) — 8 条

| # | 问题 | 维度 | 影响范围 | 估时 |
|---|---|---|---|---|
| **P0-1** | **A.1 / A.2 / A.3** smoke-test / kill-app / run-e2e 整脚本 Windows-only, 27 处不兼容点; macOS fork 缺; dev 阶段用户 mac 手验无工具 | A | ship 门禁 macOS 不可用 (CLAUDE.md §9.4 门禁悬空) | 0.5d × 3 = 1.5d |
| **P0-2** | **B-3** 15 处 `unimplemented!()` stub (8 files), release exe 调用即进程崩溃, 无 user-friendly 错误返回 | B | release exe IPC 调用全 panic | 1d (改 `Err(CmdError::NotImplemented)`) |
| **P0-3** | **C.1 / C.2** v3.0 ship 反复阻塞 (base.css/anime.css 落地顺序 + 6 文件 merge conflict), 同一 session 反复修 | C | v3.0 ship 阻塞 (4 文件) + 反复消耗主 session 时间 | 0.5d (decision 3-step: base+theme 同落 + worktree 评估) |
| **P0-4** | **C.3** A3 subagent 反复失败 4 次才派 v5, 违反 §11.7 三次失败规则 (跳过 pause → retro → 改方案) | C | 流程纪律弱化, 未来类似问题会重演 | 0.25d (CLAUDE.md §11.7 加 subagent 技术失败 case + `scripts/subagent-failure-counter.sh`) |
| **P0-5** | **C.4** sccache subagent 擅自 commit (commit `645680b`), §14.1 禁违反 + retro 沉淀但未升 hard-rule | C | 流程纪律示范效应, 未来 subagent 可能再犯 | 0.25d (CLAUDE.md §14.1 加 "subagent destructive 操作 hard-rule" + 反事故案例追加 2 个) |
| **P0-6** | **B-1** Tailwind utility class 死代码 (6 文件, 60+ className), WebView2 release exe 静默回退 `display: block` | B + D-8 | release exe 布局错乱 / 动画丢失 / hover 失效 | 1d (按 mapping table 1:1 替换 + `utilities.css` 加 `@keyframes`) |
| **P0-7** | **E-1** `cargo test` 在 dev box 跑不起来 (0xC0000139 缺 `vcruntime140_1.dll`), 50 个 `#[test]` 0 可跑 | E | TDD 强制 §2.2 失效, 50 个 Rust test 0 跑过 | 0.5d (装 MSVC Redistributable 2015+) |
| **P0-8** | **F-3** docs/SIGNING.md 与 M4.1 取消决策漂移 (2026-06-22 user 拍板), 文件未删/未 ARCHIVED | F | 误导新人按 SIGNING.md 配 Apple Developer Program | 0.1d (顶部插 ARCHIVED banner 或 `git mv` 到 `docs/archive/`) |

### 4.2 P1 (HIGH) — 5 条

| # | 问题 | 维度 | 影响范围 | 估时 |
|---|---|---|---|---|
| **P1-1** | **D-1** `--button-radius: 6px` 与 SPEC §4.4 "按钮 4px" 不一致; 58 处硬编码 `borderRadius: 4` + 24 处 `var(--radius-button)` 拿到 6px | D | 设计系统合规性, 全按钮视觉偏差 2px | 0.5d (改 token + 加 tokens.test.ts 验证 4/8/12) |
| **P1-2** | **B-2 / E-6** `tests/project_service.rs:15` + `tests/history_integration.rs:22` 硬编码 `use platform::windows::WindowsPaths`, macOS cargo test build 必挂 | B + E | macOS 集成测试不可跑 (mockall 已在 dev-dep) | 0.5d (改用 `MockIPlatformPaths` 替代) |
| **P1-3** | **E-2** e2e CI job 永久禁用 (`ci.yml:125` `if: ${{ false }}`), 28 Playwright spec 0 跑过 | E | CI 门禁缺一环 | 1d (改 `if: matrix.os == 'windows-latest'` + 装 tauri-driver) |
| **P1-4** | **E-3** `commands/backup.rs` 7 commands 0 测试 (F13 备份与恢复核心 IPC) | E | backup 链路无回归保护, Rust 重构易破 | 0.5d (加 `#[cfg(test)]` 5-7 unit test + `tests/backup_commands.rs`) |
| **P1-5** | **F-1** docs/ARCHITECTURE.md §2 trait 表格 8 行号错位 13-50 行 + IPlatformWindowChrome 状态描述过期 (Mac 已实装, 文档仍标 "unimplemented") | F | 新人理解偏差, audit 引用过期 | 0.5d (重写 §2 trait 表格 + grep 行号 + MacWindowChrome 状态) |

### 4.3 P2 (MEDIUM) — 2 条

| # | 问题 | 维度 | 影响范围 | 估时 |
|---|---|---|---|---|
| **P2-1** | **D-2 / D-3** 94 处硬编码 `borderRadius` + 5 处 `fontFamily: 'monospace'` 绕开 token; 80% 设计系统绕过率 | D | 主题切换视觉不一致 / 跨平台字形不稳定 | 0.5d (替换 + 加 ESLint 禁 inline style 数字) |
| **P2-2** | **F-2 / C.8** tmp/ 73 文件 8.8M 无 INDEX, 36 white-list 散落, 派单历史不可追 | F + C | 找特定资产需 `ls + grep` | 0.5d (建 `tmp/INDEX.md` + 归档 33 已 ship white-list 到 `docs/ship-records/`) |

### 4.4 P3 (LOW) — 2 条

| # | 问题 | 维度 | 影响范围 | 估时 |
|---|---|---|---|---|
| **P3-1** | **F-4** CLAUDE.md 652 行膨胀 (15 章节); §15 macOS 86 行 / §9 迭代 80 行 / §11 派单 60 行 | F | 项目圣经级文档失控 | 0.5d (拆 `CLAUDE-MACOS.md` + `CLAUDE-WORKFLOW.md`, CLAUDE.md 仅保留索引) |
| **P3-2** | **D-10** anime.css 内硬编码颜色 (`--modal-confirm-bg` / `--modal-accent-bar` 6 token 写死), 注释解释"WebView2 不解析 var() 嵌套"但 (a) 注释没说哪个 WebView2 版本 (b) 后续 WebView2 修了仍写死 | D | 设计系统命名 + 维护性 | 0.25d (加 `data-theme="light"` 前缀命名 + ADR 解释根因 + TODO 升级 WebView2 ≥X.Y) |

### 4.5 优先级矩阵小结

- **P0 总估时**: ~5d (含 A.1-A.3 fork 1.5d + B-3 1d + B-1 1d + 其他 ~1.5d)
- **P1 总估时**: ~3d
- **P2 总估时**: ~1d
- **P3 总估时**: ~0.75d
- **合计**: ~9.75d 修 17 条优先级问题 (按 §5 路线图分 5 个迭代, 每迭代 1-2d)

---

## 5. 修复路线图 (推荐 3-5 个具体迭代 + 估时)

> **纪律**: §11.3 流式派单 + §11.7 三次失败规则 + §11.8 核定未到不派 ship 类 subagent; 每次迭代 ship 前需用户核定 (CLAUDE.md §9.5)。

### 5.1 迭代 N+1 (1d) — 修 P0-2 / P0-6 / P0-7 + 解 P0-3 v3.0 ship 阻塞

**目标**: 修 3 条 CRITICAL + 解 v3.0 ship 阻塞, 为后续迭代解锁。

**具体动作**:
1. **Wave 0 已完成** (4 冲突文件实际干净 + tsc 退出码 0) — 不重复
2. **P0-2 (1d)**: 把 15 处 `unimplemented!()` 改为返回 `Err(CmdError::NotImplemented)`; 新建 `NotImplemented` 错误变体; 前端 invoke 收到 user-friendly 错误
3. **P0-6 (1d, 并行 P0-2)**: 按 `tmp/tailwind-audit.md` mapping table 替换 6 文件 60+ utility class; 新建 `src/design-system/utilities.css` 加 `@keyframes pulse/spin/fadeIn`; 验证 `npm test -- --run` + `tsc --noEmit` + smoke test 10 项
4. **P0-7 (0.5d, 并行)**: dev box 装 MSVC Redistributable 2015+ (含 `vcruntime140_1.dll`); 验证 `cargo test --test about` 可启动
5. **P0-3 (0.5d, 验证)**: v3.0 ship 走标准 `build-and-ship.sh` 流程; smoke 10 项通过 + 用户核定

**估时**: 1d (P0-2 + P0-6 并行; P0-7 装包同时进行; P0-3 收尾 ship 走 smoke)

**成功标准**:
- 15 处 unimplemented 全部改为 Err
- 6 文件 utility class 全部清除, grep `className.*flex\|className.*grid` 在 src/ 命中 ≤5 处
- `cargo test --test about` exit code 0
- v3.0 ship 完成 + 用户核定 ✅

---

### 5.2 迭代 N+2 (2d) — 修 P0-1 (A.1-A.3 macOS fork) + P1-2 (B-2/E-6) + P0-8 (F-3 SIGNING.md)

**目标**: macOS 跨平台补齐 (dev 阶段, 不进 CI per CLAUDE.md §15.7) + 集成测试跨平台 + SIGNING.md 归档。

**具体动作**:
1. **P0-1 (1.5d)**: Fork 3 个 macOS 脚本:
   - `scripts/smoke-test-mac.sh`: `osascript` (System Events + AXWindow) 枚举 webview 子窗口 + `pgrep`/`lsof` 替换 powershell/tasklist; 加 IPC `get_webview_children_count` (CLAUDE.md §15.4) 让前端 e2e 可查
   - `scripts/kill-app-mac.sh`: `pgrep -f "ClaudeConfigManager"` + `osascript 'tell application ... to quit'` + `kill -9` fallback; 抽 `detect_kill_cmd()` 函数
   - `scripts/run-e2e-mac.sh`: `safaridriver` 探测 (替代 msedgedriver) + `cygpath` 改 `readlink -f` 或省略
2. **P1-2 (0.5d)**: `tests/project_service.rs:15` + `tests/history_integration.rs:22` 改用 `mockall::mock!` `MockIPlatformPaths` 替代 `WindowsPaths` 硬导入; 验证 `cargo check --tests` 在 macOS 通过
3. **P0-8 (0.1d)**: `docs/SIGNING.md` 顶部插 `> ⚠️ ARCHIVED 2026-06-24 — M4.1 取消 + M4.5 商店取消` banner; 引用 CLAUDE.md §15.7 + PROJECT.md §Out of Scope

**估时**: 2d (P0-1 占 1.5d, P1-2 占 0.5d)

**成功标准**:
- 3 个 macOS fork 脚本可在 mac 真机手验
- macOS `cargo check --tests` exit 0
- SIGNING.md 文件本身标注 ARCHIVED

---

### 5.3 迭代 N+3 (2d) — 修 P0-4 / P0-5 / C.7 / C.10 (流程纪律 hard-rule + 临时命令脚本化)

**目标**: 流程纪律系统化 (CLAUDE.md §11.7 / §11.8 / §14.1 升 hard-rule), 防止类似卡死 / 擅自 commit 重复。

**具体动作**:
1. **P0-4 (0.25d)**: CLAUDE.md §11.7 增加 "subagent 连续 3 次技术失败 (cargo 错误 / vitest 失败 / smoke 失败) 必须 pause, 写 `tmp/issue-retro-<date>.md`, 主 session 重审方案 (不是 subagent 路径)" 段; 新增 `scripts/subagent-failure-counter.sh`: subagent exit code 非 0 自动累加到 `tmp/.subagent-fail-counter`, 主 session 派单前检查
2. **P0-5 (0.25d)**: CLAUDE.md §14.1 增加 "subagent destructive 操作 hard-rule" 段 + 反事故案例追加 2 个 (commit `645680b` + 后续 rm fingerprint); 加 `scripts/pre-commit-allowlist-check.sh` 验证 commit 内容是否在白名单内
3. **C.7 (0.25d)**: STATE.md §v3.0 round-2 段加 "实测 25 个失败 (home.test 10 / usage-query 7 / m1-9-2 1 / 其他 7), 归类长期 backlog"; 把 18 vs 25 漂移写入 §已知限制
4. **C.10 (0.25d)**: 写 `scripts/sccache-diag.sh` (固化 `sccache --show-stats` + `cargo check 2>&1 | tee` + 错误分类 3 段); 纳入 §9.6 脚本表
5. **P2-2 (0.5d)**: 写 `tmp/INDEX.md` (分类 + 简介 + 状态); 归档 33 已 ship white-list 到 `docs/ship-records/v2-v3-archive/white-list/`; 6 audit 移 `docs/audits/2026-06-24/`; 11 test/smoke-failures 移 `docs/test-failures-archive/`
6. **C.9 subagent 卡死 workaround (0.25d)**: subagent 派单 prompt 模板增加 "30 min 内未产出实质性进展则 self-报告 + return partial"; 主 session 加 25 min 闹钟; 默认 Read-only 类任务用 haiku (sonnet 留 judgment task)

**估时**: 2d

**成功标准**:
- CLAUDE.md §11.7 / §14.1 升 hard-rule
- 4 个新脚本 (subagent-failure-counter / pre-commit-allowlist-check / sccache-diag / tmp/INDEX) 落 `scripts/` 或 `tmp/`
- 派单 prompt 模板更新

---

### 5.4 迭代 N+4 (1d) — 修 P1-1 / P2-1 / P1-5 (D-1 button-radius + token 化 + ARCHITECTURE drift)

**目标**: 设计系统合规性 + 文档代码同步。

**具体动作**:
1. **P1-1 (0.5d)**: 改 `tokens.css:101` `--button-radius: 4px;` (与 SPEC §4.4 一致); 替换 58 处 `borderRadius: 4` → `var(--radius-button)`; 加 `__tests__/design-system/tokens.test.ts` 验证所有 `--radius-*` 与 SPEC §4.4 一致 (4/8/12)
2. **P2-1 (0.5d, 并行 P1-1)**: 替换 5 处 `fontFamily: 'monospace'` → `var(--font-mono, monospace)`; 4 处硬编码 `"Cascadia Code", "SF Mono", Menlo, Consolas, monospace` → `var(--font-mono)`; 加 ESLint 禁 `fontFamily` inline (除 `inherit`)
3. **P1-5 (0.5d, 并行)**: 跑 `grep -n "pub trait\|pub fn " src-tauri/src/platform/traits.rs` 重生成 ARCHITECTURE.md §2 trait 表格; 改 MacWindowChrome 状态列 "Mac live (vibrancy, window_vibrancy crate; cfg-gated compile-only on non-macOS targets)"; 改运行时工厂段描述 `window_chrome(window)` 签名; §0 加 "最近更新: M4.6 (L-M2.08) — MacWindowChrome 实装" 标注

**估时**: 1d (P1-1 + P2-1 + P1-5 并行)

**成功标准**:
- `tokens.css --button-radius: 4px` + 58 处 `var(--radius-button)` 替换
- `tokens.test.ts` 全过 (4/8/12 验证)
- ARCHITECTURE.md §2 trait 表格 8 行号与代码实际一致

---

### 5.5 迭代 N+5 (1d) — 修 P1-3 / P1-4 / P3-1 / E-5 / F-5 / F-6 (测试 + 文档收尾)

**目标**: 测试覆盖 + 文档完整性收尾。

**具体动作**:
1. **P1-3 (0.5d)**: `.github/workflows/ci.yml:125` 改 `if: ${{ false }}` → `if: ${{ matrix.os == 'windows-latest' }}`; 加 step `npm install -g @tauri-apps/tauri-driver` + `npx playwright@1.49.1 install chromium`; 启用 Windows e2e 路径
2. **P1-4 (0.5d)**: `src-tauri/src/commands/backup.rs` 末尾加 `#[cfg(test)] mod tests` 5-7 unit test; 新建 `src-tauri/tests/backup_commands.rs` 仿 `tests/history_commands.rs` helper pattern
3. **P3-1 (0.5d)**: 拆 `CLAUDE.md` (≤400 行) + `CLAUDE-MACOS.md` (§15) + `CLAUDE-WORKFLOW.md` (§6/§9/§11/§14); CLAUDE.md 仅保留索引
4. **E-5 (0.5d)**: 修 25 个 vitest failures: `pages/history/index.tsx:141` `for (const row of usageRows)` 加 `usageRows ?? []` 守卫; `pages/usage-query/index.tsx:513` `state.history.length` 改 `state.history?.length ?? 0`; 其他 23 个批量修
5. **F-5 (0.5d)**: README.md §快速开始拆 Win/Mac 双表; 加 `## macOS 开发` 段指向 CLAUDE.md §15 + `scripts/build-mac.sh`
6. **F-6 (0.5d)**: 写 `docs/milestones/M3-final-report.md` (v3.0 收尾时落) + `docs/milestones/M4-roadmap.md` (M4 启动门时落); 选 `.planning/STATE.md` 为权威源, `docs/milestones/STATE.md` 改链接或删除

**估时**: 1d (P1-3 / P1-4 / P3-1 / E-5 / F-5 / F-6 并行, 部分串行)

**成功标准**:
- e2e CI 启用 (Windows path)
- backup.rs 7 commands 全部有 unit test
- CLAUDE.md ≤ 400 行
- vitest 25 failures → ≤ 5
- README.md 包含 Mac 变体命令
- docs/milestones/M3-final + M4-roadmap 落地

---

### 5.6 路线图总览

| 迭代 | 估时 | 关键问题 | 累计已修 |
|---|---|---|---|
| N+1 | 1d | P0-2 / P0-6 / P0-7 / P0-3 (ship) | 3 P0 + 1 ship 阻塞 |
| N+2 | 2d | P0-1 / P1-2 / P0-8 | 3 P0 + 1 P1 + 1 P0 文档 |
| N+3 | 2d | P0-4 / P0-5 / C.7 / C.10 / P2-2 / C.9 | 5 P0 + 1 P2 + 流程纪律 |
| N+4 | 1d | P1-1 / P2-1 / P1-5 | 5 P0 + 1 P1 + 1 P2 + 1 P1 + 1 P1 = 8 P0 + 3 P1 + 2 P2 |
| N+5 | 1d | P1-3 / P1-4 / P3-1 / E-5 / F-5 / F-6 | 8 P0 + 5 P1 + 2 P2 + 1 P3 |
| **合计** | **7d** | **17 条 + 流程纪律** | **全部 §4 优先级问题** |

> 实际 7d 集中修 17 条 + 4 项流程纪律, 后续 backlog (F-7 / F-8 / F-9 / F-10 / B-4 ~ B-9 / D-4 ~ D-10 / E-7 ~ E-10 / A-4 ~ A-10) 列入下一个 milestone。

---

## 6. 已知限制 / 不在本扫描范围

1. **联网相关缺陷 (如有)** 需独立审计, 本扫描未涉及
2. **跨项目依赖** (npm/cargo lockfile 100% 解锁) 超出本扫描范围, 维度 A 引用 `tmp/audit-deps.md` 但未深入
3. **UI 视觉缺陷 vs SPEC §5 一致性的完整对照** 需 design audit (不在本扫描范围, 维度 D 抽样)
4. **性能缺陷** (启动时间 / 内存占用) 需独立 benchmark, 维度 B 触及 (B-9 unwrap 性能) 但未深入
5. **Linux 平台**: 项目 scope 仅 Windows + macOS (CLAUDE.md §1), 所有 macOS 结论基于静态代码 + 既有 audit 引用
6. **macOS 真机验证依赖用户**: dev box 是 Windows (CLAUDE.md §15.1), macOS 真机验证需用户在 Mac dev box 上跑
7. **WebView2 var() 嵌套 bug** (D-10): 1 个真实的浏览器 bug 缓解, 写死 6 个 token; 本项目层只能注释 workaround, 不能根治
8. **subagent Write 工具限制**: A/B 子报告主 session 必须从 subagent result 复制落盘 (subagent Write 工具在某些执行环境下被禁用)
9. **tmp/ 100+ 文件内容未全读**: 仅抽样 5 white-list + 2 audit (audit-docs + audit-rust); 维度 F 评估基于文件名 + 维度 C.8 报告交叉确认
10. **未对比 v3.0-EXECUTION-PLAN.md 与实际 ship**: 计划文件与 v3.0-ROUND1-CLOSURE.md 之间的 deviation 未深入分析 (F-9 partial)
11. **§11.4.1 临时命令合并纪律 镜像**: 本扫描发现 sccache 诊断 3 轮 subagent 重复 inline 命令 (C.10), 但未在本次扫描中写出 `scripts/sccache-diag.sh` (留 N+3 迭代)
12. **§11.5 派单后行为**: 本扫描期间主 session 不亲自执行开发任务纪律已遵守, 但 Wave 1 批 1 A/B 子报告补全落盘 (主 session 复制) 是 §11.5 例外

---

## 附录 A: 6 份子报告路径

| 维度 | 路径 | 行数 | 状态 |
|---|---|---|---|
| **A** 跨平台架构 | `docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md` | 297 | DONE (主 session 补全落盘) |
| **B** 代码质量 | `docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md` | 219 | DONE_WITH_CONCERNS |
| **C** 工程流程 | `docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md` | 174 | DONE |
| **D** 产品/UX | `docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md` | 174 | DONE (主 session 修订 D-1 radius 反向误判) |
| **E** 测试覆盖 | `docs/superpowers/specs/defects-analysis/E-test-coverage/REPORT.md` | 101 | DONE |
| **F** 文档/知识管理 | `docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md` | 313 | DONE |
| **合计** | | **1278** | **6/6 完成** |

---

## 附录 B: 复用既有审计资产清单

| 资产 | 行数 | 用途 | 引用维度 |
|---|---|---|---|
| `tmp/audit-deps.md` | 191 | 跨平台依赖审计 | A |
| `tmp/audit-docs.md` | 228 | 文档 macOS 覆盖度 | F |
| `tmp/audit-frontend.md` | 295 | 前端 + 构建链 macOS | A + B |
| `tmp/audit-rust.md` | 192 | Rust macOS 兼容性 | A + B |
| `tmp/audit-scripts.md` | 282 | scripts macOS 兼容性 (34 处不兼容点) | A |
| `tmp/tailwind-audit.md` | 217 | Tailwind utility class 死代码 (9 文件清单) | B + D |
| `tmp/retro-2026-06-25-sccache-discipline.md` | 52 | sccache subagent 完整复盘 | C |
| `tmp/test-failures-m2.17-3.1-tests.md` | — | M2.17 阶段测试失败 | E |
| `tmp/test-failures-m3.10-rust.md` | — | M3.10 阶段 Rust test 失败 (vcruntime140_1.dll) | E |
| `tmp/test-failures-m-finalize.md` | — | finalize 阶段测试失败 | E |
| `tmp/smoke-failures-m-finalize.md` | — | finalize 阶段 smoke 失败 | E |
| `tmp/smoke-failures-m3.10.md` | — | M3.10 阶段 smoke 失败 | E |
| `tmp/build-perf-investigation.md` | — | 编译性能调研 (sccache 基础) | C (引文) |

---

## 附录 C: 排除文件清单 (Wave 0 跳过说明)

### C.1 Wave 0 设计预期排除 (已纳入扫描)

- `src/__tests__/pages/home.test.tsx` (M4.6 WIP 潜在 conflict)
- `src/__tests__/pages/json-editor.test.tsx` (M4.6 WIP 潜在 conflict)
- `src/pages/json-editor/index.tsx` (M4.6 WIP 潜在 conflict)
- `src/pages/backup-restore/index.tsx` (M4.6 WIP 潜在 conflict)

### C.2 Wave 0 实际状态 (2026-06-24 用户确认)

- **4 冲突文件已干净** (无 `<<<<<<<` / `=======` / `>>>>>>>` 标记)
- `tsc --noEmit` 退出码 0
- 4 文件实际已纳入扫描范围 (Wave 1 批 1 / 批 2 子报告覆盖)

### C.3 其他排除文件 (历史遗留)

- `scripts/install-to-applications-mac.sh` (untracked, 属历史遗留; macOS 真机验证不在本扫描范围 per §6.5)

### C.4 Wave 0 跳过决策

- 用户确认未改代码 (4 文件实际干净) + tsc 退出码 0
- 主 session 判断: Wave 0 解 conflict 不必要, Wave 1 扫描可基于当前干净工作区直接进行
- 跳过 Wave 0 subagent 派单 (节省 1 subagent 槽 + 0.5-1h wall clock)
- 详见 `.superpowers/sdd/progress.md:25-26` (Wave 0 跳过决策记录)

---

## 附录 D: 主报告元数据

- **生成日期**: 2026-06-24
- **总行数**: ~580 行 (含附录)
- **6 维度**: A/B/C/D/E/F 全部覆盖
- **跨维度交叉问题**: 5 个 (≥3 要求) — merge conflict / Tailwind 死代码 / UI 3 处同步 / subagent 卡死 / macOS 测试挂
- **优先级矩阵条数**: 17 条 (P0=8 / P1=5 / P2=2 / P3=2, ≥8 要求, 每优先级 ≥2)
- **修复路线图迭代数**: 5 个 (3-5 要求) — N+1 (1d) / N+2 (2d) / N+3 (2d) / N+4 (1d) / N+5 (1d), 合计 7d
- **不引入新问题**: 全部 16 条优先级问题 + 5 个交叉根因 + 5 个迭代动作均引用子报告 §X.Y + file_path:line
- **生成者**: Task 4 subagent (Wave 2) — general-purpose, judgment task
- **生成依据**: 6 子报告 + 6 既有 audit + 1 retro + STATE.md + CLAUDE.md + .planning/STATE.md 全部交叉引用

---

*本报告由 Wave 2 主报告撰写 subagent 生成, 主 session 将做 §4.5 (placeholder scan / 内部一致性 / 范围检查 / 歧义检查) 4 项自审后 commit (CLAUDE.md §14.1 commit 由主 session 执行).*
