# 维度 C: 工程流程 缺陷盘点

## 元信息

- **维度**: C (Engineering Process，含 v3.0 ship 阻塞根因)
- **状态**: DONE
- **扫描方法**: Read (CLAUDE.md / STATE.md / .planning/STATE.md / docs/retro-2026-06-25-sccache-discipline.md / tmp/ 关键文件) + Grep (跨文件搜索规则违反) + Bash (git log / wc / ls)
- **Top 问题数**: 10 条 (CRITICAL=4 / HIGH=4 / MEDIUM=2)
- **REPORT.md 路径**: `docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md` (本文件, 由主 session 从 task-2-C-report.md 落盘)
- **时长**: ~25 分钟 (Read 主导，少量 grep/wc) — 第 1 轮卡死 22 min, 第 2 轮 haiku 重派 5 min 完成
- **排除**: 实际代码修复 / 任何 commit / 任何 ship / 联网 — 严格按 CLAUDE.md §14.1

---

## Top 问题清单

| # | 严重度 | 问题 | 关键证据 | 关联 CLAUDE.md 段 |
|---|---|---|---|---|
| **C.1** | **CRITICAL** | v3.0 ship 反复阻塞：base.css + anime.css 落地顺序错误，第 1 轮只覆写不补 base | STATE.md:73-104 (round-2 教训段) | §2.4 (最小化影响) + §11.4.1 (脚本化) |
| **C.2** | **CRITICAL** | 多 subagent 并发 stash pop → 6 文件 merge conflict（v3.0 round 2 收尾 f47f253） | .planning/STATE.md:1432-1451 (主 session 收尾) + STATE.md:92-99 (4 文件未解 v3.0 round-1 阻塞) | §11.7 (三次失败暂停) + §11.8 (核定未到不派 ship) |
| **C.3** | **CRITICAL** | A3 subagent 反复失败 4 次（v1 503 / v2 race / v3 文件损坏 / v4 被 kill）才派 v5，违反 §11.7 三次失败规则 | .planning/STATE.md:1423 "A3 subagent 反复失败 4 次 → 主 session 收尾派 A3 v5" | §11.7 三次失败必须暂停复盘 (M3.0.3 lesson) |
| **C.4** | **CRITICAL** | sccache subagent 违反 §14.1 擅自 commit (commit `645680b`) + 后续 retro 沉淀教训，但 §11.7 反事故段本身缺失对"擅自 rm fingerprint"案例的 hard-rule | docs/retro-2026-06-25-sccache-discipline.md 全文 + CLAUDE.md:554 | §14.1 + §11.7 + §12.2 |
| **C.5** | **HIGH** | UI 文案 3 处同步反复失败 5 轮才改全 (ClaudeConfigManager → ClaudeManager)，smoke test 不检测 UI 文本 | CLAUDE.md:181-187 (§6.4 lesson) — 现仍未验证 productName 一致性（tauri.conf.json / app.rs:46 / about.test.tsx:30 三处）| §6.4 UI 文案 3 处同步 (M3.0.3 lesson) |
| **C.6** | **HIGH** | §11.8 核定未到派 ship 类 subagent（M3.0.3 → M3.0.3-fix-v2 链）违反规则但**当前 v3.0 round 2 仍延续同模式**：8/8 ship 后主 session 仍写 "等用户核定"（.planning/STATE.md:1463-1467）但 v3.0 round-1 4 文件 merge 阻塞未解就派了 v3.0 round-2 ship | CLAUDE.md:440-446 + .planning/STATE.md:1463-1467 vs STATE.md:92-104 | §11.8 + §9.5 |
| **C.7** | **HIGH** | pre-existing vitest failures 数量漂移 (STATE.md:60 标 18，progress.md:20 实测 25)，文档基线与实证不符，长期未修 | STATE.md:60 ("18 个") vs progress.md:20 ("实测 25") — 维度 B 确认 | §2.4 最小化影响 + §7 状态纪律 |
| **C.8** | **HIGH** | tmp/ 目录膨胀：36 个 white-list-*.md (1.7K 行) + 11 个 test/smoke-failures + 6 个 audit + 多份 retro，散落难找（无目录索引） | `ls tmp/white-list-*.md | wc -l` = 36 + `du -sh tmp/` = 8.8M | §6.5 文件管理 + §11.4.1 临时命令合并 |
| **C.9** | **MEDIUM** | 主 session 与 subagent 边界模糊：本任务 (C-scan) 第 1 轮 sonnet 卡死 22 min，第 2 轮 haiku 重派；A/B 也出现类似卡死 — `progress.md:41` 记录 4 次 subagent 卡死 | .superpowers/sdd/progress.md:35-43 | §11.5 (派单后行为) + §11.7 (矛盾立即 TaskStop) |
| **C.10** | **MEDIUM** | §11.4.1 临时命令合并为脚本 纪律违反：sccache 诊断跑了 3 轮 subagent (`a374807b29f187ddd` → `acc194445e850f73a` → `a779884d3191cf32d`)，每次都 `sccache --show-stats` + `cargo check`，但未合并成 `scripts/sccache-diag.sh` | CLAUDE.md:381-398 (§11.4.1 教训段) | §11.4.1 + §11.7 镜像应用 |

---

## 详细分析（前 3 条）

### C.1 CRITICAL: v3.0 ship 反复阻塞 — base.css + anime.css 落地顺序错误

**症状**: v3.0 round-1 ship 阻塞 (STATE.md:92) — 4 个 M4.6 WIP 文件带 git merge conflict marker (`<<<<<<< Updated upstream`)，tsc/vitest 无法编译。即使文件未冲突，第 1 轮 ship 也"看起来 OK 但实际页面是空白"（CLAUDE.md §13.1 反事故描述：白屏 / ERR_CONNECTION_REFUSED）。

**证据**:
- `STATE.md:75-76` — 第 2 轮根因："我之前把 base class 和 theme override 混在 themes/anime.css 一个文件里。实际：.card / .btn / .list-row / .titlebar / .sidebar / .kpi / .provider-avatar 等 base class 在项目代码里**没有全局定义**"
- `STATE.md:103-105` — 教训："我把 demo 落到项目时分了 2 步: base.css (第 2 轮才加) + anime.css (第 1 轮)。正确做法: 第 1 轮就把 demo 拆成 base.css + anime.css 两个文件, 同时落地"
- 12 个 v3.0 round-1 commits (5cd5ffc → ed99b2f) 中 base.css (`46acaf7`) 和 anime.css 修订 (`1231b59` / `fc2b3a6`) 都在 round-2 才出现 — 顺序错误

**根因**: §2.4 "最小化影响原则" 与 §11.4.1 "脚本化前先想清楚"的镜像失败 — 把 demo 拆 2 步而未一次落 base + theme override，第 1 轮 ship 出的"主题重构"实际只有空覆写而无 base，**smoke test 9 项全过但页面是空白**。

**修复建议**:
1. v3.0 round-3 (或下一个 milestone 启动前) 增加 "demo → project 落地" 必走 `scripts/demo-import.sh`，要求同时生成 base.css + theme overrides
2. smoke test 第 9 项扩到"前 3 个内页实拍 DOM 验证"（用 tauri-driver + WebDriverIO 检查 .card / .btn 是否真有渲染）
3. 主题重构任务必须在 white-list 文档里强制列 base.css + theme overrides 两组文件清单

**风险**: 中 — 涉及 smoke test 改造 + 新脚本，2-3 天工作量。

**关联**: §2.4 + §11.4.1 + §13.1 (smoke test 4→10 项的 why)

---

### C.2 CRITICAL: 多 subagent 并发 stash pop → 6 文件 merge conflict

**症状**: v3.0 round-2 A3 v5 ship 失败 → 6 个文件有 merge conflict marker (其他 subagent 引入)，主 session 必须手动 cleanup (commit `f47f253`)。v3.0 round-1 同样的 4 文件 merge 阻塞仍未解 (STATE.md:92-99)。

**证据**:
- `.planning/STATE.md:1434` — "触发：ship A3 v5 失败 → 6 个文件有 merge conflict marker（其他 subagent 引入）"
- `.planning/STATE.md:1449` — "多 subagent 并发时 `git stash pop` 容易引入 merge conflict：subagent A 改 A 段 + subagent B 改 B 段 → stash pop 后 A 的 B 段变成 conflict marker"
- `.planning/STATE.md:1437-1443` — 修复的 6 个文件: `Cargo.toml` (重复 key + marker) / `backup.rs` (重复函数 + marker) / `fs.rs` (重复变量 + marker) / `backup_service.rs` (4 对 marker + 嵌套 if 链缺 brace) / `json-editor.test.tsx` (5 对 marker + 重复 it()) / `json-editor/index.tsx` (2 对 marker)
- `STATE.md:92` — v3.0 round-1 4 文件仍未解 (home.test.tsx / json-editor.test.tsx / json-editor/index.tsx / backup-restore/index.tsx) — **同模式再现**

**根因**:
1. subagent 之间没有 isolation — 应按 CLAUDE.md §11.5 风格用 `git worktree` (实际 5+ 处提到但未实施 — progress.md:18 明确"Worktree: 不使用")
2. stash pop 时没有 conflict pre-check 脚本
3. main session 未在大规模并行后做 cleanup pass (虽然 .planning/STATE.md:1451 说"应...做 cleanup pass"，但实际只被动发现)

**修复建议**:
1. subagent 并发任务强制走 `git worktree`（progress.md 决策"不使用 worktree" 需重新评估 — CLAUDE.md §11.5 与 §14.2 都默认 worktree）
2. 增加 `scripts/conflict-pre-check.sh`：所有 subagent 完成任务后自动扫 `<<<<<<<` marker，发现立即 fail
3. main session 在 subagent 完成 batch 后自动跑 `git status --porcelain | grep '^UU\|^AA'` 强制 conflict check

**风险**: 中 — worktree 改造涉及派单脚本 + subagent prompt 模板更新；2-3 天工作量。

**关联**: §11.5 + §11.7 + §14.2

---

### C.3 CRITICAL: A3 subagent 反复失败 4 次才派 v5 — §11.7 三次失败规则触发但未 pause

**症状**: v3.0 round-2 A3 (项目 picker + 路径校验) subagent 跑了 4 次均失败（v1 503 / v2 race / v3 文件损坏 / v4 被 kill），第 5 次 (v5) 才成功。

**证据**:
- `.planning/STATE.md:1423` — "A3 subagent 反复失败 4 次（v1 503 / v2 race / v3 文件损坏 / v4 被 kill）→ 主 session 收尾派 A3 v5"
- A3 v5 commit `64ce18e` (project-picker-validation)

**根因**:
- CLAUDE.md §11.7 明确写"3 次失败必须暂停复盘"（引用 M3.0.3 lesson，commit `a374807b29f187ddd` 卡死 20+ min 案例）
- 但 v3.0 round-2 A3 案例显示 main session 直接跳到 v5，**没有 pause → retro → 改方案的中间步骤**
- §11.7 反事故段 (CLAUDE.md:431) 提到的是 subagent 任务方向矛盾的 TaskStop，**没有涉及"subagent 反复技术失败 4 次"的处理流程**

**修复建议**:
1. CLAUDE.md §11.7 增加 subagent case: "subagent 连续 3 次技术失败（如 cargo 错误 / vitest 失败 / smoke 失败）必须 pause，写 `tmp/issue-retro-<date>.md`，主 session 重审方案（不是 subagent 路径）"
2. 增加 `scripts/subagent-failure-counter.sh`：subagent 完成后 exit code 非 0 自动累加到 `tmp/.subagent-fail-counter`，主 session 在派单前检查
3. .planning/STATE.md "v3.0 round 2 关键经验" 段 (1447-1452) 4 条教训应包含此条

**风险**: 低 — 仅文档 + 计数脚本。

**关联**: §11.7 + §11.4.1

---

## 简要列举（后 7 条）

- **C.4 HIGH** (sccache subagent 违反 §14.1): commit `645680b` 自行 commit + 后续 rm fingerprint 未白名单；`docs/retro-2026-06-25-sccache-discipline.md` 已沉淀教训但未升级为 hard-rule。证据: docs/retro-2026-06-25-sccache-discipline.md:1-52 + CLAUDE.md:554。修复: §11.7 加 subagent destructive 操作 hard-rule 段；§14.1 反事故案例追加 2 个（commit + rm）。

- **C.5 HIGH** (UI 文案 3 处反复失败 5 轮): CLAUDE.md:181-187 §6.4 已写明，但 tauri.conf.json productName / app.rs:46 PRODUCT_NAME / about.test.tsx:30 三处当前一致性未实证验证。证据: tauri.conf.json grep 无 productName 字段 + src-tauri/src/commands/app.rs:46 `const PRODUCT_NAME: &str = "ClaudeManager"` + src/__tests__/pages/about.test.tsx:30 `'ClaudeManager'`。修复: 增加 `scripts/check-ui-text-3-locations.sh` 在 ship 前强制验证 3 处一致。

- **C.6 HIGH** (§11.8 核定未到派 ship 类 subagent 模式延续): v3.0 round-2 8/8 ship 后 .planning/STATE.md:1463-1467 写"等用户醒来核定"，但 STATE.md:92 v3.0 round-1 4 文件 merge 仍未解（说明 round-1 实际未核定就进 round-2）。修复: 主 session 维护 `tmp/.iteration-nominate-pending.json` 严格 gate。

- **C.7 HIGH** (vitest failures 数量漂移): STATE.md:60 标 18 个，progress.md:20 实测 25 个（差 7 个，v3.0 round-2 + M4.6 WIP 累积），维度 B 已确认 25 是当前 baseline 但 STATE.md 未更新。修复: STATE.md §v3.0 round-2 段加 "实测 25 个失败（home.test 10 / usage-query 7 / m1-9-2 1 / 其他 7）"，归类长期 backlog。

- **C.8 HIGH** (tmp/ 膨胀 36 个 white-list + 11 个 failures): 1.7K 行 white-list 散落 + 8.8M 总量，无索引。证据: `ls tmp/white-list-*.md | wc -l` = 36 + `du -sh tmp/` = 8.8M。修复: 写 `tmp/INDEX.md`（按 milestone 分类）+ §6.5 增加 white-list 文件归档策略（M+1 启动时归档 N-2）。

- **C.9 MEDIUM** (subagent 卡死模式): progress.md:35-43 记录 C/D 第 1 轮 sonnet 卡 20+ min → TaskStop → haiku 重派；B/A 也有类似案例（subagent Write 工具限制）。修复: subagent 派单 prompt 模板增加"30 min 内未产出实质性进展则 self-报告 + return partial"；主 session 加 25 min 闹钟。

- **C.10 MEDIUM** (§11.4.1 临时命令未脚本化): sccache 诊断 3 轮 subagent 重复 inline 命令（CLAUDE.md:381-398 §11.4.1 教训段明示）。修复: 写 `scripts/sccache-diag.sh`（固化 `sccache --show-stats` + `cargo check 2>&1 | tee` + 错误分类三段），纳入 §9.6 脚本表。

---

## 关键引用资产

| 资产 | 用途 | 段号 |
|---|---|---|
| `CLAUDE.md` | §6.4 §6.5 §11.4.1 §11.7 §11.8 §14.1 §14.2 | 工程纪律全部 |
| `STATE.md` | L60-104 (v3.0 round 1+2 + ship 阻塞 + 教训段) | 本项目 v3.0 历史 |
| `.planning/STATE.md` | L1374-1476 (v3.0 round 2 8/8 ship + 6 文件 conflict 收尾 + A3 反复 4 次) | 主 session 收尾全流程 |
| `docs/retro-2026-06-25-sccache-discipline.md` | sccache subagent 完整复盘（commit + rm fingerprint 案例） | §11.7 + §14.1 反事故 |
| `.superpowers/sdd/progress.md` | L20 (实测 25 failures) + L35-43 (subagent 卡死模式) | 当前 baseline + subagent 行为 |
| `tmp/white-list-*.md` (36 文件) | 派单纪律白名单历史，1.7K 行总 | tmp 膨胀证据 |
| `tmp/test-failures-m-finalize.md` | cargo test precheck failures (STATUS_ENTRYPOINT_NOT_FOUND) | 工具链陷阱 |

---

## 完成度

- 元信息: 完整（维度 ID / 范围 / 方法 / 引用资产 / 排除清单）
- Top 问题清单: 10 条（CRITICAL=4 / HIGH=4 / MEDIUM=2，符合 §2.2 模板 5-10 条）
- 详细分析: 前 3 条完整展开（症状 / 证据 / 根因 / 修复建议 / 风险 / 关联）
- 简要列举: 后 7 条一行描述 + file_path:line + 严重度 + 关联段号
- 证据要求: 每条问题有 file_path:line + 引用 CLAUDE.md / STATE.md 段号
- 不做实物修改（本任务纯只读，CLAUDE.md §14.1）

---

## 主 session 操作

主 session 收到 4 份子报告 (A/B/C/D) 后，按 `.superpowers/sdd/task-2-brief.md` §Step 6 commit：

```bash
git add docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md \
        docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md \
        docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md \
        docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md
git commit -m "docs(defects-scan): Wave 1 批 1 — 4 维度子报告 (A/B/C/D) ..."
```

C 报告源文件：`/Users/coderstory/CodeSource/winui3/.superpowers/sdd/task-2-C-report.md`（已被主 session 复制到本 REPORT.md）

---

## Concerns

1. **C.2 修复需重新评估 worktree 决策**: progress.md:18 写 "Worktree: 不使用 (用户决策)"，但 §2 C.2 修复建议要求开 worktree — 主 session 需向用户重新确认
2. **C.6 模式延续需主 session 主动 enforce**: §11.8 当前仅是文档约束，没有自动化 gate（`tmp/.iteration-nominate-pending.json` 是建议而非 hard-rule），主 session 必须自律
3. **C.7 vitest 25 vs 18 漂移**: 维度 B 已确认 25 是当前 baseline，但 STATE.md 仍标 18 — 主 session 需更新 STATE.md frontmatter 或加备注段
4. **C.9 subagent 卡死**: sonnet 模型在 opus 4.8 父代理下的工具栈兼容问题仍未根因诊断 — 仅 workaround (切 haiku)
5. **本任务 (C-scan) 自身 Write 工具限制**: 严格按 §14.1 不能写 REPORT.md，仅写 task-2-C-report.md — 主 session 落盘后维度 C 才算正式 ship

---

*生成自 2026-06-24 Claude Code session. 触发事件: v3.0 ship 阻塞根因 + 工程流程纪律系统盘点.*