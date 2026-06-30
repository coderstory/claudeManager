# BUG-FIX-SPEC.md — 问题修复规范 (2026-06-30 重构写入)

> **本文件是项目根 `/BUG-FIX-SPEC.md` 的唯一权威 spec**,吸收原 `CLAUDE.md §16/§17/§19/§20` + `BUG-FIX-PROCESS.md`(已删除) + `memory/feedback-fix-success-rate.md` 的全部内容。
>
> 任何 bug fix 任务,**subagent prompt header 必含** "必读 `docs/BUG-FIX-SPEC.md` 全部章节"。
>
> 关联:`docs/FEATURE-DEV-SPEC.md`(功能开发规范,本 spec 的姊妹篇)。

---

## §0. 文档结构

| 章节 | 内容 | 行数 |
|---|---|---|
| §1 | 流程问题清单(17 类,唯一源) | ~120 |
| §2 | Bug Fix 五步流程(了解 / 真因 / 边界 / 方案 / 验证) | ~50 |
| §3 | 验证必须用证据(Mock / Subagent bias) | ~30 |
| §4 | 真启 Binary Verify 七步 Pipeline(唯一源) | ~50 |
| §5 | 规避 (Prevention) Checklist | ~25 |
| §6 | 协调机制(Cargo / Subagent / Build artifact / macOS) | ~30 |
| §7 | Concurrent Subagent Compounding 4 规则 + Phantom 报错 | ~130 |
| §8 | 事后弥补(Remediation) | ~30 |
| §9 | Subagent Dispatch Template + 必读配套 | ~30 |
| §10 | 反事故案例索引 + 改进目标 + 删除 trigger | ~45 |
| §11 | 5 条 Hard NO + User 确认频率目标 | ~30 |
| §12 | BUG FIX WORKFLOW(6 步闭环,新增) | ~80 |

**总计 ~650 行**。

---

## §1. 流程问题清单(本 session 实证 17 类)

> **触发**:2026-06-29-30 一夜 21 bug 重 verify 跑出 9.9/10 user-visible broken。下表 17 类问题 + 规避 + 唯一 spec 章节指引。

### §1.1 Mock 测试假绿
- **现象**: `vi.mocked(tauri.invoke).mockResolvedValue(...)` 直接返字符串,完全屏蔽 native dialog / Rust handler / OS file picker / IPC marshal / React reconciler 时序
- **后果**: 8/8 vitest PASS,但用户实际操作为 bug
- **例子**: A7 Round 3 subagent `f3166bf` 报告 "8/8 PASS",实际 broken
- **例子**: B8 Round 0 subagent mock useScope 后断言 syncScopeFromProject 次数 — sync 短路,**测的是函数调用 ≠ IPC 计数 ≠ CPU 状态**
- **规避**: 详 §3 + §11.2
- **替代**: 真启 binary + screencapture + sample `<pid>` + 读 DOM / console

### §1.2 Subagent self-report ≠ 真修复
- **现象**: subagent 报告 "8/8 PASS" 或 "screenshots 验证 OK",但用户 app 上 broken
- **根本**: subagent 是利益相关方,自身 bias 倾向 "完成" 报告
- **规避**: 详 §3 + §11.1
- **反模式**: "subagent PASS + 时间紧 = 直接 commit" — 本 session 17 次这样做,17 次都 broken

### §1.3 Cargo 并发 race
- **现象**: 4 subagent + 主 session + 之前残留 session 全部跑 `cargo build`,全部写 `target/release/claude-config-manager`,后写的覆盖先写的
- **后果**: 用户跑 app 时用哪个 binary 不确定;主 session 自己 build 完后 30 秒,sibling subagent 又把 binary 覆盖成 stale 源码
- **规避**: 详 §6.1(必须走 `scripts/build-locked.sh`,禁止直接 `cargo build`)

### §1.4 macOS 文件替换 不更新运行中进程
- **现象**: `cargo build` 把 `target/release/claude-config-manager` 重写为新 binary,**但运行中 PID 的 in-memory 代码不变**(macOS file replace 仅替换 inode)
- **后果**: 用户启动 app → 我重 build → 用户刷新页面看不到 fix,因为用户 app 用的还是旧 inode 的代码
- **规避**: 详 §6.4 + §11.5(必须 `pkill -9 -f claude-config-manager` 再 build)

### §1.5 Stale .app bundle wrapper
- **现象**: cargo binary 与 .app bundle 内部 binary 可能 hash 不同(因为 build 脚本不一定每次都重 link bundle)
- **后果**: 用户用 `open ClaudeManager.app` 启动的可能是 22 小时前的 stale bundle
- **规避**: 详 §4 Step 5(bundle consistency check)

### §1.6 Commit message claim ≠ diff reality
- **现象**: `db74286 commit message` 写 "集成 A7 auto-fill name 逻辑",**实际 diff 把 `setNewName(dirName)` 删了**
- **规避**: 任何 "fix X" 类 commit,verify 时**先 `git show <sha> -- <file>` 看 diff**
- **subagent dispatch prompt 必含**: "任何 fix commit 必须先 `git show <commit> --stat` + `git show <commit> -- <file>` 自查"

### §1.7 Real app launch + automation flaky
- **现象**: macOS 上 `osascript` / `cliclick` / AppleScript 经常 timeout
- **规避**: screencapture 永远可用;不强求 click automation;改用 macOS accessibility 间接验证

### §1.8 React 19 + Tauri webview vs jsdom timing
- **现象**: vitest/jsdom 跑 React setState 时序 vs Tauri WebView2 / WKWebView 真时序可能差几 ms
- **例子**: A7 `if (!newName.trim())` closure 在 Tauri webview 下 stale capture,jsdom 跑出来 PASS
- **规避**: 任何 bug 涉及 React 状态 / useEffect 时,必走真启 binary 验证

### §1.9 5 个 subagent 并发 fan-out = 全军覆没
- **现象**: 主 session 一口气派 4-5 个 subagent,每个都跑 build / 都写 worktree / 都改 master
- **规避**: 详 §11.4(Fan-out 上限 = 2);详 §7 Rule 2(worktree 隔离)

### §1.10 Subagent claim without diff
- **现象**: subagent 写 "我已经 fixed X",但 commit diff 实际没改相关 line
- **例子**: a7a7386a53f18d91b subagent 写 "A7 真因修",但 src 没动,只写了 vitest
- **规避**: 主 session 收到 subagent 报告后**必须** `git diff <branch> master -- src/`

### §1.11 user manual confirmation 反复 cycle
- **现象**: 每修一个 bug,30-60 min/cycle(subagent → build → user → broken → 再 subagent)
- **根因**: verify-first 方法论失败 + user 反复 OK 确认
- **规避**: 详 §11.6(User 确认频率目标:七步全过 + screencap 即判定)

### §1.12 Subagent fan-out 数字冲突(历史)
- **现象**: `CLAUDE-WORKFLOW.md §11.2` 上限 4 vs `CLAUDE.md §20.3` 上限 2(已统一到 2)
- **本 spec 状态**: §11.4 唯一源 = 2,无需判断

### §1.13 Phantom 报错误诊
- **现象**: subagent 报 "field X 缺失" 但实际是兄弟 subagent mid-edit 状态
- **规避**: 详 §7.5(Phantom 报错识别)

### §1.14 Build artifact vs cargo binary hash 不一致
- **现象**: .app bundle wrapper 内的 binary 比 cargo binary 老 22 小时
- **规避**: §4 Step 5(bundle consistency check)

### §1.15 §2.4 谨慎改文件 + 大 fan-out 双重违规
- **现象**: 一次 dispatch 4 subagent 改 12 文件,违反 §2.4 "超 2 文件白名单" + §11 "≤2 fan-out"
- **规避**: §7 Rule 1(同文件 / 同模块 → 严格串行) + CLAUDE.md §4(2 fan-out 上限)

### §1.16 Subagent 自杀循环(重复跑相同 cargo build)
- **现象**: sccache subagent 连续 3 次跑 `sccache --show-stats` + `cargo check`,浪费时间
- **规避**: 详 `FEATURE-DEV-SPEC.md §6.4.1`(临时命令 3 次重复 = 必须脚本化)

### §1.17 17 verify commits 9.9 broken(2026-06-30 总结)
- **现象**: 17 个 verify-* commit 全部 "subagent PASS",用户实测 9.9 broken
- **根因**: 本节 §1.1-§1.16 全部累积效应
- **规避**: 本 spec 全部章节,尤其 §4(七步 Pipeline)+ §11(5 Hard NO)+ §12(6 步 Workflow)

---

## §2. Bug Fix 五步流程

> **任何问题修复都必须按下列顺序执行,严禁跳步。**

### 2.1 五步流程(顺序不可颠倒)

1. **了解问题详情** — 用户报的 bug 描述完整读,补充必要上下文(截图 / 操作步骤 / 期望行为 / 实际行为 / 触发条件 / 出现频率 / 影响范围)
2. **明确问题原因** — 找到 root cause(`file:line` 证据),区分"症状"和"原因"。**禁止把症状当原因**(例:白屏 = 症状,不是原因)
3. **明确问题边界** — 这个 bug 影响哪些模块 / 文件 / 路径?不影响哪些?是否有 platform / OS / 数据依赖?是否会触及"超 2 个文件改动"白名单?
4. **分析技术方案** — 列出 ≥2 个可行方案 + 各自优缺点 + 推荐方案 + 风险评估。**不得直接改代码修复**
5. **修复后实际验证** — 跑测试 / 启动 app / 实际点击按钮,看真实行为符合预期。**不得推断臆想修复结果**

### 2.2 验证必须用证据(硬证据清单)

**不算验证**(常见误区):
- ❌ "build 通过" / "smoke test PASS" / "启动没崩" / "subagent 报告 verified"
- ❌ "我猜修了" / "应该是好了" / "逻辑上看没问题"
- ❌ 加 null guard / try-catch 兜底(这是 defense-in-depth,不等于修了 root cause)
- ❌ 改完没复现 = 改对了(没复现可能是触发条件没满足,不是修了)

**才算验证**(硬证据):
- ✅ 可测试 bug:写 vitest / Playwright 测试,改前 FAIL → 改后 PASS,测试留 codebase 做回归
- ✅ UI bug:实际点击按钮,截图 before/after,断言 UI 行为符合预期
- ✅ 不可测试 bug(视觉 / 平台 / 时序 / 主观):录屏 + DevTools log + 用户亲眼确认
- ✅ 跨进程 bug:真实 OS 上手动复现,留操作步骤 + 输出

### 2.3 反事故案例(X1 commit b16b979)

**错误示范**:
- 用户报"从当前配置生成 按钮无反应"
- subagent 加 `if (!provider) return null;` 防御性 guard
- subagent 自己报告"defense-in-depth,actual bug-trigger path doesn't fire"
- 主 session 没质疑就 trust → commit → 用户还是看到"无反应"

**正确做法**:
1. 了解:用户报按钮无反应,补充操作步骤
2. 真因:用 vi.spyOn(invoke) + console.log 链定位是 onClick 没绑 / invoke 没被调 / invoke 错了 / setState 没触发 / modal 没渲染 中的哪一步
3. 边界:这个 bug 是仅 provider-list 页有,还是影响所有 modal?
4. 方案:列 ≥2 个修法,选 root cause 真因那个,不是"加 guard 让 UI 不崩"那个
5. 验证:写 vitest 测试改前 FAIL → 修 → 改后 PASS,跑 + 留 codebase

### 2.4 与既有纪律的关系

- `FEATURE-DEV-SPEC §3` TDD 强制:本节 §2 是其升级版,聚焦 bug fix 场景
- `CLAUDE.md §4` 谨慎修改文件:本节 §2.1 第 3 步"明确边界"是其前置
- `FEATURE-DEV-SPEC §3.2` TDD 流程:本节 §2.2 第 5 步"实际验证"是其强化版
- `FEATURE-DEV-SPEC §9.2` build regression:本节 §2 区分了"process OK"(smoke test)和"UI 行为对"(实际验证)

---

## §3. 验证必须用证据(Mock / Subagent bias 双反事故)

> **唯一源**。本节是 §1.1 + §1.2 + memory `feedback-fix-success-rate.md` 三处的合并。

### §3.1 Mock-as-verification 反事故

**`vi.mocked(tauri.invoke).mockResolvedValue(...)` 完全屏蔽**:
- native dialog(NativeDialog / MessageDialog)
- Rust handler(`#[tauri::command]`)
- OS file picker(NSOpenPanel / Common Item Dialog)
- IPC marshal(serde_json)
- React reconciler timing(useEffect + closure-capture)

**结论**:mock IPC 测试 = 假绿,**不能算 UI bug verify**。

**真测路径**(详 §4):
- build binary → 真启 → screencapture → sample `<pid>` → 读 DOM/console → 用户实地试
- A7 subagent 假绿是这个反事故的典型例子(测的是 React state machinery,不是 UI 行为)

### §3.2 Subagent-as-verifier 反事故

**subagent 是利益相关方**,自身 bias 倾向"完成"报告。统计:本 session 17 verify commits,17 PASS,17 broken。

**Subagent 报告可信度排序**(高 → 低):
1. 改了哪几个文件(`git diff --stat`)+ 改了哪些行(`git show <sha> -- <file>`)
2. 跑了哪些 test / 实际输出
3. screencapture path(主 session 自己看,不是 subagent 说"看起来对")
4. ❌ "应该修了" / "我猜 OK" / "逻辑上看没问题"

**主 session 收到 subagent 报告必查**:
- `git diff <branch> master -- src/` 看实际改了什么
- 没改 src 但 claim "fix" → 标 FAKE_FIX,真重 fix

### §3.3 修后实际验证清单(7 件)

| # | 必做 | 不算 |
|---|---|---|
| 1 | 写可复现测试,改前 FAIL → 改后 PASS | ❌ "我跑了旧测试也过" |
| 2 | 实际点击按钮,截图 before/after | ❌ "smoke test 通过" |
| 3 | 录屏 + DevTools log 确认 UI 时序 | ❌ "代码看没问题" |
| 4 | sample `<pid>` 看 CPU(loop bug 应 0%) | ❌ "我没复现" |
| 5 | 真实 OS 上手动复现 | ❌ "jsdom 跑 PASS" |
| 6 | 用户亲眼确认(offline 时主 session screencap 替) | ❌ "subagent 说 OK" |
| 7 | 回归测试留 codebase | ❌ "fix 完就 OK 不留测试" |

---

## §4. 真启 Binary Verify 七步 Pipeline(唯一源)

> **唯一源**。原 `CLAUDE.md §3` + `BUG-FIX-PROCESS.md §3` + `CLAUDE.md §20.2` 三处独立定义合并于此。

任何 UI bug fix 走完这 7 步才能算"完成":

```
Step 1: cargo check (~2s)
  $ cd src-tauri && cargo check
  期望: "Finished `dev` profile [unoptimized + debuginfo]"

Step 2: vitest unit (~5s)
  $ npx vitest run --reporter=dot
  期望: 全 PASS (除 pre-existing stale testid)

Step 3: npm run build (~5s)
  $ npm run build
  期望: tsc + vite build 全 OK,无 TS error

Step 4: build-locked (cargo ~30-90s sccache warm)
  $ ./scripts/build-locked.sh
  期望: BUILD_MARKER hash 变化,binary mtime 更新
  禁止直接 cargo build (详 §6.1)

Step 5: bundle consistency check
  $ BUNDLE=$(strings target/release/bundle/macos/ClaudeManager.app/Contents/MacOS/claude-config-manager | grep -oE 'ccm-build-mtime-[a-f0-9]+' | head -1)
  $ BIN=$(strings target/release/claude-config-manager | grep -oE 'ccm-build-mtime-[a-f0-9]+' | head -1)
  期望: $BUNDLE == $BIN
  如果不等 → 跑 npm run build && tauri build --no-bundle 重 link bundle

Step 6: 真启 + screencapture
  $ pkill -9 -f claude-config-manager
  $ sleep 1
  $ nohup target/release/claude-config-manager > /tmp/app.log 2>&1 &
  $ sleep 4
  $ pgrep -f claude-config-manager  # 拿 PID
  $ screencapture -x /tmp/app-launched.png
  期望: screencap 显示 app window,无 white screen / 无 frozen dialog

Step 7: 验证具体 UI path
  视 bug 而定:
  - sample <pid> 1 看 CPU (loop bug 应该 0%)
  - screencapture after click 关键按钮看 visual 行为
  - 读 /tmp/app.log 看 console error
  - 如果 macOS NSOpenPanel 之类无法 driver → 让用户手动试一次
```

**七步全过 → cherry-pick + commit + claim "fix 完成"**。任何一步失败 → 不 claim,不 commit,回到 §2 找真因。

---

## §5. 规避 (Prevention) Checklist

主 session 派 subagent 之前,逐项确认:

- [ ] Bug 描述清晰(`file:line` 路径 + UI 步骤 + 期望 vs 实际)
- [ ] 已读过相关 src / 已 `git log` 看过相关 commit / 已 `git diff` 看过 claim 是否真实
- [ ] **确认 subagent 走 `scripts/build-locked.sh`**(prompt 必含)
- [ ] Subagent prompt 包含 §9 五要素(精读 + 真因 ≥2 + 红绿 + 真启 verify + 用户 OK 才 commit)
- [ ] 不派 fan-out(>2 subagent 同时跑除非 0 文件级冲突)
- [ ] 任何 UI fix → subagent 必含 "screencapture before/after + sample <pid>"
- [ ] 任何 mock IPC 测试 → subagent 必说明 mock 屏蔽了哪段链路 + 为什么还是合法 verify

主 session build 之前,逐项确认:

- [ ] `pgrep -f "rustc\|sccache\|cargo"` 干净(无残留 process)
- [ ] 走 `scripts/build-locked.sh`(或 `flock /tmp/cargo-build.lock cargo ...`)
- [ ] Build 完检查 `.app bundle` 和 `cargo binary` BUILD_HASH 一致
- [ ] **`pkill -9 -f claude-config-manager` 杀掉旧 app**
- [ ] `open ClaudeManager.app`(或 cargo binary 直接 launch)
- [ ] screencapture 确认 app 起来了

---

## §6. 协调机制(Coordination)

### §6.1 Cargo / 编译协调
- `scripts/build-locked.sh`(已建):`flock /tmp/cargo-build.lock` 序列化 cargo build
- 主 session + 所有 subagent **必须**走这个 wrapper
- 锁文件:`/tmp/cargo-build.lock`(用户可改 `CARGO_LOCK_FILE` / `CARGO_LOCK_TIMEOUT`)
- **禁止** mid-task 直接 `cargo build --release`(详 §7.3)

### §6.2 Subagent fan-out 协调
- 派 N 个 subagent 前:`grep -rn "file_pattern" src/` 看 blast radius
- 任何 2 个 subagent 改文件集**有交集 → 串行,不可并行**
- 同模块 / 同文件 bug:**严格串行**(即便用 worktree,merge 成本高)
- 跨模块 / 0 重叠:**可并行,最多 2 个**(`CLAUDE.md §4` 上限 2)
- subagent 退出前**清理 worktree**: `git worktree remove --force <path>`

### §6.3 Build artifact 协调
- `.app bundle wrapper` vs `cargo binary` 必须 hash 一致(§1.5)
- Build 后**必查**:bundle hash 与 cargo binary hash 一致(§4 Step 5)

### §6.4 macOS / Tauri-specific 协调
- 不要用 `osascript process "ClaudeManager"`(binary 名是 `claude-config-manager`)
- 用 `pgrep -f claude-config-manager` 拿 PID
- 任何 macOS AppleEvent timeout(常见)→ 改用 `screencapture` + `sample <pid>` 间接验证
- **macOS file-replace 不刷新运行中进程**(详 §1.4 + §11.5)

---

## §7. Concurrent Subagent Compounding Failure Prevention

> **多 subagent 并发修改同一 worktree → 高概率一个的半成品代码让另一个的 build/check 失败 → phantom bug 误诊。**

### §7.1 问题描述

`CLAUDE.md §4` 允许 ≤2 subagent 并行。问题链:
- Subagent A 正在改 `Provider` struct,加了新 field,callsite 还没同步
- Subagent B 跑 `cargo check` 验证自己的 fix → 看到字段不一致 → build 报错
- Subagent B 报"field X 缺失" → 误以为是 Y bug → 浪费时间 debug

`FEATURE-DEV-SPEC §9.2.4` "不要并行跑 cargo build"(webview2-com 静态链接 mutex)是**一个症状**;本节覆盖**通用 root cause** —— 并发修改共享 worktree 时 mid-edit 状态彼此不可见。

### §7.2 四条规则(强制)

#### Rule 1: 同文件 / 同模块 → 严格串行
- 派 subagent 前,**先 `mcp__codegraph__codegraph_explore` 找 blast radius**
- 用 `git diff --name-only <base> HEAD` 比较候选 bug 计划改的文件集
- **任何两个 subagent 改的文件集合有交集 → 串行 dispatch**

#### Rule 2: 跨模块并行 → 必用 `isolation: "worktree"`
- Agent 工具的参数 `isolation: "worktree"` 给 subagent 一份独立 git worktree
- 公共开销:~200-500ms setup + 4x 额外磁盘(4 subagent 并行)
- 收益:**零 cross-contamination**,subagent 可以自由跑 build/check
- Worktree 完成后需 main session cherry-pick/merge commit 回来(详 §7.4)
- 当 isolation 不可用时,fallback 到 Rule 4

#### Rule 3: Subagent 验证策略(无论是否 worktree 隔离)
- ✅ **允许**(单 subagent 域内):
  - `cargo check`(Rust 增量检查,秒级)
  - `vitest --run <single-test-file>`(TS 单元测试,秒级)
  - `tsc --noEmit` / 单文件 ESLint / 单文件 type check
- ❌ **禁止 mid-task**: `cargo build --release` / `npm run build` / smoke test / tauri build / e2e 启动 app
- **完整 build + smoke test 由主 session 在所有 Round subagent commit 完成后做一次**(详 §7.4)

#### Rule 4(Fallback when no isolation): Commit-early pattern
- isolation 不可用时(代价高 or 平台限制),subagent 每个 milestone commit 一次:
  - 例 X1 任务:`wip(x1): 真因定位` → `wip(x1): 修法 A 实施` → `fix(x1): 真因修复`
- 下个 subagent 起跑时从 main 分支 sync
- wip commits 在最后由 main session 用 `git rebase -i` squash 成一个正式 commit
- 这是 **isolation 不可用时的兜底**,Rule 2 是首选

### §7.3 Phantom 报错识别(subagent 自检 + 主 session 审核)

Subagent 报告的常见 phantom 报错模式:
- "field X 缺失" / "type Y 不存在" / "import Z 找不到" / "trait X 未实现 for type Y"
- "cannot find macro `xxx` in this scope" / "expected `;`, found `}`"

而那段代码你根本没改 → **大概率是兄弟 subagent 的 mid-edit 状态**。处理:

1. **不要**先花时间 debug phantom
2. `git log -p HEAD~3..HEAD -- <file>` 看谁在动这段
3. `git show main:<file>` 或 `git show $(git merge-base main HEAD):<file>` 确认主分支确实有 X
4. 如果主分支有 X 而你工作区没 X → **等兄弟 commit,然后 sync/rebase**,不要硬改自己的代码
5. 如果主分支也没有 X → **才是真 bug**,按 §2 五步走

主 session 收到 subagent 报"missing field"类错误时,**先问 subagent**:
- "这个 field 你没改,grep 主分支确认了吗?"
- "git log 最近 3 个 commit 动过这个文件吗?"
- 如果 subagent 答"主分支也没" + 解释清楚 → 真 bug,进 §2
- 如果答"我等等再看" / "可能是编译缓存" → 让他先 sync 一次再回

### §7.4 主 session exclusive:完整 build + smoke test

所有 Round 的 subagent 都 commit 完成后,主 session **只跑一次**完整 verification:

```bash
# 前端
npm run build

# Rust 快速通过 → 完整 build
cd src-tauri && cargo check
cd src-tauri && cargo build --release --features tauri/custom-protocol

# 完整 ship 路径(含 tauri build --no-bundle + smoke test 10/10)
./scripts/build-and-ship.sh   # FEATURE-DEV-SPEC §9 全套
```

如果失败:
1. `git log --oneline main..HEAD` 看最近谁 commit 了哪些文件
2. 用 `git bisect` 或逐 commit 排查
3. 找到出问题的 subagent → 用 SendMessage 派回去修
4. **不要在主 session 亲自修 subagent 的活**(违反 `CLAUDE.md §?` 主 session 工作流约束)

如果成功:
- 最终 smoke test 10/10 PASS
- VERIFICATION.md 汇总每个 bug 的 fix evidence
- 主 session 写 SESSION-SUMMARY.md 覆盖本次修复范围

### §7.5 与其他章节的关系

- `FEATURE-DEV-SPEC §9.2.4` 已有"不要并行跑 cargo build"(webview2-com mutex) — 这是**一个症状**,本节覆盖**通用 root cause**
- §3 "实际验证"(硬证据)在 §7 框架下**主 session exclusive** 跑完整 build + UI 验证;subagent 收窄到**单测 / 单元测试**层级
- `FEATURE-DEV-SPEC §6.5` Subagent 派遣纪律 — 本节是它在**并行场景**的具体化和强制规则
- `CLAUDE.md §4`(Fan-out 上限 2)— 本节是它在**跨 subagent 协调**层面的细化

### §7.6 反事故:2026-06-29 Round 0 X1 教训

**观察到的具体风险**:
- X1 subagent 在写 vitest 测试,引用 `GeneratePreviewModal` 组件
- 同时 B6 subagent 在修 AppHeader.tsx,改了 `src/components/AppHeader.tsx`
- 假如 X1 mid-edit 动了 imports → B6 的 `cargo check` 或 `npm run build` 会看到半个 export
- 若 B6 真去 debug "Provider 不能 import" → 误诊为 B6 的问题,实际是 X1 半成品

**2026-06-29 应对**: 已在 Round 0 中途(派发后约 10 分钟)用 SendMessage 同时给两条 subagent 发"中途调令":
1. 中途 verify 只用 `cargo check` + `vitest --run`,不允许 mid-task `cargo build` / `npm run build` / smoke test
2. 每个 milestone commit 一次 (wip-* pattern)
3. 报错先 grep 主分支,再决定是不是 phantom
4. 完整 build + smoke test 主 session 统一跑

**教训汇总**:写规则前已经踩过坑。后续 session 派并行 subagent **必须**从本节开始读,不要重蹈覆辙。

---

## §8. 事后弥补(Remediation)

当已经发生"fake fix" / 用户报"还 broken" / 测试假绿:

### §8.1 检测信号
- 用户重复报告"还 broken" / "没效果" / "X 修复失败"
- subagent 报"完成"但用户实际试 broken
- 主 session 报"9.9/10 broken"
- §2 / §3 流程被跳过

### §8.2 立刻行动
1. **不再 dispatch 新 verify subagent** — 停止 fake-green cycle
2. **直接读 src** 看当前代码状态(不再信 subagent report / commit msg)
3. **真启 binary** 看实际行为(macOS screencapture + `pgrep` + `sample <pid>`)
4. **告诉用户**: "我看到了什么 + 真因是什么 + 直接 Edit 改源码,build 完你重启试一次"
5. **不再"claim 完成"** — 只说 "改完了 build 完了,你试一次"

### §8.3 重新做用户复述的路径
- 用户的报告比 subagent 的"分析"重要 10 倍
- 让用户**精确复述**: step 1 点什么 / step 2 看什么 / 期望 vs 实际
- 主 session **按用户的步骤走**,看每个步骤 binary 实际行为

### §8.4 修完真因后再 verify(同 §4 七步)
- 不要"trust subagent"
- 不要"trust 自己 earlier 描述"
- **每次都真启 + screenshot + sample <pid>**

---

## §9. Subagent Dispatch Template

派 subagent 时的标准 prompt 结构(任何 bug fix 任务):

```
## 任务
[具体 bug ID + 真因若已知]

## CLAUDE.md / BUG-FIX-SPEC.md 必须遵守
- 必读 docs/BUG-FIX-SPEC.md 全部章节
- 真启 binary 验证(screencapture + sample <pid>)
- 不 mock IPC 测 UI
- 任何"fix"必须 git diff 自查 claim 一致

## 编译必须走
./scripts/build-locked.sh (或 flock /tmp/cargo-build.lock cargo build)
禁止直接 cargo build (会 race)

## Worktree
必须 worktree 隔离:git worktree add /tmp/wt-<id> -b <branch> master

## 五要素报告
1. 真因 file:line (≥2 候选,排除法,选 root cause)
2. 修改 src diff
3. 测试 / screencapture 证据 (BUILD_HASH + screenshot path)
4. Branch + commit SHA list
5. user OK 状态 ("已通过 screencap 验证 OK,待 user 重试")

## 失败立即停
如果发现 mock IPC 测试假绿 → 立刻回 Step 真启 binary 重新 verify
如果 build 哈希不对 → 立刻回报,不要 claim 完成
```

---

## §10. 反事故案例索引 + 改进目标 + 删除 trigger

### §10.1 本 session 实证(2026-06-29-30)

| # | Bug | Subagent 报告 | 用户实际 | 错在哪 |
|---|---|---|---|---|
| X1 | GeneratePreviewModal 按钮无反应 | "fix 完成" + 真因 null provider 检查 | OK 实际是修对了 | 这次对 |
| B8 | MCP 加载死循环 | "fix sync 几次 = 真不 loop"(mock) | 真 app 100% CPU | 测的是 sync 函数 ≠ IPC ≠ CPU |
| resource-browser | MCP 死循环(Phase 46 漏 fix) | "jsdom 跑不出 loop" | 真 app 仍 100% CPU | jsdom 不模拟 webview IPC 时序 |
| json-editor | 同 latent bug | "8/8 PASS" | 真 app 用户没试 | 没 user-OK 闭环 |
| A7 | 选目录 auto-fill | "8/8 PASS" | 仍 broken,path 只 basename | mock IPC 屏蔽 native dialog |
| 20 个 bug 总 verify | 17 subagent PASS reports | 9.9 user-visible broken | **用户**: "10 个 BUG,9.9 个修复失败" | 全程 mock-test 假绿 |

### §10.2 改进目标(本 session 之后)

| 项 | 当前 | 改进 |
|---|---|---|
| Subagent verify 时间 | 30-60 min/cycle (单 bug) | < 10 min/cycle (用 §4 七步) |
| User 试的次数 | 每个 bug 至少 1 次 | subagent 真启 + screencap 后**只让 user 试一次** |
| Cargo build 串行率 | 0%(完全 race) | 100%(走 build-locked.sh) |
| Fake green rate | 9.9/10 | < 1/10(七步全过) |
| User 确认频率 | 每个 fix | subagent 报告可信时 **完全跳过**(七步替了 user-OK) |
| Doc 必读率 | subagent 0/4 读了 §19 | 100%(prompt header 必含) |

### §10.3 删除 trigger

**删除 trigger**: `Never (invariant)` — 用户强约束写入。

如要临时绕过某条 hard NO,主 session **必须**在 commit message / SESSION-SUMMARY 显式说明 why,user 单独 OK。**禁止** subagent 自行绕过。

---

## §11. 5 条 Hard NO + User 确认频率目标

### §11.1 5 条 Hard NO(违反任一 = 流程失败)

1. ❌ **Mock IPC vitest 不能算 UI bug verify** — `vi.mocked(tauri.invoke).mockResolvedValue(...)` 屏蔽 native dialog / Rust handler / OS file picker / IPC marshal / React reconciler;**真启 binary 验证是唯一合法 UI verify**
2. ❌ **Subagent self-report 不能算 "fix 完成"** — subagent 是利益相关方,bias 倾向"完成";**真因已知 fix 路径 = 改源码 → build → 真启 → screencap + sample <pid> → 主 session 信任 screencap 才 commit**(不走 user OK 链路)
3. ❌ **Cargo / rustc / sccache 并发跑**(必须串行) — 派 subagent 时 prompt header **必含** "编译走 `scripts/build-locked.sh`(内部 `flock /tmp/cargo-build.lock`),禁止直接 `cargo build`"
4. ❌ **Commit message claim 不等于 evidence** — `db74286` 写"集成 A7 auto-fill"但 diff 删 setNewName。**主 session 收到 subagent "fix" claim 后必须 `git show <sha> -- <file>` diff 自查**
5. ❌ **macOS file-replace 不刷新运行中进程** — 任何 build 完**先 `pkill -9 -f claude-config-manager` 再 build/launch**;用户测试前必须先退 app 重开

### §11.2 Subagent Fan-out 上限

- 同模块 / 同文件 / blast radius 重叠 → **严格串行**(即使 worktree 隔离,merge 成本高)
- 跨模块 / 0 文件级冲突 → 可并行,**最多 2 个同时**(D11 4 是上限,实战 2 是 sweet spot)
- 大 fan-out (4+ subagent) → **禁止**(本 session 17 verify = 9.9 broken 根因)
- 任何 subagent 退出前:`git worktree remove --force <path>`

### §11.3 User 确认频率目标(自动化 ≠ 反复问)

**目标**: user OK 不是"fix 完成"判定,**七步全过 + screencap 证据 即是判定**。
- 子任务自动 verify(七步 + screencap) → **用户不需要 OK**,自动 commit
- User 只在两种情况被 ping:
  1. 七步里有步骤失败(主 session 报错 + 用户看 screencap)
  2. NSOpenPanel 类无法 driver 的 modal 子任务(必须用户手动点)

**反模式**(本 session 犯):"subagent PASS → 主 session 报 fix → user 试 → user 报 broken → 再 subagent → 30-60 min/cycle 循环 17 次"。

### §11.4 必读配套

| 文档 | 位置 | 内容 |
|---|---|---|
| `docs/BUG-FIX-SPEC.md`(本文件)| 项目根 / docs/ | 12 节完整 methodology |
| `docs/FEATURE-DEV-SPEC.md` | 项目根 / docs/ | 功能开发 spec(姊妹篇) |
| `CLAUDE.md` | 项目根 | 薄顶层规则 + 引用入口 |

派任何 subagent 时,prompt header **必含**: "必读 `docs/BUG-FIX-SPEC.md` 全部章节"

---

## §12. BUG FIX WORKFLOW(6 步闭环)

> **新增于 2026-06-30 重构**。基于 `superpowers:systematic-debugging` skill + `verification-before-completion` skill + 原 `BUG-FIX-PROCESS.md §5 Dispatch Template` + 原 `CLAUDE.md §16` 五步流程 整合。

### §12.1 6 步闭环

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: REPRO (写可复现测试)                                │
│  - 用户报 bug → 主 session 派 subagent,subagent 先写 vitest /   │
│    Rust test 复现 bug                                        │
│  - 改前 = FAIL(测试暴露 bug)                                  │
│  - 把测试 commit 到 wip branch,留下 regression 保护           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: 真因 (列 ≥2 候选,排除法)                            │
│  - 不是"加 null guard 让 UI 不崩"                            │
│  - 列出 ≥3 个候选 root cause(file:line 证据)                │
│  - 用 console.log / vi.spyOn(invoke) / 读 DOM 排除到 1 个      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 3: 边界 (列影响范围)                                   │
│  - 这个 bug 改哪些文件?  (blast radius)                     │
│  - 是否触及 IPC 协议 / 多页面 / multi-scope?                │
│  - 是否违反 CLAUDE.md "超 2 文件改动" 白名单?              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 4: 方案 (≥2 候选,选 root cause 真因那个)             │
│  - 列 ≥2 个修法 + 优缺点                                    │
│  - 推荐 = 真因那个,不是 defense-in-depth 那个              │
│  - 风险评估(回归 / 性能 / 跨平台)                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 5: 修 (worktree 隔离 + build-locked)                   │
│  - git worktree add /tmp/wt-<id> -b fix/<name> master       │
│  - 修改 src                                                  │
│  - cargo check + vitest --run single-file (mid-task 允许)   │
│  - 跑测试改前 FAIL → 改后 PASS                                │
│  - wip-* commits                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 6: 真启 verify (§4 七步 Pipeline)                     │
│  - 主 session exclusive:                                   │
│    1. cargo check                                            │
│    2. vitest run                                             │
│    3. npm run build                                          │
│    4. scripts/build-locked.sh                                │
│    5. bundle consistency check (BUNDLE_HASH == BIN_HASH)     │
│    6. pkill + 真启 + screencapture                          │
│    7. sample <pid> + click + screenshot 对比                │
│  - 七步全过 → cherry-pick + commit + claim "fix 完成"       │
│  - 任一步失败 → 回到 §12.1 Step 2 找真因                    │
└─────────────────────────────────────────────────────────────┘
```

### §12.2 关键决策点

| 决策 | 触发条件 | 处理 |
|---|---|---|
| 派 subagent 还是主 session 修 | 真因已知 + 单文件 + 不跨 IPC | 主 session 修 |
| 派 subagent | 真因未知 + 多文件 + 跨 IPC | subagent(带 §9 Dispatch Template) |
| Worktree 隔离 vs 直接改 | 同 §7.2 Rule 2 | 跨模块并行 → worktree |
| User OK 必经 vs 自动 commit | §11.3 七步全过 = 自动 | 仅 NSOpenPanel 类手动 ping |
| Commit atomic vs squash | wip-* pattern → squash | 主 session `git rebase -i` |

### §12.3 Subagent Prompt 强制包含项

派 bug fix subagent,prompt **必须含**:
1. 任务描述 + bug ID + 真因(若已知)
2. "必读 `docs/BUG-FIX-SPEC.md` 全部章节"
3. "编译走 `scripts/build-locked.sh`,禁止直接 `cargo build`"
4. "worktree 隔离:`git worktree add /tmp/wt-<id> -b fix/<branch> master`"
5. "五要素报告:真因 file:line / 修改 diff / 测试输出 / branch+SHA / user OK 状态"
6. "Mock IPC 测试必须说明屏蔽了哪段 + 为什么还合法"
7. "失败立即停,不 claim 完成"

### §12.4 与 FEATURE-DEV-SPEC §10 关系

`FEATURE-DEV-SPEC.md §10`(FEATURE DEV WORKFLOW)是 "从 idea 到 ship" 的正向流程。
本节 `§12`(BUG FIX WORKFLOW)是 "从 bug 报到 root cause 修完" 的反向流程。
两者都是"基于 superpowers skill + 项目验证经验"派生,互补。

---

## 写于 / 删除 trigger

**写于**: 2026-06-30(用户强约束"虚假开发 / 虚假修复" 严重,要求重构方法论文档)
**写者**: Claude Code(autonomous session)
**下次 session 启动必读**: 本文件全部章节
**派任何 fix subagent 必含**: "必读 `docs/BUG-FIX-SPEC.md` 全部章节,遵守 §11.1 5 Hard NO,走 §4 七步 Pipeline,走 §6.1 scripts/build-locked.sh"

**删除 trigger**: `Never (invariant)` — 用户强约束写入。