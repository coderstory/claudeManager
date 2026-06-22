# Roadmap: Claude 配置管理器 (Claude Config Manager)

## Overview

跨平台桌面 GUI 工具,帮助 Claude Code 用户在多 provider 配置间安全切换。技术栈 Tauri v2 + React + Rust,目标 Windows 11 + macOS 26。从 M1 架构期 → M2 业务期 → M2.17 收尾 → M3 用户反馈修复 + 双模式 → M4 公证发布。

## Milestones

- ✅ **v1.0 架构期 (M1.1 ~ M1.12)** — 12 phases,shipped 2026-06-19 (5 exes on Desktop)
- ✅ **v1.5 业务期 (M2.1 ~ M2.16)** — 16 phases,shipped 2026-06-21 (26+ exes on Desktop)
- 🚧 **v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1 ~ M3.10)** — 11 phases,in progress
- 📋 **v3.0 公证发布 (M4.1 ~ M4.6)** — 6 phases,planned

## Phases

<details>
<summary>✅ v1.0 架构期 (M1.1 ~ M1.12) - SHIPPED 2026-06-19</summary>

> 完整 phase 列表 + git 提交见 git log。所有 exes 在 `~/Desktop/ClaudeConfigManager-M1/`。
> 评审记录在 `docs/REVIEWS/M1-REVIEWS.md`。

| Phase | 名称 | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| M1.1 | Tauri v2 scaffold + 托盘 + 最小化 | 1 plan | Complete | 2026-06-19 |
| M1.2 | OS 抽象层 (8 traits × Win/Mac) | 1 plan | Complete | 2026-06-19 |
| M1.3 | Plugin host + 12 stubs (frontend + backend) | 4 plans + 3 fixes | Complete | 2026-06-19 |
| M1.4 | Tauri capabilities with WHY 注释 | 1 plan | Complete | 2026-06-19 |
| M1.5 | Frontend deps + 设计系统 baseline | 5 plans | Complete | 2026-06-19 |
| M1.6 | Rust backend deps + version lock | 4 plans | Complete | 2026-06-19 |
| M1.7 | Autostart 集成 (Win 注册表 + Mac LaunchAgent) | 4 plans | Complete | 2026-06-19 |
| M1.8 | TDD + UI e2e 框架 | 1 plan | Complete | 2026-06-19 |
| M1.9 | 主窗口 framework + 12 路由占位 | 9 plans + 3 fixes | Complete | 2026-06-19 |
| M1.10 | Build/package/sign/CI matrix | 4 plans | Complete | 2026-06-19 |
| M1.11 | CI + framework invariants + 3 阶段 review | 5 plans + 1 fix | Complete | 2026-06-19 |
| M1.12 | 最终自审 + brainstorm + peer review | 5 plans | Complete | 2026-06-19 |

</details>

<details>
<summary>✅ v1.5 业务期 (M2.1 ~ M2.16) - SHIPPED 2026-06-21</summary>

> 完整 phase 列表 + git 提交见 git log。所有 exes 在 `~/Desktop/ClaudeConfigManager-M2/`。
> 评审记录在 `docs/REVIEWS/M2-REVIEWS.md`。**D9 决策**:M2.17 启动时清空到 `.archive/2026-06-21-m2.16-final/`,只保留 D8 抽查 2 个。

| Phase | 名称 | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| M2.1 | F1 provider-list (3 commands) | 1 plan | Complete | 2026-06-19 |
| M2.2 | F3 import-sql (real impl + sql parser) | 1 plan | Complete | 2026-06-19 |
| M2.3 | F4 deeplink-import (ccswitch://) | 1 plan | Complete | 2026-06-19 |
| M2.4 | F2 provider-switch (atomic backup → write → reload) | 1 plan | Complete | 2026-06-19 |
| M2.5 | F6 MCP 管理 (6 commands) | 1 plan | Complete | 2026-06-19 |
| M2.6 | F13 备份 + F19 恢复 (auto-backup + 字段级 diff) | 1 plan | Complete | 2026-06-19 |
| M2.7 | F7 用量查询 (5-min cache + fallback) | 1 plan | Complete | 2026-06-19 |
| M2.8 | F8 单文件部署 (drag-drop + 导出 .json) | 1 plan | Complete | 2026-06-19 |
| M2.9 | F18 优化器 (13 内置规则 + auto-backup) | 1 plan | Complete | 2026-06-19 |
| M2.10 | Theme 3-state + AppHeader chrome cluster | 1 plan | Complete | 2026-06-19 |
| M2.11 | F9 search (QuickSearchModal + fuzzy + 历史) | 1 plan | Complete | 2026-06-19 |
| M2.12 | kill-app.sh 修复 + scripts/tests | 1 plan | Complete | 2026-06-19 |
| M2.13 | F16 resource-browser (5 类资源 + reveal) | 1 plan | Complete | 2026-06-19 |
| M2.14 | F15 error feedback 横切 (shared ErrorBanner) | 1 plan | Complete | 2026-06-19 |
| M2.15 | Page padding/h1 字号统一 (polish) | 1 plan | Complete | 2026-06-19 |
| M2.16 | 9 new plugins + macOS compat + splash + cleanup | 1 plan + 7 fixes | Complete | 2026-06-21 |

</details>

### 🚧 v2.0 用户反馈修复 + 双模式 (In Progress)

**Milestone Goal**: 修复 M2.x 阶段 26+ 已知限制 + 27 条用户反馈清单中的 P0/P1 项,引入"用户 / 项目"双模式架构 (M3.10),为 M4 公证发布做技术准备。

#### Phase M2.17: 收尾期 (M1 3 件套 + 17 限制评估 + F15 扩展 + 桌面清理)

**Goal**: M2.16 收尾 + M1 架构期遗留 3 件套 + 17 MEDIUM/LOW 已知限制全评估 + F15 ErrorBanner 接入剩余页面 + D9 桌面清理。
**Depends on**: M2.16 (✅ done)
**Requirements**: D7 (ErrorBanner 全扩展) / D9 (桌面清理) / D10 (17 限制评估)
**Status**: in progress
**Success Criteria**:
  1. M1 3 件套 (PluginHost wiring + build pipeline refresh + docs refresh) 全部 ship + smoke 7/7
  2. 17 MEDIUM/LOW 已知限制按 M2.16-001-M~010-M 顺序全评估,产出 `docs/investigations/m2.16-limitations-eval.md`
  3. F15 ErrorBanner 接入剩余 7 个页面 (import-sql / mcp-management / F2 切换 等),保持 testid 一致
  4. `~/Desktop/ClaudeConfigManager-M2/` 仅剩 D8 抽查的 2 个 exe,其他 mv 到 `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`
**Plans**: 4 (并行槽)

Plans:
- [x] M2.17-3.1: PluginHost wiring (lib.rs::run + shutdown on RunEvent::Exit) — commits `d5443c3` + `18d4b29`
- [x] M2.17-C1+C2: CI gates (npm run build in test-frontend + e2e skip with macos matrix) — commit `a980eeb`
- [x] M2.17-C3: build-and-ship.sh refresh (cargo → `tauri build`) — commit `8ef961d`
- [x] M2.17-C4: tsconfig.json 8 strict sub-flags explicit — commit `cc07178`
- [ ] M2.17-D10: 17 MEDIUM/LOW 限制评估 (主 session 必做)
- [ ] M2.17-D9: 桌面清理 (M2.17 启动 subagent 执行)
- [ ] M2.17-F15-batch4: ErrorBanner 接入剩余页面 (commit `02e5b14` 是 batch3-c3;后续 batch4 待派)

#### Phase M3.1: 启动优化 (清单 1 — 冷启动白屏→全透明→loading 闪烁)

**Goal**: 冷启动事件链路 (Tauri setup → splash → window show → webview ready → first paint) 时序修复 + 透明度闪烁根因 + webview 预加载优化。
**Depends on**: M2.17 (D10 限制评估完成)
**Requirements**: 清单 1 (P0)
**Success Criteria**:
  1. e2e cold-start 截图对比: launch → 1s → 3s → 5s,无白屏 + 无 loading 闪烁
  2. vitest 启动事件 mock 覆盖 setup/show/paint 4 个边界
  3. ship `ClaudeConfigManager-M3.1-startup-optimization.exe`,smoke 7/7 通过
**Plans**: 1 plan (估时 2-3 天)

Plans:
- [ ] M3.1-01: 启动事件链路梳理 + splash 透明度修复 + webview 预加载

#### Phase M3.2: F2/托盘/InfoBar polish (清单 3/4/5/6/7/8/24 + M2.16-007-L)

**Goal**: 8 项 polish 子任务并行 + D7 F15 ErrorBanner 扩到全部页面。
**Depends on**: M3.1
**Requirements**: 清单 3/4/5/6/7/8/24 (P1) + M2.16-007-L
**Success Criteria**:
  1. 托盘 LeftDoubleClick handler 显示窗体
  2. sidebar 底部文案 "M1.9 · 架构期" → "钱云飞作品"
  3. 备份路径校验 (`IPlatformPaths::backups_dir` = `%APPDATA%\ClaudeConfigManager\backups`)
  4. 备份差异 attribute tooltip (?) 图标
  5. backup metadata 加 `alias: Option<String>` 字段
  6. F19 恢复页 JSON 框全屏 toggle (app 窗体内)
  7. 设置入口 onClick 修复
  8. D7 F15 ErrorBanner 接入全部剩余页面
**Plans**: 1 plan (估时 3-4 天,8 子任务并行)

Plans:
- [ ] M3.2-01: 8 项 polish + ErrorBanner 全扩展

#### Phase M3.3: 配置优化 13 规则 + Fix + 新增 env (清单 9/10)

**Goal**: 内置 13 规则 markdown 文档化 + UI 重构 (规则名 + 状态 + Fix 按钮) + 新增 3 个 env 规则。
**Depends on**: M3.2
**Requirements**: 清单 9/10 (P1/P2)
**Success Criteria**:
  1. `docs/rules/builtin-rules.md` 文档化 13 规则 (含新增 3 env: `CLAUDE_CODE_ATTRIBUTION_HEADER=0` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` / `CLAUDE_CODE_EFFORT_LEVEL=max`)
  2. UI 每行展示规则名 + 状态 (绿勾/红 x) + Fix 按钮
  3. Fix 按钮调用 `apply_rule_fix(rule_id)` Tauri command,带原子备份
  4. 13+3 = 16 规则扫描 fixture + Fix 原子性测试
**Plans**: 1 plan (估时 2-3 天)

Plans:
- [ ] M3.3-01: 13 规则文档化 + UI 重构 + 3 env 规则

#### Phase M3.4: 资源市场重构 (清单 11/12/13/14/16/17)

**Goal**: 安装流程重设计 (内置 vs 第三方 vs npx 三类统一 API) + 删除克隆源码流程 + superpowers + GSD 内置源 + GSD-* 合并展示 + 资源浏览过滤规则。
**Depends on**: M3.3
**Requirements**: 清单 11/12/13/14/16/17 (P1/P2)
**Success Criteria**:
  1. F17 marketplace 安装流程三类统一 API (`install_builtin` / `install_third_party` / `install_npx`)
  2. 删除"克隆源码"分支
  3. 内置 superpowers (`/plugin install superpowers@claude-plugins-official`) + GSD (`npx @opengsd/gsd-core@latest`)
  4. GSD-* 合并展示为 "Get Shit Done" 分类
  5. 资源浏览过滤 `cache/` / `node_modules/` / `.git/` 三类
  6. 安装命令 mock + GSD 合并 fixture + 过滤规则单测
**Plans**: 1 plan (估时 4-5 天)

Plans:
- [ ] M3.4-01: F17 marketplace 重构 (基于启动门槽 2 的 `docs/design/M3.4-marketplace-refactor.md`)

#### Phase M3.5: 资源浏览修 bug (清单 15)

**Goal**: `IPlatformReveal::reveal_file` 错误处理增强 + `explorer.exe exit 1` 根因排查 + 前端错误本地化。
**Depends on**: M3.4
**Requirements**: 清单 15 (P1) — D13 决策:按 M3.5 排期
**Success Criteria**:
  1. `reveal_file` 返回 `Result<(), RevealError>` 区分 4 类 (合法路径 / 不存在 / 无权限 / 网络路径)
  2. 前端 ErrorBanner 显示本地化提示 ("无法打开该资源" + 排查建议)
  3. 4 个 reveal 场景 e2e 测试覆盖
**Plans**: 1 plan (估时 0.5-1 天)

Plans:
- [ ] M3.5-01: reveal 错误处理 + 前端本地化

#### Phase M3.6: Provider CRUD + JSON 编辑器路径 (清单 20/22)

**Goal**: 启动门槽 3 验证回归 (清单 20 JSON 编辑器路径 bug 已修半) + provider 新增/修改/查看/删除 CRUD UI。
**Depends on**: M3.5
**Requirements**: 清单 20 (P0) + 清单 22 (P0)
**Success Criteria**:
  1. JSON 编辑器路径 bug 回归测试通过 (4 场景: 合法路径 / 不存在 / 权限 / 编码)
  2. provider 新增 UI 表单 (base_url / api_key_env / model + token-mask)
  3. provider 修改走 F13 自动备份
  4. provider 删除走 F13 备份 + 二次确认
  5. provider 查看只读详情页
  6. CRUD 各 2 用例 + 备份联动 + 权限校验
**Plans**: 1 plan (估时 3-4 天)

Plans:
- [ ] M3.6-01: Provider CRUD 4 命令 + UI

#### Phase M3.7: 单文件部署重构 (清单 18)

**Goal**: F8 单文件部署页面文案重写 + 抽出"关于"页 (版本/build hash/许可证/致谢) + sidebar 加"关于"入口。
**Depends on**: M3.6
**Requirements**: 清单 18 (P1)
**Success Criteria**:
  1. F8 页面文案清晰解释 "导出单 exe / 嵌入 WebView2" 用途
  2. 新建 `pages/about/index.tsx`,显示版本 + build hash + 许可证 + 致谢
  3. sidebar 路由加 "关于" 入口
  4. about 页 snapshot + sidebar 路由跳转测试
**Plans**: 1 plan (估时 1-2 天)

Plans:
- [ ] M3.7-01: F8 文案重写 + about 页新建

#### Phase M3.8: 用量查询修 bug (清单 19)

**Goal**: **D14 待问用户** → 根据 API key 来源 (用户手动 / OAuth / 本地代理) 决定技术路线 → HTTP 客户端 + 错误处理 + 缓存策略 + UI 表格。
**Depends on**: M3.7 + **D14 用户拍板** (BLOCKED)
**Requirements**: 清单 19 (P0)
**Success Criteria**:
  1. HTTP 客户端覆盖 Anthropic / OpenAI / 第三方代理三类 (按 D14 答案选)
  2. 错误处理覆盖 401 / 429 / network error / 数据格式错误
  3. 缓存策略 (5-min in-memory + 磁盘 fallback)
  4. UI 表格展示 provider + 周期 + 用量百分比 + 限额
  5. mock HTTP 4 场景测试
**Plans**: 1 plan (估时 3-5 天,视 D14 答案浮动)

Plans:
- [ ] M3.8-01: 用量查询重写 (按 D14 选定方向)

#### Phase M3.9: SQL 导入命名 + 校验 (清单 2/21)

**Goal**: 菜单改名 + SQL 文件 schema 校验 + 部分合法 dry-run 预览。
**Depends on**: M3.8
**Requirements**: 清单 2 (P1) + 清单 21 (P1)
**Success Criteria**:
  1. 菜单/页面标题 "SQL导入" → "SQL导入配置"
  2. SQL schema 校验 (cc-switch 格式: CREATE TABLE providers / INSERT statements)
  3. 校验失败 ErrorBanner + 错误详情
  4. 部分合法时 dry-run 预览 (列出将导入的 N 条 + 跳过的 M 条)
  5. 5 场景测试: 合法 / 非法 / 部分合法 / 空文件 / 编码错误
**Plans**: 1 plan (估时 1-2 天)

Plans:
- [ ] M3.9-01: 命名 + 校验 + dry-run 预览

#### Phase M3.10: 双模式 用户/项目 (清单 23 — M3 核心新功能)

**Goal**: **架构级新功能** — 引入 Project 数据模型 + 持久化 + 用户级 (特殊 is_system=true 不可删) + 项目级 (指向 `<root>/.claude/` 虚拟视图) + 所有 plugin 适配 `IPlatformPaths::active_root_dir` + 切换走 F13 备份 + 原子切换。
**Depends on**: M3.9 + 启动门槽 1 架构评审通过
**Requirements**: 清单 23 (P0) — M3 核心新功能 (架构级)
**Success Criteria**:
  1. Project domain model (`id, name, root_dir, created_at, is_system`) + `projects.json` 持久化 + F13 备份
  2. 用户级 = 特殊 `is_system=true` 不可删
  3. 项目级 = 指向 `<root>/.claude/` 的虚拟视图
  4. 欢迎页改 "项目切换器" (下拉 + 新增/删除按钮)
  5. 所有 plugin (Provider/MCP/Optimizer/Backup) 适配 `IPlatformPaths::active_root_dir`
  6. 切换项目走 F13 备份 + 原子切换
  7. sidebar 顶部 project switcher + 当前项目显示
  8. 跨 plugin "切换项目后行为" 集成测试 + 用户/项目数据隔离单测
**Plans**: 1 plan (估时 5-7 天,含架构评审 + 适配所有 plugin 的回归测试)

Plans:
- [ ] M3.10-01: Project domain + 持久化
- [ ] M3.10-02: 所有 plugin 适配 `IPlatformPaths::active_root_dir`
- [ ] M3.10-03: 欢迎页改造 + sidebar 顶部 switcher
- [ ] M3.10-04: 跨 plugin 集成测试 + 数据隔离单测

### 📋 v3.0 公证发布 (Planned)

**Milestone Goal**: 获取代码签名证书 + 公证 (SmartScreen + notarization) + 启用 updater + 双轨打包 + (可选) 应用商店上架。

#### Phase M4.1: 代码签名证书

**Goal**: 申请 Windows EV 代码签名证书 + macOS Developer ID。
**Depends on**: M3.10 ship
**Status**: planned
**Success Criteria**:
  1. Windows EV 证书到位 (DigiCert / Sectigo / GlobalSign 三选一, ~$300-500/年)
  2. macOS Developer ID 到位 (~$99/年,Apple 强制)
  3. 证书本地导入 + 私钥保护方案落地
**Plans**: TBD (2-4 周,可与 M3 并行)

#### Phase M4.2: 公证 (SmartScreen + notarization + staple)

**Goal**: Windows SmartScreen 提交 + macOS notarization + staple ticket。
**Depends on**: M4.1
**Status**: planned
**Success Criteria**:
  1. Windows SmartScreen 首次提交通过
  2. macOS notarization 成功 + staple ticket 嵌入
  3. 文档化 SmartScreen 信誉积累策略 (新证书前几次会有警告)
**Plans**: TBD (~1 周)

#### Phase M4.3: updater 启用

**Goal**: Tauri updater 真实 pubkey + endpoint + E2E 更新流程。
**Depends on**: M4.1 (pubkey 关联签名)
**Status**: planned
**Success Criteria**:
  1. updater pubkey 配置 + 端点 (GitHub Releases / S3 / 自建 CDN 三选一)
  2. E2E 更新流程: v1.0 → v1.1 灰度 + 回滚
  3. 签名校验强制开启
**Plans**: TBD (1-2 周)

#### Phase M4.4: 双轨打包

**Goal**: Windows MSI/NSIS + macOS DMG + CI matrix (Windows Server 2019 + macOS 14 真机)。
**Depends on**: M4.2 (公证后才能分发)
**Status**: planned
**Success Criteria**:
  1. Windows MSI + NSIS 双格式 ship (二选一主推,另一个作为企业分发备用)
  2. macOS DMG + PKG 双格式 ship
  3. CI matrix 在 Windows + macOS 真机分别跑完整 e2e
**Plans**: TBD (2-3 周)

#### Phase M4.5: 应用商店上架 (可选)

**Goal**: Microsoft Store + Mac App Store 上架 (需用户拍板)。
**Depends on**: M4.2 + M4.4
**Status**: planned (需用户拍板)
**Success Criteria**:
  1. Microsoft Store 上架提交
  2. Mac App Store 上架提交
  3. 商店审核往返跟踪
**Plans**: TBD (2-4 周)

#### Phase M4.6: 长期 Backlog (按需启动)

**Goal**: 不在 M4 主线,按需启动的增强项。
**Depends on**: 不适用
**Status**: backlog

候选清单:
- F13/F19 备份增强 (增量备份 / 云备份) — 2 周, P1
- i18n 国际化 (en / zh-CN) — 1-2 周, P2
- SQLite 历史查询 (用量 / 备份历史) — 1 周, P2
- 多窗口 (主窗口 + 独立弹窗) — 1 周, P3
- Telemetry (崩溃报告 + 匿名统计) — 1-2 周, P3 (需用户拍板)
- L-M2.02 已知限制回归 — 1 天, P3
- Tailwind 接入评估 — 待评估, P3
- MacWindowChrome (vibrancy + traffic light) — 2-3 天, P2
- **D6 Mac 真机验证** — 待定, M4 启动前再问

## Progress

**Execution Order:**
M2.17 → M3.1 → M3.2 → M3.3 → M3.4 → M3.5 → M3.6 → M3.7 → M3.8 (待 D14) → M3.9 → M3.10 → M4.1 → M4.2 → M4.3 → M4.4 → M4.5 (可选) → M4.6 (backlog)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| M1.1 ~ M1.12 | v1.0 | 12/12 | ✅ Complete | 2026-06-19 |
| M2.1 ~ M2.16 | v1.5 | 16/16 | ✅ Complete | 2026-06-21 |
| M2.17 | v2.0 | 4/7 | 🚧 In progress | - |
| M3.1 | v2.0 | 0/1 | Not started | - |
| M3.2 | v2.0 | 0/1 | Not started | - |
| M3.3 | v2.0 | 0/1 | Not started | - |
| M3.4 | v2.0 | 0/1 | Not started | - |
| M3.5 | v2.0 | 0/1 | Not started | - |
| M3.6 | v2.0 | 0/1 | Not started | - |
| M3.7 | v2.0 | 0/1 | Not started | - |
| M3.8 | v2.0 | 0/1 | **BLOCKED** (D14) | - |
| M3.9 | v2.0 | 0/1 | Not started | - |
| M3.10 | v2.0 | 0/4 | Not started | - |
| M4.1 | v3.0 | 0/TBD | 📋 Planned | - |
| M4.2 | v3.0 | 0/TBD | 📋 Planned | - |
| M4.3 | v3.0 | 0/TBD | 📋 Planned | - |
| M4.4 | v3.0 | 0/TBD | 📋 Planned | - |
| M4.5 | v3.0 | 0/TBD | 📋 Planned (需用户拍板) | - |
| M4.6 | v3.0 | 0/TBD | 📋 Backlog | - |
</content>
</invoke>