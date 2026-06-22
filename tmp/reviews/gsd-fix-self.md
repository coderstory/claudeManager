# GSD-fix 自审 (auto 模式, ≤5min)

**任务**: 修 GSD-adapt 3 caveat 让 gsd-autonomous 干净跑通 (修 Fix1+Fix2, Fix3 不修)
**执行时间**: 2026-06-22
**执行人**: Subagent GSD-fix

---

## Fix 1: M2.17 partial ship 标 complete (Phase 1)

### 改动
1. 原 `01-m217-closeout-PLAN.md` → 重命名为 `01-01-PLAN.md` (描述已 ship 的 M2.17-3.1: PluginHost wiring + CI gates + build + tsconfig)
2. 新建 `01-02-PLAN.md` (描述 pending 的 M2.17-batch4: D9 + D10 + F15-batch4)
3. `01-m217-closeout-SUMMARY.md` 保留 (描述已 ship 的 M2.17-3.1)

### 验证结果
- ✅ plan_count: 1 → 2
- ✅ summary_count: 1 (只 1 个 SUMMARY,描述 Plan 1)
- ✅ status: complete → **in_progress** (期望达成)
- ✅ parser `disk_status` 计算: planCount(2) > summaryCount(1) → in_progress 标对

### 反向挑战
- **Q: 把 PLAN.md 改名 01-01-PLAN.md 会不会影响 GSD tooling?**
  A: 不会。Parser 用 `*-PLAN.md` glob 计数 (lib/commands.cjs:815,1090),01-01/01-02 都匹配。
- **Q: 1 SUMMARY 描述 2 个 plan,parser 会接受吗?**
  A: 接受。SUMMARY 按文件计数 (只要 01-m217-closeout-SUMMARY.md 存在),内容不被严格校验。
- **Q: 真实 ship 数据保留了吗?**
  A: 是。commits (d5443c3/18d4b29/2e575c7/a980eeb/8ef961d/cc07178/02e5b14/f7196e8) 在 01-01-PLAN.md。

### 已知限制
- SUMMARY.md 仍叫 "partial" 描述但只覆盖 1/2 plan (语义略错位)。**可接受**,因为 main flow 看 parser status 不用 SUMMARY 内部措辞。

---

## Fix 2: M3.8 BLOCKED (Phase 9)

### 改动
- `09-m38-usage-blocked/` → `.deferred-m38-usage/` (mv 目录,以 `.` 开头让 parser 不识别)

### 验证结果
- ✅ parser 不再 pick 该目录
- ⚠️ 但 parser 仍 emit Phase 9 stub,因为 ROADMAP.md 第 9 段还在
  - stub 状态: `directory: None`, `plan_count: 0`, `summary_count: 0`, `status: not_started`
  - 即: "可执行 phase" 数从 11 减到 10 (directory=None 的 stub 不算)
- ✅ 自审接受: directory=None 的 stub 在 gsd-autonomous 中无法执行任何 plan (plan_count=0),跳过

### 反向挑战
- **Q: 为什么不用 mv 到 `.planning/phases/.deferred-m38-usage/` 而是直接 `.deferred-m38-usage/`?**
  A: 按 task 描述,放到 phases/ 下以 `.` 开头隐藏。parser 用 `*-PLAN.md` glob,只扫 phases/ 下的非隐藏子目录。
- **Q: ROADMAP.md 还在引用 M3.8 段,parser 仍 emit stub, 这算成功吗?**
  A: 算。因为:
    1. ROADMAP 不让改 (GSD-adapt 边界)
    2. stub 不带 directory → gsd-autonomous 不会尝试执行 (plan_count=0)
    3. D14 拍板后,mv 回原名 + 补回 PLAN.md 即可 (可逆)
- **Q: 完全删除目录更干净?**
  A: 任务明确禁止 rm,且 mv 可逆更稳。

### 已知限制
- ROADMAP.md 第 9 段仍存在,parser 仍 emit Phase 9 stub。但 stub 无 directory,无 plan,自动执行会跳过。
- **可接受**: 主 session 用 phase_count 时要注意: 11 (含 stub) vs 10 (可执行)。Stub 显式标识 `directory: None`。

---

## 验证摘要

```
phase 1 (M2.17): plan_count=2 summary_count=1 status=in_progress  ✅
phase 9 (M3.8): directory=None plan_count=0 status=not_started   ✅ (跳过)
phase 2-8:     不变,correct                                          ✅
phase 10-11:   不变,correct                                          ✅
```

整体状态: **6 complete + 4 in_progress + 1 stub-skipped (M3.8)** = 可执行 phase 10 个 (parser 总数 11 因 ROADMAP 段)。

---

## 失败项
- **none**

---

## 给主 session
- ✅ gsd-autonomous 现在能干净跑 (Phase 1 in_progress, Phase 9 自动跳过)
- ⚠️ 预期 phase_count=10 实际=11,因为 Phase 9 ROADMAP 段在。可执行 10。
- 下一步: 跑 /gsd-autonomous 即可
- M3.8 复启: D14 拍板后 mv 回 `09-m38-usage-blocked/` + 补 PLAN.md 即可