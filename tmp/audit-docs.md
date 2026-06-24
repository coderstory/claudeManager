# 文档 macOS 覆盖度审计 (2026-06-24)

> **范围**: 全量扫描 SPEC.md / CLAUDE.md / README.md / AGENTS.md / docs/* 与 .planning/* 中所有 macOS / Darwin / Apple / WebKit / NSWindow / Cocoa 关键词命中 + 章节完整性。
>
> **方法**: `grep -ci 'macos|darwin|apple|webkit|nswindow|cocoa'` + 关键章节人工阅读。
>
> **结论**: macOS 覆盖度参差不齐——CLAUDE.md / README.md / docs/ARCHITECTURE.md 顶层一致声明双平台,但 M4+ 路线图、plugin 平台矩阵、smoke test 缺口、Phase 18 仅 Win e2e 留下"Windows-first 隐性优先"风险。

---

## 1. SPEC.md

- **平台覆盖章节**: 部分存在（§2.2 `<app-data>` 平台路径 / §3.6 单实例 + 文件关联 / §6.6 资源启用 / §8.x 验收 / §10 OS 验收 — 都有 Mac 列）
- **macOS 关键字命中**: **12 次**（命中位置: 5 / 117 / 247 / 253 / 547 / 630 / 899 / 969 / 985 / 1052 / 1102 / 1298）
- **12 plugin 平台标注**: **0/24 完整** — F1~F24 列表（§3.1 §3.2）只有"功能 / 一句话"两列，**无"Win / Mac / Linux"平台标注列**。Mac 行为散落在各章节（NSApplication、NSAppleEventManager、open -R、vibrancy、~/Library/Application Support）但**没有矩阵化**。
- **关键引用证据**：
  - L5: 跨平台承诺 "macOS / Windows / Linux 任一平台用任何技术栈实现"
  - L117: `<app-data>` macOS 路径 `~/Library/Application Support/ClaudeConfigManager/`
  - L247-253: §3.6 单实例 .sql 关联 — Mac 走 `NSApplication.shared.delegate` + `NSAppleEventManager` + `kAEOpenDocuments`
  - L547: §5.x 毛玻璃 "Win11 Mica / macOS vibrancy / Linux 透明"
  - L630 / L1052: reveal 资源 "macOS `open -R`"
  - L899: §6.8 平台行为表 — Mac 走 `LSMultipleInstancesProhibited=YES` + `kAEOpenDocuments`
  - L969 / L985: §6.10 平台 native 安装 "macOS: .app bundle,拖到 /Applications" + 主题跟随系统 "macOS 用户切 dark mode"
  - L1102: §8.x 验收 Mac 行为
  - L1298: §11.2 风险点"实现者二选一（§5.7 瓷白液态玻璃 vs §5.8 系统毛玻璃）；选这个要按 Apple HIG Liquid Glass 标准"
- **评分**: **B-**（有承诺 + 有零散 Mac 行为，但**没有** plugin×platform 矩阵，读者需要 grep 才能拼出 Mac 全貌）

## 2. CLAUDE.md

- **§1 目标平台**: **Win + Mac ✓**（L12 "Windows 11（开发主平台）+ macOS 26（Tahoe）"）
- **§3.2 macOS trait 规划**: **完整**（8 个 trait 都标注 Mac 实现 API）
  - `IPlatformSingleInstance` → Mac: `NSAppleEventManager`
  - `IPlatformPaths` → Mac: `~/Library/Application Support`
  - `IPlatformAutostart` → Mac: `LaunchAgent`
  - `IPlatformReveal` → Mac: `open -R`
  - `IPlatformNotifier` → 跨平台（不区分）
  - `IPlatformAppMenu` → Mac: macOS 应用菜单
  - `IPlatformWindowChrome` → Mac: vibrancy
  - `IGitHost` → Mac: git CLI
- **§9 迭代交付**: **Windows-only** — 桌面路径 `~/Desktop/ClaudeConfigManager-M{major}/`、smoke test 4 项全用 PowerShell `Get-Process` + `taskkill /F /IM ClaudeConfigManager.exe`、脚本 `./scripts/build-and-ship.sh` 是 Win 专用。**Mac 迭代交付流程未在 CLAUDE.md 落盘**。
- **§12 编译性能**: 调研只跑 `cargo build --release` Windows-gnu toolchain；Mac 编译性能基线缺失。
- **评分**: **B+**（架构层 Mac 完整；迭代交付层 Mac 流程空白——这是文档与实操的最大 gap）

## 3. README.md

- **项目简介**: ✓ "支持 Windows 11 和 macOS 26 (Tahoe) 双平台"（L15）
- **系统要求表**（L40-44）: ✓ 双平台（Win 11 / macOS 26 Tahoe / Xcode CLT + macOS SDK）
- **快速开始**: ✗ **Windows-only** — `git clone` → `npm install` → `./scripts/build-and-ship.sh`（这是 Win 脚本，Mac 应该是 `./scripts/build-mac.sh`，但 README 不知道）
- **目录结构** / **开发流程** / **测试**: ✗ 命令不区分平台（`./scripts/build-and-ship.sh` / `cargo test --manifest-path src-tauri/Cargo.toml` 都没给 Mac 变体）
- **当前状态表**: macOS 兼容条目模糊（"Mac 平台修复"作为 M2 范围子项，未说明 Mac 几/几完成）
- **评分**: **C+**（顶层承诺 Mac，落地命令全部 Win-only；新人 Mac 跑不起来）

## 4. AGENTS.md

- **L12**: "cross-platform (Windows 11 + macOS 26)" 一次
- **其他**: ✗ **无 Mac 专属内容**（构建命令、smoke test、网络纪律、TDD、评审纪律 — 全 Win 视角）
- **评分**: **D+**（只有顶层一句话；subagent 在 Mac 上派单会摸黑）

## 5. docs/

### docs/ARCHITECTURE.md

- **§0 概览 ASCII 图**: ✓ 标注 `windows/ (live)` + `macos/ (M2.16: 7/8 live; 1 stub)`
- **§2 trait 表格**: ✓ 8 trait 都标 Win impl / Mac impl / M1.x 状态（Mac 6 真 + 1 no-op + 1 stub）
- **§3 plugin 表格**: ✗ 12 plugin **无平台标注列**（同样缺矩阵）
- **§7 Build matrix**: 表格全部 Win（`cargo build --release` / `tauri build` / `WebView2Loader.dll`），Mac `cargo tauri build` 仅在 §0 一笔带过
- **§8 M2.16 已知限制**: ✓ "Mac platform: IGitHost still compile-only stub" + "IPlatformReveal unimplemented" + "Mica/vibrancy on macOS unverified" — 透明
- **§8 M2.16 已知限制**: ⚠ "MacPaths 用了 `dirs` crate, Mac `~/Library/Application Support` 是硬编码, 不走 macOS 标准 `NSFileManager`"（M2.16-008-M，未修）
- **评分**: **A-**（架构层对 Mac 8 trait 状态完全透明，**plugin 矩阵**与 **Mac 真实使用 vs 设计 gap** 都写明）

### docs/BUILD.md

- **§1 Two build modes**: ✓ 列出 `scripts/build-mac.sh`（与 Win 并列）
- **§2 Windows**: ✓ 完整（build-and-ship + build-only + smoke-test + kill-app）
- **§3 macOS**: ✓ 有 `build-mac.sh` 章节 + 输出 `.app` / `.dmg` 路径 + 4 项"为什么 Mac 简单"（`cargo tauri build` / `beforeBuildCommand` / 无 mingw64 / 无 WebView2Loader.dll / 无 .exe mangling）
- **§3.3 macOS smoke test**: ⚠ **"no macOS smoke-test script yet (M1.10 scope is build + CI; macOS smoke testing lands when there's a Mac dev box to write it on)"** — 显式声明 Mac smoke test 缺位
- **§4 Release CI**: ✓ 完整（matrix windows-latest + macos-latest，pin `aarch64-apple-darwin` target，注释 Linux 排除）
- **§6.3 CI macOS 故障**: ✓ "xcrun: error: unable to find utility" 处理
- **评分**: **B+**（Mac build 命令 + 路径 + 4 项 Mac 简化点都有；**smoke test 缺位**是显式遗留）

### docs/SIGNING.md

- **§3 macOS Developer ID + notarization**: ✓ 完整（3.1 Apple Developer Program enrollment / 3.2 两种 signing flow / 3.3 app-specific password / 3.4 cert export / 3.5 GitHub Secrets 5 项 / 3.6 "为什么 macOS builds need macos-latest runner, not Windows"）
- **§5 Summary checklist v1.1**: ✓ Mac 部分 5 项 (APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID / APPLE_CERTIFICATE / APPLE_CERTIFICATE_PWD)
- **§1 Why we sign / notarize table**: ✓ Mac 行 "Gatekeeper blocks... 'cannot be opened because the developer cannot be verified'; DMG treated as damaged on Apple Silicon"
- **状态标记 (M1.10)**: ⚠ 文档自己声明 "All secrets in this document are placeholders for the v1.1 release phase. M1 builds are dev builds (debug) and do NOT require signing"
- **M4.1 取消 (2026-06-22 用户口头)**: ⚠ 文档未同步此决策 — 还在列 EV cert + Apple Developer Program 5 个 secret，但用户已拍板不买证书（PROJECT.md Out of Scope 段 L93 / STATE.md L59 写明）
- **评分**: **A-**（Apple 签名链路 1:1 详细，但**与当前 M4.1 取消决策漂移**）

### docs/AGENTS.md / 其他 docs/

- 仅 docs/ARCHITECTURE.md / BUILD.md / SIGNING.md 涉及 macOS；其他 docs/ 子目录（MILESTONES、reviews、rules、design、investigations、superpowers）未在审计范围

## 6. .planning/

### .planning/PROJECT.md

- **L7**: ✓ "目标平台 Windows 11（开发主平台）+ macOS 26 (Tahoe)"
- **L34-76 Validated 段**: ✓ 多次提 Mac（"OS 抽象层 (8 traits × Win/Mac)" / "9 new plugins + macOS compat + splash" / "L-M2.08 MacWindowChrome 架构统一"）
- **L82-85 Active 段**: ✗ Mac 状态未同步（v3.0 round 2 提"e2e/云备份/updater UI/M4.6 长尾 pending"，但 Mac 真机验证进度未列）
- **L88-95 Out of Scope 段**: ✓ "D6 Mac 真机验证 — 用户拍板不处理;v3.0 期间不启动" / "M4.5 应用商店 / M4.1 证书 — 不买 / 不上架" — 决策透明
- **L101 v3.0 goal**: ✗ "M3.10 双模式落地 + 测试补齐 + updater 基础 + Tailwind 闭环" — **Mac 验证未列入 v3.0 goal**
- **L103-104 v3.0 排除**: ✓ "M4.1 证书 / M4.5 商店 / D6 Mac 真机 / M4.2 / M4.4（用户拍板）"
- **L113 Constraints**: ✓ "目标平台: Windows 11 (开发主) + macOS 26 (Tahoe). Linux 不在范围"
- **L116**: ✓ "macOS 真机验证: M2/M3 阶段 Windows dev box 上 mac impl 是 compile-only stubs;Mac 真机验证 D6 暂缓待 M4 启动前再问"
- **L126 Decision table**: ✓ "macOS impl = Windows dev box 上 compile-only stub → ⚠️ Revisit (D6 待 M4 启动前问)"
- **评分**: **B**（Mac 决策透明但 v3.0 goal 不含 Mac 验证，ACTIVE 段不列 Mac 进度）

### .planning/ROADMAP.md

- **L5 Overview**: ✓ "目标 Windows 11 + macOS 26"
- **L259 v3.0 milestone goal**: ⚠ "M3.10 双模式全 plugin 落地 + updater 基础启用 + 测试补齐 + Tailwind 闭环" — **不含 Mac 真机验证**
- **L323-330 v4.0+ 公证发布 (Deferred)**: ✓ 提 Mac "macOS DMG + Windows MSI/NSIS 双轨打包"
- **L333-338 候选清单**: ✓ M4.2 公证 "M4.1 取消 → 暂缓" / M4.3 updater "Phase 1 已 ship" / M4.4 双轨打包 "M4.1 取消 → 暂缓"
- **Phase 18 M1 L1 Playwright e2e (Windows only)**: ⚠ 标题明文 "Windows only" — 是**首次显式声明**有 phase 是 Mac-exclusive 缺位
- **评分**: **C+**（标题与 milestone 段多次提 Mac，但 v3.0 milestone goal 不含 Mac 验证 / Phase 18 显式标 Windows-only 是 plan-level 缺口）

### .planning/STATE.md

- **L33 v3.0 本轮总结**: ⚠ 提 "A1 12/13 plugin 适配完成 + L-M2.08 MacWindowChrome 统一" — Mac 改动有记录
- **L33**: ✗ "8/8 tasks ship (M3.13.x bug fix 4/4 + Phase 21 SQLite history 4/4)" — **未提 Mac 验证是否完成**
- **L61 Known Issues**: ✓ "D6 Mac 真机验证 — 暂缓, M4 启动前再问"
- **L237-804 M2.16 Mac 兼容表**: ✓ 7 个 Mac trait 落地记录（MacPaths / MacReveal / MacGitHost / MacAppMenu / MacNotifier / MacWindowChrome / MacSingleInstance）
- **L804 累计验证**: ✓ "vitest 344/344 pass ... smoke 7/7: launch / window / webview / title / assets / tray / kill 全 PASS" — **全部是 Windows-side smoke**
- **L808-812 M2.16 已知限制**: ✓ "L-M2.09: ci.yml macos-latest gate job 需用户 push 后看 Actions 实际触发（dev box Windows，本机无法跑 Mac CI 验证）"
- **L820-822 M2.16 候选**: ✓ "真实 macOS 26 真机验证全套功能（dev box Windows，L-M2.09 / L-M2.11 / L-M2.12）"
- **L921 D6~D13 决策表**: ✓ "D6 Mac 真机验证时机: A 现在（需 Mac dev box）/ B M2.17 末 / C 推迟到 M3 — 暂不确定，后续决定"
- **L1245 D6 暂缓原因**: ✓ "D6 留待 D14 一起问"
- **评分**: **A-**（决策透明、状态完整；最显式的 Mac 状态文档；v3.0 round 2 8/8 ship 段未注明 Mac 验证状态）

### .planning/HANDOFF.json

- **macOS 关键字命中**: 5 次（多为路径/分支标签，不深入审计 JSON 结构）
- **评分**: 数据不展开

### .planning/phases/*

- **macOS 关键字命中总计**: 9 个 phase 文件提到 Mac
- **关键命中**:
  - `01-m217-closeout/01-01-PLAN.md` (1) + `01-m217-closeout-SUMMARY.md` (1)
  - `03-m32-polish/03-m32-polish-SUMMARY.md` (1)
  - `06-m35-reveal-bug/06-m35-reveal-bug-SUMMARY.md` (1)
  - `09-m38-usage/09-m38-usage-PLAN.md` (1) + `09-m38-usage-SUMMARY.md` (1)
  - `18-m1-l1-playwright-e2e-windows-only/18-CONTEXT.md` (2)
  - `21-m46-sqlite-history/21-01-PLAN.md` (1) + `21-CONTEXT.md` (1) + `21-RESEARCH.md` (3)
- **Phase 18 标题明文 "Windows only"**: 是**审计范围内唯一显式声明 Mac-exclusive 缺位**的 phase
- **Phase 21 SQLite history (L-M2.02)**: 提 3 次 macOS（research 阶段提到 macOS 兼容路径）
- **评分**: B（个别 phase 提 Mac；但 **23 个 phase 中 22 个无 Mac 专属内容**，且 Phase 18 显式排除）

### .planning/milestones/*.md

- **v2.0-ROADMAP.md**: 10 次 — 顶层概述 + M2.16 行 + M4.1~M4.6 多个 phase 都提 Mac（公证/notarization/DMG/真机 e2e）
- **v2.0-MILESTONE-AUDIT.md**: 2 次
- **v2.0-BACKLOG.md**: 4 次
- **v3.0-EXECUTION-PLAN.md**: 2 次（line 144 platform/macos/window_chrome.rs / line 147 Win Mica + macOS vibrancy 双平台风险）
- **v3.0-ROUND1-CLOSURE.md**: 0 次（明显缺口 — round 1 收尾文档不提 Mac，与 STATE.md L33 "L-M2.08 MacWindowChrome 架构统一" 矛盾）
- **评分**: **C**（v2.0 roadmap 完整；v3.0 plan 提了 Mac 风险点但 v3.0-ROUND1-CLOSURE.md 完全不提 Mac → round 1 收尾漂移）

---

## 7. macOS 关键字命中汇总

| 文档 | 命中次数 | 评分 |
|---|---|---|
| SPEC.md | 12 | B- |
| CLAUDE.md | 8 | B+ |
| README.md | 4 | C+ |
| AGENTS.md | 1 | D+ |
| docs/ARCHITECTURE.md | 7 | A- |
| docs/BUILD.md | 22 | B+ |
| docs/SIGNING.md | 28 | A- |
| .planning/PROJECT.md | 6 | B |
| .planning/ROADMAP.md | 3 | C+ |
| .planning/STATE.md | 20 | A- |
| .planning/HANDOFF.json | 5 | n/a |
| .planning/milestones/v2.0-ROADMAP.md | 10 | B |
| .planning/milestones/v2.0-BACKLOG.md | 4 | n/a |
| .planning/milestones/v2.0-MILESTONE-AUDIT.md | 2 | n/a |
| .planning/milestones/v3.0-EXECUTION-PLAN.md | 2 | C+ |
| .planning/milestones/v3.0-ROUND1-CLOSURE.md | **0** | **D** |
| .planning/phases/* (合计) | ~10 (9 file 命中) | C+ |

---

## 8. 缺口清单（按严重度排序）

### CRITICAL（block macOS 真机使用）
1. **README.md 快速开始命令 Win-only** — `git clone` → `build-and-ship.sh` 在 Mac 上不存在；新人 Mac 跑不起来
2. **AGENTS.md 几乎全 Win** — subagent 派到 Mac dev box 会按 Win 命令瞎跑
3. **Phase 18 Playwright e2e 显式 "Windows only"** — 无对应 Mac e2e phase；M3.10 双模式/M2.16 全功能在 Mac 真机上无自动化验证
4. **scripts/smoke-test.sh 仅 Win**（PowerShell Get-Process + taskkill）— 显式声明 BUILD.md §3.3 "no macOS smoke-test script yet"

### HIGH（决策/状态漂移）
5. **docs/SIGNING.md 与 M4.1 取消决策漂移** — 用户 2026-06-22 拍板不买证书，但 SIGNING.md 仍列 5 个 Apple secret + Developer Program enrollment 步骤
6. **.planning/milestones/v3.0-ROUND1-CLOSURE.md 不提 Mac** — round 1 实际 ship L-M2.08 MacWindowChrome（STATE.md L33）但 closure doc 0 命中
7. **plugin 平台矩阵缺失** — SPEC.md §3.1 §3.2 + docs/ARCHITECTURE.md §3 / .planning/ROADMAP.md 表格都无"Win OK / Mac OK / Win-only / Mac-only"列
8. **CLAUDE.md §9 迭代交付 Win-only** — 桌面路径 / smoke test / taskkill 全部 Win 视角，Mac 迭代交付流程未在项目圣经级文档落盘
9. **v3.0 milestone goal 不含 Mac 验证**（PROJECT.md L101 / ROADMAP.md L259）— 即使 D6 取消真机，e2e CI gate 跑通 / Mac CI smoke 至少应在 goal 内

### MEDIUM（完整度）
10. **.planning/ROADMAP.md v4.0+ 段缺手** — M4.2/M4.4 暂缓但**没有"Mac 真机 e2e CI"**作为独立 phase 提
11. **M2.16-008-M 限制未升级**（MacPaths 硬编码不走 NSFileManager）— 文档已知但未列入 v3.0 backlog
12. **scripts/build-mac.sh 缺位 CLAUDE.md** — 文档圣经不提 Mac build 入口
13. **CI matrix macos-latest gate job** 状态未在 STATE.md 收尾段同步（commit `c18d267` 已 ship，但 STATE.md L808 仍标"需用户 push 后看 Actions 实际触发"）

### LOW（nice-to-have）
14. **Mac 编译性能基线缺失**（CLAUDE.md §12 调研只跑 Windows-gnu）
15. **Mac `.app` bundle 验收 checklist** 缺位（与 Win §2.4 7 项 smoke 对比）
16. **Mac 主题自动切换验收步骤**（SPEC.md L985 提"macOS 用户切 dark mode 时应用立即切"）— 缺 sub-test

---

## 9. 推荐补文档顺序（按 ROI）

1. **README.md 加 Mac build 段**（5 分钟）— 在 L23-37 快速开始后加 `### macOS 开发` 子段，引用 `scripts/build-mac.sh` + macOS 必装依赖（Xcode CLT / macOS SDK）
2. **AGENTS.md 加 Mac subagent checklist**（10 分钟）— 在 §"Build / smoke / ship" 加 `### macOS` 段：`./scripts/build-mac.sh` / `open src-tauri/target/release/bundle/macos/ClaudeConfigManager.app` / Mac smoke 待补
3. **CLAUDE.md §9 补 Mac 桌面路径段**（10 分钟）— 在 §9.2 后加 `### 9.8 macOS 迭代交付`：`~/Desktop/ClaudeConfigManager-M{major}/ClaudeConfigManager.app`（目录不是 .exe）/ Mac smoke = 人工启动 .app + 退出干净
4. **docs/SIGNING.md 同步 M4.1 取消**（15 分钟）— 在文档头部加 "⚠️ 2026-06-22 用户拍板 M4.1 证书取消；Apple Developer ID / notarization 全部暂缓到 v4.0+ 重新启动时再启用"，避免后续 subagent 误信文档去采买证书
5. **plugin 平台矩阵表**（1 小时，跨 3 个文档）— 在 SPEC.md §3.1 / §3.2 加 "Win / Mac / Linux" 列；在 docs/ARCHITECTURE.md §3 同步；在 .planning/ROADMAP.md §3 plugin tables 同步
6. **v3.0-ROUND1-CLOSURE.md 补 Mac 段**（10 分钟）— 加"v3.0 round 1 收尾 12 commits 中 Mac 相关改动：L-M2.08 MacWindowChrome 架构统一（commit 7efb0f8）"对齐 STATE.md
7. **.planning/ROADMAP.md v3.0 milestone goal 补 Mac CI smoke 一项**（15 分钟）— "v3.0 goal = M3.10 落地 + Mac CI gate 跑通 + updater 基础 + Tailwind 闭环"（D6 真机验证可继续暂缓，但 CI smoke 至少要跑通）
8. **Mac 真机 e2e phase 草案**（30 分钟）— 新建 `.planning/phases/XX-m1-l1-playwright-e2e-macos/XX-CONTEXT.md` 对应 Phase 18 Windows-only，标注"等 Mac dev box 接入后启动"

---

*审计完成时间: 2026-06-24*
*审计范围: D:/project/winui3/ 下 8 个核心文档 + .planning/ 全树 + docs/ 全树*
*未改任何文档（CLAUDE.md §10 + 用户明确指示）*
