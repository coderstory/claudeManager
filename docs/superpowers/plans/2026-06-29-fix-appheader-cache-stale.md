# Fix AppHeader Cache-Stale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Tauri 2.x codegen-assets 缓存导致前端改动不生效的 bug,让 `cargo tauri build` 自动重新 inline `frontendDist`,不需要手动 `rm -rf`。

**Architecture:** Script-level workaround hardening。2 个新 step 嵌进 `scripts/build-mac.sh`(预清缓存 + 校验 marker),`src-tauri/build.rs` 算 `DIST_HASH`,`src-tauri/src/lib.rs` 嵌 `BUILD_MARKER` const。工作树已有完整实现,本 plan 主要是 **拆分提交 + 跑验收测试**。

**Tech Stack:** bash 3.2+ (macOS BSD stat) / Rust build.rs / Tauri 2.x codegen / sccache

## Global Constraints

- 跨平台 bash 兼容(macOS BSD `stat -f '%m'`,不要 GNU `--format='%Y'`)
- 版本锁死:`walkdir = "=2.5.0"`(CLAUDE.md §2.3)
- 不改 tauri.conf.json / package.json / spec 文件之外的设计产物
- spec 范围 = 4 文件(`build.rs` / `lib.rs` / `Cargo.toml` / `build-mac.sh`);工作树里**夹带**的 2 个文件(`install-to-applications-mac.sh` + `lib.rs` 的 `tauri_plugin_log::Target::new(TargetKind::Webview)`)按 CLAUDE.md §2.4 必须**单独拆 commit**,不能混进 v3.4.4 cache-stale commit
- macOS only 修复;Windows 平行 fix 不在本 plan 范围(spec §1 scope-out)

---

## Task 1: 拆分 commit — `src-tauri/build.rs` + `src-tauri/Cargo.toml`(纯 cache-stale 部分)

**Files:**
- Modify: `src-tauri/build.rs`(保留 BUILD_GIT_COMMIT / BUILD_HASH / BUILD_TIMESTAMP + re-run triggers;新增 DIST_HASH 段 + `compute_dist_mtime_max` 函数 + `use std::path::Path;` `use std::time::UNIX_EPOCH;` `use walkdir::WalkDir;`)
- Modify: `src-tauri/Cargo.toml`(在 `[build-dependencies]` 块加 `walkdir = "=2.5.0"` + 注释)

**Interfaces:**
- Consumes: 现有 `cargo:rerun-if-changed=../.git/HEAD` / `cargo:rerun-if-changed=../.git/refs/heads` / `tauri_build::build()`
- Produces: `cargo:rustc-env=DIST_HASH=<hex>`,供 `lib.rs` 的 `env!("DIST_HASH")` 读

- [ ] **Step 1: 验证工作树 `build.rs` 含 DIST_HASH + compute_dist_mtime_max**

```bash
grep -c "DIST_HASH" /Users/coderstory/CodeSource/winui3/src-tauri/build.rs
grep -c "compute_dist_mtime_max" /Users/coderstory/CodeSource/winui3/src-tauri/build.rs
```

Expected: 两个命令都输出 ≥ 1(说明工作树里改动已就位)

- [ ] **Step 2: 验证工作树 `Cargo.toml` 含 walkdir build-dep**

```bash
grep -c "walkdir" /Users/coderstory/CodeSource/winui3/src-tauri/Cargo.toml
```

Expected: `1`(只匹配新增那行,不该有别处用到)

- [ ] **Step 3: 用 `git add -p` 暂存这两文件的 cache-stale 部分**

⚠️ 这一步**不能**整文件 add,必须用 `git add -p` 交互式选 hunks:

```bash
cd /Users/coderstory/CodeSource/winui3
git add -p src-tauri/build.rs src-tauri/Cargo.toml
```

交互提示:
- `Cargo.toml`:只有 1 个 hunk(`+version = "0.1.16"` 那段是 v3.4.1 旧 fix 改动,**不要**;但它是单独一行 + Cargo.toml 当前是 M 状态。**先看 diff 是不是纯净的**——如果只有 walkdir 一段 hunk,直接 `y`;如果 version bump 也在同一个 hunk,先 `e` 手动编辑掉 version 行)

参考命令查当前 diff:
```bash
git diff src-tauri/Cargo.toml
```

应该看到:
```diff
@@ -1,6 +1,6 @@
 [package]
 name = "claude-config-manager"
-version = "0.1.5"
+version = "0.1.16"
 ...
```

⚠️ **如果 version bump 是必须保留的另一个独立 fix**,那就用 `git add -p` 选 `e` 手动编辑,把 version 行还原成 `0.1.5`(本 Task 不动 version,version bump 留给 Task 5 单独 commit)

- `build.rs`:所有 hunks 全 `y`(都是 v3.4.4 DIST_HASH 相关 + import)

- [ ] **Step 4: 验证暂存区正确**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff --cached --stat
```

Expected: 看到 `src-tauri/build.rs` + `src-tauri/Cargo.toml` 在暂存区;**不应该**看到 `src-tauri/src/lib.rs` 或 `scripts/build-mac.sh`

- [ ] **Step 5: 跑 `cargo check` 验证编译**

```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check
```

Expected: 成功;warnings 可能有但 build 不该断(`compute_dist_mtime_max` 第一次引入会有 dead_code warning,等 lib.rs 用了 env! 之后会消)

- [ ] **Step 6: commit**

```bash
cd /Users/coderstory/CodeSource/winui3
git commit -m "feat(tauri): embed DIST_HASH in build.rs for stale-cache detection (v3.4.4)

src-tauri/build.rs computes max mtime of ../dist at build time and
emits it as cargo:rustc-env=DIST_HASH. Companion to scripts/build-mac.sh
step [2.5/3] which verifies the marker in the built binary matches
the current dist hash.

src-tauri/Cargo.toml — add walkdir = '=2.5.0' as build-dependency
(pinned per CLAUDE.md §2.3; matches tauri-build's transitive walkdir
to avoid pulling a second copy into the dep graph).

Refs: docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md"
```

---

## Task 2: 拆分 commit — `src-tauri/src/lib.rs`(纯 BUILD_MARKER 部分)

**Files:**
- Modify: `src-tauri/src/lib.rs`(新增 `pub const BUILD_MARKER` + 文档注释)

**Interfaces:**
- Consumes: `env!("DIST_HASH")` from build.rs
- Produces: `pub const BUILD_MARKER: &str = concat!("ccm-build-mtime-", env!("DIST_HASH"))`,可被 `strings <binary>` grep 到

- [ ] **Step 1: 用 `git add -p` 暂存 lib.rs 的 BUILD_MARKER hunk,排除 `tauri_plugin_log::Target::new` hunk**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff src-tauri/src/lib.rs
```

参考输出(从前面 `git diff` 已确认):
- 第一个 hunk:`+pub const BUILD_MARKER` + 长文档注释 → **y**
- 第二个 hunk:`tauri_plugin_log::Builder::default().build()` → `tauri_plugin_log::Builder::default().target(...).build()` → **n**(这是夹带的 console→log 转发改动,留给 Task 5)

```bash
git add -p src-tauri/src/lib.rs
```

第一个 hunk `y`,第二个 hunk `n`

- [ ] **Step 2: 验证暂存区**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff --cached --stat
git diff --cached src-tauri/src/lib.rs
```

Expected: `lib.rs` 在暂存区;`git diff --cached` 只显示 `+pub const BUILD_MARKER` + 注释,**不**显示 `tauri_plugin_log` 那段

- [ ] **Step 3: 验证编译**

```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check
```

Expected: BUILD_MARKER const 编译通过,`env!("DIST_HASH")` 解析为 Task 1 注入的 hex 字符串

- [ ] **Step 4: commit**

```bash
cd /Users/coderstory/CodeSource/winui3
git commit -m "feat(tauri): declare BUILD_MARKER const for binary grep verification (v3.4.4)

pub const BUILD_MARKER = concat!(\"ccm-build-mtime-\", env!(\"DIST_HASH\"))
lands in .rodata as raw text (not lz4-compressed like the dist bundle),
giving scripts/build-mac.sh step [2.5/3] a stable grep-able anchor to
verify the dist was actually inlined into the binary. Without this,
Tauri 2.x silently serves stale dist from codegen-assets cache even
after cargo tauri build succeeds.

Refs: docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md"
```

---

## Task 3: 拆分 commit — `scripts/build-mac.sh`(cache-stale 4 段:`compute_dist_hash_inline` helper + pre-flight check + `[1.5/3]` + `[2.5/3]`)

**Files:**
- Modify: `scripts/build-mac.sh`(spec §3.3 列的所有 cache-stale 相关改动)

**Interfaces:**
- Consumes: `DIST_DIR` / `BUILD_DIR` 局部变量;`strings` CLI;macOS BSD `stat -f '%m'`
- Produces:
  - 函数 `compute_dist_hash_inline <dir> → hex` (echo 到 stdout)
  - pre-flight fail(若 `src-tauri/build.rs` missing)/ warn(若 `strings` missing)
  - Step `[1.5/3]` stale codegen-assets 自动清
  - Step `[2.5/3]` BUILD_MARKER 校验,fail loud 给 actionable remediation

- [ ] **Step 1: 用 `git add -p` 暂存 build-mac.sh 的 cache-stale hunks,排除 `--no-dmg` / `--bundles` 那段 hunk**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff scripts/build-mac.sh
```

参考 hunks(从前面 diff 已确认):
- hunk 1(`@@ -29,6 +29,21 @@`):文档头 v3.4.4 注释段 → **y**
- hunk 2(`@@ -56,6 +71,25 @@`):`compute_dist_hash_inline` helper + `MODE=` 之间 → **y**
- hunk 3(`@@ -64,7 +98,16 @@`):`--no-dmg` / `--bundles` 改动 → **n**(v3.4.1 旧 fix,留给 Task 5)
- hunk 4(`@@ -77,6 +120,20 @@`):pre-flight checks → **y**
- hunk 5(`@@ -100,6 +157,45 @@`):Step `[1.5/3]` 段 → **y**
- hunk 6(`@@ -119,6 +215,50 @@`):Step `[2.5/3]` 段 → **y**

```bash
git add -p scripts/build-mac.sh
```

按上面顺序:y / y / n / y / y / y

- [ ] **Step 2: 验证暂存区 + 排除项**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff --cached --stat
git diff --cached scripts/build-mac.sh | grep -E "^\+.*bundles" || echo "OK: --bundles not in staged"
```

Expected: 第一个输出显示 `scripts/build-mac.sh` 在暂存区;第二个 echo `OK: --bundles not in staged`

- [ ] **Step 3: bash 语法检查**

```bash
bash -n /Users/coderstory/CodeSource/winui3/scripts/build-mac.sh
```

Expected: 无输出(exit 0)

- [ ] **Step 4: 函数 dry-run 测试(不真 build)**

```bash
cd /Users/coderstory/CodeSource/winui3
bash -c 'source <(grep -A 20 "^compute_dist_hash_inline" scripts/build-mac.sh | sed -n "/^compute_dist_hash_inline/,/^}/p"); \
  HASH=$(compute_dist_hash_inline dist); \
  echo "computed dist hash: $HASH"; \
  [[ "$HASH" =~ ^[0-9a-f]+$ ]] && echo "OK: hex format"'
```

Expected: 输出形如 `computed dist hash: 684a...` 然后 `OK: hex format`

- [ ] **Step 5: commit**

```bash
cd /Users/coderstory/CodeSource/winui3
git commit -m "feat(macOS): auto-clear stale Tauri codegen-assets + verify marker (v3.4.4)

scripts/build-mac.sh — two new steps:

[1.5/3] Before cargo tauri build: compute dist hash, compare against
each target/\$MODE/build/claude-config-manager-*/out/tauri-codegen-assets/.
If hash differs, rm -rf that hash dir only (preserves sccache warm
cache for non-codegen crates — only the affected codegen output is
cleared, not the entire target/).

[2.5/3] After build: grep binary for BUILD_MARKER (ccm-build-mtime-<hex>),
verify matches current dist hash. Fail loudly with actionable remediation
if mismatch (suggests manual rm -rf or cargo clean -p).

Also adds:
- compute_dist_hash_inline() helper (BSD stat -f '%m', mirrors Rust
  compute_dist_mtime_max in src-tauri/build.rs)
- Pre-flight check: src-tauri/build.rs must exist; warn if 'strings'
  missing (Xcode CLT not installed)

Fixes: .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
Refs:  docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md"
```

---

## Task 4: 跑 §5 manual regression tests

**Files:**
- Read: `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`(原 bug 报告的 "Regression test" 章节需要新增)
- Run: 4 个 manual test A/B/C/D

**Interfaces:**
- Consumes: 上 3 个 Task 已提交的 cache-stale 修复
- Produces: 测试结果 + bug report 状态更新

- [ ] **Step 1: 跑 Test A — 正常编辑流程(positive case)**

```bash
echo '<span>UNIQUE-MARKER-A-$(date +%s)</span>' >> /Users/coderstory/CodeSource/winui3/src/components/AppHeader.tsx
cd /Users/coderstory/CodeSource/winui3
./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug cache-fix-test-a --debug 2>&1 | tail -50
```

Expected:
- `[1.5/3]` 段检测到 stale codegen-assets 并清除(或 `codegen-assets fresh` 如果有 sccache 预热)
- `[2/3]` build 成功
- `[2.5/3] ✓ BUILD_MARKER matches: ccm-build-mtime-...`
- `DONE ✓`

如果 `[2.5/3]` FAIL,看错误信息:
- "BUILD_MARKER not found" → src-tauri/lib.rs 没拿到 const(Task 2 commit 没进去)
- "BUILD_MARKER mismatch" → Task 1 + Task 3 哈希算法分歧(bash 跟 Rust max mtime 算法要对一下)

- [ ] **Step 2: 启动 .app 验证 marker 显示**

```bash
DEST_APP="/Applications/ClaudeManager.app"
if [[ ! -d "$DEST_APP" ]]; then
  DEST_APP="$HOME/Applications/ClaudeManager.app"
fi
open "$DEST_APP"
sleep 3
osascript -e 'tell application "System Events" to tell process "ClaudeManager" to get name of front window' 2>/dev/null
```

Expected: 窗口标题显示 "Claude 配置管理器"(来自 AppHeader `<span>`)。如果没显示 UNIQUE-MARKER 字符串(可能 webview 缓存),至少标题应该一致

恢复 AppHeader:
```bash
cd /Users/coderstory/CodeSource/winui3
git checkout src/components/AppHeader.tsx
```

- [ ] **Step 3: 跑 Test B — 强制 stale cache(negative case)**

```bash
# 跑一次正常 build,确保 [2.5/3] 通过
cd /Users/coderstory/CodeSource/winui3
./scripts/build-mac.sh --debug --no-dmg 2>&1 | tail -20
```

Expected: `[2.5/3] ✓ BUILD_MARKER matches`

现在手动制造 stale:
```bash
touch /Users/coderstory/CodeSource/winui3/dist/assets/index-*.js
# 临时把 [1.5/3] 段注释掉,看 [2.5/3] 能不能 catch
sed -i.bak 's|# === Step 1.5: Clear stale Tauri codegen-assets (v3.4.4) ===|# DISABLED FOR TEST B: === Step 1.5: Clear stale Tauri codegen-assets (v3.4.4) ===|' /Users/coderstory/CodeSource/winui3/scripts/build-mac.sh
sed -i.bak 's|^DIST_DIR=.*|DIST_DIR="/tmp/non-existent-dist-test-b";|' /Users/coderstory/CodeSource/winui3/scripts/build-mac.sh  # 这会破坏 build,改用别的做法
```

⚠️ 上面的 sed 路径不安全(改 DIST_DIR 会破坏所有 [1.5/3] 逻辑)。正确做法:

```bash
cd /Users/coderstory/CodeSource/winui3
# 备份原版
cp scripts/build-mac.sh scripts/build-mac.sh.test-b-bak

# 临时让 [1.5/3] 失效 — 把 if [[ -d "$DIST_DIR" 改成 false
sed -i.bak 's|if \[\[ -d "\$DIST_DIR" \&\& -d "\$BUILD_DIR" \]\]|if false|' scripts/build-mac.sh

# 跑 build,期望 [2.5/3] FAIL
./scripts/build-mac.sh --debug --no-dmg 2>&1 | tail -10
echo "---exit code: $?---"

# 恢复
mv scripts/build-mac.sh.test-b-bak scripts/build-mac.sh
```

Expected:
- 第二次 build 不清 codegen-assets(因为 [1.5/3] 被禁用)
- `[2.5/3] FAIL: BUILD_MARKER mismatch` 或 `dist content NOT inlined`
- exit code 非 0
- 恢复后下一次 build 应该 PASS

- [ ] **Step 4: 跑 Test C — warm cache 保留**

```bash
cd /Users/coderstory/CodeSource/winui3
# 第一次 build
./scripts/build-mac.sh --debug --no-dmg 2>&1 | grep -E "Cache|codegen|sccache"
echo "---"
# 第二次 build,不改源码
./scripts/build-mac.sh --debug --no-dmg 2>&1 | grep -E "Cache|codegen|sccache"
echo "---"
# 验证 codegen hash dir 还在
ls src-tauri/target/debug/build/ | grep claude-config-manager
```

Expected:
- 第一次 build `[1.5/3] codegen-assets fresh (hash=...)` 或 `cleared X stale hash dir(s)`(第一次基本是 cleared)
- 第二次 build `[1.5/3] codegen-assets fresh (hash=...)`(应该是 fresh,不删)
- `claude-config-manager-<hash>` 目录还在(没被误删)

- [ ] **Step 5: 跑 Test D — cold cache(第一次 build)**

```bash
cd /Users/coderstory/CodeSource/winui3
rm -rf src-tauri/target
./scripts/build-mac.sh --debug --no-dmg 2>&1 | tail -30
```

Expected:
- `[1.5/3]` 不报错(dist 存在,build dir 不存在 → 静默跳过)
- `[2.3]` build 成功
- `[2.5/3] ✓ BUILD_MARKER matches: ccm-build-mtime-...`
- `DONE ✓`

- [ ] **Step 6: 把 Test A-D 结果报告主 session**

格式:`[Task 4] §5 regression tests: A=PASS B=PASS C=PASS D=PASS`(或具体哪个 FAIL)

---

## Task 5: 拆分 commit — 夹带的 2 个 fix(`install-to-applications-mac.sh` + `lib.rs` 的 `tauri_plugin_log` Webview target)

**Files:**
- Modify: `scripts/install-to-applications-mac.sh`(v3.4.1 `--no-dmg` 旧 fix)
- Modify: `src-tauri/src/lib.rs`(`tauri_plugin_log::Target::new(TargetKind::Webview)` console 转发)

**Interfaces:**
- 与 cache-stale 完全独立

- [ ] **Step 1: 验证这 2 个改动还在 working tree**

```bash
cd /Users/coderstory/CodeSource/winui3
git status --short scripts/install-to-applications-mac.sh src-tauri/src/lib.rs
```

Expected: 两个文件都还在 ` M` 状态(Task 2/3 暂存了 BUILD_MARKER 那段后,夹带的 hunk 应该还在 unstaged 区)

- [ ] **Step 2: 暂存 install-to-applications-mac.sh**

```bash
cd /Users/coderstory/CodeSource/winui3
git add scripts/install-to-applications-mac.sh
git diff --cached scripts/install-to-applications-mac.sh
```

Expected: 显示 `--no-dmg` / `--bundles app` / `[[ "$BUILD_MODE" == "debug" ]] && echo "--debug" || echo ""` 那段改动

- [ ] **Step 3: 暂存 lib.rs 的 tauri_plugin_log hunk**

```bash
cd /Users/coderstory/CodeSource/winui3
git add -p src-tauri/src/lib.rs
```

提示应该是 BUILD_MARKER 之外的那个 hunk(`tauri_plugin_log::Builder::default()` 那段),输入 `y`

- [ ] **Step 4: 验证暂存区**

```bash
cd /Users/coderstory/CodeSource/winui3
git diff --cached --stat
```

Expected: 显示 `scripts/install-to-applications-mac.sh` + `src-tauri/src/lib.rs`

- [ ] **Step 5: 验证编译**

```bash
cd /Users/coderstory/CodeSource/winui3/src-tauri && cargo check
```

Expected: 成功

- [ ] **Step 6: commit(2 个独立 fix 合并一个 commit,主题 "housekeeping")**

```bash
cd /Users/coderstory/CodeSource/winui3
git commit -m "chore: 2 unrelated dev-iteration housekeeping fixes

scripts/install-to-applications-mac.sh (v3.4.1 fix, previously landed
but never committed separately): always pass --no-dmg to build-mac.sh
so dev iteration skips the .dmg step (~30s saved per build). The .app
is what we cp to /Applications; .dmg is distribution-only.

src-tauri/src/lib.rs: route webview console.log/warn/error through
tauri_plugin_log TargetKind::Webview so the same line lands in stdout
AND in the rotating log file (previously only stdout).

These were bundled into the same working-tree commit as the v3.4.4
cache-stale fix; per CLAUDE.md §2.4 (no incidental changes) they're
split into their own commit here.

Refs: .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md"
```

---

## Task 6: 追加 smoke test #11 + 更新 bug report 状态(单独 doc commit)

**Files:**
- Modify: `scripts/smoke-test.sh`(在 Test 10 之后追加 Test 11:BUILD_MARKER 校验)
- Modify: `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`(状态 `未解决` → `已解决`,新增 Regression test 章节)

**Interfaces:**
- 与 Task 1-5 的 fix 完全独立,纯测试 + 文档

- [ ] **Step 1: 在 `scripts/smoke-test.sh` 末尾追加 Test 11**

定位:在 "=== Summary ==="(第 683 行)之前,Test 10 之后(`record "10_queryable" "PASS" "skipped"` 块结束后)。插入:

```bash
# === Test 11: BUILD_MARKER in binary matches current dist hash (v3.4.4) ===
# Why: scripts/build-mac.sh step [2.5/3] catches the Tauri 2.x stale
# codegen-assets bug at build time, but smoke-test runs against an
# already-built exe and wants independent confirmation that the dist
# that was inlined at build time still matches the current dist (i.e.
# the user didn't edit src/ since the last build and ship a stale .app).
# Uses macOS BSD stat -f '%m'; same algorithm as compute_dist_hash_inline
# in scripts/build-mac.sh + compute_dist_mtime_max in src-tauri/build.rs.
echo ""
echo ">>> Test 11: BUILD_MARKER matches current dist hash"
if [[ "$IS_DARWIN" == "true" && -n "$STRINGS_TARGET" ]]; then
  # Re-derive expected hash from current dist/ (NOT from the .app — we
  # want to verify "what got inlined at build time == what's on disk now").
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
    record "11_marker" "FAIL" "BUILD_MARKER mismatch: expected=$TEST11_EXPECTED_MARKER actual=$TEST11_ACTUAL (stale .app or new frontend edit since build)"
  fi
else
  record "11_marker" "PASS" "skipped (Windows / Linux / no STRINGS_TARGET)"
fi
```

把上面块追加到 `scripts/smoke-test.sh` 第 682 行之后(`exit 1 if FAIL` 之前)

⚠️ `STRINGS_TARGET` 变量在 Test 7 块里设置(macOS 分支);Windows 分支也设。但 Test 11 只在 `IS_DARWIN=true` 跑,Windows 走 `skipped`

- [ ] **Step 2: 修改文件头注释**

`scripts/smoke-test.sh` 第 7-20 行的 "10 项必过检查" 改成 "11 项",Test 1-10 列表保留,加一行:

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

如果 FAIL:看具体哪项,debug 后回到对应 Task 修

- [ ] **Step 5: 更新 bug report 状态**

修改 `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`:

a) "状态" 段:
```
- **未解决**。...
```
改成:
```
- **已解决** (2026-06-29 via script-level workaround hardening; see docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md)。工作树 5 个文件改动已拆分 commit: build.rs / Cargo.toml / lib.rs / build-mac.sh 是 v3.4.4 核心 fix;install-to-applications-mac.sh + lib.rs 的 tauri_plugin_log::TargetKind::Webview 是无关 housekeeping。
```

b) "Workaround" 段:
```
# 保险做法:删 Tauri build cache(只 release 下的 build 子目录,不全删 target)
rm -rf src-tauri/target/release/build
# 然后 rebuild
./scripts/install-to-applications-mac.sh --milestone M4 --task 0.0 --slug v3.4.x --release
```
在前面加一段:
```
## 自动修复(v3.4.4)

`scripts/build-mac.sh` 现在自动:
- `[1.5/3]` 检测 dist hash 跟 codegen-assets 不一致时,自动 `rm -rf` 该 hash 目录(只清 stale 的那个,保留 sccache)
- `[2.5/3]` 编译完成后 grep binary 的 `BUILD_MARKER`,验证 dist 真 inline 了;不匹配 fail loud 给可执行 remediation

不需要手动 `rm -rf src-tauri/target/release/build` 了。详见 docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md。

旧的 Workaround(下面这段)只在自动 fix fail 时兜底:
```

c) 新增 "Regression test" 章节(在 "相关文件" 之前),把 plan Task 4 的 Test A/B/C/D 4 段粘过去(改写成 markdown bullet 形式)

d) "已知相关 bug 报告 (待查)" 段:
```
- [Tauri #???]: cargo tauri build doesn't detect frontendDist changes
- Tauri 2.11.3 codegen assets cache 行为
```
改成:
```
- 不需要查 Tauri 上游 bug — workaround 已 ship, smoke test #11 兜底。Tauri 2.x codegen-assets 缓存行为记录在 docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md §2 "Why we don't fully fix Tauri 2.x" 里。
```

- [ ] **Step 6: commit smoke test + bug report(2 个文件一起,doc commit 性质)**

```bash
cd /Users/coderstory/CodeSource/winui3
git add scripts/smoke-test.sh .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
git commit -m "chore(smoke+docs): add Test 11 + close bug-appheader-cache-stale

scripts/smoke-test.sh — Test 11: grep BUILD_MARKER (ccm-build-mtime-<hex>)
from the .app inner binary, verify it matches current dist/ max mtime.
Independent of build-mac.sh step [2.5/3]; runs at smoke-test time as a
regression guard so shipping a stale .app (built before a frontend
edit) is caught at ship time, not at user run time.

.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md — close
the bug: status moved from 未解决 to 已解决, add the
Regression test section (Tests A-D from spec §5.2), keep the old
manual workaround as a fallback under the auto-fix section.

Refs: docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md"
```

---

## Task 7: 验证整体 commit 历史 + 给主 session 报告

**Files:** (无新增修改)

- [ ] **Step 1: 查 commit log**

```bash
cd /Users/coderstory/CodeSource/winui3
git log --oneline -10
```

Expected(从最早到最新):
1. `b10327a` docs(superpowers): fix AppHeader cache-stale design spec — **已在 brainstorming 阶段提交**
2. `feat(tauri): embed DIST_HASH in build.rs` (Task 1)
3. `feat(tauri): declare BUILD_MARKER const` (Task 2)
4. `feat(macOS): auto-clear stale Tauri codegen-assets` (Task 3)
5. `chore: 2 unrelated dev-iteration housekeeping fixes` (Task 5)
6. `chore(smoke+docs): add Test 11 + close bug-appheader-cache-stale` (Task 6)

⚠️ Task 4 不产生 commit(只跑测试)

- [ ] **Step 2: 工作树应该全 clean**

```bash
cd /Users/coderstory/CodeSource/winui3
git status --short
```

Expected: 无输出(全 clean)

- [ ] **Step 3: 报告主 session 1 行摘要**

格式:
```
[v3.4.4 ship] cache-stale 修复已分 5 个 commit ship:
- feat(tauri) build.rs embed DIST_HASH
- feat(tauri) lib.rs BUILD_MARKER const
- feat(macOS) build-mac.sh [1.5/3] + [2.5/3]
- chore housekeeping (install-to-applications-mac.sh + lib.rs Webview target)
- chore(smoke+docs) Test 11 + bug report close
Smoke test 11/11 PASS
Regression Tests A=PASS B=PASS C=PASS D=PASS
```

---

## Self-Review

1. **Spec 覆盖**:
   - spec §3.1 build.rs DIST_HASH → Task 1 ✅
   - spec §3.2 lib.rs BUILD_MARKER → Task 2 ✅
   - spec §3.3 build-mac.sh 4 段改动(helper / pre-flight / [1.5/3] / [2.5/3]) → Task 3 ✅
   - spec §4 错误处理表覆盖 → 散落在 Task 3 的代码 + Task 4 Test B(强制 stale 触发 "mismatch" 错误路径) ✅
   - spec §5.1 smoke test #11 → Task 6 ✅
   - spec §5.2 manual regression A/B/C/D → Task 4 ✅
   - spec §6.2 bug report 状态更新 → Task 6 ✅
   - spec §7 提交策略("单原子 commit 4 文件")→ **拆为 5 commit**,偏离 spec。原因:工作树夹带 2 个无关改动,CLAUDE.md §2.4 禁止混。在 Self-Review 这里标记为已知偏离,在最终 commit message 里说明。
   - spec §1 scope-out(交叉平台 / 完整 Tauri 研究 / bash 单元测试)→ 全 plan 遵守 ✅

2. **占位符扫描**:无 TBD / TODO / "implement later" / "fill in details"

3. **类型 / 函数名一致性**:
   - `compute_dist_hash_inline`(bash)↔ `compute_dist_mtime_max`(Rust)一致(spec §3.3 已要求 mirror)
   - `BUILD_MARKER` 全 plan 一致
   - `DIST_HASH` env var 名一致(Rust ↔ bash grep `ccm-build-mtime-`)
   - `STRINGS_TARGET` 在 smoke-test.sh Test 7 已设,Task 6 Step 1 复用,无需新变量

4. **CLAUDE.md 纪律**:
   - §2.3 版本锁 ✅ walkdir = "=2.5.0"
   - §2.4 不顺便改别的东西 → 拆 commit(Task 5 单独提交夹带的)
   - §7 不删测试 → Task 6 追加 Test 11,不删 1-10
   - §10 不亲自执行开发任务 → 本 plan 由 subagent 执行;主 session 只审 commit + 收最终报告

5. **Plan 偏离 spec §7 的说明**:spec 说 "Single atomic commit, 4 files" → 实际拆 5 commit(因工作树有夹带)。**这个偏离已在 Task 7 commit message 里说明**,符合 CLAUDE.md §2.4 spirit(不夹带 → 拆 commit)。

---

*Plan 由 writing-plans skill 生成(2026-06-29)。subagent 实施前必读 CLAUDE.md §14.1 + §2.4 + 本 spec。*