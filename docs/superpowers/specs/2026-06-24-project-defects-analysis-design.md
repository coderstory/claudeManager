# Claude Config Manager — 项目缺陷盘点设计 (C-扫描)

**日期**: 2026-06-24
**作者**: 主 session (Claude Code Opus 4.8)
**状态**: ✅ 设计 approved, 待撰写 spec 文档 (本文档)

---

## 1. 项目背景与现状

**项目**: Claude Config Manager — Tauri v2 + React 19 + Rust 跨平台桌面工具
**当前状态** (来自 STATE.md):
- M1 架构期 ✅ 完成 (12 子任务)
- M2 业务实现期 ✅ 完成到 M2.16
- v3.0 主题重构 ✅ 完成 (含 round-2 修复 3 atomic commit)
- M4.6 WIP 🚧 — Phase 21-D 集成测试 + smoke + ship 收尾中
- **🚨 阻塞**: 工作区有 4 文件 git merge conflict, v3.0 ship 失败

**任务动机**:
- 用户要求"分析项目的缺陷和不足"
- 项目已有 6 份 `tmp/audit-*.md` + `tmp/tailwind-audit.md`, **全部聚焦 macOS 兼容性** (2026-06-24 批次)
- 其他 5 维度 (代码质量 / 工程流程 / 产品UX / 测试覆盖 / 文档管理) **未系统盘点**
- v3.0 ship 阻塞 + §11.7 三次失败规则说明存在反复出现的根因, 需独立分析

**约束**:
- ❌ 不修改任何代码 (仅产出 markdown 报告)
- ❌ 不派生修改 lockfile / package.json / Cargo.toml 的 subagent
- ❌ 不联网 (§8 禁止 subagent WebFetch/WebSearch)
- ❌ 不跑 ship/build/kill-app 类脚本 (decision 3.4)
- ✅ 引用既有 6 份 audit 资产, 不重复造轮

---

## 2. 6 维度扫描范围与子报告结构

### 2.1 维度清单

| ID | 维度 | 范围 (目录 / 文件) | 主参考文档 | 复用资产 |
|---|---|---|---|---|
| **A** | 跨平台架构 | `src-tauri/src/platform/` + `src-tauri/Cargo.toml` + `scripts/` + `src-tauri/tauri.conf.json` | CLAUDE.md §3.2 / §15 / §13.2 | `audit-{deps,rust,scripts}.md` |
| **B** | 代码质量 | `src/` + `src-tauri/src/` 全量 (跳过 4 个冲突文件) | SPEC.md / CLAUDE.md §2 | `audit-{frontend,rust}.md` + `tailwind-audit.md` |
| **C** | 工程流程 | CLAUDE.md §6/§11 / STATE.md / `.planning/` / `tmp/white-list-*` + `git log --oneline -100` | CLAUDE.md §11 + §6 + §14 | `retro-2026-06-25-sccache-discipline.md` + STATE.md 全部 + 所有 `white-list-*.md` |
| **D** | 产品/UX | `src/pages/` + `src/components/` + `src/design-system/` + `dist/` (对照 SPEC.md §5) | SPEC.md §5 + v3.0 round-2 反馈 | STATE.md §v3.0 round-2 / `tmp/ui-redesign/demo-c-anime.html` |
| **E** | 测试覆盖 | `src/__tests__/` + `src-tauri/tests/` + `tests/` (Playwright) + 18 个 pre-existing failures | STATE.md "pre-existing 18 个" + `test-failures-*.md` | 所有 `test-failures-*.md` + `smoke-failures-*.md` |
| **F** | 文档/知识管理 | `CLAUDE.md` / `SPEC.md` / `docs/` / `.planning/` / `tmp/` | CLAUDE.md / ARCHITECTURE.md | `audit-docs.md` + 全部 `white-list-*.md` (90+ 文件) |

### 2.2 子报告统一结构

每份子报告独立 markdown 文件, 路径:
```
docs/superpowers/specs/defects-analysis/
├── A-platform-architecture/REPORT.md
├── B-code-quality/REPORT.md
├── C-engineering-process/REPORT.md
├── D-product-ux/REPORT.md
├── E-test-coverage/REPORT.md
└── F-documentation-knowledge/REPORT.md
```

**子报告模板** (严格):
```markdown
# <维度名> 缺陷盘点

## 元信息
- 维度 ID: <A/B/C/D/E/F>
- 扫描范围: <具体目录清单 + 排除清单 (4 个冲突文件)>
- 扫描方法: <工具 + 抽样策略>
- 引用资产: <既有 audit / STATE / CLAUDE.md 章节>
- 扫描时长: <实际耗时>

## Top 问题清单 (5-10 条, 按严重度排序)
| # | 问题 | 文件:行 | 严重度 | 证据 | 修复建议 | 关联 audit/维度 |
|---|---|---|---|---|---|---|

## 详细分析 (前 3 条展开, 其余简要)
### 问题 <ID>.1: <标题>
- **症状**: ...
- **证据**: <file_path:line + 代码片段>
- **根因**: ...
- **修复建议**: <最小改动 + 风险评估>
- **关联**: [[子报告路径]] / [[audit-xxx]]

### 问题 <ID>.2: ...
### 问题 <ID>.3: ...

## 简要列举 (第 4-10 条)
- <ID>.4: <一行描述> - file_path:line - 严重度 - 关联
- <ID>.5: ...
...

## 扫描未覆盖 / 已知限制
- ...
```

**严格度**: 5-10 条/维度, 详细分析仅前 3 条 + 简要列举后续 (decision 严格度)

---

## 3. 主报告结构 (汇总 + 路线图)

**路径**: `docs/superpowers/specs/2026-06-24-project-defects-analysis.md`
**目标体量**: ≤30 页 (避免 200+ 页巨型文件)

```markdown
# Claude Config Manager — 项目缺陷盘点 (C-扫描)

## 元信息
- 任务: 全量盘点 6 维度缺陷
- 扫描日期: 2026-06-24
- 扫描前提: Wave 0 已解 4 文件 merge conflict (M4.6 Upstream 侧)
- 主 session: Claude Code Opus 4.8
- 引用: 6 份子报告 + 6 份既有 audit (`tmp/audit-*.md`)

## 1. 项目当前状态摘要
- M1 ✅ / M2.16 ✅ / v3.0 round-2 ✅ / M4.6 WIP (3 阻塞)
- 跨平台: Windows 主, macOS dev-only (M4 阶段)
- 测试: 130+ 用例 + 18 pre-existing failures
- 文档: 3044 行核心文档 (CLAUDE.md 637 + SPEC.md 1434 + ARCHITECTURE.md 654 + AGENTS.md 212 + STATE.md 107)
- 临时诊断资产: `tmp/` 目录 70+ 文件

## 2. 6 维度摘要 (每维 1 段 + Top 3)
### 2.A 跨平台架构 — Top 3
### 2.B 代码质量 — Top 3
### 2.C 工程流程 — Top 3 (含 v3.0 ship 阻塞)
### 2.D 产品/UX — Top 3
### 2.E 测试覆盖 — Top 3
### 2.F 文档/知识管理 — Top 3

## 3. 跨维度交叉问题 (出现 ≥2 维度的根因)
- 例: "merge conflict 反复出现" → C (流程) + E (测试失败累积) + F (白名单文件散落 tmp/)
- 例: "前文 subagent 提交违规" → C (流程) + F (文档未涵盖 §14.1)

## 4. 优先级矩阵 (修复顺序建议)
| 优先级 | 问题 | 维度 | 影响范围 | 估时 |
|---|---|---|---|---|
| P0 (CRITICAL) | ... | ... | ... | ... |
| P1 (HIGH) | ... | ... | ... | ... |
| P2 (MEDIUM) | ... | ... | ... | ... |
| P3 (LOW) | ... | ... | ... | ... |

## 5. 修复路线图 (推荐迭代顺序)
- 迭代 N+1: 解 conflict (Wave 0 完成后) + 修 P0
- 迭代 N+2: ...
- 迭代 N+M: ...

## 6. 已知限制 / 不在本扫描范围
- 联网相关缺陷 (如有) 需独立审计
- 跨项目依赖 (npm/cargo 全部 lockfile 100% 解锁) 超出范围
- UI 视觉缺陷 vs SPEC §5 一致性的完整对照需 design audit (不在本扫描范围)
- 性能缺陷 (启动时间 / 内存占用) 需独立 benchmark

## 附录 A: 6 份子报告路径
- `docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md`
- `docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md`
- `docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md`
- `docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md`
- `docs/superpowers/specs/defects-analysis/E-test-coverage/REPORT.md`
- `docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md`

## 附录 B: 复用既有审计资产清单
- `tmp/audit-deps.md` (191 行) - 跨平台依赖审计
- `tmp/audit-docs.md` (228 行) - 文档 macOS 覆盖度
- `tmp/audit-frontend.md` (295 行) - 前端 + 构建链 macOS
- `tmp/audit-rust.md` (192 行) - Rust macOS 兼容性
- `tmp/audit-scripts.md` (282 行) - scripts macOS 兼容性
- `tmp/tailwind-audit.md` (217 行) - Tailwind utility class 死代码

## 附录 C: 排除文件清单 (Wave 0 之前)
- `src/__tests__/pages/home.test.tsx` (M4.6 WIP merge conflict)
- `src/__tests__/pages/json-editor.test.tsx` (M4.6 WIP merge conflict)
- `src/pages/json-editor/index.tsx` (M4.6 WIP merge conflict)
- `src/pages/backup-restore/index.tsx` (M4.6 WIP merge conflict)

注: Wave 0 解 conflict 后, 这 4 个文件纳入扫描范围
```

---

## 4. subagent 编排 (4 槽并发)

### 4.1 Wave 0: 解 conflict (1 subagent)

**目标**: 解 4 文件 git merge conflict, 选 M4.6 Upstream 侧 (推荐)

**派单内容**:
```
任务: 解 4 个文件 git merge conflict (v3.0 ship 阻塞)
文件清单:
- src/__tests__/pages/home.test.tsx
- src/__tests__/pages/json-editor.test.tsx
- src/pages/json-editor/index.tsx
- src/pages/backup-restore/index.tsx
决策: 选 Upstream 侧 (推荐; 若发现冲突侧有重要 WIP 改动, 改为 manual merge)
工具: ✅ git status / git diff / git log / grep ❌ 任何修改代码的写操作
约束: ❌ 不 commit / push / 改全局配置 (符合 §14.1)
验证: 完成后跑 tsc --noEmit + npm test -- --run 确认编译通过 + 18 个 pre-existing failures 不增加
输出: 报告到主 session (含: 选了哪一侧 + 改了什么 + 验证结果)
```

### 4.2 Wave 1 批 1: 4 subagent 并行 (维度 A/B/C/D)

**4 subagent 模板**:
```
任务: <维度名> 缺陷深扫 (Wave 1 - <ID>)
范围: <见 §2.1 表格>
工具: ✅ 静态分析 (tsc --noEmit / eslint / cargo clippy / cargo check)
     ✅ 引用既有 audit 资产 (附录 B)
     ✅ 跑测试套件 (npm test -- --run / cargo test) 只读
     ❌ ship/build/kill-app 类脚本
     ❌ 联网 (WebFetch/WebSearch)
约束:
- ❌ 不修改任何代码 (只读)
- ❌ 不派生 subagent
- ❌ 不 commit / push / 改全局配置 (符合 §14.1)
- ✅ 输出格式严格按 §2.2 子报告模板
- ✅ 证据要求: 每条问题必须有 file_path:line + 代码片段
- ✅ 问题数量: 5-10 条, 详细分析仅前 3 条 + 简要列举后续
输出: docs/superpowers/specs/defects-analysis/<dim>-<name>/REPORT.md
参考: CLAUDE.md §<X> / STATE.md §<Y> / tmp/audit-<xxx>.md
```

### 4.3 Wave 1 批 2: 2 subagent 并行 (维度 E/F)

**模板同上**, 仅范围和参考文档变化

### 4.4 Wave 2: 主报告撰写 (1 subagent)

```
任务: 撰写主报告 (汇总 6 份子报告)
输入: 6 份子报告 (docs/superpowers/specs/defects-analysis/*/REPORT.md)
     + 6 份既有 audit (tmp/audit-*.md)
工具: ✅ 只读 markdown 文件 ❌ 其他
输出: docs/superpowers/specs/2026-06-24-project-defects-analysis.md
     (≤30 页, 严格按 §3 模板)
要求:
- 不引入新问题 (只汇总 + 交叉引用)
- 跨维度交叉问题段必须举 ≥3 个具体例子
- 优先级矩阵 P0/P1/P2/P3 必须有具体问题 (不允许 "待评估")
- 修复路线图必须给出 3-5 个具体迭代建议 (含估时)
```

### 4.5 Wave 3: 主 session 自审 spec (无 subagent)

主 session 自行按 brainstorming 第 7 步 spec 自审:
1. **占位符扫描**: TBD / TODO / incomplete / vague → 修复
2. **内部一致性**: 章节矛盾 / 架构 vs 特性不匹配 → 修复
3. **范围检查**: 是否聚焦于单 implementation plan → 已分解为 Wave 0-3
4. **歧义检查**: 任意要求可被两种解释 → 选一种并明示

---

## 5. 时间与 token 估算

| Wave | 内容 | subagent 数 | 单个时长 | Wall clock |
|---|---|---|---|---|
| **0** | 解 conflict | 1 | 0.5-1h | 1h |
| **1-批 1** | A/B/C/D 并行 | 4 | 1-2h | 2h (4 槽并行) |
| **1-批 2** | E/F 并行 | 2 | 1-1.5h | 1.5h (4 槽还剩 2 槽可用) |
| **2** | 主报告 | 1 | 1-1.5h | 1.5h |
| **3** | spec 自审 | 0 (主 session) | 0.5h | 0.5h |
| **合计** | | **8 subagent** | ~11h subagent 总时长 | **~5-6h wall clock** |

**并发控制**:
- 批 1 满 4 槽
- 批 2 用 2 槽 (剩 2 槽空闲, 留作重派缓冲)
- Wave 2 用 1 槽
- 任何 subagent 失败 → 重派用空闲槽 (§11.3 流式派单)

---

## 6. 交付与验证流程

1. **Wave 0**: 派 1 subagent 解 conflict → 等完成 → 主 session 验证 tsc + npm test 通过
2. **Wave 1 批 1**: 派 4 subagent (A/B/C/D) 同时跑 → 流式接收完成通知 → 检查每份产出
3. **Wave 1 批 2**: 派 2 subagent (E/F) → 流式接收
4. **Wave 2**: 派 1 subagent 写主报告
5. **Wave 3**: 主 session 自审 spec (扫占位符 / 一致性 / 范围 / 歧义)
6. **用户审阅 spec** (brainstorming 第 8 步)
7. **根据用户反馈决定**:
   - 全部 OK → 进入 writing-plans skill 撰写 implementation plan
   - 部分调整 → 回到 Wave 2 重写或回到 Wave 1 重扫特定维度
   - 重做 → 重新 brainstorming

**重要纪律** (CLAUDE.md):
- §11.3 流式派单: 不要等所有 subagent 完成才重新分配
- §11.7 三次失败规则: 同一问题 3 次失败暂停复盘
- §14.1 subagent 禁区: 不 commit / push / 改全局配置
- §6.4 三处同步: UI 文案改动需 3 处同步 (本任务不涉及代码, 无此风险)

---

## 7. 已知限制

1. **本任务产出是报告, 不是修复**: 子报告的"修复建议"只是建议, 是否真修复由后续迭代决定
2. **Wave 0 依赖解 conflict 成功**: 若 conflict 解失败 / tsc 仍不通过, Wave 1 需调整排除文件清单
3. **5-10 条/维度可能漏掉低严重度问题**: 子报告 "简要列举" 段保留但仅 1 行描述, 详细分析仅前 3 条
4. **跨维度交叉问题主观性**: 主报告 §3 依赖 Wave 2 subagent 主观判断, 可能漏掉部分交叉
5. **不修改代码限制**: 即使发现 CRITICAL bug, 本任务也仅记录 + 提建议, 不直接修复

---

## 附录: 与既有审计的关系

| 既有审计 (2026-06-24) | 本任务覆盖 |
|---|---|
| `tmp/audit-deps.md` (跨平台依赖) | 复用 → 维度 A 引用 |
| `tmp/audit-docs.md` (文档 macOS 覆盖度) | 复用 → 维度 F 引用 |
| `tmp/audit-frontend.md` (前端 + 构建链 macOS) | 复用 → 维度 A + B 引用 |
| `tmp/audit-rust.md` (Rust macOS 兼容性) | 复用 → 维度 A + B 引用 |
| `tmp/audit-scripts.md` (scripts macOS) | 复用 → 维度 A 引用 |
| `tmp/tailwind-audit.md` (Tailwind 死代码) | 复用 → 维度 B 引用 |

**重复扫描原则**: 维度扫描时, 既有 audit 的结论**直接引用**, 不重新跑相同命令; 仅当既有 audit 未覆盖的角度才补充新扫描。

---

## 附录: 文件路径索引 (待创建)

```
docs/superpowers/specs/
├── 2026-06-24-project-defects-analysis.md       ← 主报告 (Wave 2 输出)
└── defects-analysis/
    ├── A-platform-architecture/REPORT.md         ← 维度 A (Wave 1-批1)
    ├── B-code-quality/REPORT.md                  ← 维度 B (Wave 1-批1)
    ├── C-engineering-process/REPORT.md           ← 维度 C (Wave 1-批1, 含 v3.0 ship 阻塞)
    ├── D-product-ux/REPORT.md                    ← 维度 D (Wave 1-批1)
    ├── E-test-coverage/REPORT.md                 ← 维度 E (Wave 1-批2)
    └── F-documentation-knowledge/REPORT.md       ← 维度 F (Wave 1-批2)
```

---

*本文档为 design, 待 spec 撰写完成 (2026-06-24-project-defects-analysis-design.md) 后 commit*