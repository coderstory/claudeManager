# Bug 验证报告 — A2: add_provider missing field id

> **状态**: 已验证 (PASS)
> **日期**: 2026-06-30
> **分支**: `verify/a2-add-provider-id`
> **Commits**: `3683eed` (regression test)

---

## §16 五步证据

### 1. 了解 (problem details)

- **Bug ID**: A2 — `add_provider missing field id` (清单 §1, P0)
- **清单描述**: "代码已修, 未 commit" — 指 fix 在 worktree 而未进 master
- **操作路径**: 用户从 provider-list 页面 → 点 [+ Add] → 填表单(name / base_url / api_key / model) → 点 [保存]
- **前置状态**: 库可为空或已有若干 provider
- **期望行为**: 新 provider 写入 `<app_data>/providers/<id>.json`,列表刷新
- **实际行为** (bug 触发时): IPC `add_provider` payload 缺 `id` → Rust serde 返回 `"missing field 'id'"` → invoke 抛错 → 列表不刷新,用户看到错误条

### 2. 原因 (root cause, file:line 证据)

**Root cause**: 前端 form 在 add path 没把 `id` 放进 `ProviderInput` payload,而 Rust 端 `ProviderInput` (`src-tauri/src/domain/provider.rs`) 强制要求 `pub id: String` 字段。

**代码位置**:

| 文件 | 行 | 说明 |
|---|---|---|
| `src-tauri/src/domain/provider.rs` | `ProviderInput.id: String` | Rust serde 必填 |
| `src/types/provider.ts` | 191-198 | TS mirror 同步声明 `id: string` |
| `src/pages/provider-list/index.tsx` | 290-311 | `handleSubmitForm` 调 `addProvider(input)` |
| `src/pages/provider-list/index.tsx` | 1048-1067 | `ProviderFormModal.handleSubmit` 含 fix |

**fix 现状 (master)**: `ProviderFormModal.handleSubmit` 已正确生成 id:
```tsx
const idForInput = existing?.id ?? generateIdFromName(name.trim());
const input: ProviderInput = {
  id: idForInput,  // <-- 这里
  name: name.trim(),
  base_url: baseUrl.trim(),
  api_key: apiKey.trim(),
  models: { ... },
  notes: notes.trim() || null,
};
```

注释明确写 "M5 bug #6 fix: include `id` in the ProviderInput payload — Rust's ProviderInput struct requires it"。

**清单 "代码已修, 未 commit" 解读**: fix 在 master 已就位,但**没有任何回归测试**锁定此行为 — 下次重构 ProviderFormModal 可能再次漏掉 id。本验证补的就是这个测试。

### 3. 边界 (boundary)

涉及文件 (≤ 2 个, 不需 §2.4 白名单):
1. `src/__tests__/pages/provider-list.test.tsx` — 加 1 个新 vitest 用例 (60 行)
2. (no production code change — fix 已在 master)

**受影响模块**:
- `src/lib/api/providers.ts::addProvider` (IPC wrapper, 透传 input — 无需改)
- `src/types/provider.ts::ProviderInput` (TS shape, 已声明 id — 无需改)
- `src/pages/provider-list/index.tsx::ProviderFormModal` (form submit — 已有 fix)
- `src-tauri/src/services/provider_service.rs::add_provider` (Rust impl — 已校验 id)

**不影响**:
- 任何其他 CRUD IPC (update_provider / delete_provider / get_provider_details)
- import-sql / deeplink 导入路径 (它们的 provider 来源是 SQL parser / URL parser,自带 id)
- MCP 管理 / 用量查询 / 优化器

### 4. 方案 (≥2 candidates)

| # | 方案 | 优 | 劣 | 推荐 |
|---|---|---|---|---|
| A | Rust `ProviderInput.id` 改为 `Option<String>`,缺省时 auto-gen uuid | 对调用方友好 | 隐藏前端契约错误;与 `update_provider` 不对称;R2 写入路径必现成 id,加 option 是 dead branch | ❌ |
| B | 前端 `ProviderFormModal.handleSubmit` 显式生成 id (current implementation) | 与 `update_provider` 对称; 契约错误时立刻显式; 复用 `generateIdFromName` | UI 不能完全自由选 id (但这是有意的 SPEC §2.1 kebab-case 约束) | ✅ **(已采用)** |
| C | Schema: id optional + Rust 校验 None 时报错 "id required" | 不破坏 API 形状 | 没解决问题,只把错误从 serde 延迟到 service | ❌ |

**推荐方案 B** — 与现有 `update_provider` M5 bug #6 修复路径对称。fix 已在 master,本次验证只补回归测试,不重写实现。

### 5. 验证 (actual verification)

#### 5.1 vitest 改前 FAIL → 改后 PASS 循环

**Step 1**: 写回归测试 (`src/__tests__/pages/provider-list.test.tsx` lines 602-653):
- 用例名: `[Add] invoke payload must include input.id (A2 regression)`
- 流程: mock list empty → 点 + Add → 填 name='GLM Add' 等 → 点 保存 → 断言 `args.input.id === 'glm-add'` (generateIdFromName 派生)

**Step 2**: 跑测试 with fix active → **PASS**:
```
✓ src/__tests__/pages/provider-list.test.tsx (30 tests | 29 skipped)
Tests  1 passed | 29 skipped (30)
```

**Step 3**: 临时还原 fix (从 ProviderFormModal.handleSubmit 移除 `id` 字段) → 跑测试 → **FAIL**:
```
Expected: "glm-add"
Received: undefined
❯ src/__tests__/pages/provider-list.test.tsx:652:29
Tests  1 failed | 29 skipped (30)
```

**Step 4**: 恢复 fix → 跑测试 → **PASS**:
```
✓ src/__tests__/pages/provider-list.test.tsx (30 tests) 231ms
Tests  30 passed (30)
```

→ **回归测试有效**: 未来若有人重构 ProviderFormModal 并丢掉 `id`,本测试会 FAIL 提醒。

#### 5.2 全套回归 (no regression)

| 测试文件 | 结果 |
|---|---|
| `src/__tests__/pages/provider-list.test.tsx` | 30/30 PASS (含新加的 A2 + 现有 M5 bug #6 update_provider) |
| `src/__tests__/pages/import-sql.test.tsx` | 25/25 PASS (cross-module,确认无副作用) |

#### 5.3 实际 UI 行为 (待 macOS 真机 / D6)

- Windows dev box 上 ✅ (fix 已 in master,build 通过)
- macOS 真机验证: D6 暂缓 (CLAUDE.md §约束 + 清单 §3.3) — `add_provider` IPC 无 OS-specific 分支,Mac 上行为应一致

---

## 6. 总结

| 项 | 值 |
|---|---|
| Bug ID | A2 |
| Severity | P0 |
| Root cause | ProviderFormModal.handleSubmit 漏 `id` (已修) |
| 验证方式 | vitest 回归测试 (TDD, 改前 FAIL → 改后 PASS 循环已演示) |
| 测试用例 | `[Add] invoke payload must include input.id (A2 regression)` |
| 测试位置 | `src/__tests__/pages/provider-list.test.tsx:602-653` |
| Commit | `3683eed` |
| 分支 | `verify/a2-add-provider-id` |
| Production code 改动 | 0 行 (fix 已在 master) |
| Test code 改动 | +60 行 |
| Build 影响 | 无 |
| Regression 风险 | 低 (仅新增测试用例,不动 product code) |

**清单 §1 A2 状态变更**: 待 verify → ✅ **已 verify**,P0 关闭。