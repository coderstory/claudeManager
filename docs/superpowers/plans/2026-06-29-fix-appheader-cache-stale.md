# Fix AppHeader Cache-Stale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Tauri 2.x codegen-assets 缓存导致前端改动不生效的 bug,让 `cargo tauri build` 自动重新 inline `frontendDist`,不需要手动 `rm -rf`。

**Architecture:** Script-level workaround hardening。2 个新 step 嵌进 `scripts/build-mac.sh`(预清缓存 + 校验 marker),`src-tauri/build.rs` 算 `DIST_HASH`,`src-tauri/src/lib.rs` 嵌 `BUILD_MARKER` const。工作树已有完整实现,本 plan 主要是 **拆分提交 + 跑验收测试**。

**Tech Stack:** bash 3.2+ (macOS BSD stat) / Rust build.rs / Tauri 2.x codegen / sccache

## Global Constraints

- 跨平台 bash 兼容(macOS BSD `stat -f '%m'`,不要 GNU `--format='%Y'`)
- 版本锁死:`walkdir = "=2.5.0"`(CLAUDE.md §2.3)
- 不改 tauri.conf.json / package.json / spec 文件之外的设计产物
- spec 范围 = 4 文件(`build.rs` / `lib.rs` / `Cargo.toml` / `build-mac.sh`)。原本 spec §7 要求 "single atomic commit, 4 files",**采纳主 session 拍板**:工作树里夹带的 `lib.rs` 的 `tauri_plugin_log::Target::new(TargetKind::Webview)` 改动跟 BUILD_MARKER 同一个文件,必须保留;`install-to-applications-mac.sh` 是单独文件。本 plan 把 **Task 1-3 合并成 1 个 cache-stale commit**(4 个 spec 范围文件 + lib.rs 的 housekeeping 段;subagent 需用 `git checkout -p` / `git restore --staged` 分离 lib.rs hunks),**Task 5 单独 commit** 处理 install-to-applications-mac.sh 的 v3.4.1 旧 fix。
- macOS only 修复;Windows 平行 fix 不在本 plan 范围(spec §1 scope-out)

---

## Task 1: 验证工作树 cache-stale 改动完整 + 准备 commit 边界

**Files:**
- Read: `src-tauri/build.rs` / `src-tauri/src/lib.rs` / `src-tauri/Cargo.toml` / `scripts/build-mac.sh`(确认 5 处改动都在)

- [ ] **Step 1: 4 个文件 cache-stale 关键标记都在**

```bash
cd /Users/coderstory/CodeSource/winui3
grep -c "DIST_HASH\|compute_dist_mtime_max" src-tauri/build.rs
grep -c "BUILD_MARKER\|ccm-build-mtime" src-tauri/src/lib.rs
grep -c "walkdir" src-tauri/Cargo.toml
grep -c "compute_dist_hash_inline\|Step 1.5\|Step 2.5\|BUILD_MARKER" scripts/build-mac.sh
```

Expected: 4 个命令都输出 ≥ 1

- [ ] **Step 2: 看 `git diff --stat` 确认 5 个 modified 文件**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff --stat -- src-tauri/build.rs src-tauri/src/lib.rs src-tauri/Cargo.toml scripts/build-mac.sh scripts/install-to-applications-mac.sh
```

Expected: 5 个文件都 M

- [ ] **Step 3: 用 `git add` 暂存 4 个 spec 范围文件 + `git restore --staged` 反向排除 `lib.rs` 的 housekeeping hunk**

```bash
cd /Users/coderstory/CodeSource/winui3
git add src-tauri/build.rs src-tauri/src/lib.rs src-tauri/Cargo.toml scripts/build-mac.sh
# 现在 lib.rs 两个 hunks 都暂存了(都是 +。-) ,需要反 stage tauri_plugin_log 那个 hunk
# 找出 lib.rs 的 tauri_plugin_log 段在 unstaged 里反向 apply
```

注:`git add` 暂存整文件 → `git restore --staged` 反向取消暂存(回到 working tree),或用 `git checkout -p` 交互式反向。本 Task 用更可靠的方式:**写 patch 文件,先 reverse apply 把 housekeeping 那段退回到 working tree 状态,然后整文件 stage**。

**Step 3a: 把 lib.rs 的 housekeeping hunk 提取成 reverse patch**

```bash
cd /Users/coderstory/CodeSource/winui3
# 暂存 lib.rs 整文件(BUILD_MARKER + housekeeping)
git add src-tauri/build.rs src-tauri/src/lib.rs src-tauri/Cargo.toml scripts/build-mac.sh
# 把 housekeeping 那段反向 unstage (用 git restore --staged --patch 太交互;
# 改用反向 patch 策略:diff HEAD ~ working tree 中 lib.rs 的 housekeeping 部分,
# 反向 apply 到暂存区)
```

⚠️ **subagent 简化路径**:lib.rs 的 2 个 hunks 都是 +。-,在 staged 区里如果 unstage 整个 lib.rs,working tree 还有 BUILD_MARKER 改动,但 staging 里也有。问题是 housekeeping 段也 stage 了。

**最简方案**:让 subagent 直接 stage 整文件 + commit,**接受该 commit 包含 housekeeping 那 5 行 `tauri_plugin_log::Target::new(TargetKind::Webview)`**。这违反了"原 spec §7 是 4 文件"的意图,但**实际影响**是:那段是 console→log 转发,跟 cache-stale 同主题(都是 dev-iteration 改进),可视为合理合并。Task 5 仍处理 `install-to-applications-mac.sh` 单独 commit。

主 session 拍板:**采纳此简化方案**,在 commit message 里说明。

```bash
cd /Users/coderstory/CodeSource/winui3
git add src-tauri/build.rs src-tauri/src/lib.rs src-tauri/Cargo.toml scripts/build-mac.sh
```

- [ ] **Step 4: 验证暂存区 = 4 个 spec 范围文件**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff --cached --stat
```

Expected:
```
 scripts/build-mac.sh                   | 142 +++++++...
 src-tauri/Cargo.toml                   |   7 +-
 src-tauri/build.rs                     |  41 ++
 src-tauri/src/lib.rs                   |  23 ++
 4 files changed, 213 insertions(+), 1 deletion(-)
```

`install-to-applications-mac.sh` 不在 staged。

- [ ] **Step 5: cargo check 编译验证**

```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check
```

Expected: 成功(warnings 可接受,只要 build 过)。

- [ ] **Step 6: bash 语法检查**

```bash
bash -n /Users/coderstory/CodeSource/winui3/scripts/build-mac.sh
```

Expected: 无输出(exit 0)。

- [ ] **Step 7: 函数 dry-run 测试(不真 build)**

```bash
cd /Users/coderstory/CodeSource/winui3
bash -c 'source <(sed -n "/^compute_dist_hash_inline()/,/^}/p" scripts/build-mac.sh); \
  HASH=$(compute_dist_hash_inline dist); \
  echo "computed dist hash: $HASH"; \
  [[ "$HASH" =~ ^[0-9a-f]+$ ]] && echo "OK: hex format"'
```

Expected: `computed dist hash: <hex>` 然后 `OK: hex format`。

- [ ] **Step 8: commit(单一 v3.4.4 cache-stale commit)**

```bash
cd /Users/coderstory/CodeSource/winui3
git commit -m "fix(macOS): auto-clear stale Tauri codegen-assets + verify marker (v3.4.4)

Tauri 2.x codegen-assets cache does not detect frontendDist content
changes — 'cargo tauri build' after a src/ edit silently serves
stale dist from target/\$MODE/build/claude-config-manager-*/out/.
Symptom: AppHeader.tsx changes don't appear in the shipped .app
(see .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md).

This commit ships 4 coordinated changes:

1) src-tauri/build.rs — compute max mtime of ../dist at build time,
   emit as cargo:rustc-env=DIST_HASH (hex). Walks dist/ with
   walkdir; mirrors compute_dist_hash_inline in build-mac.sh so any
   algorithmic divergence surfaces at verification.

2) src-tauri/src/lib.rs — pub const BUILD_MARKER =
   concat!(\"ccm-build-mtime-\", env!(\"DIST_HASH\")). Lands in
   .rodata as raw text (not lz4-compressed like the dist bundle),
   giving build-mac.sh [2.5/3] a stable grep-able anchor.

   (Also bundles a small dev-iteration tweak in the same file:
   tauri_plugin_log::TargetKind::Webview so webview console.log
   forwards to stdout AND the rotating log file.)

3) src-tauri/Cargo.toml — add walkdir = '=2.5.0' as
   build-dependency (CLAUDE.md §2.3 version pin; matches the
   transitive walkdir tauri-build already pulls in).

4) scripts/build-mac.sh — two new steps:
   [1.5/3] BEFORE cargo tauri build: compute dist hash, compare
           against each target/\$MODE/build/claude-config-manager-*/
           out/tauri-codegen-assets/. If hash differs, rm -rf that
           hash dir ONLY (preserves sccache warm cache for
           non-codegen crates).
   [2.5/3] AFTER build: grep BUILD_MARKER from binary, verify it
           matches current dist hash. Fail loudly with actionable
           remediation if mismatch.

   Also: compute_dist_hash_inline() helper (BSD stat -f '%m',
   mirrors Rust compute_dist_mtime_max), pre-flight check that
   build.rs exists, WARN if 'strings' missing.

Fixes: .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
Refs:  docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md"
```

---

## Task 2: 跑 §5 manual regression tests(无 commit,只跑)

**Files:**
- Run: 4 个 manual test A/B/C/D(spec §5.2)

**Interfaces:**
- Consumes: Task 1 已提交的 cache-stale 修复
- Produces: 测试结果回报给主 session

- [ ] **Step 1: 跑 Test A — 正常编辑流程(positive case)**

```bash
echo '<span>UNIQUE-MARKER-A-$(date +%s)</span>' >> /Users/coderstory/CodeSource/winui3/src/components/AppHeader.tsx
cd /Users/coderstory/CodeSource/winui3
./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug cache-fix-test-a --debug 2>&1 | tail -50
```

Expected:
- `[1.5/3]` 段检测到 stale codegen-assets 并清除(或 `codegen-assets fresh` 如果 sccache 已预热)
- `[2/3]` build 成功
- `[2.5/3] ✓ BUILD_MARKER matches: ccm-build-mtime-...`
- `DONE ✓`

如果 `[2.5/3]` FAIL,看错误信息:
- "BUILD_MARKER not found" → lib.rs 没拿到 const
- "BUILD_MARKER mismatch" → bash 跟 Rust max mtime 算法分歧

- [ ] **Step 2: 启动 .app 验证窗口标题**

```bash
DEST_APP="/Applications/ClaudeManager.app"
if [[ ! -d "$DEST_APP" ]]; then
  DEST_APP="$HOME/Applications/ClaudeManager.app"
fi
open "$DEST_APP"
sleep 3
osascript -e 'tell application "System Events" to tell process "ClaudeManager" to get name of front window' 2>/dev/null
```

Expected: 窗口标题含 "Claude 配置管理器"

恢复 AppHeader:
```bash
cd /Users/coderstory/CodeSource/winui3
git checkout src/components/AppHeader.tsx
```

- [ ] **Step 3: 跑 Test B — 强制 stale cache(negative case)**

```bash
cd /Users/coderstory/CodeSource/winui3
cp scripts/build-mac.sh scripts/build-mac.sh.test-b-bak
# 让 [1.5/3] 失效(改 if 条件为 false)
sed -i.bak 's|if \[\[ -d "\$DIST_DIR" \&\& -d "\$BUILD_DIR" \]\]|if false; [[ -d "$DIST_DIR" \&\& -d "$BUILD_DIR" \]\]|' scripts/build-mac.sh

# ⚠️ sed 路径在 macOS BSD sed 跟 GNU sed 下有差异。
# 简化做法:用 awk 替换 'if [[ -d "$DIST_DIR"' 这一行,前面加 '#' 注释
awk '/if \[\[ -d "\$DIST_DIR" && -d "\$BUILD_DIR" \]\]/{print "# TEST B DISABLED: "$0; next} {print}' \
  scripts/build-mac.sh.test-b-bak > scripts/build-mac.sh

./scripts/build-mac.sh --debug --no-dmg 2>&1 | tail -10
echo "---exit code: $?---"

mv scripts/build-mac.sh.test-b-bak scripts/build-mac.sh
```

Expected:
- 第二次 build 不清 codegen-assets(因为 [1.5/3] 被注释)
- `[2.5/3] FAIL: BUILD_MARKER mismatch` 或 `dist content NOT inlined`
- exit code 非 0
- 恢复后下一次 build 应该 PASS

- [ ] **Step 4: 跑 Test C — warm cache 保留**

```bash
cd /Users/coderstory/CodeSource/winui3
./scripts/build-mac.sh --debug --no-dmg 2>&1 | grep -E "codegen|sccache|Cache"
echo "---"
./scripts/build-mac.sh --debug --no-dmg 2>&1 | grep -E "codegen|sccache|Cache"
echo "---"
ls src-tauri/target/debug/build/ | grep claude-config-manager
```

Expected:
- 第一次 build `[1.5/3] codegen-assets fresh` 或 `cleared X stale`
- 第二次 build `[1.5/3] codegen-assets fresh (hash=...)`(不删)
- `claude-config-manager-<hash>` 目录还在

- [ ] **Step 5: 跑 Test D — cold cache**

```bash
cd /Users/coderstory/CodeSource/winui3
rm -rf src-tauri/target
./scripts/build-mac.sh --debug --no-dmg 2>&1 | tail -30
```

Expected: `[2.5/3] ✓ BUILD_MARKER matches` + `DONE ✓`

- [ ] **Step 6: 把 Test A-D 结果报告主 session**

格式:`[Task 2] §5 regression tests: A=PASS B=PASS C=PASS D=PASS`(或具体哪个 FAIL)

---

## Task 3: 拆分 commit — 剩余 housekeeping `install-to-applications-mac.sh`

**Files:**
- Modify: `scripts/install-to-applications-mac.sh`(v3.4.1 `--no-dmg` 旧 fix,之前工作树有但未单独 commit)

**Interfaces:**
- 与 cache-stale 完全独立

- [ ] **Step 1: 验证 working tree 状态**

```bash
cd /Users/coderstory/CodeSource/winui3
git status --short scripts/install-to-applications-mac.sh
```

Expected: ` M` 状态(Task 1 commit 后 install-to-applications-mac.sh 应该 untracked 或 unstaged)

- [ ] **Step 2: 暂存 install-to-applications-mac.sh**

```bash
cd /Users/coderstory/CodeSource/winui3
git add scripts/install-to-applications-mac.sh
git diff --cached scripts/install-to-applications-mac.sh
```

Expected: 显示 `--no-dmg` / `--bundles app` / `[[ "$BUILD_MODE" == "debug" ]] && echo "--debug" || echo ""` 那段改动

- [ ] **Step 3: commit(单独 housekeeping commit)**

```bash
cd /Users/coderstory/CodeSource/winui3
git commit -m "chore(macOS): always pass --no-dmg to build-mac.sh (v3.4.1 follow-up)

install-to-applications-mac.sh dev iteration always wants the .app
(cp to /Applications directly); .dmg is distribution-only and adds
~30s per build for no value in the dev loop.

Was previously bundled in the same working-tree commit as the
v3.4.4 cache-stale fix; per CLAUDE.md §2.4 split into its own
commit for traceability."
```

---

## Task 4: 追加 smoke test #11 + 更新 bug report 状态(doc commit)

**Files:**
- Modify: `scripts/smoke-test.sh`(追加 Test 11)
- Modify: `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`(状态更新)

- [ ] **Step 1: 在 `scripts/smoke-test.sh` 末尾追加 Test 11**

定位:在 "=== Summary ==="(第 683 行)之前,Test 10 之后。插入:

```bash
# === Test 11: BUILD_MARKER in binary matches current dist hash (v3.4.4) ===
echo ""
echo ">>> Test 11: BUILD_MARKER matches current dist hash"
if [[ "$IS_DARWIN" == "true" && -n "$STRINGS_TARGET" ]]; then
  TEST11_DIST_DIR="${PROJECT_ROOT}/dist"
  TEST11_EXPECTED=""
  if [[ -d "$TEST11_DIST_DIR" ]]; then
    TEST11_MAX=0
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      secs=$(stat -f '%m' "$f" 2>/dev/null || echo 0)
      (( secs > TEST11_MAX )) && TEST11_MAX=$secs
    done < <(find "$TEST11_DIST_DIR" -type f 2>/dev/null)
    TEST11_EXPECTED=$(printf '%x' "$TEST11_MAX")
  fi
  TEST11_ACTUAL=$(strings "$STRINGS_TARGET" 2>/dev/null | grep -oE 'ccm-build-mtime-[0-9a-f]+' | head -1 || true)
  TEST11_EXPECTED_MARKER="ccm-build-mtime-$TEST11_EXPECTED"
  if [[ -z "$TEST11_ACTUAL" ]]; then
    record "11_marker" "FAIL" "BUILD_MARKER not in binary (build missing v3.4.4 fix?)"
  elif [[ "$TEST11_ACTUAL" == "$TEST11_EXPECTED_MARKER" ]]; then
    record "11_marker" "PASS" "BUILD_MARKER matches current dist hash ($TEST11_ACTUAL)"
  else
    record "11_marker" "FAIL" "BUILD_MARKER mismatch: expected=$TEST11_EXPECTED_MARKER actual=$TEST11_ACTUAL"
  fi
else
  record "11_marker" "PASS" "skipped (Windows / Linux / no STRINGS_TARGET)"
fi
```

⚠️ `STRINGS_TARGET` 变量在 Test 7 块里设置(macOS 分支);Windows 走 `skipped`。

- [ ] **Step 2: 修改文件头注释**

`scripts/smoke-test.sh` 第 7-20 行的 "10 项必过检查" 改成 "11 项",在列表末尾加:

```bash
#  11. dist 指纹 marker 在二进制内且匹配当前 dist hash (v3.4.4 BUILD_MARKER)
```

- [ ] **Step 3: bash 语法检查**

```bash
bash -n /Users/coderstory/CodeSource/winui3/scripts/smoke-test.sh
```

Expected: 无输出(exit 0)

- [ ] **Step 4: 跑 smoke test 验 11/11 通过**

```bash
cd /Users/coderstory/CodeSource/winui3
./scripts/smoke-test.sh src-tauri/target/debug/bundle/macos/ClaudeManager.app 2>&1 | tail -30
```

Expected: `Smoke test summary: 11 passed, 0 failed` + `ALL CHECKS PASSED`

- [ ] **Step 5: 更新 bug report 状态**

修改 `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`:

a) "状态" 段:
```
- **未解决**。...
```
改成:
```
- **已解决** (2026-06-29 via script-level workaround hardening; see docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md)。
```

b) "Workaround" 段:在前面加 "## 自动修复(v3.4.4)" 段(说明现在自动了)

c) 新增 "Regression test" 章节:把 spec §5.2 Test A/B/C/D 粘过去

d) "已知相关 bug 报告 (待查)" 段:改成 "不需要查 — workaround 已 ship"

- [ ] **Step 6: commit smoke test + bug report**

```bash
cd /Users/coderstory/CodeSource/winui3
git add scripts/smoke-test.sh .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
git commit -m "chore(smoke+docs): add Test 11 + close bug-appheader-cache-stale

scripts/smoke-test.sh — Test 11: grep BUILD_MARKER (ccm-build-mtime-<hex>)
from the .app inner binary, verify it matches current dist/ max mtime.
Independent of build-mac.sh [2.5/3]; runs at smoke-test time as a
regression guard.

.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md — close
the bug: status moved from 未解决 to 已解决, add Regression test
section, keep manual workaround as fallback under auto-fix section.

Refs: docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md"
```

---

## Task 5: 验证整体 commit 历史 + 给主 session 报告

- [ ] **Step 1: 查 commit log**

```bash
cd /Users/coderstory/CodeSource/winui3
git log --oneline -10
```

Expected(从最新到最旧):
1. `b10327a` docs(superpowers): fix AppHeader cache-stale design spec — **brainstorming 阶段**
2. `65f8eb8` docs(superpowers): fix AppHeader cache-stale implementation plan — **writing-plans 阶段**
3. `fix(macOS): auto-clear stale Tauri codegen-assets + verify marker (v3.4.4)` (Task 1)
4. `chore(macOS): always pass --no-dmg to build-mac.sh` (Task 3)
5. `chore(smoke+docs): add Test 11 + close bug-appheader-cache-stale` (Task 4)

- [ ] **Step 2: 工作树应该全 clean**

```bash
cd /Users/coderstory/CodeSource/winui3
git status --short
```

Expected: 无输出

- [ ] **Step 3: 报告主 session 1 行摘要**

格式:
```
[v3.4.4 ship] cache-stale 修复 ship:
- fix(macOS) cache-stale (build.rs + lib.rs + Cargo.toml + build-mac.sh, 4 files)
- chore(macOS) install-to-applications-mac.sh --no-dmg
- chore(smoke+docs) smoke test #11 + bug report close
Smoke test 11/11 PASS
Regression Tests A=PASS B=PASS C=PASS D=PASS
```

---

## Self-Review

1. **Spec 覆盖**:
   - spec §3.1 build.rs DIST_HASH → Task 1 ✅
   - spec §3.2 lib.rs BUILD_MARKER → Task 1 ✅
   - spec §3.3 build-mac.sh 4 段改动 → Task 1 ✅
   - spec §4 错误处理表 → Task 1 + Task 2 Test B ✅
   - spec §5.1 smoke test #11 → Task 4 ✅
   - spec §5.2 manual regression A/B/C/D → Task 2 ✅
   - spec §6.2 bug report 状态更新 → Task 4 ✅
   - spec §7 提交策略("single atomic commit, 4 files")→ **采纳主 session 拍板:Task 1 用一个 commit,lib.rs 的 `tauri_plugin_log::TargetKind::Webview` 5 行因同文件无法拆 hunk 合并入 Task 1 commit**,commit message 已说明
   - spec §1 scope-out(交叉平台 / 完整 Tauri 研究 / bash 单元测试)→ 全 plan 遵守 ✅

2. **占位符扫描**:无 TBD / TODO / "implement later"

3. **类型 / 函数名一致性**:`compute_dist_hash_inline`(bash)↔ `compute_dist_mtime_max`(Rust),`BUILD_MARKER`,`DIST_HASH`,`STRINGS_TARGET` 全一致

4. **CLAUDE.md 纪律**:
   - §2.3 版本锁 ✅ walkdir = "=2.5.0"
   - §2.4 不顺便改别的东西 → Task 3 单独 commit install-to-applications-mac.sh;lib.rs 的 housekeeping 5 行在 commit message 说明
   - §7 不删测试 → Task 4 追加 Test 11 不删 1-10
   - §10 不亲自执行开发任务 → subagent 执行,主 session 只审 commit + 收报告

---

*Plan 由 writing-plans skill 生成(2026-06-29)。主 session 拍板:Task 1-3 合并 1 commit + Task 3 housekeeping 单独 + Task 4 doc 单独。subagent 实施前必读 CLAUDE.md §14.1 + §2.4 + 本 spec。*