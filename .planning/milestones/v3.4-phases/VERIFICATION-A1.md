# A1 重验证 — JSON 编辑器双层包装 (2026-06-30)

> 按 CLAUDE.md §16 五步流程重验证 ffb00cd + 303b4d3 修复的 A1 bug。
> Bug 状态: ✅ **VERIFIED FIXED**,且**测试留 codebase 做回归保护**。

---

## 1. 了解问题详情 (problem details)

- **Bug**: 用户在 JSON 编辑器选任意文件 (尤其不存在的) 都看到
  `"读取失败 : 读取失败 : No such file or directory (os error 2)"`
  双层包装。InfoBar 显得啰嗦且不专业。
- **操作路径**: 应用启动 → 侧栏 "JSON 编辑器" tile → 点"选择文件"按钮
  → 选一个不存在的 `.json` (或任意文件)
- **期望行为**: InfoBar 显示一份简洁的 category 文案,例如
  `"文件不存在 · <path>: No such file or directory (os error 2)"` 或
  至少没有双层 `"读取失败"` 前缀
- **实际行为 (改前)**: `"读取失败: 文件不存在 <path>: <io error>"` —
  即使是 single-wrap,前端的 "读取失败:" 与后端 class 字 (实际为
  `"文件不存在"`) 不一致地混在一起
- **触发条件 / 频率**: 100% 复现,任何 read_file 错误路径 (文件不存在 /
  无权限 / 编码错误 / I/O 失败)
- **影响范围**: F5 JSON 编辑器两个加载入口 (handleFileChosen line 226,
  loadFileByPath line 258)

---

## 2. 明确问题原因 (root cause, file:line 证据)

### 2.1 修前真因 (ffb00cd + 303b4d3 已修)

**Root cause (历史)**: 前端在 catch 块对 Rust 错误又包了一层 "读取失败: "。

```ts
// src/pages/json-editor/index.tsx:226 (修前)
message: { kind: 'error', text: `读取失败: ${mapBackendError(raw)}` },
// src/pages/json-editor/index.tsx:258 (修前) — 完全相同的 bug 模式
message: { kind: 'error', text: `读取失败: ${mapBackendError(raw)}` },
```

后端 `classify_io_error` (fs.rs:231) 已经返回 `"<category> <path>: <io error>"`
形式 (category ∈ {"文件不存在", "无权限", "编码错误", "I/O 失败"})。
前端再 pre-pend "读取失败: " 是冗余信息,而且与后端 category 重复。

如果后端某些路径 (fs.rs:298/306/308 `read_sql_file`) 已经 emit
"读取失败 <path>: ...",前端又叠一次 → 双层包装。

### 2.2 关联 commit

- `ffb00cd` (line 226, 2026-06-29) — 删 handleFileChosen 的前端包装
- `303b4d3` (line 258, 2026-06-29) — 删 loadFileByPath 的前端包装 (followup)

### 2.3 ⚠️ 修后残留 bug (本轮发现,未在 commit message 中提及)

**真因**: `mapBackendError` 函数 (src/pages/json-editor/index.tsx:913-921)
的正则用 `\b` (word boundary),但 JavaScript 的 `\b` **不识别 CJK 字符**
(\w 仅匹配 `[A-Za-z0-9_]`,不含中文)。所以 CJK category + space 分隔的
Rust 错误 (例如 `"文件不存在 /path: ..."`) 永远**不匹配** regex,直接走
`if (!m) return raw;` 分支返回原始字符串,导致**reformatting 失效**。

```ts
function mapBackendError(raw: string): string {
  const m = raw.match(/^(文件不存在|无权限|编码错误|I\/O 失败)\b\s*(.*)$/);
  if (!m) {
    // Scope / validation errors are already user-readable.
    return raw;        // <— 100% 命中,从未进入 reformatting
  }
  ...
}
```

**实际效果**: 用户看到的最终 InfoBar 文本 = `Rust raw` (无 `·` reformatting,
无双层包装因为 ffb00cd 删了前端 prefix)。

**症状 vs 原因**:
- 症状 = 双层 "读取失败" 前缀 (ffb00cd/303b4d3 已修)
- 原因 = `\b` 在 CJK→ASCII 边界不匹配 (本轮发现的更深层 issue)

**影响**: 用户**看到的是 raw Rust 错误**(不是 reformat 后的 "文件不存在 · ..."),
InfoBar 信息密度 OK 但**未达原设计意图** (清单 20 acceptance)。

**修复建议 (out of A1 scope, 留 STATE.md)**:
- 方案 A: 改 regex 为 `/^(文件不存在|无权限|编码错误|I\/O 失败)\s*(.*)$/`
  (去掉 `\b`,依赖 `\s*` 自然分隔)
- 方案 B: 抽工具函数 `formatBackendErrorCategory(raw)`,用 startsWith 判断
  而非 regex

---

## 3. 边界 (scope)

- **影响文件**:
  - 改前/改后均涉及:`src/pages/json-editor/index.tsx` (line 226, 258, 913)
  - 测试:`src/__tests__/pages/json-editor-error.spec.tsx` (新增 6 个 test)
  - 测试:`src/__tests__/pages/json-editor.test.tsx` (line 332-353 stale
    assertion 修正)
- **平台差异**: 无 (frontend only)
- **数据依赖**: 无
- **§2.4 白名单**: 触及 3 个文件,但**都集中在 json-editor 单元** —
  - 1 个新测试文件 (`json-editor-error.spec.tsx`) — 显然在 scope 内
  - 1 个测试修正 (`json-editor.test.tsx` line 332-353) — 修 ffb00cd
    残留的 stale test assertion
  - 实际**没有改 src 代码**(fix 已在 master,本轮只 verify)
  - **判定**: 不触发 §2.4 白名单 (新文件 + 测试修正 + 0 src 改动)

---

## 4. 方案 (technical options)

### 4.1 本轮实际方案 (verify,非 fix)

**方案 A (实际)**: 写 vitest 锁住 invariant,不重写 fix
- 优点: 不引入新回归,符合 §16 step 5 "修复后验证" 流程
- 优点: 改前 FAIL → 改后 PASS 完整证据链
- 缺点: 未解决 §2.3 残留 `\b` bug
- 风险: 低 (纯 test,0 src change)

### 4.2 备选方案 (修复 \b bug,如未来需要)

**方案 B (recommended for followup)**: 改 `mapBackendError` regex,去掉 `\b`
```ts
const m = raw.match(/^(文件不存在|无权限|编码错误|I\/O 失败)\s*(.*)$/);
```
- 优点: 最小改动,修根因
- 缺点: 需要 vitest 验证 reformatting 路径 (4 个 scenario 都测)
- 风险: 低 (regex 更宽松不会引入 false positive,因为 \s* 仍是有效分隔)

**方案 C**: 抽工具函数 `formatBackendErrorCategory`,startsWith 判断
- 优点: 不依赖 regex,语义更清晰
- 缺点: 多一个新文件,跨多页面可能要用,scope 扩
- 风险: 中 (需要 grep 所有调用点统一)

**推荐**: 方案 B,但**留 STATE.md,不在本轮做** (本轮任务是 verify,不是 fix 残留)

---

## 5. 验证 (evidence) — §16 step 5 硬证据

### 5.1 改前 FAIL (revert fix, run test)

**操作**: 临时 revert `src/pages/json-editor/index.tsx:226` 为
`` `读取失败: ${mapBackendError(raw)}` `` (line 258 也同时 revert,
模拟 ffb00cd + 303b4d3 之前的 pre-fix 状态)

**结果**:
```
src/__tests__/pages/json-editor-error.spec.tsx (6 tests | 2 failed)
× regression: 即使 raw 错误里已含"读取失败"前缀,前端不再叠加
  expected '读取失败: 读取失败 /home/u/.claude/whatever.j…'
    not to contain '读取失败: 读取失败'
  Received: "读取失败: 读取失败 /home/u/.claude/whatever.json:
    No such file or directory (os error 2)"
× 整个 InfoBar 文本里"读取失败"出现 0 次 (任何出现都是回归)
  expected 1 to be +0
```

**关键证据**: `Received: "读取失败: 读取失败 /home/u/.claude/whatever.json: No such file or directory (os error 2)"`
— 这正是用户**原始报告的"双层包装"** 字面值。

### 5.2 改后 PASS (restore fix, run test)

**操作**: 恢复 ffb00cd + 303b4d3 的 fix (line 226/258 改回 `mapBackendError(raw)`)

**结果**:
```
✓ src/__tests__/pages/json-editor-error.spec.tsx (6 tests) 90ms
✓ src/__tests__/pages/json-editor.test.tsx (23 tests) 470ms
Test Files  2 passed (2)
Tests       29 passed (29)
```

### 5.3 旧测试 stale assertion 修正

**问题**: `json-editor.test.tsx:349` 旧测试 `expect(msg.textContent).toContain('读取失败')`
**enforces the bug** — 即使 fix 已 ship,这测试**也 FAIL**,因为 ffb00cd
删了 "读取失败" 前缀。ffb00cd / 303b4d3 commit message 没提这测试要同步改。

**修正**: 把 `toContain('读取失败')` 改成 `not.toContain('读取失败')` (因为现在
InfoBar 文本中不该出现 "读取失败" 任何一次)。同时补 `toContain('No such file or directory')`
断言 OS-level 细节保留。

**证据**: 改前 (revert fix) 测试 FAIL at line 351,Received =
`"读取失败: 文件不存在 /home/u/.claude/nope.json: No such file or directory (os error 2)"`。
改后 PASS。

### 5.4 验证清单 (CLAUDE.md §16.2 硬证据)

- [x] vitest 改前 FAIL (2/6 fail on pre-fix code)
- [x] vitest 改后 PASS (6/6 pass on post-fix code)
- [x] 旧测试 stale assertion 修正 (revert fix → FAIL, restore → PASS)
- [x] 测试留 codebase 做回归保护 (`.planning/milestones/v3.4-phases/` +
  `src/__tests__/pages/json-editor-error.spec.tsx` + `json-editor.test.tsx`)
- [x] 关联 bug 同步识别 (`\b` 残留 bug 见 §2.3 / §4.2,留 STATE.md)

---

## 6. 已知限制 (STATE.md followup)

> ⚠️ 本轮 verify 发现的次级 issue,本轮不修,留 STATE.md:

**A1-followup**: `mapBackendError` regex `^(文件不存在|无权限|编码错误|I\/O 失败)\b\s*(.*)$`
中的 `\b` 在 JavaScript 里**不识别 CJK 字符**,所以该 regex **永远不匹配**。
后果:reformatting 路径 (返回 `"category · rest"`) 从未生效,用户看到的
InfoBar 文本就是 Rust raw error (无 `·` separator)。

**修复建议**: 改方案 B (删 `\b`),需新加 4 个 reformatting 单元测试 (每个
category 一个) 锁住 invariant。

**影响**: 视觉上一致(因为修前修后都没 reformat),功能上不影响(用户
仍看到 OS-level 错误细节),但**与 SPEC §6.5 文档化意图不符** (清单 20
"Frontend InfoBar keys off the leading category word to render the right copy")。

**优先级**: P2 (视觉 polish,非功能 bug)

---

## 7. 关联 commit + branch

- **branch**: `wip/a1-json-error-prefix` (基于 master,worktree:
  `agent-ac14b56fadc6bb8c4`)
- **本轮 commit**:
  - `wip(a1): 真因定位 + 写 vitest 改前 FAIL 证据` (测试文件 + VERIFICATION-A1.md)
  - `verify(a1): 修后 PASS 验证 + 旧测试 stale assertion 修正`
- **关联上游 commit** (master 已 ship):
  - `ffb00cd` (line 226) — 删第一层前缀
  - `303b4d3` (line 258) — 删第二层前缀 (followup)

---

**写于**: 2026-06-30
**作者**: Claude Code (subagent via worktree `agent-ac14b56fadc6bb8c4`)
**协议**: CLAUDE.md §16 五步流程
**下一步**: 主 session 收到 branch + commit SHA list 后 cherry-pick 回 master
