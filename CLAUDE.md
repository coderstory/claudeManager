# Claude Config Manager — 项目规则

> **本文件是项目纪律入口 + 必读配套指针**。详细 spec 见 `docs/FEATURE-DEV-SPEC.md`(功能开发)+ `docs/BUG-FIX-SPEC.md`(问题修复)。
>
> 任何 AI 会话(包括 subagent)开始工作前必须先读本文件 + 至少读完对应任务的 spec 章节。

---

## 1. 项目背景

- **项目名**:Claude 配置管理器(Claude Config Manager)
- **定位**:跨平台桌面工具,帮助用户在多个 Claude Code provider 配置之间快速切换 + 安全管理 + 实时监控用量
- **目标平台**:Windows 11(开发主平台)+ macOS 26(Tahoe)
- **技术栈**:Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust(后端)
- **产品/设计规格**:`./SPEC.md`(不可修改;实现唯一参考)

## 2. 工程纪律绝对底线

- **架构先行** — 任何功能开发前必须先设计架构(接口 / 模块边界 / 数据流);系统兼容性的代码必须抽象到 `platform/` 层,**不允许在业务代码里散落 OS 判断**
- **TDD 强制** — 测试先行;新功能必须有单元 + 集成 + UI e2e 测试;**不允许"先写完代码回头补测试"**
- **版本管理纪律** — 禁止"依赖不行就换版本",遇到依赖问题先读官方文档;所有依赖版本锁在 `Cargo.toml` / `package.json`
- **谨慎修改文件** — 每次文件修改必须有充分证据;**任何变更影响超过 2 个文件时,先列白名单给用户确认**
- **UI/UX 是头等大事** — 视觉一致性 > 功能堆叠;UI 改动必须参考 `SPEC.md §5` 设计规范

## 3. 必读配套引用入口

| 文档 | 路径 | 何时读 |
|---|---|---|
| **功能开发规范** | [`docs/FEATURE-DEV-SPEC.md`](./docs/FEATURE-DEV-SPEC.md) | 任何 feature dev 任务(必读全部章节) |
| **问题修复规范** | [`docs/BUG-FIX-SPEC.md`](./docs/BUG-FIX-SPEC.md) | 任何 bug fix 任务(必读全部章节) |
| **产品/设计规格** | [`./SPEC.md`](./SPEC.md) | 任何 UI / 数据模型 / 业务逻辑改动前(只读) |
| **联网 fallback 顺序** | 见 `docs/FEATURE-DEV-SPEC.md §10.5` | subagent 联网时 |

**Session 入口行为**(每次新 session):
- 第一条业务请求先调 `superpowers:using-superpowers` skill(项目已启用)
- `superpowers` = Skill 层; `GSD` = Slash command 层;两者叠加使用
- User 离线时:不主动问,直接派单 + commit + SESSION-SUMMARY.md(详 `docs/BUG-FIX-SPEC.md §11.3`)

## 4. Subagent Fan-out 上限 = 2(唯一源, 解决历史冲突)

> **本节是 subagent fan-out 上限的权威源**(原 `CLAUDE-WORKFLOW.md §11.2` 上限 4 与 `CLAUDE.md §20.3` 上限 2 冲突,**统一为 2**)。

- 同模块 / 同文件 / blast radius 重叠 → **严格串行**(详 `docs/BUG-FIX-SPEC.md §7.2 Rule 1`)
- 跨模块 / 0 文件级冲突 → 可并行,**最多 2 个同时**
- 大 fan-out (4+ subagent) → **禁止**(本项目 17 verify = 9.9 broken 根因)
- 任何 subagent 退出前:`git worktree remove --force <path>`

## 5. 5 条 Hard NO(摘要, 详 `docs/BUG-FIX-SPEC.md §11.1`)

1. ❌ **Mock IPC vitest 不能算 UI bug verify** — 真启 binary + screencapture 是唯一合法 UI verify
2. ❌ **Subagent self-report 不能算 "fix 完成"** — 主 session 必须 `git show <sha> -- <file>` diff 自查
3. ❌ **Cargo / rustc / sccache 并发跑**(必须串行)— 走 `scripts/build-locked.sh`(flock 串行)
4. ❌ **Commit message claim ≠ evidence** — 必须 diff 看具体 line
5. ❌ **macOS file-replace 不刷新运行中进程** — `pkill -9 -f claude-config-manager` 再 build/launch

## 6. 不要做

- ❌ 不要修改 `./SPEC.md`(实现唯一参考)
- ❌ 不要在业务代码里散落 OS 判断(走 `platform/` 层抽象)
- ❌ 不要"边写边想"——架构设计先行
- ❌ 不要"先写完代码回头补测试"——TDD 强制
- ❌ 不要"依赖不行就换版本"——读文档先
- ❌ 不要修改 `.planning/research/` 下的研究产物(决策依据)
- ❌ 不要超过 1 小时不 commit——M1 必须原子提交
- ❌ 不要在没确认的情况下删除文件——尤其是 `.planning/` 和 `src/`
- ❌ 不要跳过 smoke test 直接 cp exe 到桌面
- ❌ 不要在用户没核定前进入下一迭代
- ❌ **不要主 session 亲自执行开发任务**(编译 / 安装依赖 / 写代码 / 跑命令)— 全部派 subagent

---

**写于 2026-06-30**(用户强约束"虚假开发 / 虚假修复" 严重,要求 CLAUDE.md 梳理归纳形成完整体系)。
**详细 methodology**: `docs/FEATURE-DEV-SPEC.md` + `docs/BUG-FIX-SPEC.md`(双 spec 架构)。
**修改本文件**:需明确理由 + 记录在 commit message。