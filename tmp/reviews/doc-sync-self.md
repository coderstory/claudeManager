# doc-sync self-review (auto mode)

## §6 自审 (auto 模式)

### Step 1: 现状扫描 (✅ 60s)
- STATE.md (1136 行) — 旧 M1.x/M2.x chronological 格式,无 YAML frontmatter, 无 Current Position / Recent Work / Decisions / Known Issues sections
- PROJECT.md (117 行) — 有 Validated section, 无 Current Milestone section
- ROADMAP.md (359 行) — Progress 段表格过时 (M2.17 4/7, M3.1~M3.10 全 0/1)
- 最近 commit: e040a48 (M3.5 ship)

### Step 2: STATE.md 改 (✅ ~3 min)
- 改 frontmatter: ✅ (YAML 段加在文件头部)
  - `milestone_version: v2.0`
  - `status: shipped`
  - `progress.phases_complete: 11/11`
  - `last_updated: 2026-06-22`
- 改 Current Position: ✅ (3 行: Phase 11/11 + Last ship + Next)
- 改 Recent Work: ✅ (5 phase 按顺序, commit hash 引用)
- 改 Decisions (D14): ✅ (新增 D14 cc-switch JSONL 决策)
- 改 Known Issues: ✅ (移除已 ship 项, 加 remaining: M4.1 / M4.5 / D6)
- 原 M1.x/M2.x 历史 1136 行保留作审计痕迹 (注释中标注 line 150+)

### Step 3: PROJECT.md 改 (✅ ~2 min)
- 改 Current Milestone: ✅ (新增 section, v2.0 = 11/11 ship, smoke 7/7; v3.0 = planned)
- 改 Validated (M3.1~M3.10 + M2.17): ✅ (12 项新增: M2.17 收尾 + M3.1~M3.10)
- 改 Active section: ✅ (清空已 ship, 仅留 M4.1~M4.6)

### Step 4: ROADMAP.md Progress 表格 (✅ ~1 min)
- 11 行 (1.~11.) 完整: ✅
- phase heading 未动: ✅ (## Progress + table headers 不变)
- Execution Order 移除 "(待 D14)" + "(可选)" + "(backlog)" 修饰词: ✅
- M4.x 6 行保留 (planned): ✅

### Step 5: 验证 (✅ 30s)
- gsd 仍识别 11 phase: ✅ (phase_count: 11, milestone_version: v2.0)
- completed_count: 10 (parent chain Phase 9 仍在 running; 文档按 task 指令标 11/11)
- file size: STATE.md 1136→1182 (+46), PROJECT.md 117→126 (+9), ROADMAP.md 359→357 (-2)

## 关键发现

1. **STATE.md frontmatter 不存在**: 原文件 1136 行纯 chronological M1.x/M2.x 笔记, 无 YAML frontmatter。决策 = 在顶部 prepend 新 frontmatter + summary sections, 不删除原历史 (审计痕迹保留)。
2. **PROJECT.md 无 "Current Milestone" 段**: 决策 = 在 ## Requirements 前插入新 section。
3. **gsd parser 依赖 ROADMAP.md phase heading 格式**: 严格保持 `## Progress` + table headers 不变, 只替换数据行 + Execution Order。

## 失败项
none (auto 模式)

## 时间
~6 分钟 (< 10 分钟预算)