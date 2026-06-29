# VERIFICATION-A10.md — A10 Backup Time 显示错 Bug 重验证

> 按 CLAUDE.md §16 五步流程 + §17 反事故纪律完整执行。
> 关联 commit: (待 commit) `verify(a10): backup time UTC+8 display regression test`
> 关联原始 fix: `1deb267` (master 已 ship — `refactor(time): centralize time formatting with fixed UTC+8`)
> 清单索引: `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md §2 Round 5 A10`

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
- 任意 backup 显示入口:
  - **路径 A** (F13 即时时间线): 侧栏 → "备份与恢复" → 列表 tab → 每行显示 `formatBackupTimestamp(e.timestamp_unix)`
  - **路径 B** (F13 Restore tab): 同上 → Restore tab → 选中备份行
  - **路径 C** (F21 审计): 同上 → 审计 tab → `BackupHistoryTable` → `formatTs(row.created_at)`
  - **路径 D** (history 页 backup 历史): 侧栏 → "查询历史" → (历史版本,已合入备份与恢复页)

### 1.2 前置状态
- B7 commit `1deb267` 已 ship,引入 `src/lib/formatTime.ts` 中心 util
- `formatDateTime(unixSeconds)` 显式 `timeZone: 'Asia/Shanghai'` 锁死 UTC+8
- `src/types/backup.ts:13` `formatBackupTimestamp` `import { formatDateTime } from '../lib/formatTime';`
- `src/types/backup.ts:50-53` `formatBackupTimestamp` delegate 到 `formatDateTime`
- `src/pages/history/BackupHistoryTable.tsx:15` `import { formatDateTime } from '../../lib/formatTime';`
- `src/pages/history/BackupHistoryTable.tsx:22-26` `formatTs(ts)` delegate 到 `formatDateTime`

### 1.3 期望行为
- 时间显示永远锁 UTC+8 (Asia/Shanghai),不随浏览器 TZ 漂移
- `unix = 1782714600` 应渲染 `2026/06/29 14:30:00` (UTC+8),不是 `2026/06/28 23:30:00` (LA local)
- 跨 TZ 字符串稳定 (同一 unix 输入 → 同一字符串,无 shift)

### 1.4 实际行为 (triage 时状态)
- "subagent 派出结果不明" — A10 在 `reverify-bugs-2026-06-29.md` §1 列为模糊状态
- 未 commit,无明确文件:line 证据,无回归测试
- 怀疑: 6 个时间字段 (UsageHistoryTable / BackupHistoryTable / types/backup / about / optimizer / backup-restore) 中至少一处未走 `formatTime.ts`,会 fallback 到浏览器 TZ

### 1.5 触发条件 / 频率
- 用户运行在非 UTC+8 时区 (如 UTC-7 美国西部)
- 查看备份与恢复页 / 历史审计 tab
- 频率: 100% (任何 backup 显示都受影响)

### 1.6 影响范围
- 仅 backup 相关时间字段 (F13 timeline + F21 audit + Restore tab)
- 不影响: usage history 时间 (B7 已验) / about 页 build time / optimizer / 已有 B7 测试覆盖的 6 文件
- 平台差异: 仅 macOS 跟非 UTC+8 用户相关,Windows UTC+8 跟用户本机一样看不出来

---

## 2. 明确问题原因 (§16 第 2 步,file:line 证据)

### 2.1 grep master 排查结论

```bash
# 命令 1: 找 backup 时间字段的渲染函数
grep -n "formatBackupTimestamp\|formatTs" src/types/backup.ts src/pages/backup-restore/index.tsx src/pages/history/BackupHistoryTable.tsx
```

结果 (master HEAD `69089c1`):

| file:line | 符号 | 实现 |
|---|---|---|
| `src/types/backup.ts:50-53` | `formatBackupTimestamp(unix)` | `if (unix == null) return '未知时间'; return formatDateTime(unix);` ✓ delegate |
| `src/pages/history/BackupHistoryTable.tsx:22-26` | `formatTs(ts)` | `const d = new Date(ts * 1000); if (Number.isNaN(d.getTime())) return '—'; return formatDateTime(ts);` ✓ delegate |
| `src/pages/backup-restore/index.tsx:894-896` | 直接调 `formatBackupTimestamp(e.timestamp_unix)` | ✓ delegate |
| `src/pages/backup-restore/index.tsx:1188-1190` | 直接调 `formatBackupTimestamp(entry.timestamp_unix)` | ✓ delegate |

```bash
# 命令 2: 找 backup-restore 是否有直接 toLocaleString 调用
grep -n "toLocaleString\|toLocaleDateString\|toLocaleTimeString" src/pages/backup-restore/index.tsx
```

结果: 无 (0 hit)。

```bash
# 命令 3: 确认 formatTime.ts 显式 timeZone
grep -n "timeZone" src/lib/formatTime.ts
```

结果: `src/lib/formatTime.ts:24` `timeZone: TIME_ZONE,` + `src/lib/formatTime.ts:19` `const TIME_ZONE = 'Asia/Shanghai';` ✓

### 2.2 真因 (master 状态)

**A10 在 master 已修复 — B7 commit `1deb267` 引入的 `formatTime.ts` 中心 util 把所有 backup 时间字段都 lock 到了 UTC+8。**

证据链:
1. `src/lib/formatTime.ts:19-32` 显式 `timeZone: 'Asia/Shanghai'`,无浏览器 TZ 漂移
2. `src/types/backup.ts:13, 50-53` `formatBackupTimestamp` delegate 到 `formatDateTime`
3. `src/pages/history/BackupHistoryTable.tsx:15, 22-26` `formatTs` delegate 到 `formatDateTime`
4. backup-restore 页 2 处使用 `formatBackupTimestamp`(transitive delegate)

### 2.3 关联 commit

- **核心 fix**: `1deb267` — `refactor(time): centralize time formatting with fixed UTC+8 (Asia/Shanghai)` (B7)
- **辅助 commit**: `747055c` + `9f4eb1d` — vitest coverage for centralized UTC+8 helper (B7 reverify)
- **辅助 commit**: `b88e4ac` + `a1c835c` — VERIFICATION-B7.md reports

### 2.4 为什么 A10 仍属 "subagent 派出结果不明"

reverify 清单 §1 A10 行: "subagent 派出结果不明" — 是历史模糊状态:
- 没独立 commit
- 没专门 vitest 文件
- B7 fix 范围 ≥6 文件 (UsageHistoryTable / BackupHistoryTable / types/backup / about / optimizer / backup-restore) 全部合在一起
- 没有 A10-specific 聚焦的回归测试 (B7 测试覆盖 `formatBackupTimestamp` 但不渲染 `BackupHistoryTable` 也不跨组件)

本次按 §16 重新独立验证,并写 A10-specific 聚焦回归测试。

---

## 3. 明确边界 (§16 第 3 步)

### 3.1 影响模块/文件 (本次验证覆盖)

| file:line | 验证角度 |
|---|---|
| `src/lib/formatTime.ts:22-32` | `formatDateTime` UTC+8 单元 |
| `src/types/backup.ts:50-53` | `formatBackupTimestamp` delegate 契约 |
| `src/pages/history/BackupHistoryTable.tsx:22-26` | `formatTs` delegate 到 formatDateTime |
| `src/pages/history/BackupHistoryTable.tsx:154` | row 第一列 `<td>{formatTs(row.created_at)}</td>` |
| `src/pages/backup-restore/index.tsx:894-896, 1188-1190` | timeline + restore row 时间显示 |
| `src/pages/backup-restore/index.tsx:1249` | audit tab → `BackupHistoryTable rows={auditRows}` |

### 3.2 不影响 (本次不覆盖)

- usage history 时间 (B7 单独覆盖, `formatTime.spec.ts` 已 PASS)
- about 页 build time (B7 已覆盖)
- optimizer 时间字段 (B7 已覆盖)
- 备份文件 mtime / ctime (底层 Rust 写入时间,不在前端格式化范围)

### 3.3 平台差异

- 浏览器/WebView2/WebView 行为一致 — 都遵循 `Intl.DateTimeFormat` 显式 `timeZone` 参数
- Vitest jsdom env 也支持 `process.env.TZ` 切换 + `Intl.DateTimeFormat` 显式 timeZone
- macOS 真机 / Windows 真机 跨 TZ 验证已在 B7 reverify 跑过 (`747055c` 测试含 TZ swap)

### 3.4 数据依赖

- 测试 fixture: `unix = 1782714600` (2026-06-29 06:30 UTC = 2026-06-29 14:30 UTC+8)
- 跨 TZ 测试: `process.env.TZ = 'America/Los_Angeles'` (UTC-7, 显示 2026-06-28 23:30 LA local — 与 UTC+8 14:30 形成强对照)

### 3.5 §2.4 白名单 (是否 > 2 文件改动)

本次验证只新增 **1 个测试文件**,不修改任何业务代码 (master 的 B7 fix 已 ship)。
- 新增: `src/__tests__/pages/backup-time-display.spec.tsx`
- 修改: 0
- 删除: 0

→ **不需要 §2.4 白名单**。

---

## 4. 分析技术方案 (§16 第 4 步)

### 4.1 方案 A — 写 A10 聚焦 vitest (推荐,本次采用)

**做法**: 新建 `src/__tests__/pages/backup-time-display.spec.tsx`,3 个角度 9 个 case:
1. **Utility 角度** (4 case): `formatBackupTimestamp` 直接断言 + cross-TZ + null 契约 + delegate
2. **Presentation 角度** (3 case): `BackupHistoryTable` 渲染多行 + cross-TZ 渲染
3. **Integration 角度** (1 case): backup-restore audit tab 渲染完整 IPC 链路
4. **Reverse 角度** (1 case): 故意 broken impl 应 FAIL (TDD §16.2 硬证据)

**优点**:
- A10-specific 聚焦回归测试,留 codebase
- 跨 3 层 (util / presentation / integration) 完整覆盖
- 显式 cross-TZ 模拟 (`process.env.TZ = 'America/Los_Angeles'`)
- Reverse case 证明测试能抓 buggy impl,不是 vacuous

**缺点**: 无 (符合 §16.2 硬证据要求)

**风险**: 低 — 只新增测试文件,不动业务代码

### 4.2 方案 B — 扩展现有 `format-time.spec.ts`

**做法**: 在 `src/__tests__/lib/format-time.spec.ts` 加几行 BackupHistoryTable 渲染断言。

**优点**: 复用现有 B7 测试文件

**缺点**:
- 现有文件只测 utility 层,加组件渲染 = 跨文件职责 (lib test 测 component)
- BackupHistoryTable 测试在 backup-time-display 上下文更自然
- 现有 B7 测试不应混入新 feature 验证

**风险**: 低

### 4.3 推荐方案

**A** — 新建 A10 聚焦测试文件,职责清晰,与 A1/A4/A5/A7/A8 reverify 风格一致。

---

## 5. 修复后实际验证 (§16 第 5 步)

### 5.1 改前 FAIL 证据 (TDD §16.2 硬证据)

临时修改 `src/lib/formatTime.ts::formatDateTime`,故意 drop `timeZone` 选项,模拟回归:

```typescript
// src/lib/formatTime.ts 临时编辑 (已被还原)
export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(LOCALE, {
    // 故意缺 timeZone: TIME_ZONE, — 模拟回归
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
```

跑 `vitest run src/__tests__/pages/backup-time-display.spec.tsx` 结果:

```
 FAIL  src/__tests__/pages/backup-time-display.spec.tsx > BackupHistoryTable > cross-TZ: row text identical regardless of host TZ
AssertionError: expected '2026/06/28 23:30:00settings.json.bak.…' to be '2026/06/29 14:30:00settings.json.bak.…'

 FAIL  ... > reverse case: a buggy local-TZ impl would FAIL this test > asserts that swapping TZ to LA would expose a buggy local-TZ implementation
AssertionError: expected '2026/06/28 23:30:00' to contain '29'

 Tests  3 failed | 6 passed (9)
```

3 个 case FAIL (cross-TZ × 2 + reverse × 1),强证据:测试能抓到 buggy impl,且暴露的具体差异 `2026/06/28 23:30:00` (LA local) vs `2026/06/29 14:30:00` (UTC+8) 正是用户报告的"时间错"症状。

### 5.2 改后 PASS 证据

恢复 `src/lib/formatTime.ts::formatDateTime` 到 master 版本 (含 `timeZone: TIME_ZONE`):

```bash
diff /tmp/formatTime.ts.backup src/lib/formatTime.ts
# 输出: RESTORED OK
```

跑 `vitest run src/__tests__/pages/backup-time-display.spec.tsx`:

```
 ✓ src/__tests__/pages/backup-time-display.spec.tsx (9 tests) 55ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

9/9 PASS — master 的 B7 fix (`1deb267`) 在 backup 时间字段已正确生效。

### 5.3 完整 §16 五步证据汇总

| 步骤 | 证据 |
|---|---|
| 1. 了解 | §1.1-1.6 操作路径 / 前置 / 期望 / 实际 / 触发 / 范围 |
| 2. 原因 | §2.1 grep master 命令 + 结果表 + 真因 (B7 已 ship) |
| 3. 边界 | §3.1-3.5 影响文件表 + 不影响表 + 平台差异 + 数据依赖 + §2.4 白名单 (不触发) |
| 4. 方案 | §4.1-4.3 ≥2 方案对比 + 推荐 |
| 5. 验证 | §5.1 改前 FAIL (3/9) + §5.2 改后 PASS (9/9) + TDD §16.2 双证据 |

### 5.4 回归保护

新测试文件 `src/__tests__/pages/backup-time-display.spec.tsx` 留 codebase:
- 9 个 case 跨 util/presentation/integration/reverse 4 个角度
- 任何人未来 revert B7 fix 或误改 `formatBackupTimestamp` delegate 链都会被这 9 个 case 抓到
- 与 B7 `src/__tests__/lib/format-time.spec.ts` 形成双保险 (B7 测 utility 层,A10 测 presentation + integration 层)

---

## 6. 结论

**A10 "Backup time 显示错" 在 master HEAD `69089c1` 已修复** — 由 B7 commit `1deb267` 的 `formatTime.ts` 中心 util 统一锁 UTC+8 顺带解决,不需要单独 fix。

**新增回归测试**: `src/__tests__/pages/backup-time-display.spec.tsx` (9 case, 全部 PASS)
**改前 FAIL 证据**: 3/9 case 在故意 drop `timeZone` 时显示 `2026/06/28 23:30:00` (LA local) vs `2026/06/29 14:30:00` (UTC+8),与用户报告的"时间错"症状一致
**改后 PASS 证据**: master 代码 9/9 case PASS

清单 §1 A10 行从 "subagent 派出结果不明" 升级为 "已 verify + 回归测试留 codebase"。

---

**写于**: 2026-06-30
**作者**: Claude Code (verify subagent, A10 reverify)
**分支**: `verify/a10-backup-time` (从 master HEAD `69089c1` 拉出)
**worktree**: `/Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-a0b5e17b6cd58a9fd`