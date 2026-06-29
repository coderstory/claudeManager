# Bug 修复重验证清单 (2026-06-29)

> 本会话对 21 个 bug 做了诊断 + 部分修复,但**没有一项经过"实际验证"**。
> 重新走新 session 时,按本清单逐项验证,不接受"build PASS + smoke PASS + 启动没崩"作为完成证据。
>
> **必须遵守**:CLAUDE.md §16 Bug Fix Protocol (5 步流程:了解 → 原因 → 边界 → 方案 → 验证)。

---

## 0. 协议提醒 (CLAUDE.md §16, 2026-06-29 写入)

任何 bug 修复 5 步,顺序不可颠倒:
1. **了解问题详情** — 完整读 bug 描述 + 补充上下文(截图/操作步骤/期望/实际/触发条件/频率/范围)
2. **明确问题原因** — root cause 必须有 file:line 证据,分清症状 vs 原因
3. **明确问题边界** — 影响哪些模块/文件/路径;若超 2 个文件改动 → §2.4 白名单
4. **分析技术方案** — 列 ≥2 个方案 + 优缺点 + 推荐 + 风险,**不得直接改代码**
5. **修复后实际验证** — 跑测试/启动 app/实际点击按钮,**不得推断臆想修复结果**

**不算验证**: build OK / smoke 10/10 PASS / app 启动没崩 / subagent 自报 / 加 null guard (defense-in-depth)
**才算验证**:
- 可测 bug: vitest / Playwright 改前 FAIL → 改后 PASS,测试留 codebase 做回归
- UI bug: Playwright tauri-driver 实际点击按钮,断言 UI 行为符合预期
- 不可测 bug(视觉/平台/时序/主观): 录屏 + DevTools log + 用户亲眼确认

**反事故案例**: X1 commit `b16b979` 加 `if (!provider) return null;` 防御性 guard,但 subagent 自己报告"defense-in-depth,actual bug-trigger path doesn't fire",主 session 没质疑就 trust → 用户仍报"按钮无反应"。

---

## 1. 21 个 Bug 状态总览

来源:`/tmp/triage-report-all-20.md`(诊断-only,无代码改动)

| # | Bug | Severity | 状态 | Commit | 重验证方式 |
|---|---|---|---|---|---|
| A1 | JSON 编辑器 "读取失败 : 读取失败 : 双层包装" | P0 | 已 commit | `ffb00cd` + `303b4d3` | vitest 选文件触发错误 → 断言文案无双前缀 |
| A2 | add_provider missing field id | P0 | 待 verify(代码已修) | (无 commit) | 写 fixture 调 `add_provider` 触发,断言 payload 含 id |
| A3 | New project "must be an absolute path: winui3" | P0 | 已 commit | `db74286` | 选目录/手输路径 → 断言 validation 拦截 |
| A4 | Config optimizer "未知规则: <id>" | P0 | 已 commit | `a6cfb3b` | 完整 scan + 点 Fix → 断言不再抛 unknown rule |
| A5 | 两个错误窗口重复 | P1 | 已 commit | `76613be` | 故意 throw → 断言只看到 1 个错误条 |
| A6 | Marketplace installed indicator 缺失 | P1 | **未开始**,需用户确认路径 | — | 先确认 Claude Code 实际 install 路径 |
| A7 | New project 选目录不自动填 name | P1 | 已 commit | `04c568c` | 点选目录 → 断言 name 输入框自动填 |
| A8 | Usage history 列名 + 项目名解析 | P1 | 已 commit | `631b7bd` | user 级 / project 级切 → 断言列名 + 项目名 |
| A9 | 删除 mc + pure-black 主题 | P2 | NO-OP(5 主题已干净) | — | grep `themeIds.ts` 确认无 mc/pure-black |
| A10 | Backup time 显示错 | P2 | subagent 派出结果不明 | — | 读 `backup-restore/index.tsx` + 选一条记录看时间 |
| A11 | Backup 加备注功能 | P2 | **未开始**(用户拒绝) | — | **需用户决策**: 是否要做这个新功能 |
| A12 | Settings.json move | P2 | **未开始**(用户拒绝) | — | **需用户澄清**: 是 app prefs 还是 Claude Code settings.json |
| B1 | Backup 历史 vs 备份与恢复 重叠 | P? | 已 commit(选合并) | `0fdfd9f` | 进 history 备份历史 tab + 备份与恢复页 → 断言统一 |
| B2 | Day aggregation 选日期不查询 | P1 | 已 commit | `34d4bb4` | 选日期 → 断言列表重查 |
| B3 | Resource browser plugin 列表缺已安装 | P1 | **未开始**,需用户确认路径 | — | 同 A6,先确认 install 路径 |
| B4 | Close button hover 看不见 | P1 | 已 commit | `2dba138` | hover 关闭按钮 → 截图断言红底白 X |
| B5 | macOS Dock 点击不重开 | P1 | 已 commit(macOS only) | `3588e62` | macOS 真机验证(Windows dev box 无法测,D6 暂缓) |
| B6 | 删 back button + 显示 APP_NAME | P1 | 已 commit(导致白屏) | `86ed4db` | **白屏反复**:用户已手动修复,验证 fix 没引入新回归 |
| B7 | 所有时间字段 UTC+8 | P0 | 已 commit | `1deb267` | 选历史记录 → 断言时间字段全 UTC+8 显示 |
| B8 | MCP 加载死循环 | P0 | 已 commit | `7cee365` | 开 MCP 管理页 → 断言不卡死 / CPU 不 100% |
| X1 | GeneratePreviewModal `p.name` 崩溃 | P1 | 错方向 commit | `b16b979` | **未修**:Defense-in-depth,真因未找。**第 1 优先级** |

---

## 2. 重验证执行顺序 (按风险 + 影响)

### Round 0 — 先解最高风险 (X1, B6 白屏)

#### X1 "从当前配置生成" 无反应
- **症状**: 用户点按钮 → 完全无响应
- **commit `b16b979`**: 加 `if (!provider) return null;` 防御性 guard
- **真因(未明)**: 可能是 Rust 端 IPC env var 错配 / IPC 返回 schema 不符 / onClick 未绑 / state 不更新
- **重验证步骤**(按 §16 第 1 步起):
  1. **了解**: 操作路径(从哪个页面点) / 前置状态(是否有当前激活 Provider / `~/.claude/settings.json` 含 `ANTHROPIC_API_KEY` 还是 `ANTHROPIC_AUTH_TOKEN`) / 期望行为 / 实际行为
  2. **原因**: 写 vitest 测试用 vi.spyOn(`@tauri-apps/api/core`, `invoke`) 拦 IPC,断言点按钮后 invoke 被调 + 参数正确 + 返回值非 null + setState 触发 + modal 渲染。哪一步断言失败 = 真因。
  3. **边界**: 仅 provider-list 页 / 仅"从当前配置"按钮 / 涉及所有 generate IPC?
  4. **方案**: 列 ≥2 个修法(注意:Rust 端 env var 错配是已知嫌疑 —— `usage.rs` / `optimizer_rules.rs` / `usage_query/commands.rs` 只查 `ANTHROPIC_AUTH_TOKEN`, 但 `provider_service.rs` 已正确处理 `ANTHROPIC_API_KEY` OR `ANTHROPIC_AUTH_TOKEN`, 系统性不一致)
  5. **验证**: vitest 改前 FAIL → 修 → 改后 PASS,测试留 codebase
- **测试代码起点** (见 CLAUDE.md §16.3):

  ```ts
  // src/__tests__/pages/provider-list-generate.spec.tsx
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';
  import { vi } from 'vitest';
  import * as tauri from '@tauri-apps/api/core';

  vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

  test('点击从当前配置生成 → 调 invoke + 打开 preview modal', async () => {
    const mockProvider = { id: 'p1', name: 'Test', env: { ANTHROPIC_API_KEY: 'sk-x' } };
    vi.mocked(tauri.invoke).mockResolvedValue({ provider: mockProvider, is_new: false });
    render(<ProviderListPage />);
    fireEvent.click(screen.getByRole('button', { name: /从当前配置生成/ }));
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('generate_from_current_config'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  test('invoke 抛错 → 显示错误 toast 而不是静默', async () => {
    vi.mocked(tauri.invoke).mockRejectedValue(new Error('no current config'));
    render(<ProviderListPage />);
    fireEvent.click(screen.getByRole('button', { name: /从当前配置生成/ }));
    expect(await screen.findByText(/no current config/)).toBeInTheDocument();
  });
  ```

#### B6 白屏反复 (用户已手动修复)
- **症状**: 改 `AppHeader.tsx` → npm run build → install → 启动仍空白
- **commit `86ed4db`**: 删 back button, 加 `void HOME_VIEW` 占位避免 module-load 时序坑
- **额外已知问题**: 见 `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`(Tauri codegen-assets 缓存,fix commits `fd118e3` + `ca0e6e2`)
- **重验证步骤**:
  1. 当前代码能否正常 build? `npm run build` 成功?
  2. `cargo build --release` 成功? (注意 `fd118e3` 修了 BUILD_MARKER DCE)
  3. 启动 app → **任何页面都不白屏**? 包括 home / provider-list / settings?
  4. back button 确实没了?
  5. APP_NAME 是否在 header 左上角显示? (注意 §6.4/§6.5 3 处同步)
- **风险**: Tauri codegen-assets stale(`ca0e6e2` commit 已加自动 clear,但要验证)

### Round 1 — P0 可独立验证的 4 个

#### A1 JSON 编辑器双层包装
- **commit**: `ffb00cd` (line 226) + `303b4d3` (line 258 followup)
- **验证**: 打开 JSON 编辑器 → 选不存在文件 → 断言看到的是 `"No such file or directory"` 或 `"文件不存在"`,**没有** `"读取失败 : 读取失败 :"` 前缀
- **测试**: vitest 触发 mapBackendError,断言输出无重复前缀

#### A3 项目路径 absolute
- **commit**: `db74286`
- **验证**: 新建项目 → 点选目录(拿 `webkitRelativePath`)→ 断言 path 变绝对路径 / 手输相对路径 → 验证拦截 + 红字提示
- **风险**: 已知 `validateProjectPath` 在 `src/lib/api/projects.ts:120`,看 submit 前是否调

#### A4 Optimizer unknown rule
- **commit**: `a6cfb3b` (camelCase vs snake_case)
- **验证**: 跑 scan → 选 finding 点 Fix → 断言不再 `未知规则: <id>` 错
- **测试**: vitest 模拟 scan 返回 finding,点 Fix 断言 invoke 参数 rule_id 与 finding.rule_id 一致

#### B7 UTC+8 时间
- **commit**: `1deb267`
- **变更范围**: 涉及 ≥6 个文件 (UsageHistoryTable, BackupHistoryTable, types/backup.ts, about/index.tsx, optimizer/index.tsx, backup-restore/index.tsx)
- **CLAUDE.md §2.4 提醒**: > 2 文件改动需白名单
- **验证**: 东八区用户 + 其他 TZ 都看 UTC+8;具体检查:
  - `src/pages/history/UsageHistoryTable.tsx` 的 `formatTs`
  - `src/pages/history/BackupHistoryTable.tsx` 的 `formatTs`
  - `src/types/backup.ts` 的 `formatBackupTimestamp`
  - `src/pages/about/index.tsx:94` 的 `formatTimestamp`
  - `src/pages/optimizer/index.tsx:401`
  - `src/pages/backup-restore/index.tsx` 时间列
- **建议重构**: 抽 `src/lib/formatTime.ts` 工具函数,全局替换 (per triage §B7)

### Round 2 — P0/P1 时序 / Loop 类

#### B8 MCP 加载死循环
- **commit**: `7cee365`
- **根因(推测)**: `useScope` 返回不稳定 ref + `scopeKey = scope + ':' + projectRoot` 导致组件 remount 循环
- **验证**: 打开 MCP 管理页 → DevTools Performance 录制 → CPU 不 100% / 不卡死
- **测试**: vitest 模拟 useScope 返回不稳定 ref,断言 effect 不触发死循环

#### A5 重复错误窗口
- **commit**: `76613be` (去重 error display)
- **已知风险**: 用户报告"无反应"症状,可能与本 fix 的 toast 渲染冲突
- **验证**: 故意 throw → 断言**只看到 1 个**"渲染错误"红条
- **关联**: 见 X1 验证,可能共同根因

### Round 3 — P1 UX 细节

#### A7 选目录自动填 name
- **commit**: `04c568c`
- **验证**: 新建项目 → 点选目录 → 断言 name 输入框自动填了目录名

#### A8 usage history 列名 + 项目名
- **commit**: `631b7bd`
- **验证**: history 页 → user 级 / project 级切换 → 断言列名是"token 消耗量" + 项目列显示项目名(非原始路径)

#### B1 Backup 重叠(选合并)
- **commit**: `0fdfd9f`
- **验证**: history 备份历史 tab + 备份与恢复页 → 断言合并到统一视图

#### B2 Day aggregation filter
- **commit**: `34d4bb4` (from_date/to_date)
- **验证**: day aggregation tab → 选日期 → 断言列表更新(useEffect deps 含 filter)

#### B4 Close button hover
- **commit**: `2dba138`
- **验证**: hover 关闭按钮 → 截图断言红底白 X
- **关联**: `src/components/WindowControls.tsx:83-99` + `src/styles/base.css`

### Round 4 — 待用户决策/澄清

#### A6 / B3 Plugin install 路径
- **状态**: 未开始
- **阻塞**: 需用户确认 Claude Code 实际 install 路径(`installed/` vs `cache/` vs `installed_plugins.json`)
- **下一步**: 问用户要实测样例 / 截图

#### A11 Backup 备注
- **状态**: 未开始,用户拒绝
- **阻塞**: 需用户重新决策(DB 迁移工作量)

#### A12 Settings.json move
- **状态**: 未开始,用户拒绝
- **阻塞**: 需用户澄清是 app prefs 还是 Claude Code 的 settings.json

#### B5 macOS dock reopen
- **commit**: `3588e62`
- **状态**: macOS only,Windows dev box 无法测
- **下一步**: macOS 真机验证(D6 暂缓到 M4 启动前)

### Round 5 — 长尾 / 待 verify

#### A9 主题清理
- **状态**: NO-OP(5 主题已干净)
- **验证**: grep `themeIds.ts` 确认无 `mc` / `pure-black`

#### A2 add_provider missing id
- **状态**: "代码已修",未 commit
- **验证**: 写 fixture 调 add_provider,断言 payload 含 id;若新 build 仍报错 → 查 `src/pages/import-sql/index.tsx` 的 Provider 转换路径

#### A10 Backup time calc
- **状态**: subagent 派出结果不明
- **下一步**: 读 `src/pages/backup-restore/index.tsx` + 看是否有 formatTs 函数 / 找具体行号

---

## 3. 系统性已知问题 (跨多个 bug)

### 3.1 Rust 端 env var 处理不一致
- `src-tauri/src/services/provider_service.rs::read_current_active_env` 正确处理 `ANTHROPIC_API_KEY` OR `ANTHROPIC_AUTH_TOKEN`
- 但以下位置**只查 `ANTHROPIC_AUTH_TOKEN`,不查 `ANTHROPIC_API_KEY`**:
  - `src-tauri/src/commands/usage.rs:60`
  - `src-tauri/src/plugins/stubs/usage_query/commands.rs:92`
  - `src-tauri/src/infrastructure/optimizer_rules.rs:144`
  - `src-tauri/src/commands/providers.rs:580` (write path)
- **影响**: 用户用 `ANTHROPIC_API_KEY` 的 settings.json,可能用量查询/优化器/写入路径全部失效 → 表现为"按钮无反应"或"读不到数据"
- **验证**: grep 全代码 `ANTHROPIC_AUTH_TOKEN`,对照 `ANTHROPIC_API_KEY` 一致性
- **可能直接是 X1 真因**

### 3.2 Tauri codegen-assets stale (cache)
- 见 `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`
- `ca0e6e2` commit 加了自动 clear,但每次 build 都要 verify
- 详见 commit `fd118e3` (BUILD_MARKER DCE) + `ca0e6e2` (auto-clear)

### 3.3 4 槽并发上限 (D11)
- CLAUDE.md 启动门 ≤4 subagent 同时
- B6 + A8 + B4 + A5 一起改相关文件 → stash 冲突 → 白屏反复
- **规则**: 同文件/同模块 bug → **串行**;不同模块 → 可并行;跨模块依赖 → git worktree 隔离

---

## 4. 验证 checklist 模板

每个 bug 验证时按这个清单走(粘到 commit message 或 PR description):

```markdown
## Bug: [ID] [标题]

### 1. 了解 (problem details)
- 操作路径:
- 前置状态:
- 期望行为:
- 实际行为:
- 触发条件 / 频率:
- 影响范围:

### 2. 原因 (root cause, file:line 证据)
- 真因:
- 关联 commit:

### 3. 边界 (scope)
- 影响模块/文件:
- 平台差异:
- 数据依赖:
- §2.4 白名单 (是否 > 2 文件改动):

### 4. 方案 (technical options)
- 方案 A: ...
- 方案 B: ...
- 推荐: ...
- 风险: ...

### 5. 验证 (evidence)
- [ ] vitest / Playwright 测试改前 FAIL
- [ ] 修后 PASS,测试留 codebase
- [ ] 实际启动 app + 点击按钮 + 截图 before/after
- [ ] 用户亲眼确认
- [ ] 回归测试保留
- [ ] 关联 bug 同步验证 (env var / cache / etc.)
```

---

## 5. 阻塞决策清单

需用户在**新 session 开始前**先回答:

- [ ] **A12**: "settings.json" 指的是 app prefs 还是 Claude Code 的 settings.json?
- [ ] **A6 / B3**: Claude Code plugin install 实际路径?(`installed/` vs `cache/` vs `installed_plugins.json`)——给个实测样例或截图
- [ ] **B1**: Backup 重叠的修复方式(已选合并 `0fdfd9f`,需确认用户对新视图满意)
- [ ] **A9**: 删除 mc + pure-black 主题是否仍需要?(triage 时发现 5 主题已干净)
- [ ] **B7**: 全局 UTC+8 改动涉及 ≥6 文件,白名单已给?(已 commit `1deb267`,需用户回顾)

---

## 6. 相关索引

- **CLAUDE.md §16**: Bug Fix Protocol(本清单的执行依据)
- **`/tmp/triage-report-all-20.md`**: 21 个 bug 的详细诊断
- **`.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`**: AppHeader 缓存 stale 的单独诊断
- **`.planning/milestones/v3.4-phases/tech-debt-test-inventory.md`**: 测试覆盖清单
- **memory `feedback-fix-success-rate.md`**: 5 件必做纪律
- **memory `project-codebase-2026-06-29.md`**: 全 codebase 认知缓存

---

## 7. 本会话经验教训(必读)

1. **Smoke test PASS ≠ bug fixed**(CLAUDE.md §13 + §16.2)
2. **Defense-in-depth ≠ root cause fix**(X1 commit 教训)
3. **可测 bug / 不可测 bug 必须分两类处理**(UI 视觉 / 平台特定 / 主观判断无法 vitest)
4. **4 个并行 subagent 改相关文件 = stash 冲突 = 白屏反复**(CLAUDE.md §11 4 槽上限 + 关联改动串行)
5. **修改前先 read file**(Read 工具前置);用 codegraph_explore 优先于 grep
6. **Subagent 是利益相关方,主 session 必须质疑每个 commit**
7. **Rust 端 env var 系统性不一致**(§3.1)是多个 bug 嫌疑根因,新 session 优先查

---

**写于**: 2026-06-29
**作者**: Claude Code (主 session,在用户指令"重新处理"下整理)
**下次使用**: 新 session 开始时,先读 CLAUDE.md §16 + 本清单 §5 阻塞决策 → 再按 §2 重验证顺序执行