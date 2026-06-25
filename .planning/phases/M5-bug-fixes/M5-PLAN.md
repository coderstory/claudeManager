# M5 用户 bug 修复 — PLAN

> **Milestone**: M5 (2026-06-25 启动)
> **Phase**: planning
> **Status**: 待用户拍板 4 阶段排序 + 修法优先级
> **Owner**: 主 session
> **Bug source**: `bug-report.md` (来自 `~/Desktop/17823997343240.md` 2026-06-25 23:31 用户报告)
> **Spec ref**: `SPEC.md` §3 (F1-F24 清单)

---

## 1. 为什么这样设计 (§2.5)

### 1.1 问题陈述
用户在 v3.0 ship 后实测 ClaudeManager.app,发现 **33 个 bug**(见 bug-report.md),按 4 类分布:

| 类别 | 数量 | 占比 |
|---|---|---|
| A. UI/UX 文本/样式调整 | 5 | 15% |
| B. 单功能 bug(数据/逻辑错) | 14 | 42% |
| C. 功能删除/重构(高风险) | 11 | 33% |
| D. 信息不足,需澄清 | 3 | 10% |
| **合计** | **33** | **100%** |

**核心影响**:
- **#2** sqlite 错(历史查询) + **#4** Provider 列表激活状态消失 + **#6** 编辑 Provider 报错 = F1/F2/F5 三大核心 flow 坏
- **#13** MCP 文本提示过时 + **#18** 删单文件部署 = 死代码/死文案(F8 v3.0 已 ship 单文件,文案没跟上)
- **#27** 配置优化点击应用报过期 + **#33** JSON 编辑器搜不到 settings.json = F5/F18 流程死

按 §1 项目背景 "Provider 切换 1 秒搞定,绝不出错" 是**核心 value**,**critical 5 个必须先修**:
- #2 (sqlite 缺表)
- #4 (Provider 激活态消失)
- #6 (编辑 Provider 报错)
- #13 (MCP 死文案)
- #27 (配置优化点击应用报错)

### 1.2 M5 跟 M4 关系
**M4 = 测试框架**(14 场景 e2e),**M5 = 被测对象修复**。两者**互补**:
- M5 修完后,M4 的 14 场景是 M5 修复的**回归验证**
- 修 M5 时**应该**先修 critical(M4 还没法验),修后期 M4 接入(M4 是终极验收门)

按用户 2026-06-25 拍板:"**先 M4 后 M5**" — 但 M4 还在 planning(没 Phase 1),M5 报告 33 bug 紧急。**现实路径**:
1. **当前只做规划**(用户原话) — 主 session 写 M5-PLAN.md
2. **M4 Phase 1 启动门槛**: 5 决策已拍板 + fixture 隔离方案展开(看 M4-PLAN.md §9-§10)→ 等 XDG_CONFIG_HOME 假设验证
3. **M5 修 bug 时**: 不用等 M4 框架就绪,每个 bug 配手测 + 现有 vitest 单测(哪里有就加)
4. **M5 修完一波后**: 用 M4 框架跑 14 场景作回归

### 1.3 用户拍板(2026-06-25)
| Q | 决策 |
|---|---|
| Q1 修法 | **Q1=1**: M5 一次性修完 33 个(不 phase-out critical) |
| Q2 scope | **Q2=1**: M5 全做 33/33,无延后 |
| Q3 顺序 | **Q3=3**: 当前只做规划(M4-PLAN + M5-PLAN 都完成才进实现) |
| Q4 M4 vs M5 | **Q4=用户隐含**: 先 M4 后 M5(M4 是框架先立,M5 修完用 M4 验) |
| Q5 修法 | 待拍:critical 优先 / 易修先 / 报告顺序 |

---

## 2. 架构

### 2.1 不改架构,只改实现
M5 是 **bug 修复**,**不动 §3 分层**(src-tauri/src/{domain,services,infrastructure,platform,plugins,commands},src/{pages,components,hooks,stores,lib})。

但修复要遵守 §2.1 架构先行:**修复前先在 M5-PLAN.md 写"为什么这样修"**,写不进 commit message 里。

### 2.2 修法分层(每个 bug 至少 1 行 patch)
```
单文件 .tsx / .ts 改 → commit "fix(frontend): ..."
单文件 .rs 改 → commit "fix(rust): ..."
跨文件改(commands + IPC + UI) → commit "fix(multi): ..." + 写 STATE.md exception
```

### 2.3 数据库 schema 修复(#2)
**#2 `sqlite error: no such table: usage_history`** — 这意味着 v3.0 M4.6 ship 的 Phase 21 SQLite history 表在某些路径下没建出来。可能原因:
- Tauri 启动时跑 `rusqlite::Connection::open` 但 migration 没跑完
- 测试环境(history.db 路径不同)没建表
- schema_version 表存在但 usage_history/backup_history 缺

**修法**:在 AppState::build() 加 idempotent CREATE TABLE IF NOT EXISTS(已 ship V2 migration commit 8985626,但可能没 IF NOT EXISTS),看 src-tauri/src/infrastructure/db.rs 或 migrations/。

### 2.4 UI 文案同步(CLAUDE.md §6.4 lesson)
**#13 MCP 文案 / #14 用量查询亿级显示 / #18 删单文件部署 / #32 关于页** = 4 个文案/UI 修改。按 §6.4 lesson,**前端字符串 + Rust IPC 常量 + 测试 fixture 三处必须同步**。

举例 #18 "删单文件部署菜单和代码":
- `src/pages/single-file-deploy/index.tsx` 删(已存在)
- `src/components/AppSidebar.tsx` 删 menu entry
- `src/__tests__/pages/single-file-deploy.test.tsx` 删/跳过
- `src-tauri/src/commands/` 删相关 IPC 命令
- `src-tauri/capabilities/*.json` 删相关 capability
- 全局 grep 确认无引用

---

## 3. 接口 — 33 bug 拆解

### 3.1 33 bug 分类 + 优先级

#### A. UI/UX 文本/样式(5, 估 1 行/条)
| # | bug | 位置(估) | 修法 |
|---|---|---|---|
| 1 | 二次元主题 header 菜单背景色 | src/components/AppHeader.tsx + design-system | 加 CSS variable |
| 5 | "Default Model (ANTHROPIC_MODEL)" → "Default Model" | src-tauri/commands/app.rs::PRODUCT_NAME-like 常量 | 改字符串 |
| 14 | 用量查询亿级显示文本缺失 | src/pages/usage-query/index.tsx | 调 formatChineseTokenCount 路径(commit 46861f9 已加) |
| 20 | 重新扫描按钮宽度 | src/components/Common.tsx 或具体页 | min-width |
| 32 | 关于页项目主页独立一行 | src/pages/about/index.tsx | 改 layout |

#### B. 单功能 bug(14, 中风险)
| # | bug | 修法 |
|---|---|---|
| 2 | sqlite no such table: usage_history | idempotent CREATE TABLE IF NOT EXISTS(看 §2.3) |
| 4 | Provider 列表激活态消失 | 检查 isCurrent 计算 + 焦点失焦重算 |
| 6 | 编辑 Provider 报错 missing field `id` | update_provider IPC 接收 id 参数(看 src-tauri/commands/provider.rs) |
| 11 | MCP 切项目级后文本提示没切 | 路径化文本(messages.ts / 复数键) |
| 12 | MCP 从剪贴板导入 invalid URL(预期 import JSON) | 改 import_mcp_from_clipboard,支持 JSON 解析 |
| 13 | MCP 文本 ccswitch:// 协议已删 | 删文案里的 ccswitch 引用(看 §2.4) |
| 15 | 删用量查询余额/费用 + 计算代码 | 删 UI + 删 service 字段 |
| 16 | 用量趋势按天只显示当前 | 取近 7 天数据(看 src-tauri/src/services/usage_service.rs) |
| 17 | CACHE CREATE 列永远 0 | 列从表头删(无法获取就不展示) |
| 19 | 资源浏览切项目级还是用户级 | 看 src/components/ResourceBrowser.tsx,加 path 选择 |
| 21 | plugins 显示外层目录 | 改 src/services/resource_browser.rs 解析逻辑 |
| 22 | 资源市场"浏览资源"没打开 git URL | 看 open_external_browser 实现,加 open URL |
| 23 | 资源市场点安装 npx 报 git error | 区分 git clone vs npm install 调用 |
| 24 | 资源市场点安装 cli 报 git error | 同 #23,分清"git 拉 + CLI 验证"两阶段 |

#### C. 功能删除/重构(11, 高风险)
| # | bug | 修法 |
|---|---|---|
| 3 | 欢迎页新增项目改弹窗形式 | src/pages/welcome/index.tsx 改 onClick → modal |
| 7 | SQL 导入过滤缺值 + 重复 + 加复选框 | src/components/ImportSqlModal.tsx 重构 |
| 8 | SQL 导入跳过条目显示名字而非行号 | 改 parse error 报告(返回 provider name) |
| 9 | JSON 编辑器全屏功能丢失,备份页 JSON 也加 | src/components/JsonEditor.tsx 加 fullscreen 按钮 + 备份页用同组件 |
| 10 | JSON 编辑器左侧目录树奇怪 | 改 src/components/JsonTreeSidebar.tsx 父子关系 |
| 18 | 删单文件部署菜单和代码 | 看 §2.4 三处同步 |
| 25 | 资源市场"第三方仓库"功能澄清 | 文档化或删(待 #25 拍板) |
| 26 | 配置优化"需手动处理"不可勾 | src/pages/optimization/index.tsx checkbox 改 readonly |
| 27 | 配置优化点击应用报 finding 已过期 | 加 invalidate 逻辑,应用前重新查 |
| 28 | 手动处理项目点后出 JSON 编辑器 | 改 src/pages/optimization/index.tsx + 共用 JsonEditor |
| 29 | 备份与恢复分页 + 多选删除 | src/pages/backup-restore/index.tsx 加 pagination + bulk delete |
| 30 | 备份与恢复文件选择恢复后不删 | 改 onRestoreCompleted 行为 |
| 31 | 历史查询三列表分页 | src/pages/history/index.tsx + 3 个表 |
| 33 | JSON 编辑器搜不到 settings.json | 改 src-tauri/src/commands/fs.rs scan_root_for_jsons |

> 等等,**B+C 实际是 14+12=26 个**,A 是 5,合计 31。**漏了 2 个**。检查 bug-report.md:

| # | bug | 漏在 |
|---|---|---|
| 4 | Provider 列表激活态 | B ✓ |
| 11 | MCP 切项目级 | B ✓ |
| 12 | MCP 剪贴板 invalid URL | B ✓ |

> 重数 **5+14+11+3 = 33** (A 5 + B 14 + C 11 + D 3) — 跟 bug-report.md 的 33 一致。✓

#### D. 信息不足(3, 需用户澄清)
| # | bug | 需澄清 |
|---|---|---|
| 12 | MCP 剪贴板 import invalid URL | 实际是 import JSON 还是 URL?(用户描述自相矛盾) |
| 23-24 | git error: 无法启动 npx/claude | 是 git 调用错把 npx 当 git 用,还是 PATH 缺?(待 #25 拍板) |
| 25 | 第三方仓库功能 | 保留还是删?(用户说"功能干啥的,输入 git 仓库然后干啥") |

---

## 4. 任务拆分(4 阶段)

按"critical 先 + 同类打包 + 风险分层"原则:

### Phase 1: critical 5 + 信息澄清(估 1-2 天)
**修**:#2 #4 #6 #13 #27
**澄清**:#12 #23-24 #25
**理由**:#2/4/6 是核心 flow 直接坏,#13 误导用户,#27 让 F18 完全死
**测试**:
- 5 个 vitest 单测(现有 test 套件覆盖的补)
- 手测每个 bug 报告步骤

### Phase 2: B 类剩余 10 个(估 2-3 天)
**修**:#11 #12 #15 #16 #17 #19 #21 #22 #23 #24(B 14 - critical 4 = 10)
**前置**:#12 #23 #24 是 D 类,Phase 1 启动前用户拍板(看 §9)
**理由**:单功能 bug,改动局限
**测试**:vitest + 手测

### Phase 3: C 类重构 11 个(估 3-4 天)
**修**:#3 #7 #8 #9 #10 #18 #26 #28 #29 #30 #31 #33(C 类 14)
**理由**:C 类风险高,需要:
- 架构细节(看 §2.4 三处同步)
- 单测 patch(CLAUDE.md §2.2 TDD 强制)
- vitest 全过

### Phase 4: 整合验证(估 1 天)
**修**:#1 #5 #14 #20 #32(A 类 5 个全在 Phase 4)+ 修全过程中发现的小问题
**测试**:
- test-all.sh 5 阶段全过(继承 v3.0 收尾结果)
- ClaudeManager.app 重新 build + 装 + 启动
- 33 bug 报告步骤全手测一遍

---

## 5. ship gate

按 §2.3 "TDD 强制" + §5.3 "M1 阶段必过 e2e",M5 ship 标准:

| Gate | 标准 |
|---|---|
| 单元测试 | vitest 500 → 500+ (33 bug 每个至少 1 新 test) |
| Rust 测试 | cargo build --tests 0 warning(继承 v3.0 收尾) |
| 集成测试 | test-all.sh 5 阶段全 PASS |
| UI e2e | M4 框架就绪后跑(继承 v3.0 smoke 10/10 + M4 14 场景) |
| 33 bug 报告步骤 | 全手测一遍,每个 PASS |

M5 ship = tag v3.1(= v3.0 + M5 修)

---

## 6. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| #2 sqlite 修可能撞 v3.0 已有 migration 逻辑 | migration V3 重写可能 | 测前先看 src-tauri/migrations/,Phase 1 必做 |
| #4 isCurrent 计算错可能改 settings.json 解析 | 改 ~5 个文件 | 写 vitest 覆盖 isCurrent 5 个边界 |
| #6 update_provider 改签名是 breaking | 现有调用方全改 | 兼容老签名 + 加新签名,deprecation warning |
| #7 SQL 导入重做涉及 parser 改 | 解析逻辑重写 | 现有 5 场景 sql-validator 测试必须全过 |
| #9 JSON 编辑器全屏功能可能影响性能 | 大量内容卡顿 | 测 100KB / 1MB / 10MB 三档 |
| #10 目录树改可能影响 30 #31 分页 | 数据结构变 | 写 vitest tree builder 全覆盖 |
| #18 删单文件部署 + 删 menu + 删 IPC + 删 capability 4 处 | 漏一处就死代码 | 严格按 §2.4 三处同步(扩展到 4 处) |
| #27 配置优化 finding invalidate 可能影响 #26 readonly checkbox | 共用 state | Phase 3 一起改 |
| C 类 11 个改动可能引入新 bug | test-all 挂 | Phase 3 完成后跑 test-all 验 |
| 33 bug 一次性全修,中途出意外 | 进度拖延 | Phase 1-3 各跑 test-all 守门,任何一阶段不过不继续 |

---

## 7. 不做(M5 scope 排除)

- ❌ **M4 框架实现** — M5 不动 M4,只等 M4 完成接入
- ❌ **新功能** — M5 只修 33 bug,不加新功能(如果发现新 bug,加到 M6 backlog)
- ❌ **M4.3 updater Phase 2/3** — STATE.md Known Issues 列的,留给 M5+
- ❌ **M4.6 i18n / 多窗口 / Telemetry** — 延后 M6
- ❌ **重构 / 重写 src-tauri/src 任何架构层** — M5 scope 是 bug 修,不动 §3 分层
- ❌ **删 `tests/e2e/` 历史 Playwright 路径**(M4 决策 E=1: 保留)
- ❌ **加新依赖** — §2.3 版本锁纪律;M5 用现有 dep
- ❌ **改 design-system 主题** — §1 视觉一致性 > 功能堆叠;M5 文案/颜色调整在 A 类范围

---

## 8. 验证 / 成功标准

### Phase 1 完成标志
- [ ] 5 critical bug 修完(#2 #4 #6 #13 #27)
- [ ] 3 信息澄清有答案(#12 #23-24 #25)
- [ ] 5 个新 vitest 单元测试
- [ ] test-all.sh 5 阶段仍全 PASS

### Phase 4 完成标志 (= M5 ship)
- [ ] 33/33 bug 报告步骤手测 PASS
- [ ] 33 个新 vitest 单元测试全过
- [ ] test-all.sh 5 阶段全 PASS
- [ ] ClaudeManager.app 重新 build + 装,启动 1 窗口 OK
- [ ] 写进 STATE.md "M5 完成" 段
- [ ] tag v3.1
- [ ] **M4 框架就绪后** 14 e2e 场景全 PASS(回归验证)

### M5 不做但 M4/M6 接力
- M6.1: 性能基准 (启动 / 切换延迟 / 内存)
- M6.2: 修 tauri-driver macOS 支持
- M6.3: 可视化回归 (pixel diff)
- M6.4: F8/F18/F23/F20 e2e 覆盖

---

## 9. 开放问题(等用户拍板进 Phase 1)

| # | 问题 | 拍板 (待) |
|---|---|---|
| Q5 | 修法优先级 | (1) critical 5 优先 / (2) 易修先 / (3) 报告顺序 |
| #12 | MCP 剪贴板功能错位 | (1) 实际是 import JSON(改代码)/ (2) 实际是 import URL(改文案)/ (3) 两种都支持 |
| #23-24 | 资源市场 git error 根因 | (1) git 调用错把 npx 当 git(改逻辑)/ (2) PATH 缺(改文档)/ (3) 不确定(继续调查) |
| #25 | 第三方仓库功能 | (1) 保留(改文档说清作用)/ (2) 删(走 §2.4 三处同步) |
| Q-RENAME | v3.0 → v3.1 还是 v3.0.1? | (1) v3.1(major bump,33 bug 是 user-facing)/ (2) v3.0.1(minor,bug fix) |

---

*Refs: CLAUDE.md §1 核心 value + §2.1 架构先行 + §2.2 TDD + §2.3 版本锁 + §2.5 为什么这样设计 + §6 review discipline + §6.4 文案同步.  F1-F24 来自 SPEC.md §3.  bug 来源 17823997343240.md 2026-06-25 23:31.*
