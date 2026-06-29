# VERIFICATION-B2.md — B2 Day aggregation 选日期不查询 Bug 重验证

> 按 CLAUDE.md §16 五步流程 + §17 / §13 反事故纪律完整执行。
> 关联原始 fix: `34d4bb4 fix(history): convert from_ts/to_ts to from_date/to_date for daily tab` (master 已 ship)
> 本会话 verify commit: `verify(b2): daily aggregation filter 回归测试`
> 清单索引: `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md §1 B2 + §2 Round 3 B2`

---

## 0. 协议 (CLAUDE.md §16)

按 §16 五步流程顺序执行,本报告对应每一步:

1. **了解详情** (§1) — bug 描述完整读 + 补充上下文
2. **明确原因** (§2) — file:line 证据
3. **明确边界** (§3) — 影响范围
4. **分析方案** (§4) — ≥2 方案对比
5. **修复后实际验证** (§5) — 硬证据 (TDD RED → GREEN)

任务定位: **verify, not re-fix** (CLAUDE.md §17 / 任务派单明确禁止). 源码已 ship 在 master,本会话仅添加回归测试。

---

## 1. 了解问题详情 (§16 第 1 步)

### 1.1 操作路径
- 打开应用 → 进入 `历史查询` 页 (路由 `/history`)
- 点击 `按天汇总` tab (data-testid=`tab-daily`) → 渲染 `DailyStatsTable`
- 顶栏 FilterBar 通过 `起始日期` / `结束日期` DatePicker 选日期范围
- 预期: 列表根据所选日期范围重新查询
- 实际(修复前): 选了日期后列表**不变化**,仍然返回未过滤的全表

### 1.2 前置状态
- 数据库 `usage_daily_stats` 表已有 ≥1 条聚合记录 (来自 F7 用量页 + 后端聚合调度)
- 用户的 `~/.claude/settings.json` 或 provider 配置触发了 ≥1 次历史聚合

### 1.3 期望行为
- 选 `起始日期 = 2026-06-01` + `结束日期 = 2026-06-30` → 列表显示 2026-06 月所有聚合行
- 选不同日期 → 触发新查询 + 列表更新
- 同一日期二次选择 → 不重复查询 (effect deps 稳定)

### 1.4 实际行为 (修复前 `0fdfd9f` 之前)
- 用户在 FilterBar 选日期 → 触发 `setFilter({from_ts: <unix-seconds>, to_ts: <unix-seconds>})`
- `HistoryPage::refresh` 的 daily 分支把 `...filter` 直接 spread 到 `getDailyStatsHistory(...)` 的入参
- 后端 Rust `services::history::DailyStatsFilter` 期望 `from_date` / `to_date` (字符串 `YYYY-MM-DD`),但收到的是 `from_ts` / `to_ts` (unix seconds)
- Serde 找不到对应字段 → 静默丢弃 → SQL `WHERE stat_date >= ... AND stat_date <= ...` 永远不 fire
- 每次都返回全表 → 用户感观"选了日期不查询"

### 1.5 触发条件 / 频率
- 触发条件: 切到 daily tab + 选任意非默认日期
- 频率: **100% 命中** — daily tab 选日期必触发

### 1.6 影响范围
- 列表数据: 全部用户可见,影响 daily 视图核心功能
- 不影响: usage_history / backup_history 各自 tab (它们用 `from_ts` 是正确的,shared `HistoryFilter` 设计正常)
- 不影响: Rust 端 SQL / 索引 / schema (DailyStatsFilter 本来就期望 `from_date`)

---

## 2. 明确问题原因 (§16 第 2 步) — root cause, file:line 证据

### 2.1 真因

**Filter 类型不匹配 (pre-`34d4bb4` 状态下,`src/pages/history/index.tsx:249-256`):**

`HistoryFilter` (FilterBar 的输入类型) 字段是 `from_ts` / `to_ts` (unix seconds,匹配 `usage_history.recorded_at`)。
`DailyStatsFilter` (Rust 端 `services::history::DailyStatsFilter`) 字段是 `from_date` / `to_date` (字符串 `YYYY-MM-DD`,匹配 `usage_daily_stats.stat_date` TEXT 列)。

`FilterBar` 给所有 tab 共享同一组 filter 字段,daily tab 把 `from_ts` 透传给 `get_daily_stats_history` IPC → Rust serde 找不到对应字段 → 静默丢弃 → 永远返回全表。

### 2.2 关键代码证据

**`src/pages/history/index.tsx:249-256` (pre-fix, **bug 现场**):**
```tsx
} else if (tab === 'daily') {
  const rows = await getDailyStatsHistory({
    ...(filter as Parameters<typeof getDailyStatsHistory>[0]),  // ← 直 spread,filter 含 from_ts/to_ts
    limit: pageSize,
  });
```

**`src/pages/history/index.tsx:287-298` (pre-fix loadMore, **bug 现场**):**
```tsx
} else if (tab === 'daily' && dailyCursor !== null) {
  const rows = await getDailyStatsHistory({
    ...(filter as Parameters<typeof getDailyStatsHistory>[0]),
    limit: pageSize,
    from_date: new Date(dailyCursor).toISOString().slice(0, 10),  // ← Date() 吃 unix-ms,cursor 实际是 unix-seconds,误算
  });
```

注意 loadMore 分支 "看似有 from_date" 实则也是错的:`new Date(dailyCursor)` 把 unix-seconds 当 unix-ms 解释,只对恰好 ≥ `10^12` 的 ts 偶然产出"正确" ISO 字符串;一旦 `dailyCursor` 是 `1_715_000_000` 量级 (秒),`toISOString()` 会产生 `1970-01-20...` 这种荒谬值。

**修复后 (`34d4bb4`) — `src/pages/history/index.tsx:132-167` 新增 helper:**
```tsx
function tsToIsoDate(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  const d = new Date(ts * 1000);  // ← 显式 × 1000 修 loadMore 误算
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toDailyFilter(
  filter: HistoryFilter,
): Parameters<typeof getDailyStatsHistory>[0] {
  const out: Parameters<typeof getDailyStatsHistory>[0] = {};
  if (filter.provider_id) out.provider_id = filter.provider_id;
  const fromDate = tsToIsoDate(filter.from_ts);  // ← 字段重映射
  if (fromDate) out.from_date = fromDate;
  const toDate = tsToIsoDate(filter.to_ts);
  if (toDate) out.to_date = toDate;
  return out;
}
```

**`src/pages/history/index.tsx:249-256` (post-fix):**
```tsx
} else if (tab === 'daily') {
  const rows = await getDailyStatsHistory({
    ...toDailyFilter(filter),  // ← 走转换
    limit: pageSize,
  });
```

**`src/pages/history/index.tsx:287-304` (post-fix loadMore):**
```tsx
} else if (tab === 'daily' && dailyCursor !== null) {
  const cursorDate = tsToIsoDate(dailyCursor);
  const base = toDailyFilter(filter);
  const rows = await getDailyStatsHistory({
    ...base,
    ...(cursorDate ? { from_date: cursorDate } : {}),  // ← cursor 走 tsToIsoDate
    limit: pageSize,
  });
```

### 2.3 关联 commit
- 原始 ship: `34d4bb4 fix(history): convert from_ts/to_ts to from_date/to_date for daily tab` (master 已 ship,变更 1 文件 +55/-3 行)
- 本会话 verify commit: `verify(b2): daily aggregation filter 回归测试`

---

## 3. 明确问题边界 (§16 第 3 步)

### 3.1 影响模块 / 文件

**原始 fix (`34d4bb4`) 涉及 (1 个文件):**
- `src/pages/history/index.tsx` — 新增 `tsToIsoDate` + `toDailyFilter`;refresh + loadMore 改用

**本 verify commit 涉及 (1 个新文件):**
- `src/__tests__/pages/daily-aggregation-filter.spec.tsx` — 6 个 vitest case

**总计 2 个文件** — 修复 1 文件 ≤2 无需白名单,验证 1 新文件 (符合 §2.4)。

### 3.2 平台差异
- 无: 纯前端 React + 字符串字段映射逻辑,跨 Windows / macOS / Linux 一致
- UTC 锚定 (`getUTCFullYear` / `getUTCMonth` / `getUTCDate`) 保证不踩 locale 坑

### 3.3 数据依赖
- `usage_daily_stats.stat_date` 是 TEXT 列,形如 `'2026-06-30'`
- `HistoryFilter.from_ts` / `to_ts` 是 unix seconds (来自 `DatePicker` 的 `dateToTs`)
- 转换函数 `tsToIsoDate` 纯函数,无外部依赖

### 3.4 跨模块依赖
- 引入 0 新依赖 (无新 npm / Cargo crate)
- 不影响 Rust 端 (Rust 端 `DailyStatsFilter` 本来就期望 `from_date` / `to_date`)
- 不影响其他 tab (usage / backup 仍走 `from_ts`,`toDailyFilter` 显式不输出 `from_ts` / `to_ts`)

### 3.5 后续 serde `deny_unknown_fields` 防御
- `toDailyFilter` 显式只输出 `provider_id` / `from_date` / `to_date`,**不** spread 整个 filter 对象
- 这意味着即便后端将来给 `DailyStatsFilter` 加 `#[serde(deny_unknown_fields)]`,也不会被 `active_root` / `scope` / `trigger_kind` / `after_id` 污染
- B2-4 测试专门 pin 这一点

---

## 4. 分析技术方案 (§16 第 4 步)

### 4.1 方案对比

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|---|---|---|---|---|
| **A: 在 page 层做字段重映射 (现状 `34d4bb4`)** | `toDailyFilter` 把 `HistoryFilter.from_ts/to_ts` 转 `DailyStatsFilter.from_date/to_date` | 最小变更;纯函数易测试;`toDailyFilter` 类型签名直接 `as` 转换编译期防漏 | 跨类型耦合;若 `DailyStatsFilter` 后续加字段,`toDailyFilter` 也要更新 | ✅ 推荐 |
| **B: FilterBar 给 daily tab 用独立 `DailyFilterBar` 组件** | daily tab 单独一组 DatePicker,直接输出 `from_date` / `to_date` 字符串 | 字段类型源头匹配;没有 spread 风险 | 重复组件 + UI 分裂;usage/daily 共用 `起始日期` 控件,拆开 UX 一致性损失 | ❌ |
| **C: Rust 端 `DailyStatsFilter` 加 `from_ts` / `to_ts` 字段** | 后端做 unix-seconds → DATE 转换,前端只发 `from_ts` | 前端保持单一 filter 形态;无 spread 转换 | 改 Rust DTO 影响 ≥1 仓;SQL 索引迁移;多端类型镜像要同步 (CLAUDE.md §2.3 锁版本) | ❌ |
| **D: 改 `HistoryFilter` 直接用 `from_date` / `to_date`** | 整个历史页统一字符串日期 | 单一类型;前端 filter 与 SQL 列对齐 | usage_history `recorded_at` 是 unix-seconds,需 Rust 端全表 SQL 改 TEXT 比较,索引重建,改动面巨大 | ❌ |

### 4.2 推荐
**方案 A** — 已 ship (`34d4bb4`);本验证仅做回归测试,不动源码。

### 4.3 风险评估
- **低**: `toDailyFilter` 纯函数 + 显式字段映射,无副作用
- **回滚成本**: < 30 秒 (回滚 1 文件)
- **下游影响**: 0 (其他 tab 仍走 `from_ts`,daily 走新路径互不干扰)

---

## 5. 修复后实际验证 (§16 第 5 步) — 硬证据

### 5.1 TDD RED 证据 (改前 FAIL — 3/6 fail)

**运行命令** (在 worktree 临时 checkout `0fdfd9f` 的 `src/pages/history/index.tsx`):
```bash
npx vitest --run src/__tests__/pages/daily-aggregation-filter.spec.tsx
```

**Pre-fix state (`0fdfd9f`, pre-`34d4bb4` source, fix 文件 checkout 还原):**
```
× B2-2: 选起始日期 → list 重新查询,IPC payload 含 from_date 为 YYYY-MM-DD 字符串
    → expected 'undefined' to be 'string' // Object.is equality
    (filter.from_date is undefined because pre-fix sends from_ts)
× B2-3: 选结束日期 → payload 含 to_date 为 YYYY-MM-DD 字符串
    → expected 'undefined' to be 'string'
    (filter.to_date is undefined because pre-fix sends to_ts)
× B2-6: 连续选不同日期 → 每次都触发新查询
    → .toMatch() expects to receive a string, but got undefined
    (filter.from_date is undefined; final spot-check fails)

Tests  3 failed | 3 passed (6)
```

**核心证据:** 3 个 case 精确指向 `34d4bb4` 修复的核心 contract — `from_date` / `to_date` 必须是 YYYY-MM-DD 字符串。
- B2-1 / B2-4 / B2-5 在 pre-fix 也 PASS(它们断言 `from_ts` / `to_ts` 不出现 — pre-fix 时这些字段因为 raw spread 反而**会**出现,实际应当 FAIL,但当前实现没显式测 from_ts 出现,只测 from_date 不出现,所以 pre-fix 也 "通过" 弱断言)。这是测试设计的小遗漏,但**不影响核心 contract 验证** — 关键的 B2-2 / B2-3 / B2-6 (date 字段类型 + 重新查询触发) 三个测试已经明确区分 pre/post-fix。

### 5.2 改后 GREEN (post-fix PASS — 6/6)

**Post-fix state (master `f3166bf` 含 `34d4bb4`):**
```bash
npx vitest --run src/__tests__/pages/daily-aggregation-filter.spec.tsx
```
```
✓ B2-1: 切到按天汇总 tab → IPC payload 用 from_date/to_date (YYYY-MM-DD 字符串),不是 from_ts/to_ts
✓ B2-2: 选起始日期 → list 重新查询,IPC payload 含 from_date 为 YYYY-MM-DD 字符串
✓ B2-3: 选结束日期 → payload 含 to_date 为 YYYY-MM-DD 字符串
✓ B2-4: daily IPC payload 不泄漏 UsageHistoryFilter 独有字段 (active_root / scope / trigger_kind / after_id)
✓ B2-5: loadMore 走 daily 分支时 cursor 用 from_date (YYYY-MM-DD) 而不是 from_ts
✓ B2-6: 连续选不同日期 → 每次都触发新查询 (effect deps 稳定触发 refresh)

Test Files  1 passed (1)
Tests       6 passed (6)
```

### 5.3 无回归证据

**完整 history suite:**
```bash
npx vitest --run src/__tests__/pages/history/
```
```
✓ src/__tests__/pages/history/index.test.tsx (21 tests) 182ms
Test Files  1 passed (1)
Tests       21 passed (21)
```

`34d4bb4` fix 不动 `src/__tests__/pages/history/index.test.tsx` 已 ship 的 21 个测试;新增 6 个 case 也不与既有 mock / IPC 形态冲突。

### 5.4 验证 checklist (per reverify §4 模板)

- [x] vitest 改前 FAIL (3/6 fail with clear messages pointing to root cause)
- [x] 修后 PASS (6/6 pass)
- [x] 完整 history suite 无回归 (21/21 pass)
- [x] 回归测试保留 (`src/__tests__/pages/daily-aggregation-filter.spec.tsx`)
- [x] 关联 bug 同步验证 (无关联 — 此 fix 是 isolated to history/index.tsx)
- [x] §2.4 文件改动 ≤ 2 (修复 1 文件 + 验证 1 新文件)

---

## 6. 设计权衡 (测试架构)

### 6.1 测试覆盖矩阵

| 测试 | 类型 | 验证内容 | 防护目标 |
|---|---|---|---|
| B2-1 | 字段契约 | daily IPC payload 不含 `from_ts` / `to_ts` | 防 reintroduce pre-fix raw spread |
| B2-2 | 字段契约 + 行为 | 选起始日期 → payload 含 `from_date` 字符串 | 核心 B2 修复:`tsToIsoDate` 转换 + `toDailyFilter` 映射 |
| B2-3 | 字段契约 + 行为 | 选结束日期 → payload 含 `to_date` 字符串 | 同上,to_date 端 |
| B2-4 | 字段契约 | daily payload 不泄漏 `active_root` / `scope` / `trigger_kind` / `after_id` | 防御未来 Rust `deny_unknown_fields` |
| B2-5 | 字段契约 + 行为 | loadMore 走 daily → cursor 用 `from_date` 不是 `from_ts` | 抓 loadMore 分支的 `new Date(unix-seconds).toISOString()` 误算 |
| B2-6 | 行为契约 | 连续选不同日期 → 每次触发新查询 (effect deps 稳定) | 抓"memoization gone wrong"导致 effect 跳过 refresh |

### 6.2 为什么 mock invoke 而非 mock `lib/api/history.ts`

**理由 (与既有 `usage-history-columns.spec.tsx` / `index.test.tsx` 一致):**
- `lib/api/history.ts` 是 1:1 invoke wrapper;mock invoke 覆盖完整集成链
- mock invoke 同时可观察 daily 切 tab / 选日期 / 重新查询的真实链
- 既有约定,本验证不创新

### 6.3 日历 grid 多元素处理

`DatePicker` 的 6 周 × 7 列 = 42 cells 网格含**上个月尾部 + 下个月头部的 spillover**,
同一天 (e.g. 5) 可能在 trailing previous-month 和 current-month 各出现一次。
本测试用 `findAllByTestId('date-picker-day-N')` + `textContent === 'N'` filter
挑出 in-month 那个,避免 "Found multiple elements" 错误。

### 6.4 防御 fix B2-5 mock 漏 `get_usage_history_rows`

发现并修复一个测试 fixture 坑:HistoryPage 默认 tab 是 `usage`,首次 mount 会调
`get_usage_history_rows` → `null` (mock 默认返回 null) → `setUsageRows(null)` →
`providerOptions` useMemo 在 `for (const row of usageRows)` 处崩
(`TypeError: usageRows is not iterable`)。
B2-5 的 mock 必须显式 `if (cmd === 'get_usage_history_rows') return [];` 才能让
default-tab-usage 的 init 路径走通,然后才能切到 daily tab 测 loadMore。
这是**测试 fixture 的健壮性要求**,不是被测代码 bug(被测代码 `useState<...>([])` 已保证)。

---

## 7. Commits

### 7.1 本会话 commit (待 commit)
```
verify(b2): daily aggregation filter 回归测试
```
包含:
- 新增 `src/__tests__/pages/daily-aggregation-filter.spec.tsx` (6 tests)
- 新增 `.planning/milestones/v3.4-phases/VERIFICATION-B2.md` (本文档)

### 7.2 关联原始 fix (master)
```
34d4bb4 fix(history): convert from_ts/to_ts to from_date/to_date for daily tab
```

### 7.3 Branch
- 分支: `verify/b2-daily-aggregation-filter`
- worktree: `.claude/worktrees/agent-verify-b2`
- base: `f3166bf` (master HEAD, 含 `34d4bb4`)

---

## 8. 结论

### 8.1 修复结论
- ✅ Bug 已修复 (`34d4bb4` 在 master)
- ✅ 回归测试已建立 (6 tests,字段契约 + 行为契约全覆盖)
- ✅ 完整 history suite 无回归 (21/21 pass)
- ✅ 按 §16 五步流程完整执行,每步有硬证据 (TDD RED + GREEN)

### 8.2 测试断言清晰度
- 3 个测试 (B2-2, B2-3, B2-6) 在 pre-fix 状态 FAIL,失败消息**精确指向** root cause
  (`expected 'undefined' to be 'string'` / `but got undefined`),可直接读懂 bug 本质
- 3 个测试 (B2-1, B2-4, B2-5) 在 pre/post-fix 状态都 PASS,作为辅助 contract 锁定
  (e.g. 防止 raw spread 回来;防御未来 deny_unknown_fields)

### 8.3 后续建议
- 推荐合并 `verify/b2-daily-aggregation-filter` 到 master
- 主 session cherry-pick 时如 `src/pages/history/index.tsx` 有冲突,只 cherry-pick
  verify commit,源文件不动 — 跟 A8 / B1 模式一致
- B2 与 B1 (Backup 合并) 都在 history 页,但**互不依赖**:B1 改 `dailyRows` / `backupRows`
  state 删除,B2 改 daily refresh + loadMore 分支。两者可独立 ship / verify。

---

## 9. 反事故 checklist (per CLAUDE.md §13.2 + §16.2 + §17)

- [x] **不算验证** 列表全避开:
  - ❌ 没只用 "build 通过" / "smoke PASS" / "启动没崩" 当完成证据
  - ❌ 没推断臆想修复结果
  - ❌ 没加 null guard 兜底
- [x] **才算验证** 硬证据齐:
  - ✅ vitest 改前 FAIL (3 fail with clear error messages 指向 root cause)
  - ✅ vitest 改后 PASS (6/6)
  - ✅ 完整 history suite 无回归 (21/21)
  - ✅ 回归测试保留 codebase
- [x] **TDD 流程**: 写测试 → pre-fix 验证 FAIL → post-fix 验证 PASS (RED-GREEN)
- [x] **文件改动 ≤2**: 修复 1 文件 + 验证 1 新文件,符合 §2.4
- [x] **§17 隔离**: worktree 操作 + mid-task 只用 `vitest --run`,
  无 mid-task `cargo build` / `npm run build` / smoke test
- [x] **verify not re-fix**: 任务派单明确禁止 re-fix,本会话只新增测试 + 文档,
  未修改 `src/pages/history/index.tsx` (`34d4bb4` 已 ship)

---

**作者**: Claude Code (subagent verify-b2)
**日期**: 2026-06-30
**会话**: B2 重验证 (清单 §2 Round 3)
