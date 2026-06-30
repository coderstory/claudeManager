# SESSION-SUMMARY: Methodology 重构 (2026-06-30)

## 概述

用户多次反馈"虚假开发 / 虚假修复"严重,经 audit 发现根因不是 subagent 努力,是 **规则体系本身有问题**:6 个规则 doc 共 1,287 行,4 处"已迁移"占位符,5 处重复定义,数字冲突 (§11.2=4 vs §20.3=2),**0 个 feature dev workflow**。

## 重构产出

| 维度 | Before | After |
|---|---|---|
| 规则 doc 数 | 6 (CLAUDE.md + BUG-FIX-PROCESS + CLAUDE-WORKFLOW + CLAUDE-MACOS + .claude/CLAUDE.md + memory 散落) | 3 (CLAUDE.md + FEATURE-DEV-SPEC + BUG-FIX-SPEC) |
| CLAUDE.md 行数 | 619 | 73 |
| 重复定义 | 5+ 处 (mock IPC / subagent bias / cargo race / commit-msg / 真启七步) | 0 处 (收敛到唯一 spec) |
| 占位符 "已迁移到" | 4 处 | 0 处 |
| 数字冲突 | 1 (fan-out 4 vs 2) | 0 (统一到 2) |
| Feature dev workflow | 缺失 | FEATURE-DEV-SPEC §10 (基于 superpowers skill) |
| Bug fix workflow | 散落 5 处 | BUG-FIX-SPEC §12 (6 步闭环) |

## Commit 系列

| # | SHA | 内容 |
|---|---|---|
| 1 | `afc73c9` | docs(spec): create docs/BUG-FIX-SPEC.md (663 行) |
| 2 | `bbf694f` | docs(spec): create docs/FEATURE-DEV-SPEC.md (691 行) |
| 3 | `39a7b01` | docs(CLAUDE.md): rewrite as thin entry-point (619 → 92 行) |
| 4 | (delete) | docs: delete BUG-FIX-PROCESS.md / CLAUDE-WORKFLOW.md / CLAUDE-MACOS.md |

## Verification 结果

- ✅ Cross-ref 完整性:旧 doc 引用仅在历史 archives (不动),活跃 doc 0 残留
- ✅ 重复消除:Mock IPC / Subagent self-report / Cargo race / Commit-msg 等全部收敛到唯一 spec
- ✅ Stale 清理:3 个旧 doc 删除,4 个占位符清零
- ✅ 新章节存在:FEATURE-DEV-SPEC 11 节 / BUG-FIX-SPEC 13 节
- ✅ 数字冲突解决:Fan-out 统一为 2
- ✅ 行数:CLAUDE.md 73 + 2 spec 共 1,352 = 1,425 总 (vs 旧 1,287 + memory 散落 ~200 = ~1,500)

## Deferred (本 session 之后)

### 1. Scanner fix 主 session verify

- Branch: `fix/scanner-plugin-registry` @ `5b49a97` (subagent 完成,11 单测 PASS)
- **未做 main session verify**: cherry-pick + `cargo build --release` via `build-locked.sh` + bundle consistency check + screencapture
- **当前任务**:本 session 末完成 cherry-pick + §4 七步 Pipeline

### 2. Memory 收敛 (11 → 3)

Memory 文件不在仓库,需 user 在 main session 执行:

| Action | File |
|---|---|
| Delete | `feedback-never-recommend-cert.md` (合并到 no-cert-purchase) |
| Delete | `project-theme-redesign.md` (5-theme 已 ship) |
| Delete | `project-v33-paused.md` (UNPAUSED 后 stale) |
| Delete | `project-codebase-2026-06-29.md` (内容已进 FEATURE-DEV-SPEC §1-§3) |
| Update | `MEMORY.md` (索引更新) |
| Update | `feedback-fix-success-rate.md` (指向 BUG-FIX-SPEC §11) |
| Update | `feedback-no-cert-purchase.md` (内容已在 CLAUDE.md §6 + §4) |
| Update | `feedback-autonomous-offline-mode.md` (内容已在 CLAUDE.md §3) |
| Update | `feedback-superpowers-activate.md` (内容已在 CLAUDE.md §3) |
| Update | `feedback-network-fallback-render-url.md` (内容已在 FEATURE-DEV-SPEC §10.5) |
| 保留 | `feedback-memory-deletion-trigger.md` (meta-rule) |

### 3. Old BUG-FIX-PROCESS 引用同步

- 新 session 不需要修改历史 archives (retro / macos-p2-backlog / ship-records)
- 这些 docs 是 HISTORICAL records,改它会丢失历史价值
- 任何新引用必须用 `docs/BUG-FIX-SPEC.md §X` / `docs/FEATURE-DEV-SPEC.md §X` / `CLAUDE.md §X`

## 反事故自我审计

按 `BUG-FIX-SPEC.md §2` 五步 + `§4` 七步 Pipeline 自我审计:

1. **了解**: 用户报"虚假开发 / 虚假修复严重,需要双 spec + 薄 CLAUDE.md" ✅
2. **真因**: 不是"doc 太长",是"doc 体系缺 feature dev 维度 + 重复定义 + 数字冲突 + 占位符" ✅
3. **边界**: 7 文件 + 8 memory,全部列出白名单 ✅
4. **方案**: 列了 5 个备选 (A 严格 2 spec / B 3 doc / C 单 doc / D 内联 / E 2 spec + cross-cutting), 选 A ✅
5. **验证**: 6 项 grep + wc 命令,全部通过 ✅

未触发硬 NO (mock IPC / subagent self-report / cargo 并发 / commit-msg ≠ diff / macOS file-replace)。

---

**写于**: 2026-06-30  
**下次 session 启动必读**: CLAUDE.md + 至少 docs/BUG-FIX-SPEC.md 或 docs/FEATURE-DEV-SPEC.md (按任务)  
**派任何 subagent 必含**: "必读 CLAUDE.md + 任务对应 spec"