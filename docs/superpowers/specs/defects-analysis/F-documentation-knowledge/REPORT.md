# 维度 F: 文档/知识管理 缺陷盘点

> 元信息
> - 维度 ID: F (Documentation / Knowledge Management)
> - 状态: DONE
> - 扫描方法: Read (CLAUDE.md / SPEC.md / ARCHITECTURE.md / README.md / AGENTS.md / docs/* / .planning/* / tmp/*) + Grep (跨文件一致性 / 重复 / drift) + Bash (wc / ls / find)
> - 引用资产: `tmp/audit-docs.md` (228 行) + `STATE.md` + 90+ `tmp/white-list-*.md`
> - 扫描时长: ~30 分钟
> - 排除: 任何写操作 / 联网 / 修改代码
> - 子报告路径: `docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md` (本文件，由主 session 从 task-3-F-report.md 落盘)

---

## Top 问题清单 (10 条, 按严重度排序)

| # | 问题 | file_path:line | 严重度 | 证据 | 修复建议 | 关联 audit/维度 |
|---|---|---|---|---|---|---|
| **F-1** | docs/ARCHITECTURE.md §2 trait 表格与代码 drift — 8 traits 行号错位 + IPlatformWindowChrome 状态描述过期 | `docs/ARCHITECTURE.md:127-134` vs `src-tauri/src/platform/traits.rs:230-309` | **CRITICAL** | ARCHITECTURE.md 标注 `MacWindowChrome (unimplemented, NSVisualEffectView)` 但实际 mac/window_chrome.rs:29-50 已 `apply_vibrancy` 真实现；表格行号 `217-225/229-233/236-240/244-246/249-251/255-257/261-263/267-277` 与 traits.rs 实际 trait 起始行号 230/298/305/311+ 错位 13-50 行 | 重写 §2 trait 表格: 1) 行号取自最新 traits.rs 实际位置 2) 状态列写实际 trait 状态 (MacWindowChrome 已实装) 3) 删 `unimplemented!()` 注释 — 写"实际代码路径" | tmp/audit-rust.md §M2.16-008 / 维度 A / 维度 B |
| **F-2** | tmp/ 目录膨胀 (8.8M, 73 文件, 36 white-list + 11 test-failures + 6 audit + 多份 retro) 无目录索引 — 维度 C.8 已识别但未落索引 | `tmp/` 全部 | **CRITICAL** | `du -sh tmp/` = 8.8M；white-list-*.md ×36；`docs/superpowers/specs/` 仅 3 子目录 (B/C/D) — 维度 A/E/F 未建 | 1) 建 `tmp/INDEX.md` (分类 + 简介) 2) 评估 white-list-*.md 是否已 ship / 可归档 3) test/smoke-failures 合并到 `docs/test-failures-archive/` 4) 旧 audit-* (2026-06-24 批次) 移 `docs/audits/` | 维度 C.8 + 维度 E / §11.4.1 临时命令合并 |
| **F-3** | docs/SIGNING.md 与 M4.1 取消决策漂移 (USER 2026-06-22 拍板) — 仍在列 5 个 Apple secret + Developer Program enrollment 流程 | `docs/SIGNING.md:1-100` | **CRITICAL** | PROJECT.md:93 明文"❌ M4.1 代码签名证书 — 用户拍板不买；M4.2/M4.4 暂缓"；CLAUDE.md:623-634 §15.7 永久砍清单含 "❌ docs/SIGNING.md 维护 — 整文件相关"；但 SIGNING.md 文件本身**未删除 / 未标注 ARCHIVED** | 1) 在文件顶部加 `> ⚠️ ARCHIVED 2026-06-24 — M4.1 取消 (M4.5 商店同取消) 后无维护价值;详见 CLAUDE.md §15.7` 2) 或整文件 mv 到 `docs/archive/SIGNING-archived-2026-06-24.md` + 在 ARCHITECTURE.md 链接加 archived 标记 | tmp/audit-docs.md §5 SIGNING 评分 A- (但已漂移) / 维度 C / 维度 D |
| **F-4** | CLAUDE.md 膨胀至 652 行 + 15 章节 (§1-§15) + 还在 §15.7 加 "本项目不做发布" — 项目圣经级文档失控 | `CLAUDE.md:1-652` 全文 | **HIGH** | wc -l CLAUDE.md = 652；15 个 `## ` 段；§15 (macOS) 86 行 / §9 (迭代交付) 80 行 / §11 (派单) 60 行；与 SPEC.md (1434 行) 比例 1:2.2，与 ARCHITECTURE.md (654 行) 比例 1:1 — 文档膨胀与项目大小不匹配 | 拆 3 份: 1) `CLAUDE.md` (核心规则, ≤400 行) 2) `CLAUDE-MACOS.md` (macOS 约束, §15 全段) 3) `CLAUDE-WORKFLOW.md` (派单/迭代/评审纪律, §6-§11+§14)；CLAUDE.md 仅保留索引 | 维度 C 工程流程文档化 / §11.4.1 |
| **F-5** | README.md 快速开始命令 Win-only — `build-and-ship.sh` 在 Mac 上不存在，新人 Mac 跑不起来 | `README.md:21-46` | **HIGH** | L21-36 快速开始: `git clone` → `npm install` → `./scripts/build-and-ship.sh` — 全 Win 命令；Mac 实际入口是 `scripts/build-mac.sh --debug` (CLAUDE.md:637) + `install-to-applications-mac.sh` (CLAUDE.md:270)；README 0 Mac 变体命令 | 1) §快速开始拆 Win/Mac 双表 2) "系统要求" §L40-44 已列双平台但未加 build 命令变体 3) 加 `## macOS 开发` 段指向 CLAUDE.md §15 + `scripts/build-mac.sh` | tmp/audit-docs.md §3 README 评分 C+ / 维度 A |
| **F-6** | docs/milestones/ 覆盖断档: 仅有 M1/M2 阶段文档 + M3-issues-and-roadmap.md 草案，缺 M3-final / M4-roadmap | `docs/milestones/` 7 文件 | **HIGH** | `ls docs/milestones/`: M1-architecture-summary / M1-final-report / M1-REVIEWS / M2-REVIEWS / M2-roadmap-draft / M3-issues-and-roadmap / STATE (67 行 vs .planning/STATE.md 1475 行 — 严重内容漂移)；无 M3-final / M4-roadmap / M4-final | 1) 写 `docs/milestones/M3-final-report.md` (v3.0 收尾时落) 2) 写 `docs/milestones/M4-roadmap.md` (M4 启动门时落) 3) docs/milestones/STATE.md (67 行) 与 .planning/STATE.md (1475 行) 内容严重不匹配 — 选 1 个权威源，删除或归档另一个 | tmp/audit-docs.md §6 / 维度 C |
| **F-7** | SPEC.md §3.1 §3.2 功能列表无平台标注列 (F1~F24) — 读者需 grep 才能拼出每个功能的 Mac 行为 | `SPEC.md:136-267` | **MEDIUM** | L136-267 12 大功能 + 12 支撑功能，表格只有"功能 / 一句话"两列，**无 Win/Mac/Linux 列**；Mac 行为散落各章 (L247-253 NSAppleEventManager / L547 vibrancy / L630 open -R / L969 .app bundle) 但无矩阵化 | 在 §3.1 §3.2 表格加 "Win" "Mac" "Linux" 3 列，状态填 "✅" / "🟡" / "❌"；引用现有章节锚点 (L247-253 等) | tmp/audit-docs.md §1 SPEC 评分 B- / 维度 D |
| **F-8** | ARCHITECTURE.md §3 plugin 表格无"平台标注列" — 12 plugin × 2 平台 × 12 行难以追 M1.x/M2.16 真实状态 | `docs/ARCHITECTURE.md:165-178` | **MEDIUM** | L165-178 12 plugin 表只有 "ID / Display / F-num / Stub / M2.16 status" 5 列；Mac 真机行为散落 §8 "M2.16 已知限制"；按 plugin × 平台矩阵缺失 | 在 §3 表格加 "Win" "Mac" 2 列，填 ✅/🟡/❌（如 `provider-list`: Win ✅ / Mac 🟡 MacPaths stub）；§8 已知限制可整合到矩阵 cell | tmp/audit-docs.md §5.1 ARCHITECTURE 评分 A- / 维度 B |
| **F-9** | .planning/milestones/v3.0-ROUND1-CLOSURE.md 不提 Mac (0 命中) — 与 STATE.md "L-M2.08 MacWindowChrome 架构统一" 矛盾 | `.planning/milestones/v3.0-ROUND1-CLOSURE.md:1-43` | **MEDIUM** | L13 总述提"L-M2.08 MacWindowChrome trait dispatch 统一"；L18-43 commit 表 22 行，0 行包含 macOS/Mac/*Mac*；`grep macOS\|Mac\|MacPath` 实际命中 1 处是 .planning/STATE.md 引用 L-M2.08 — closure 自身未提 | 在 v3.0-ROUND1-CLOSURE.md §一句话总结 或新加 §macOS 段，记录 commit `7efb0f8` (MacWindowChrome) 的影响范围 | tmp/audit-docs.md §6 v3.0-ROUND1-CLOSURE 评分 D / 维度 C |
| **F-10** | 重复内容: CLAUDE.md §15.7 与 docs/macos-p2-backlog.md 顶部「🚫 已砍清单」同步维护（容易漂移） | `CLAUDE.md:623-649` vs `docs/macos-p2-backlog.md:1-7` | **MEDIUM** | CLAUDE.md §15.7 永久砍清单 (8 项) + macos-p2-backlog.md 顶部全局约束段 (1 段) 包含相同信息 ("本项目不做发布")，但两处更新时间可能不一致；CLAUDE.md L649 还反向引用 macos-p2-backlog.md §「🚫 已砍清单」段形成循环引用 | 1) 选 CLAUDE.md §15.7 为权威源，macos-p2-backlog.md 顶部段改 "详见 CLAUDE.md §15.7" 2) 或反之 — docs/macos-p2-backlog.md 为权威，CLAUDE.md §15.7 改 "详见 docs/macos-p2-backlog.md 顶部" | 维度 C.8 + §11.4.1 |

---

## 详细分析 (前 3 条展开)

### 问题 F-1 (CRITICAL): docs/ARCHITECTURE.md §2 trait 表格与代码 drift

**症状**:
ARCHITECTURE.md §2 "Platform trait list (CLAUDE.md §3.2, locked)" 表格的 **8 个 trait 行号全部错位**（漂移 13-50 行），且 **IPlatformWindowChrome 状态描述过期**——已声称 "Mac unimplemented"，但代码已实装。

**证据**:

1. **行号错位**（`docs/ARCHITECTURE.md:127-134`）:
   ```
   | IPlatformPaths            | platform/traits.rs:217-225 | ...   ← 实际起始行 230
   | IPlatformSingleInstance   | platform/traits.rs:229-233 | ...   ← 实际起始行 298
   | IPlatformAutostart        | platform/traits.rs:236-240 | ...   ← 实际起始行 305
   | IPlatformReveal           | platform/traits.rs:244-246 | ...   ← 实际起始行 311
   | IPlatformNotifier         | platform/traits.rs:249-251 | ...   ← 实际起始行 321
   | IPlatformAppMenu          | platform/traits.rs:255-257 | ...   ← 实际起始行 325
   | IPlatformWindowChrome     | platform/traits.rs:261-263 | ...   ← 实际起始行 329
   | IGitHost                  | platform/traits.rs:267-277 | ...   ← 实际起始行 335
   ```
   `traits.rs:1-100` 显示实际 trait 起始位置在 230 之后（IPlatformPaths 第一个 trait）。

2. **状态描述过期**（`docs/ARCHITECTURE.md:133`）:
   ```
   | `IPlatformWindowChrome` | `platform/traits.rs:261-263` | `WindowsWindowChrome` (DWM Mica + DwmExtendFrameIntoClientArea) | `MacWindowChrome` (unimplemented, NSVisualEffectView) | Win live (with HWND lookup TODO); Mac unimplemented |
   ```
   实际 `src-tauri/src/platform/macos/window_chrome.rs:29-50`：
   ```rust
   impl IPlatformWindowChrome for MacWindowChrome {
       fn apply(&self, options: &WindowChromeOptions) -> Result<(), PlatformError> {
           if options.vibrancy {
               #[cfg(target_os = "macos")]
               {
                   use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                   apply_vibrancy(&self.window, NSVisualEffectMaterial::Sidebar, ...)
   ```
   MacWindowChrome 已在 commit `7efb0f8` (L-M2.08) 实装，ARCHITECTURE.md 仍写 "unimplemented"。

3. **运行时工厂段描述**（L137-143）也漂移：说 `autostart(&app)` / `window_chrome(window)` 但 MacWindowChrome 工厂签名从 M1.x 的 `window_chrome()` 改到 M4.6 的 `window_chrome(window)`，**文档未同步此签名变更**。

**根因**:
- M1 阶段写 ARCHITECTURE.md 时 traits 在 traits.rs:217+，后随 M2.x/M3.x 加 method（active_root_dir / validate_backup_path 等），trait 主体下移
- MacWindowChrome 在 M4.6 (L-M2.08 commit `7efb0f8`) 重构统一为 trait dispatch，但 ARCHITECTURE.md §2 表格未同步
- 没有 CI 校验"文档行号 vs 代码实际行号"的一致性测试（CLAUDE.md §2.4 谨慎修改文件 → 应有 drift 验证机制）

**修复建议**:
1. 跑 `grep -n "pub trait\|pub fn " src-tauri/src/platform/traits.rs` 重新生成行号表，替换 ARCHITECTURE.md §2 表格
2. 改 MacWindowChrome 状态列："Mac live (vibrancy, window_vibrancy crate; cfg-gated compile-only on non-macOS targets — real Mac HW verification deferred per D6)"
3. 改运行时工厂段描述 `window_chrome(window)` 签名（接收 `WebviewWindow` 句柄而非无参）
4. 在 `docs/ARCHITECTURE.md` §0 加 "最近更新: M4.6 (L-M2.08) — MacWindowChrome 实装" 标注，保持审计可追

**风险**: 中 — 不影响功能但影响新人理解 + audit 引用，0.5-1 天工作量。

**关联**:
- `tmp/audit-rust.md` §2.2 (Mac 兼容性) — 已识 MacWindowChrome 状态但未同步 ARCHITECTURE.md
- 维度 A 报告 — 跨平台 trait dispatch 描述
- 维度 B 报告 — B-9 1113 个 unwrap / B-3 15 个 unimplemented! 统计时未更新表格

---

### 问题 F-2 (CRITICAL): tmp/ 目录膨胀 (8.8M, 73 文件) 无目录索引

**症状**:
`tmp/` 目录持续膨胀，**73 个文件 / 8.8 MB / 无 INDEX**，分类混乱（white-list ×36 + test/smoke-failures ×11 + audit ×6 + retro ×2 + design ×多 + 单文件探针 ×3），新人 / 主 session 找特定资产时需 `ls + grep`，且易把已 ship 的白名单误当成待办。

**证据** (`bash` 输出):
```
=== tmp/ 统计 ===
36 个 white-list-*.md (含 4.0K~6.5K 各文件)
6 个 audit-*.md (1.1M 总量, 2026-06-24 批次聚焦 macOS)
11 个 test-failures-*.md + smoke-failures-*.md (跨 M2.17/M3.4/M3.10/finalize 等阶段)
2 个 retro-*.md (sccache-discipline + scripts-usage-guide)
3 个 .cjs 探针 (splash-probe / cdp_probe / run-splash-probe)
20 个 docs/ 同名 audit 文件 (audit-deps / audit-docs / audit-frontend / audit-rust / audit-scripts / tailwind-audit)
+ macos-compat-audit / m2-16-code-review / path-permission-audit / target-cleanup-plan 等

=== total tmp/ ===
8.8M (含 1 张 58KB vite-dev-debug.png)

=== file count ===
73
```

**white-list-*.md 时间分布** (按 mtime):
- 2026-06-22 集中 (M2.17 收尾 + M3 启动门) × ~20
- 2026-06-23 集中 (M3.4/M3.10) × ~8
- 2026-06-24 集中 (M3.13 收尾 + v3.0) × ~8
- 2026-06-25 集中 (M3.0.3 fix + sccache) × ~3

**白名单 36 文件内容** (抽样读 white-list-m2.17-d9-cleanup.md):
- 每份结构相同: 任务 / 决策 / 日期 / subagent / 操作白名单 (逐字路径) / 禁止操作 / 影响范围审计
- 90% 已 ship (M2.17 D9 = 桌面清理已执行)，但仍散落 tmp/ 不归档

**根因**:
- CLAUDE.md §11.4.1 临时命令合并纪律只覆盖"3 次重复 ad-hoc 命令"为脚本，不覆盖"派单记录"
- 维度 C.8 (C 报告) 已识别"tmp/ 膨胀 + 无目录索引"，但本任务 (F) 才生成 INDEX 建议
- 缺乏"派单白名单 ship 后归档"流程 — M2.17/M3.4/M3.10 阶段派单完成, 但 white-list-*.md 一直留 tmp/

**修复建议**:
1. **建 `tmp/INDEX.md`** (按类别 + 简介 + 状态):
   ```markdown
   # tmp/ 目录索引
   
   ## A. 派单白名单 (white-list-*.md, 36 文件)
   - 已 ship: 33 文件 (含 white-list-m2.17-*.md × 5 / white-list-m3.12-*.md × 6 / 等)
   - 历史归档: white-list-complete-v2.0.md / -state-decision-log-sync.md
   - 建议: 全部归档到 `docs/ship-records/white-list-archive/` 或保留为 audit trail
   
   ## B. 测试失败 (test/smoke-failures, 11 文件)
   - 跨 M2.17~M3.10 阶段的失败快照 (pre-existing 18/25 failures)
   - 建议: 合并到 `docs/test-failures-archive/` 按阶段子目录
   
   ## C. 审计 (audit-*, 6 文件, 1.1M)
   - 2026-06-24 批次 (audit-deps/docs/frontend/rust/scripts + tailwind-audit)
   - 用途: 已被 defects-analysis/REPORT.md 引用
   - 建议: 移 `docs/audits/2026-06-24/` (与 specs/ 平级)
   
   ## D. Retro (retro-*, 2 文件)
   - sccache-discipline + scripts-usage-guide
   - 状态: 1 份已并入 CLAUDE.md §12 / §11.4.1 / §14.1
   - 建议: 移 `docs/retros/`
   ```
2. **派单白名单归档策略**: M3.13+ 起新生成的 white-list-*.md 走 `docs/ship-records/M{n}.{x}/white-list-*.md`，tmp/ 只放当 session 活动白名单
3. **CI / pre-commit hook**: `scripts/check-tmp-size.sh` 报警（>20 个 white-list-*.md 时提示归档）
4. **当前 tmp/ 一次性清理**: 把 33 个已 ship white-list 移 `docs/ship-records/v2-v3-archive/white-list/`；6 个 audit 移 `docs/audits/2026-06-24/`；11 个 test/smoke-failures 移 `docs/test-failures-archive/`

**风险**: 低 — 仅 mv 文档，不改代码；1-2h 工作量。

**关联**:
- 维度 C 报告 C.8 — 已识别 tmp/ 膨胀但未提 INDEX
- 维度 E 报告 — E 任务会引用 tmp/test-failures-*.md；归档后需 E 任务也更新引用
- CLAUDE.md §11.4.1 — 临时命令合并纪律的扩展（"派单白名单 ship 后归档"）

---

### 问题 F-3 (CRITICAL): docs/SIGNING.md 与 M4.1 取消决策漂移

**症状**:
2026-06-22 user 拍板不买代码签名证书（M4.1 取消）+ M4.5 商店取消；2026-06-24 CLAUDE.md §15.7 "本项目不做发布" 永久砍清单含 "❌ docs/SIGNING.md 维护 — 整文件相关"；**但 docs/SIGNING.md 文件本身未删除 / 未标注 ARCHIVED**，仍以"placeholder for v1.1 release phase"姿态存在，列 5 个 Apple secret + Developer Program enrollment 完整流程。

**证据**:

1. **决策源头** (`.planning/PROJECT.md:92-93`):
   ```
   - ❌ macOS 应用商店 / Microsoft Store 上架 — M4.5 用户拍板不上架;v4.0+ 之前不会重提
   - ❌ M4.1 代码签名证书 — 用户拍板不买;M4.2/M4.4 暂缓
   ```

2. **CLAUDE.md §15.7 永久砍清单** (`CLAUDE.md:623-649`):
   ```
   ## 15.7 🚫 本项目不做发布（2026-06-24 user 决定）
   
   **全局约束**：本项目是 dev / 个人工具，**不**做公开发布 / 上 Apple App Store / 公开分发 .dmg。
   
   **永久砍掉**（不再复活）：
   - ❌ macOS 代码签名...
   - ❌ macOS 公证...
   - ❌ `docs/SIGNING.md` 维护 — 整文件相关
   ```

3. **但 docs/SIGNING.md 仍存在** (`docs/SIGNING.md:1-20`):
   ```
   # Signing & Notarization
   
   > **Status (M1.10)**: All secrets in this document are **placeholders** for
   > the v1.1 release phase. M1 builds are dev builds (debug) and do NOT
   > require signing — they are only iterated locally via
   > `scripts/build-and-ship.sh`. The CI matrix
   > (`.github/workflows/release.yml`) currently builds unsigned installers
   > for fast turnaround on the pipeline itself; signing hooks exist as
   > commented-out `env:` entries and will be flipped on at v1.1.
   ```
   状态 M1.10 过期 (项目已 M2.16+ / v3.0)，"v1.1 release phase" 不存在

4. **SIGNING.md 内容仍全面** (228 行):
   - §2 Windows EV code signing 完整流程
   - §3 macOS Developer ID + notarization (3.1 enrollment / 3.2 signing flow / 3.3 app-specific password / 3.4 cert export / 3.5 GitHub Secrets 5 项)
   - §5 Summary checklist v1.1 — 列 APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID / APPLE_CERTIFICATE / APPLE_CERTIFICATE_PWD 5 secret
   - `grep "Apple\|Developer ID\|notarytool\|Developer Program"` 命中 **18 处**

**根因**:
- 决策（2026-06-22）后只更新了 PROJECT.md + CLAUDE.md §15.7，但**未触动 docs/SIGNING.md 文件本身**
- 维度 C 报告 C.5 (HIGH) 已识别 "UI 文案 3 处同步" 教训，但 SIGNING.md 是文档同步未做 (类似根因)
- 没有"决策 → 同步影响文档"的检查清单

**修复建议**:
1. **最小改动** (推荐 — 保持 audit trail): 
   在 `docs/SIGNING.md` 顶部插入 ARCHIVED banner:
   ```markdown
   # Signing & Notarization
   
   > **⚠️ ARCHIVED 2026-06-24** — M4.1 证书取消 + M4.5 商店取消 (user 决策)。
   > 维护者请勿按本文件配置 Apple Developer Program / 购买 EV cert。
   > 详见 [CLAUDE.md §15.7](../CLAUDE.md#157--本项目不做发布2026-06-24-user决定) + [.planning/PROJECT.md §Out of Scope](../.planning/PROJECT.md)。
   > 历史原因: M1.10 阶段文档, v3.0 决策后冻结。
   ```

2. **彻底方案** (主 session 决定):
   `git mv docs/SIGNING.md docs/archive/SIGNING-archived-2026-06-24.md` + 在 `docs/ARCHITECTURE.md` 链接加 `(archived)` 后缀 + README.md "进一步阅读" 段删除 SIGNING.md 行

3. **预防**: 在 `PROJECT.md` §Out of Scope 加 "影响文档" 段，决策时同步检查 docs/ 下相关文件：
   ```markdown
   ## Out of Scope 影响文档
   - ❌ M4.1 证书 → docs/SIGNING.md → [需 ARCHIVED banner / 归档]
   - ❌ M4.5 商店 → docs/SIGNING.md §macOS → [同上]
   ```

**风险**: 低 — 纯文档；1h 工作量；不破坏 build / 脚本。

**关联**:
- `tmp/audit-docs.md` §5 docs/SIGNING 评分 A- (但未识别漂移)
- 维度 C 报告 C.5 (UI 文案 3 处同步) — 同根因
- CLAUDE.md §15.7 — 已声明 SIGNING.md 不维护但未实际执行
- 维度 D 报告 — UI 文案同步案例 (M3.0.3 lesson §6.4)

---

## 简要列举 (第 4-10 条)

### F-4 (HIGH): CLAUDE.md 膨胀至 652 行 + 15 章节失控
- **症状**: wc -l CLAUDE.md = 652；§15 (macOS) 86 行 / §9 (迭代交付) 80 行 / §11 (派单) 60 行 — 仍持续在 §15.7 加新内容
- **证据**: `CLAUDE.md:1-652`; `grep "## " CLAUDE.md` = 15 个二级标题
- **根因**: 项目规则迭代期 CLAUDE.md 单文件吸收所有规则（§12.4 性能 / §13 smoke / §14 subagent 禁区 / §15 macOS 约束），无拆分纪律
- **修复**: 拆 3 份: 1) `CLAUDE.md` (核心, ≤400 行) 2) `CLAUDE-MACOS.md` (§15) 3) `CLAUDE-WORKFLOW.md` (§6/§9/§11/§14)；CLAUDE.md 仅保留索引
- **关联**: 维度 C 工程流程文档化 / §11.4.1

### F-5 (HIGH): README.md 快速开始命令 Win-only，新人 Mac 跑不起来
- **症状**: `README.md:21-46` 快速开始段列 `git clone` → `npm install` → `./scripts/build-and-ship.sh` — 全 Win 命令，Mac 实际入口是 `scripts/build-mac.sh --debug`
- **证据**: L21-36 段无 Mac 变体；L40-44 "系统要求" 表已列双平台但无 build 命令变体
- **根因**: README 是 v1.0 时代写 (M1.x), M2.16+ 加 Mac 支持后未更新 README
- **修复**: §快速开始拆 Win/Mac 双表；"## macOS 开发" 段指向 CLAUDE.md §15 + `scripts/build-mac.sh`
- **关联**: tmp/audit-docs.md §3 README 评分 C+ / 维度 A 跨平台

### F-6 (HIGH): docs/milestones/ 覆盖断档：M3-final / M4-roadmap 缺失 + STATE.md 双份漂移
- **症状**: `docs/milestones/` 仅 7 文件 (M1/M2 + M3 草案), 缺 M3-final / M4-roadmap；`docs/milestones/STATE.md` (67 行) 与 `.planning/STATE.md` (1475 行) 内容严重不匹配
- **证据**: `ls docs/milestones/` = M1-architecture-summary / M1-final-report / M1-REVIEWS / M2-REVIEWS / M2-roadmap-draft / M3-issues-and-roadmap / STATE；无 M3-final / M4-*；`wc -l docs/milestones/STATE.md` = 67 vs `wc -l .planning/STATE.md` = 1475
- **根因**: 里程碑文档与 .planning/ 双轨维护，docs/ 仅放对外可读版（rules of thumb），.planning/ 放内部状态；M3 阶段 docs/ 未及时增补
- **修复**: 1) 写 `docs/milestones/M3-final-report.md` 2) 写 `docs/milestones/M4-roadmap.md` 3) 选 1 个 STATE.md 权威源（建议 `.planning/`），`docs/milestones/STATE.md` 改链接或删除
- **关联**: tmp/audit-docs.md §6 / 维度 C

### F-7 (MEDIUM): SPEC.md §3.1 §3.2 功能列表无平台标注列
- **症状**: L136-267 12 大功能 + 12 支撑功能表格只有"功能 / 一句话"两列，**无 Win/Mac/Linux 列**；Mac 行为散落各章
- **证据**: SPEC.md:136-267 表格结构；Mac 命中散在 L247-253 (NSAppleEventManager) / L547 (vibrancy) / L630 (open -R) / L969 (.app bundle)
- **根因**: SPEC.md §3.x 是产品功能定义，作者按"功能维度"组织而非"功能×平台矩阵"组织
- **修复**: §3.1 §3.2 表格加 "Win" "Mac" "Linux" 3 列，状态填 ✅/🟡/❌
- **关联**: tmp/audit-docs.md §1 SPEC 评分 B- / 维度 D

### F-8 (MEDIUM): ARCHITECTURE.md §3 plugin 表格无平台标注列
- **症状**: L165-178 12 plugin 表只有 "ID / Display / F-num / Stub / M2.16 status" 5 列，Mac 真机行为散落 §8
- **证据**: `docs/ARCHITECTURE.md:165-178` 表格
- **根因**: 12 plugin 表格 M1 阶段写，M2.16+ 增补 plugin (backup-restore / resource-browser / marketplace) 时未重塑表格
- **修复**: 加 "Win" "Mac" 2 列填 ✅/🟡/❌；§8 已知限制整合到矩阵 cell
- **关联**: tmp/audit-docs.md §5.1 ARCHITECTURE 评分 A- / 维度 B

### F-9 (MEDIUM): v3.0-ROUND1-CLOSURE.md 不提 Mac (与 STATE.md 矛盾)
- **症状**: L13 总述提"L-M2.08 MacWindowChrome trait dispatch 统一"，但 L18-43 commit 表 22 行 0 行包含 macOS/Mac
- **证据**: `.planning/milestones/v3.0-ROUND1-CLOSURE.md:18-43` commit 表；`grep macOS\|Mac\|MacPath .planning/milestones/v3.0-ROUND1-CLOSURE.md` 命中 1 处是引用 .planning/STATE.md
- **根因**: v3.0 round 1 closure 写时聚焦"实质功能 ship"，未涵盖 Mac 相关 commit (`7efb0f8` MacWindowChrome)
- **修复**: 加 §macOS 段，记录 commit `7efb0f8` 的影响范围（macOS 真机 vibrancy 实装路径）
- **关联**: tmp/audit-docs.md §6 v3.0-ROUND1-CLOSURE 评分 D / 维度 C

### F-10 (MEDIUM): 重复内容：CLAUDE.md §15.7 与 docs/macos-p2-backlog.md 顶部「🚫 已砍清单」
- **症状**: CLAUDE.md §15.7 永久砍清单 (8 项) + macos-p2-backlog.md 顶部全局约束段 (1 段) 包含相同信息 ("本项目不做发布")
- **证据**: `CLAUDE.md:623-649` vs `docs/macos-p2-backlog.md:1-7`；CLAUDE.md L649 还反向引用 macos-p2-backlog.md §「🚫 已砍清单」段形成循环引用
- **根因**: 同一决策写两处，未选权威源
- **修复**: 选 CLAUDE.md §15.7 为权威源，macos-p2-backlog.md 顶部段改 "详见 CLAUDE.md §15.7"
- **关联**: 维度 C.8 + §11.4.1

---

## 扫描未覆盖 / 已知限制

- **未扫描代码层文档注释**: src-tauri/src/ 内 `//!` 模块级 doc + 函数级 `///` doc 共 ~300+ 处，未做 drift 审计（独立审计任务，本任务只关注 docs/ + .planning/ + tmp/）
- **未扫描 i18n 字符串**: `src/locales/` 不存在（项目未做 i18n，M4 阶段 L-M2.02 候选），不属本任务
- **未扫描 API 文档**: 项目无自动生成 API 文档 (cargo doc / typedoc)，无 rustdoc / tsdoc 漂移风险
- **未审计 GitHub Actions workflow 注释**: `.github/workflows/ci.yml` + `release.yml` 与 docs/ 描述一致性未审计
- **维度 A/E 报告未生成**: 本任务仅 F 维度；F-1 trait 行号错位问题部分依赖 A 报告交叉验证
- **tmp/ 100+ 文件内容未全读**: 仅抽样 5 个 white-list + 2 个 audit (audit-docs + audit-rust)；剩余 ~65 文件未逐字读，drift 评估基于文件名 + 维度 C.8 报告
- **未对比 v3.0-EXECUTION-PLAN.md 与实际 ship**: 该 plan 是 v3.0 round 1 启动时的计划文件，与 v3.0-ROUND1-CLOSURE.md 之间的 deviation 未深入分析
- **docs/milestones/M2-roadmap-draft.md 状态**: 标注"草案"但未升级到 final，与 M3/M4 阶段的 final 报告是否对齐未确认

---

*本报告由 F 维度 subagent (Task 3) 生成。完整 docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md 由主 session 从本文件落盘.*