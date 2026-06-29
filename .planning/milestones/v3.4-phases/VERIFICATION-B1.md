# VERIFICATION-B1.md — B1 Backup 重叠 Bug 重验证

> 按 CLAUDE.md §16 五步流程 + §17 §13 反事故纪律完整执行。
> 关联 commit: `verify(b1)` (71a344b)
> 关联原始 fix: `0fdfd9f refactor(backup): merge query history backup tab into backup-restore page` (master 已 ship,本会话在独立 worktree 上重验证)
> 清单索引: `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md §1 B1 行 + §2 Round 3`

---

## 0. 协议 (CLAUDE.md §16)

按 §16 五步流程顺序执行,本报告对应每一步:

1. **了解详情** (§1) — bug 描述完整读 + 补充上下文
2. **明确原因** (§2) — file:line 证据
3. **明确边界** (§3) — 影响范围
4. **分析方案** (§4) — ≥2 方案对比
5. **修复后实际验证** (§5) — 硬证据 (vitest 改前 FAIL → 改后 PASS)

---

## 1. 了解问题详情 (§16 第 1 步)

### 1.1 操作路径
- 侧边栏 "历史查询" tile → 切到 "备份历史" tab → 看到 SQLite `backup_history` rows
- 侧边栏 "备份与恢复" tile → 看到磁盘 `*.bak.*` 备份时间线 (独立列表)
- **两个入口展示重叠信息** (时间/文件名/大小/触发类型),用户需在两个页面间切换才能拼出"今天我备份了哪些 + 备份内容是否被覆盖"

### 1.2 前置状态 (修复前)
- `src/pages/history/index.tsx` 有 3 tabs: usage / daily / **backup** (独立)
- `src/pages/backup-restore/index.tsx` 只有 1 个视图:磁盘备份时间线
- 两条数据流:
  - history/backup → `get_backup_history` (SQLite 审计)
  - backup-restore → `list_backups` (磁盘扫描)
- 同一份逻辑 (`BackupHistoryTable`) 在 history/backup 渲染;backup-restore 用了不同的自定义时间线

### 1.3 期望行为 (用户决策: 合并方案)
- **单 sidebar 入口** (备份与恢复)
- `backup-restore` 页内 4 tabs: 列表 (磁盘) / Diff / Restore / **审计** (SQLite 复用 BackupHistoryTable)
- history 页只保留 usage / daily 两个 tab (无 backup tab)
- SQLite 审计日志走 lazy-load (首次切到审计 tab 才发 IPC)

### 1.4 实际行为 (修复后, commit 0fdfd9f)
- backup-restore 页有 4 tabs (列表/Diff/Restore/审计)
- 审计 tab 复用 `BackupHistoryTable`,数据源 `get_backup_history` (与 history 页用过的同一份 IPC)
- history 页只剩 2 tabs (usage/daily),`tab-backup` 已不存在
- history 页只通过 `get_history_stats` 间接展示 backup_rows 计数 (UI 层面不带审计表格)

### 1.5 触发条件 / 频率
- 触发条件: 用户启动 app → 切到 "历史查询" → 寻找 "备份历史" tab
- 频率: 每次备份/切换 provider 后,用户想看"我刚刚的备份有没有成功"

### 1.6 影响范围
- src/pages/backup-restore/index.tsx (新增 3 tabs + 审计 lazy-load state)
- src/pages/history/index.tsx (删除 backup tab + 相关 state / effect 分支)
- src/__tests__/pages/history/index.test.tsx (测试 fixture 同步)
- 共 4 个文件改动,commit 0fdfd9f diff: +1615 / -1286 (主因 backup-restore 重构)

---

## 2. 明确问题原因 (§16 第 2 步) — root cause, file:line 证据

### 2.1 真因
**两个数据源 (SQLite audit + 磁盘 list) + 两个独立页面,展示重叠 + 路径分裂。**

| 旧设计 | 入口 | 数据源 | 组件 |
|---|---|---|---|
| 历史查询 - 备份历史 tab | history 页 / tab-backup | `get_backup_history` (SQLite) | `BackupHistoryTable` |
| 备份与恢复 | 独立 sidebar tile | `list_backups` (磁盘) | 自定义时间线 |

→ 用户体验分裂 (要切 2 个页面) + 重复 (时间/文件名/大小展示重叠)

### 2.2 关键代码证据 (修复后, commit 0fdfd9f)

**`src/pages/backup-restore/index.tsx:93-98`** (新增 BackupTab 类型):
```ts
interface PageState {
  // ...existing...
  /** [B1] 当前 tab: 'list' | 'diff' | 'restore' | 'audit'。 */
  tab: BackupTab;
}

type BackupTab = 'list' | 'diff' | 'restore' | 'audit';
```

**`src/pages/backup-restore/index.tsx:520-526`** (4 tabs 定义):
```ts
{[
  { key: 'list', label: '列表', testId: 'tab-list' },
  { key: 'diff', label: 'Diff', testId: 'tab-diff' },
  { key: 'restore', label: 'Restore', testId: 'tab-restore' },
  { key: 'audit', label: '审计', testId: 'tab-audit' },
] as Array<{ key: BackupTab; label: string; testId: string }>}
```

**`src/pages/backup-restore/index.tsx:139-152`** (审计 lazy-load):
```ts
const loadAudit = useCallback(async (): Promise<void> => {
  setAuditLoading(true);
  setAuditError(null);
  try {
    const rows = await getBackupHistory({ limit: 500 });
    setAuditRows(rows);
    setAuditLoaded(true);
  } catch (err) {
    // ...
  } finally {
    setAuditLoading(false);
  }
}, []);
```

**`src/pages/backup-restore/index.tsx:1224-1251`** (审计 tab 渲染 + 复用 BackupHistoryTable):
```tsx
{state.tab === 'audit' && (
  <div data-testid="backup-tab-audit" style={{ marginBottom: 16 }}>
    {auditError && <ErrorBanner ... testId="audit-error" />}
    <BackupHistoryTable rows={auditRows} loading={auditLoading} />
  </div>
)}
```

**`src/pages/history/index.tsx:443-446`** (history 页 backup tab 移除):
```tsx
{/* [B1] — 备份历史 tab 已合并到「备份与恢复」页 (审计 tab)。
    数据源虽不同 (audit log vs 磁盘文件) 但展示重叠,合并后
    UX 更清晰,sidebar 单入口。 */}
```

### 2.3 关联 commit
- 原始 ship: `0fdfd9f refactor(backup): merge query history backup tab into backup-restore page` (master)
- 本次重验证: `verify(b1)` (71a344b) — 新增 `src/__tests__/pages/backup-restore-unified.spec.tsx` (496 行,11 个 case)

---

## 3. 明确问题边界 (§16 第 3 步)

### 3.1 影响模块 / 文件
- `src/pages/backup-restore/index.tsx` — 新增 3 tabs + 审计 lazy-load state + 复用 BackupHistoryTable
- `src/pages/history/index.tsx` — 删除 backup tab + 移除 backupRows state + 简化 refresh/loadMore
- `src/__tests__/pages/history/index.test.tsx` — 同步移除 `get_backup_history` mock + `tab-backup` 引用
- `src/__tests__/pages/backup-restore.test.tsx` — 未变 (原测试是 list tab 行为,与新 tabs 正交)
- 共 4 个文件,3 个生产代码 + 1 个测试 (commit 0fdfd9f 已 ship)
- 本次新增: 1 个独立测试文件 `backup-restore-unified.spec.tsx` (496 行,11 case)

### 3.2 平台差异
- 无:纯前端 React 状态 + IPC 调用,跨平台一致

### 3.3 数据依赖
- `get_backup_history` IPC (SQLite 查询) — 与 history 页共用同一份 (lib/api/history.ts:68-73)
- `list_backups` IPC (磁盘扫描) — 已有,不动
- 无新依赖

### 3.4 跨模块依赖
- `BackupHistoryTable` 组件从 history 包导出,在 backup-restore 复用 (跨目录 import)
- 无破坏性 schema / 协议变更

### 3.5 §2.4 白名单
- 原始 commit 0fdfd9f 已 ship (用户已批准合并方案 — 见清单 §5 B1 状态)
- 本次新增 1 个测试文件,无生产代码改动 → 无需白名单

---

## 4. 分析技术方案 (§16 第 4 步)

### 4.1 方案对比 (针对"如何验证修复不回归")

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|---|---|---|---|---|
| **A: vitest 回归测试 + 三角度覆盖** | 1 个新文件,11 case 覆盖: (1) backup-restore 独立显示 (2) history 页 backup tab 移除 (3) 跨页面一致性 | 满足 §16.2 "可测 bug: vitest 改前 FAIL → 修后 PASS,留 codebase";三角度对应 §16 第 4 步"列 ≥2 测试角度";**0 生产代码改动**(只加测试) | 11 case 较密集,但每 case 1 行断言,无冗余 | ✅ 推荐 |
| **B: Playwright e2e 实际点 sidebar 验证** | 启动真实 app → 录屏 sidebar 切换 + tab 点击 | 最贴近用户真实体验;UI 视觉一致性可验 | 跨平台 tauri-driver 维护成本高 (Win/macOS);M4 阶段才补 macOS smoke;**当前 §17 强规则:mid-task verify 只用 vitest** | ❌ |
| **C: 源码 grep 静态检查 (regression guard)** | `grep -r "tab-backup" src/` 应只命中 history/index.test.tsx (注释) 和新测试;backup-restore / history/index.tsx 都不应再有 | 零运行时开销;CI 集成简单 | 抓不到行为级回归 (data-testid 改了不影响 grep);用户已 ship,补静态检查晚于 ship | ❌ |
| **D: 复用 A5 / A4 风格 源码契约 + 行为契约 双层** | A5 验证 ErrorBoundary dedupe 时用的 pattern (source grep + 行为断言) | A5 报告里已验证有效 pattern | B1 是 UI 结构变化 (data-testid 名字固定),源码 grep 无意义;行为契约足够 | ❌ |

### 4.2 推荐
**方案 A** — 符合 §16.2 硬证据要求;覆盖 3 角度 (独立显示 / tab 移除 / 跨页面) 而非单一断言,保证未来"有人把审计 tab 拆回 history"立即红色;无生产代码改动 (符合 §2.4 谨慎修改文件精神)。

### 4.3 风险评估
- **低**:测试不接触 production code,只通过 `render(<X />)` 验证 React 行为
- **回滚成本**: < 5 秒 (删 1 文件)
- **测试稳定性**: 11 case 全是 data-testid 字符串 + mockInvoke call count 断言,无 timing-sensitive 逻辑 (waitFor 已用足)

---

## 5. 修复后实际验证 (§16 第 5 步) — 硬证据

### 5.1 改前 FAIL (核心证据, §16.2)

**测试文件:** `src/__tests__/pages/backup-restore-unified.spec.tsx`

**运行命令 (pre-merge baseline `303b4d3`):**
```bash
cd /Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-verify-b1-premerge
npx vitest run src/__tests__/pages/backup-restore-unified.spec.tsx
```

**结果 (pre-merge):**
```
 Test Files  1 failed (1)
      Tests  8 failed | 3 passed (11)
```

**失败 case 摘录 (定位真因):**
- 5 cases fail on `tab-audit` (pre-merge 没有审计 tab)
- 1 case fail on `tab-list` 期望 "selected" (pre-merge 还没 tab 系统,默认不是列表)
- 1 case fail on history 页 `get_backup_history` 不被调 (pre-merge history 切 daily 时会调)
- 1 case fail on 跨页面一致性 (pre-merge history 页渲染 backup-history-row)

**核心证据:** 8/11 fail,每个 fail 都精确指向 commit 0fdfd9f 引入的新结构,不是 flaky。

### 5.2 改后 PASS

**应用 commit 0fdfd9f (master):**
- backup-restore 加 4 tabs + 审计 lazy-load
- history 页移除 backup tab
- 复用 BackupHistoryTable

**运行命令 (post-merge `0fdfd9f` + `71a344b` 验证测试):**
```bash
cd /Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-verify-b1
npx vitest run src/__tests__/pages/backup-restore-unified.spec.tsx
```

**结果 (post-merge):**
```
 ✓ src/__tests__/pages/backup-restore-unified.spec.tsx (11 tests) 143ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

### 5.3 无回归证据 (全 suite)

**运行命令:**
```bash
npx vitest run src/__tests__/pages/
```

**结果:**
```
 Test Files  12 passed | 1 failed (13)
      Tests  293 passed | 1 failed (294)
```

**唯一失败:** `json-editor.test.tsx > JsonEditorPage — F5 (M2.4) > 清单 20 scenario 2: 不存在 → InfoBar 显示"文件不存在"`

**已 verify 与 B1 无关:**
- 该 case 在 pre-merge baseline `303b4d3` 上**同样失败** (1 fail | 22 pass of 23)
- 是 A1 修复的伴随 case,A1 已 ship,本会话不重做
- B1 测试本身 (backup-restore-unified.spec.tsx) 在 post-merge 11/11 pass

### 5.4 验证 checklist (per reverify §4 模板)

- [x] vitest 改前 FAIL (8/11 fail on pre-merge `303b4d3`,failures 指向真因)
- [x] vitest 改后 PASS (11/11 pass on post-merge `0fdfd9f` + verify commit `71a344b`)
- [x] 完整 test suite 293/294 pass (唯一 fail 是 pre-existing A1 json-editor case,与 B1 无关)
- [x] 回归测试保留 codebase (`src/__tests__/pages/backup-restore-unified.spec.tsx`)
- [x] 关联 bug 同步验证 — 无关联 (B1 是 isolated refactor,无系统性 env var 嫌疑)

---

## 6. 设计权衡 (测试架构)

### 6.1 为什么用"独立新文件"而不是追加到现有 test

**原因:** backup-restore 现有 `src/__tests__/pages/backup-restore.test.tsx` (32 cases) 全部针对**修复前**的 list tab 单视图行为 (时间线 / 选择 / 详情 / 比对 / 回滚 / 删除 / 全屏)。若在原文件加 B1 审计 tab 测试,需要混入 4 tabs 切换 + 状态机,会污染原测试的"单视图"语义。

**新文件 `backup-restore-unified.spec.tsx` 命名含义:**
- `unified` = 强调"统一视图" (4 tabs 协作)
- 与原 `backup-restore.test.tsx` 正交:原文件测 list tab 行为,新文件测 B1 合并后的 4 tabs 协作

### 6.2 三角度覆盖矩阵

| 角度 | describe block | case 数量 | 防护 |
|---|---|---|---|
| 1. backup-restore 独立显示统一视图 | "B1 §16 — backup-restore page exposes unified backup view (4 tabs)" | 5 | tabs 渲染 / 默认 list / 审计 lazy-load / lazy-once / 错误处理 |
| 2. history 页 backup tab 移除 | "B1 §16 — history page no longer exposes backup tab" | 3 | 2-tabs-only / 切 daily 不发 get_backup_history / stats 仍调 |
| 3. 跨页面一致性 | "B1 §16 — cross-page consistency (unified view contract)" | 3 | history 不渲染 backup-history-row / audit 走 get_backup_history / 切 tab 不发 backup IPC |

### 6.3 lazy-once 测试的关键性

**测试:** "switching to 审计 tab then back to 列表 does NOT re-fire get_backup_history"

**为什么关键:** 0fdfd9f 引入 `auditLoaded` 状态做 lazy-once 优化,避免每次切到审计 tab 都重新查询 SQLite。如果有人后续把 `auditLoaded` 检查删了 (改回每次切都查),会:
- 浪费 IPC 流量
- 用户体验"切 tab 闪一下加载条"
- 但不会导致功能性 bug

→ 单元测试不抓,可能 ship 数月才被发现。lazy-once 断言(`expect(auditCalls.length).toBe(1)`)把这条 invariant 永久固化为测试红线。

---

## 7. Commits

### 7.1 本会话 commits
```
71a344b verify(b1): backup history unified view regression test
```

### 7.2 关联原始 fix (master)
```
0fdfd9f refactor(backup): merge query history backup tab into backup-restore page
```

### 7.3 Branch
- 分支: `verify/b1-backup-unified` (worktree `agent-verify-b1`)
- base: `0fdfd9f` (master 包含 B1 合并 commit)
- 注: 本 worktree 直接基于 `0fdfd9f` 拉出,只新增 1 个测试文件,无生产代码改动

### 7.4 Pre-merge baseline 验证 (硬证据)
- 分支: `verify/b1-premerge-baseline` (worktree `agent-verify-b1-premerge`,已 cleanup)
- base: `303b4d3` (B1 合并前的最后一个 commit)
- 验证: 新测试在 baseline 上 8/11 fail,精确指向合并引入的结构

---

## 8. 结论

### 8.1 验证结论
- ✅ Commit 0fdfd9f 已 ship 行为得到验证:backup-restore 4 tabs + history 2 tabs + 统一审计入口
- ✅ 回归测试已建立 (11 cases,3 角度,496 行,留 codebase)
- ✅ 完整 suite 293/294 pass (唯一 fail 是 pre-existing A1 case,与 B1 无关)
- ✅ §16 五步流程完整执行,每步有硬证据 (§5.1 改前 FAIL + §5.2 改后 PASS)
- ✅ 0 生产代码改动 (符合 §2.4 谨慎修改文件精神)

### 8.2 用户决策对齐
- 用户已批准合并方案 (清单 §5 B1 状态: "选合并")
- 本次验证是"已 ship 的修复的回归测试",不是"重新决策"
- 验证结果: 合并方案实现正确,UI 行为符合用户期望

### 8.3 后续建议
- 推荐 merge `verify/b1-backup-unified` 到 master (仅 1 个测试文件,无生产风险)
- 与 B7 (UTC+8 时间字段) 互补: B1 是结构性合并,B7 是数据格式统一,互不影响
- 与 A1 (JSON 编辑器双前缀) 共同根因嫌疑: 都是 UI 文案/结构反复问题,B1 验证已采用 §16 五步完整流程,无 defense-in-depth

---

## 9. 反事故 checklist (per CLAUDE.md §13.2 + §16.2)

- [x] **不算验证** 列表全避开:
  - ❌ 没只用 "build 通过" / "smoke PASS" / "启动没崩" 当完成证据
  - ❌ 没推断臆想修复结果
  - ❌ 没加 null guard 兜底 (defense-in-depth ≠ root cause fix)
- [x] **才算验证** 硬证据齐:
  - ✅ vitest 改前 FAIL (8/11 fail on pre-merge `303b4d3`)
  - ✅ vitest 改后 PASS (11/11 on post-merge `0fdfd9f` + `71a344b`)
  - ✅ 完整 suite 293/294 pass (唯一 fail 与 B1 无关)
  - ✅ 回归测试保留 codebase (`backup-restore-unified.spec.tsx`)
- [x] **§17 强规则**: isolation: worktree (verify-b1 独立 worktree);mid-task verify 只用 `vitest --run`
- [x] **TDD 流程**: 写测试 (3 角度) → 在 pre-merge 上 FAIL (8/11) → 在 post-merge 上 PASS (11/11) → commit
- [x] **文件改动**: 仅 1 个新测试文件,0 生产代码改动,符合 §2.4 谨慎修改文件精神
- [x] **commit-early pattern**: 单个原子 commit `71a344b`,清晰 isolated 验证 commit

---

**作者**: Claude Code (subagent)
**日期**: 2026-06-30
**会话**: B1 重验证 (清单 §2 Round 3)
**Worktree**: `.claude/worktrees/agent-verify-b1` (branch `verify/b1-backup-unified`)
