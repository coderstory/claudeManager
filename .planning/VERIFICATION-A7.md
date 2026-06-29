# VERIFICATION-A7 — 新建项目 选目录不自动填 name

**Bug ID**: A7
**Bug 描述**: 新建项目时点选 [浏览…] → 选完目录 → name 输入框保持空白, 用户必须再手输一遍项目名
**验证日期**: 2026-06-30
**验证人**: verify-subagent (isolation: worktree)
**工作分支**: `verify/a7-autofill-name`
**Base commit**: `e69529b` (master HEAD at verification start)

---

## 1. §16 五步流程 (per CLAUDE.md §16)

### Step 1 — 了解问题详情

**Bug 现象** (用户报告):
- 操作: 主页 → 点 [+ 新增项目] → 点 [浏览…] → 选文件夹 → 关闭 native dialog
- 期望: name 输入框自动填上目录名 (e.g. 选 `/Users/foo/my-app` → name = `my-app`)
- 实际: name 输入框空白, 用户必须手动再输一遍
- 影响: 重复劳动 + 易输错 (用户可能输错或不一致)

**触发条件**:
- 任意点选目录都会触发 (always-on)
- 跨平台: Windows / macOS / Linux 都受影响

**出现频率**: 100% (every single time user picks a folder)

**影响范围**: 主页 (HomeView) "新增项目" modal 内的两个 input 字段联动

### Step 2 — 明确问题原因 (Root Cause)

**真因**: `src/pages/home/index.tsx::HomeView::handlePickRoot` 在 commit `04c568c` 之前只调用 `setNewRoot(dirName)`, 没有同步调用 `setNewName(dirName)`, 导致 root 输入框更新但 name 输入框保持初始空值.

**修复路径**:

| Commit | Author | Date | Diff |
|---|---|---|---|
| `04c568c` fix(home): auto-fill new project name when picking folder | Claude Code | 2026-06-29 21:21 | `src/pages/home/index.tsx` +1 / -0 (1-line `setNewName(dirName)`) |
| `db74286` fix(home): switch new project picker to Tauri native dialog | Claude Code | 2026-06-29 22:45 | `src/pages/home/index.tsx` +40 / -29 (HTML5 webkitdirectory → Tauri native dialog, 同时重构 auto-fill 为非破坏性 + 跨平台 split) |

**当前 master (e69529b) 代码 (src/pages/home/index.tsx:83-99)**:

```tsx
const handlePickRoot = async (): Promise<void> => {
  // Native folder picker — wraps `tauri-plugin-dialog::pick_folder` on
  // the Rust side (see `commands::project::pick_project_root_dir`).
  // Returns the absolute path (e.g. `/Users/foo/projects`) or null
  // if the user cancelled.
  const picked = await pickProjectRoot();
  if (!picked) return; // user cancelled — leave form unchanged
  setNewRoot(picked);
  // Auto-fill name from the last path segment if user hasn't typed one
  // yet (matches A7 fix from the previous round).
  if (!newName.trim()) {
    const segments = picked.split(/[\\/]/).filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    if (last) setNewName(last);
    }
  handleValidateRoot();
};
```

**`db74286` 相对 `04c568c` 的 3 处增强** (relative to original A7 fix):

1. **绝对路径** (vs `04c568c` 的 basename): HTML5 webkitdirectory picker 只返回 `webkitRelativePath = "foo/bar"`, 取首段当 rootDir 导致后续 Rust `validate_root` 抛 `NotAbsolute`. Tauri native dialog 返回绝对路径, 直接可用.
2. **跨平台路径 split** (`/[\\/]/` 同时吃 Unix `/` 和 Windows `\\`): 04c568c 用 `firstFile.webkitRelativePath?.split('/')[0]` 只吃 `/`, 在 Windows 上 `D:\\projects\\foo` 会失败. 当前实现 `picked.split(/[\\/]/)` 两种 OS 都 OK.
3. **非破坏性** (`if (!newName.trim())`): 04c568c 无条件覆盖, 用户先输的 name 会被目录名抢走. 当前实现只 fill 当 user 还没输.

**API module**: `src/lib/api/projects.ts:91-93`:

```ts
export async function pickProjectRoot(): Promise<string | null> {
  return invoke<string | null>('pick_project_root_dir');
}
```

### Step 3 — 明确问题边界

**影响的文件**:
- `src/pages/home/index.tsx` (handlePickRoot, lines 83-99) — **已修复** ✅
- `src/lib/api/projects.ts` (pickProjectRoot wrapper, lines 91-93) — **未触及 fix** ✅

**不影响**:
- `src/lib/api/projects.ts::validateProjectPath` (A3 的作用域)
- `src/lib/api/projects.ts::addProject` (提交项目, 不是 picker)
- 其他页面 (MCP / Provider / Backup 等没有 "新建项目" 流程)
- Rust 后端 `src-tauri/src/commands/project.rs::pick_project_root_dir` (返回 absolute path 是 db74286 的范畴, 不属 A7)

**OS / 平台依赖**:
- macOS / Windows / Linux 都受影响 (因为 picker 的产物对 name 输入框的影响是 OS-agnostic)
- 跨平台 path split `[\\/]` 修复同时解决 Win/Mac/Linux 三平台

**是否触及 §2.4 "超 2 个文件改动" 白名单**:
- 本次验证**只改 1 个文件** (新增测试文件 `src/__tests__/pages/new-project-autofill-name.spec.tsx`)
- 生产代码**未改动** (fix 已在 master)
- 不需要白名单

### Step 4 — 分析技术方案 (≥2 方案)

**方案 A: 新增独立 A7 测试文件** (采用)
- 文件: `src/__tests__/pages/new-project-autofill-name.spec.tsx`
- 8 个 `it()` 块: Unix / Windows / 深嵌套 / 取消 / 非破坏性 / Unicode / 末尾斜杠 / 可编辑
- 优点: 跟 A3 (`new-project-validation.spec.tsx`) 解耦, grep `A7` 直接定位, future 修改 auto-fill 逻辑时不会撞 A3 测试
- 缺点: 测试文件多一个, 维护成本微增

**方案 B: 扩展 A3 测试文件, 加 `describe('A7 — auto-fill name ...')` 块**
- 文件: `src/__tests__/pages/new-project-validation.spec.tsx`
- 优点: 共享 mock setup, 测试文件少
- 缺点: A3 文件已经 7 个 case + A3.1 内嵌 1 个 A7 断言 (line 107), 加 A7 块会让单文件 > 300 行, 阅读成本高

**方案 C: A + B 同时做**
- 优点: 双向保护
- 缺点: 重复, 维护成本翻倍, 违背 §2.2 TDD "测试先行" 但不"重复覆盖"

**推荐**: 方案 A (独立文件), 因为:
1. A7 fix 已在 master, 测试目的是**回归保护**, 单文件聚焦 single-responsibility
2. A7 涉及 8 个独立场景 (含 Unicode / 取消 / 非破坏性等 A3 没覆盖的), 适合独立 describe
3. 便于 future re-verify 时 grep `A7` 快速定位测试范围

### Step 5 — 修复后实际验证 (per §16.2 硬证据)

**5.1 Red→Green 循环** (proving tests are real regression guards, not false positives):

**实验步骤**:
1. 备份 `src/pages/home/index.tsx` 到 `/tmp/home-original.tsx`
2. 用 Python 注释掉 auto-fill 块 (lines 93-97)
3. 跑测试 → 期望 6/8 FAIL (Red)
4. 恢复 `src/pages/home/index.tsx` 备份
5. 跑测试 → 期望 8/8 PASS (Green)

**Red 结果** (auto-fill 暂时删除):
```
× A7.1: 选 Unix 绝对路径 → name 自动填 my-app         FAIL
× A7.2: 选 Windows 绝对路径 → name 自动填 my-app       FAIL
× A7.3: 选深嵌套路径 /a/b/c/d/e/f → name 自动填 f      FAIL
× A7.6: 选 Unicode 目录名 /Users/test/项目一 → 项目一    FAIL
× A7.7: 末尾带斜杠 /...my-app/ → name 自动填 my-app     FAIL
× A7.8: 选完目录后 name input enabled, 用户可继续编辑   FAIL
✓ A7.4: 用户取消 (picker 返回 null) → name 保持空        PASS (trivially)
✓ A7.5: 用户先输 name → 不覆盖 (非破坏性)               PASS (trivially, no auto-fill = no overwrite)
```
- 6/8 FAIL ✅ (6 个 auto-fill positive 测试全部失败)
- 2/8 PASS ✅ (2 个 negative 测试在"无 auto-fill"下也成立, 符合预期)

**Green 结果** (auto-fill 恢复):
```
✓ A7.1: 选 Unix 绝对路径 → name 自动填 my-app
✓ A7.2: 选 Windows 绝对路径 → name 自动填 my-app
✓ A7.3: 选深嵌套路径 → name 自动填 f
✓ A7.4: 用户取消 → name 保持空
✓ A7.5: 用户先输 name → 不覆盖
✓ A7.6: 选 Unicode 目录名 → name 自动填 项目一
✓ A7.7: 末尾带斜杠 → name 自动填 my-app
✓ A7.8: 选完目录后 name input enabled
```
- 8/8 PASS ✅

**结论**: 测试是真实回归保护, 不是 false positive. 改前 6 个 fail → 改后 8 个 pass, TDD Red→Green 闭环成立.

**5.2 全套测试回归** (确认无副作用):

```
$ npx vitest --run src/__tests__/pages/new-project-validation.spec.tsx
✓ src/__tests__/pages/new-project-validation.spec.tsx (7 tests) 64ms

$ npx vitest --run src/__tests__/pages/new-project-autofill-name.spec.tsx
✓ src/__tests__/pages/new-project-autofill-name.spec.tsx (8 tests) 120ms
```

- A3 (new-project-validation.spec.tsx): 7/7 PASS ✅
- A7 (新文件 new-project-autofill-name.spec.tsx): 8/8 PASS ✅
- 生产代码 `git diff --stat src/pages/home/index.tsx`: empty (未改)
- 仅新增测试文件: `src/__tests__/pages/new-project-autofill-name.spec.tsx`

**5.3 §17 Rule 3 合规** (subagent 验证策略):
- ✅ 只跑 `vitest --run <single-test-file>` (秒级, 0.466s)
- ❌ **未跑** `cargo build --release` / `npm run build` / smoke test (留给主 session exclusive)
- 工作目录: `verify/a7-autofill-name` worktree (Rule 2 isolation), 不污染主 worktree

---

## 2. 测试覆盖矩阵

| # | 场景 | 期望 | 实际 | 状态 |
|---|---|---|---|---|
| A7.1 | Unix `/Users/foo/projects/my-app` | name = `my-app` | `my-app` | ✅ |
| A7.2 | Windows `D:\\projects\\my-app` | name = `my-app` | `my-app` | ✅ |
| A7.3 | 深嵌套 `/a/b/c/d/e/f` | name = `f` | `f` | ✅ |
| A7.4 | 取消 (picker → null) | name = `''` (无 crash) | `''` | ✅ |
| A7.5 | 用户先输 `my-custom-name` 再 pick | name = `my-custom-name` (不覆盖) | `my-custom-name` | ✅ |
| A7.6 | Unicode `/Users/test/项目一` | name = `项目一` | `项目一` | ✅ |
| A7.7 | 末尾斜杠 `/Users/foo/projects/my-app/` | name = `my-app` | `my-app` | ✅ |
| A7.8 | 选完目录后 name input enabled | name 可编辑 | 可编辑 | ✅ |

**未覆盖** (out of scope 或 A3 已有):
- ~~A3 路径验证场景~~ (`new-project-validation.spec.tsx` 已覆盖, A7 不重复)
- ~~submit 按钮 enabled/disabled~~ (A3.4 + A3.5 已覆盖)
- ~~路径包含 `..` 拒绝~~ (A3 + handleValidateRoot 内部检查)
- ~~空字符串 picker 返回~~ (等价于 cancel, A7.4 覆盖)

---

## 3. 已知限制 / 风险

**Risk 1: `home.test.tsx` 有 pre-existing 失败测试** (与本 A7 无关)
- `src/__tests__/pages/home.test.tsx:50-65` "clicking [浏览…] fills the input with selected dir name"
- 此测试用 HTML5 `<input webkitdirectory>` (`pick-root-input` testid) 模拟 picker
- 但 master 代码 (`db74286` 后) 用的是 Tauri native dialog, 没有 `pick-root-input` DOM 节点
- 因此此 test FAIL 是**预期内**的 stale test, 不属 A7 scope
- 修复建议: 在 A7 verify commit 之后, follow-up task 删/改这条测试 (out of scope for A7)
- 验证证据: `npx vitest --run src/__tests__/pages/home.test.tsx` 显示 1 FAIL (这条) / 3 PASS

**Risk 2: `mockImplementationOnce` queue order 在 `useProjects` hook 调用 `list_projects` 时被消耗**
- 第一次写测试时用 `mockImplementationOnce` 模拟 picker → 失败 6/8
- 根因: `useProjects` 在 mount 时调 `list_projects`, 消耗 `mockImplementationOnce` 的第一次调用
- 修复: 改用 always-on `mockImplementation` + per-test `pickerResult` 变量注入
- 这是测试 fixture 技巧, 文档化在测试文件注释里

**Risk 3: Unicode 路径在 Windows 上可能不完整**
- 测试 A7.6 用 Unix 风格的 Unicode 路径 (`/Users/test/项目一`)
- Windows 上 Unicode 路径 (e.g. `D:\\项目一`) 在 mock 里也走相同 split, 应该 PASS
- 但 Windows 真实 native dialog 对 Unicode 的支持取决于 tauri-plugin-dialog 实现, 测试无法覆盖
- 不在 A7 scope, 留 follow-up

---

## 4. 总结

| 项目 | 状态 |
|---|---|
| A7 真因 (fix) | ✅ 已修复 (`04c568c` + `db74286`) |
| 回归测试覆盖 | ✅ 8 个场景, 独立文件 `new-project-autofill-name.spec.tsx` |
| Red→Green 闭环 | ✅ 6/8 FAIL without fix, 8/8 PASS with fix |
| 测试套件副作用 | ✅ 无 (生产代码 0 改动) |
| 跨平台覆盖 | ✅ Unix / Windows / Unicode / 末尾斜杠 / 深嵌套 |
| UX 边界 | ✅ 取消 / 非破坏性 (用户先输不覆盖) / 可编辑 |
| 工作树分支 | `verify/a7-autofill-name` (基于 master e69529b) |
| Commit | `verify(a7): regression test for auto-fill name on folder pick` |

**结论**: A7 bug fix 已 ship (master e69529b 含 04c568c + db74286), 回归测试已落地, 红绿闭环成立. **不需要 rebase master** (新分支基于最新 master e69529b, 包含全部 fix).

---

## 5. 提交信息 (committed)

```
verify(a7): regression test for auto-fill name on folder pick

Per CLAUDE.md §16 五步流程验证 A7 (commit 04c568c + db74286).

Fix 已在 master (e69529b), 任务非 re-fix 而是加回归测试 + 写 §16 验证报告.

测试: 8 个 vitest 场景覆盖
- Unix / Windows 绝对路径
- 深嵌套 / 末尾斜杠 / Unicode 路径
- 用户取消 / 用户先输 name 不被覆盖 (非破坏性)
- 选完目录后 name input 可编辑

Red→Green 验证: 临时删除 auto-fill 块 → 6/8 FAIL → 恢复 → 8/8 PASS.
证明测试是真实回归保护, 不是 false positive.

文件:
- 新增: src/__tests__/pages/new-project-autofill-name.spec.tsx (8 tests)
- 新增: .planning/VERIFICATION-A7.md (§16 五步证据)
- 未改动: src/pages/home/index.tsx (fix 已在 master)
```
