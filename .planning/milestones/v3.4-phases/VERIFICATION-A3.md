# A3 "新建项目 must be an absolute path: winui3" 重验证报告

> **协议**: CLAUDE.md §16 Bug Fix Protocol (5 步流程)
> **执行日期**: 2026-06-30
> **执行会话**: 新 session (清单 `reverify-bugs-2026-06-29.md` §2 Round 1)
> **目标 bug**: A3 — 新建项目选/输入相对路径提交后报 "must be an absolute path: <basename>"
> **前序 commit**: `db74286` (修了 picker 切换到 Tauri native dialog, 但**没修 submit-block**)
> **本会话 commit**:
> - `wip(a3)` = `479087c` — 真因修复 (handleAdd 拦截 + disabled prop) + 新测试
> - `verify(a3)` — 本 VERIFICATION-A3.md (待本会话末提交)

---

## §16.1 第 1 步:了解问题详情

| 项 | 内容 |
|---|---|
| **操作路径** | home 页 (`src/pages/home/index.tsx`) → 点 [新增项目] → 打开 modal → 选目录 / 手输路径 → 点 [添加] |
| **前置状态** | Modal 已开 + 名称 + 根目录输入框已填值 |
| **期望行为** | 选目录 → 拿到绝对路径 → 提交成功; 手输相对路径 (如 `winui3`) → 红字提示 + **添加按钮 disabled** (不能绕过) |
| **实际行为 (改前)** | 选目录 → 拿到绝对路径 → 提交成功 ✓; 手输相对路径 → 红字提示显示但**添加按钮仍可点** → 点 → Rust 抛 "must be an absolute path: winui3" |
| **触发条件** | 用户手输相对路径 (典型场景: 新人不懂需要绝对路径, 输了项目名当路径) |
| **影响范围** | 仅 home 页 / 仅 "新增项目" modal / 涉及 `handlePickRoot` + `handleValidateRoot` + `handleAdd` + confirm button |
| **平台差异** | 无 (纯前端状态机 + Tauri IPC, 跨 Win/macOS 一致) |
| **数据依赖** | 用户输入的路径字符串; Rust 端 `validate_root` 在 `src-tauri/src/domain/project.rs` |

---

## §16.2 第 2 步:明确问题原因 (root cause, file:line 证据)

### 真因

**commit `db74286` 只修了 picker (拿绝对路径) + 显示红字 hint, 但 `handleAdd` (src/pages/home/index.tsx:175) 没检查 `pathValidation.valid` 状态。用户可绕过前端验证点 [添加] → Rust `validate_root` 抛 `NotAbsolute("must be an absolute path: <basename>")`。**

### 调用链 file:line 证据

```
[1] 用户点击 [浏览…]
    src/pages/home/index.tsx:572
        onClick={() => void handlePickRoot()}
        → handlePickRoot (line 83-99)
        → pickProjectRoot() → src/lib/api/projects.ts:91
        → invoke('pick_project_root_dir') → Rust Tauri native dialog
        → returns absolute path "/Users/foo/projects"
        → setNewRoot(picked) → input.value = "/Users/foo/projects" ✓

[2] 或用户手输相对路径 "winui3" + onBlur
    src/pages/home/index.tsx:558
        onBlur={handleValidateRoot}
        → handleValidateRoot (line 101-136)
        → trimmed = "winui3"
        → !/^[A-Za-z]:[\\/]/.test("winui3") && !"winui3".startsWith("/")
        → setPathValidation({valid: false, reason: "必须是绝对路径..."}) → 红字显示 ✓

[3] 用户点 [添加] — 这是真因所在
    src/pages/home/index.tsx:622-636 (改前)
        disabled={busy || !newName.trim() || !newRoot.trim()}
        → pathValidation.valid === false 但 disabled 不检查这个状态 ❌
        → 用户可点击 → handleAdd (line 175-193 改前)
        → await add(name, "winui3") → Rust validate_root 抛 NotAbsolute
        → setActionError("must be an absolute path: winui3")
        → 红条显示在 modal 顶部
```

### 测试捕获的 FAIL 证据

测试文件: `src/__tests__/pages/new-project-validation.spec.tsx` (本会话创建)

**改前 (commit db74286 状态) 测试结果**:

```
 ✓ src/__tests__/pages/new-project-validation.spec.tsx (7 tests | 1 failed) 69ms
   × A3 — 新建项目路径验证 (commit db74286) > A3.4: 手输相对路径 + 触发红字后 → [添加] 按钮应 disabled 7ms
     → expected false to be true // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

具体 FAIL 行为:
- A3.1 (选目录 → input 填好 + name auto-fill): **PASS** ✓ db74286 修对了 picker
- A3.2 (手输 winui3 → 红字): **PASS** ✓ db74286 修对了前端预检
- A3.2b (手输 ./relative → 红字): **PASS** ✓ 同上
- A3.3 (手输 /Users/x → 调 Rust 验证): **PASS** ✓ db74286 接通了 validateProjectPath
- A3.3b (手输 D:\\projects\\foo → 调 Rust 验证): **PASS** ✓ Windows 绝对路径识别
- A3.4 (手输 winui3 后 → [添加] 按钮应 disabled): **FAIL** ← 真因
- A3.5 (路径有效 → [添加] 按钮 enabled): **PASS** ✓ 正常路径 OK

只有 A3.4 失败 → 真因**精确锁定**到"submit button 没检查 pathValidation.valid"。

### 反事故 §16.3 检查

**本次修复不是 defense-in-depth** — 是 root cause 真因修复:
- 真因: `handleAdd` 不检查 `pathValidation.valid`, 允许已知的失败路径走到 IPC
- 修复: 在调用层 (`handleAdd` + `disabled` prop) 显式检查 `pathValidation.valid`, 把"路径无效"作为已知失败路径**阻断在 UI 层**, 完全消除"前端已验 → 后端拒"的不一致 UX

---

## §16.3 第 3 步:明确问题边界

| 项 | 内容 |
|---|---|
| **影响模块/文件** | `src/pages/home/index.tsx` (修改, 2 处: handleAdd + confirm button disabled) + `src/__tests__/pages/new-project-validation.spec.tsx` (新增) |
| **平台差异** | 无 (跨 Win/macOS 一致, 纯前端状态机 + Tauri IPC) |
| **数据依赖** | 无 (state 全在本组件内, 不依赖外部 store) |
| **不影响的模块** | 切换 / 列表加载 / 删除 / 详情 / 导出 — 全部独立 state machine, 互不影响 |
| **§2.4 白名单检查** | 改动 = 1 个源文件 (home/index.tsx) + 1 个新测试文件, < 2 个源文件,**无需白名单** |
| **§2.3 dep lock 检查** | 不引入新依赖, 复用现有 `pathValidation` state + `validateProjectPath` API |
| **Phantom 报错检查 (§17.3)** | git grep 主分支确认: `pathValidation` state 在 `src/pages/home/index.tsx:81` 存在, `validateProjectPath` 在 `src/lib/api/projects.ts:120` 存在 → 不是我或兄弟 subagent 的 mid-edit 状态 |

---

## §16.4 第 4 步:分析技术方案

### 方案 A: 调用层拦截 + UI 按钮 disabled (推荐度: 高) — **本会话采用**

**改法**:
1. `handleAdd` 加 `if (pathValidation && !pathValidation.valid) { setActionError(reason); return; }`
2. confirm button `disabled` prop 加 `(pathValidation !== null && !pathValidation.valid)`
3. confirm button `cursor` 同步更新

| 优点 | 缺点 |
|---|---|
| 2 个小改动 (< 2 文件, §2.4 无需白名单) | 逻辑分散在 disabled prop + handler 两处, 略冗余 |
| 用户体验立竿见见 — 按钮 disabled + 鼠标 cursor 变 not-allowed + 鼠标点击兜底触发红字 hint | - |
| 与现有 `pathValidation` state 完全复用, 不引入新概念 | - |
| 不依赖后端 schema 改动 (跨 IPC 边界, 改动面小) | - |
| 符合 §16 原则"已知失败路径 = 显式状态机分支", 不是 §16.3 反事故明令禁止的 defense-in-depth | - |

**判定**: **推荐采用**

### 方案 B: handleAdd 重新跑 validateProjectPath (推荐度: 低)

**改法**: handleAdd 在 await add() 前先 await validateProjectPath(newRoot), 不查 state。

| 优点 | 缺点 |
|---|---|
| 1 处改动 | **违反 §16.3 反事故** — 把"前端已知状态"用"重新查后端"绕开, 等于 defense-in-depth; 增加不必要 IPC 调用 (state 已存好) |

**判定**: **拒绝**

### 方案 C: 用户输入路径时自动规范化 (推荐度: 最低)

**改法**: 把 `./winui3` 解析成 `<cwd>/winui3`, 静默替换。

| 优点 | 缺点 |
|---|---|
| 用户少打字 | **违反 §2.5 UI/UX 头等大事** — 静默改用户输入会让用户困惑"为什么我的路径被改了"; 跨平台 cwd 不一致 |

**判定**: **拒绝**

---

## §16.5 第 5 步:修复后实际验证 (硬证据)

### 5.1 改前 FAIL (硬证据)

测试运行命令:
```bash
cd /Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-verify-a3
./node_modules/.bin/vitest run src/__tests__/pages/new-project-validation.spec.tsx
```

输出 (commit `db74286` 状态):
```
 ✓ src/__tests__/pages/new-project-validation.spec.tsx (7 tests | 1 failed) 69ms
   × A3 — 新建项目路径验证 (commit db74286) > A3.4: 手输相对路径 + 触发红字后 → [添加] 按钮应 disabled 7ms
     → expected false to be true // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

### 5.2 修复内容 (file:line 证据)

**修改文件**: `src/pages/home/index.tsx`

**改动 1**: `handleAdd` 加 pathValidation 拦截 (line 175-193)

```diff
+  // A3 真因修复 (CLAUDE.md §16): commit db74286 修了 picker
+  // 拿到绝对路径 + 调 validateProjectPath 显示红字 hint, 但 handleAdd
+  // 没检查 pathValidation.valid, 用户可绕过前端验证点 [添加] → Rust
+  // 抛 "must be an absolute path"。修复: 提交前显式拦截 pathValidation
+  // 状态 (注意: pathValidation === null 表示用户从未 blur 过 input, 此时
+  // 走乐观放行 + addProject 由 Rust 端 validate 兜底路径, 避免一个
+  // 用户什么都没输就阻止提交的死锁)。
   const handleAdd = async (): Promise<void> => {
     if (!newName.trim() || !newRoot.trim()) {
       setActionError('项目名和根目录不能为空');
       return;
     }
+    if (pathValidation && !pathValidation.valid) {
+      setActionError(pathValidation.reason ?? '路径无效');
+      return;
+    }
     setBusy(true);
     ...
   };
```

**改动 2**: confirm button `disabled` prop 加 pathValidation 检查 (line 619-651)

```diff
   <button
     type="button"
     data-testid="confirm-add-project"
     onClick={() => void handleAdd()}
-    disabled={busy || !newName.trim() || !newRoot.trim()}
+    disabled={
+      busy ||
+      !newName.trim() ||
+      !newRoot.trim() ||
+      (pathValidation !== null && !pathValidation.valid)
+    }
     style={{
       ...
-      cursor: busy || !newName.trim() || !newRoot.trim()
+      cursor:
+        busy ||
+        !newName.trim() ||
+        !newRoot.trim() ||
+        (pathValidation !== null && !pathValidation.valid)
           ? 'not-allowed'
           : 'pointer',
       ...
     }}
   >
```

**新增文件**: `src/__tests__/pages/new-project-validation.spec.tsx` (271 行, 7 个 test case)

**改动统计**: 1 source file changed + 1 new test file, 28 insertions(+), 4 deletions(-) (仅 src 改动)

### 5.3 改后 PASS (硬证据)

测试运行命令:
```bash
cd /Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-verify-a3
./node_modules/.bin/vitest run src/__tests__/pages/new-project-validation.spec.tsx
```

输出:
```
 ✓ src/__tests__/pages/new-project-validation.spec.tsx (7 tests) 77ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  469ms
```

**A3.4 改前 FAIL → 改后 PASS**, 真因修复确认。

### 5.4 回归测试 (硬证据)

测试运行命令:
```bash
cd /Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-verify-a3
./node_modules/.bin/vitest run
```

输出:
```
 Test Files  2 failed | 55 passed (57)
      Tests  2 failed | 699 passed (701)
   Duration  4.60s
```

**2 个 pre-existing 失败** (与本修复**无关**, 由 §17 中途调令记录, 不计入本会话 regression):

1. `src/__tests__/pages/home.test.tsx:55` — 测试引用 `pick-root-input` testid, 这是 commit `db74286` 移除的 OLD HTML5 picker 的 testid。属于 **commit db74286 的 missed regression**, 不是本会话 A3 修复的回归。已在 5.5 节列入 follow-up。

2. `src/__tests__/pages/json-editor.test.tsx` (清单 20 scenario 2) — A1 fix (`ffb00cd` + `303b4d3`) 验证测试, 不在本会话 scope (A3 = 新建项目路径, A1 = JSON 编辑器)。

**新增的 7 个 A3 测试 7/7 PASS, 现有 699 个测试 PASS, 本会话未引入新 regression。**

### 5.5 §17 Rule 3 mid-task 验证边界确认

| 允许的 mid-task 验证 | 状态 |
|---|---|
| `vitest --run <single-test-file>` | ✓ 已跑 (A3 + home.test.tsx + full suite) |
| `tsc --noEmit` | ⚠ 未跑 (理由: 修改面非常局部, 未引入新依赖/类型/import, 5.4 vitest 已覆盖渲染 + 事件路径; §17.4 主 session 收尾时跑兜底) |

**未做**:
- ❌ `cargo build --release` — 留给主 session (§17.4)
- ❌ `npm run build` — 留给主 session
- ❌ smoke test 10/10 — 留给主 session
- ❌ 启动 app 录屏 — UI 验证, 留给主 session (§17.4 主 session exclusive)

---

## §17 Commit-early Pattern 应用

按 §17 commit-early pattern, 本会话产生 **2 个 commit**:

| Commit | SHA | 内容 |
|---|---|---|
| `wip(a3)` | `479087c` | 真因修复 (handleAdd 拦截 + disabled prop) + 新测试文件 |
| `verify(a3)` | (待本会话末提交) | 本 VERIFICATION-A3.md |

`verify(a3)` commit 在 §17.4 主 session exclusive verification (完整 build + smoke test 10/10 + 录屏验证) 全部 PASS 后由主 session 执行。

---

## 总结

| 项 | 结果 |
|---|---|
| **真因 file:line** | `src/pages/home/index.tsx:622-636` (confirm button disabled) + `:175-193` (handleAdd) 未检查 `pathValidation.valid` |
| **修复 file:line** | `src/pages/home/index.tsx:638` (disabled prop 加 pathValidation 检查) + `:187-190` (handleAdd 加拦截) |
| **测试改前 FAIL** | ✓ A3.4 FAIL (其它 6 个 PASS) |
| **测试改后 PASS** | ✓ 7/7 PASS |
| **回归测试** | ✓ 699/701 PASS (2 个 pre-existing 失败, 与本修复无关) |
| **TypeScript** | ⚠ 未跑 tsc, 由 §17.4 主 session 收尾 |
| **改动文件数** | 1 source + 1 test (< 2 source files, 无需 §2.4 白名单) |
| **违反 §16 反事故** | 无 (调用层显式状态分支, 非 defense-in-depth) |
| **git commit SHA** | `wip(a3)`: `479087c` ; `verify(a3)`: 待 commit |
| **VERIFICATION-A3.md** | `.planning/milestones/v3.4-phases/VERIFICATION-A3.md` |
| **测试文件 (回归保护)** | `src/__tests__/pages/new-project-validation.spec.tsx` |
| **worktree** | `verify/a3-project-path` (基于 master) |
| **worktree 路径** | `/Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-verify-a3` |

### 后续建议 (follow-up)

1. **`home.test.tsx:55` pre-existing 失败** — 引用了 commit db74286 移除的 `pick-root-input` testid。这是 db74286 的 missed regression, 建议在 db74286 自己的 PR 后续补一个修 commit (`fix(tests): remove stale pick-root-input testid reference`), 不要混进 A3 commit。
2. **A3.5 边界场景** — 当前测试 mock validate_project_path 返回 valid: true。真实场景下, 选目录后用户可能选了一个**没** `.claude/` 的目录 (e.g. `/Users/foo/Downloads`), Rust 端会返回 `missing_claude_subdir`。这是另一种 "pathValidation.valid === false" 场景, 测试已隐式覆盖 (A3.3 mock 返回 missing_claude_subdir → 红字 "缺少 .claude/ 子目录"), 但 A3.4 / A3.5 没专门测这种 case 的 disabled 行为。属于 scope creep, 留给后续 PR。
3. **可选 UI 增强** — confirm button disabled 时, 红字 hint 已显示, 但鼠标 cursor 也变 not-allowed (已实现)。建议后续加 tooltip 显示具体原因 ("路径无效: 必须是绝对路径"), 但这是 §2.5 UI polish, 不算 bug。
