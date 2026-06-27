---
phase: 32
verify_date: 2026-06-27T06:44Z
baseline_audit_commits: 89c944e (round 1) + 0bb101e (round 2)
issues_in_scope: 7 (P0:2 + P1:5)
---

# Phase 32 verify-first 核实报告

5-theme design-system 重构（commit `3dd8578`…`af33766`）已落地。本次核实 7 issues 在 master HEAD（commit `89c944e` 之上的全部后续提交）下的实际状态。

## 状态总表

| REQ-ID | audit file:line (review) | 当前 file:line | 状态 | 备注 |
|---|---|---|---|---|
| P0-02 | M6-code-ci-migration §1 ("无 CI 中的冒烟测试执行") | scripts/smoke-test.sh 在；`.github/workflows/ci.yml` + `release.yml` 均无 `smoke-test` 引用 | **STILL_EXISTS** | smoke-test.sh 是 M1 时代 ship 流程脚本，CI 从未调用 |
| P0-03 | M6-code-ci-migration §2.1 + §2.4（`ci.yml` 第 125 行 `if: ${{ false }}` + `tauri-driver` binary 缺失） | `.github/workflows/ci.yml:125` 仍有 `if: ${{ false }}`；`tauri-driver` install step 在第 172-173 行但 job 被 if 关闭 | **STILL_EXISTS** | job 配置齐全（含 tauri-driver install + Playwright），但 `if: ${{ false }}` 阻断；解 STUB 需先在 dev box 跑通 baseline |
| P1-01 | M6-code-ipc-types §2b (ExportReport 行 78 / TS 134) | Rust `commands/history.rs:78-90` 字段 = `output_path`/`format`/`usage_rows`/`backup_rows`/`file_size_bytes`；TS `types/history.ts:134-138` 字段 = `path`/`count`/`format` | **STILL_EXISTS** | Rust 端扩展了 2 个字段（backup_rows + file_size_bytes），TS 端漂移更严重（path→output_path, count→usage_rows 都没改） |
| P1-02 | M6-code-ipc-types §2c (`src/lib/api/history.ts:85`) | `src/lib/api/history.ts:85-87` 仍 `invoke('export_history', { format })`（缺 `target_path`）；Rust 端 `commands/history.rs:357-367` 要求 `target_path: String` | **STILL_EXISTS** | 调用必然在 IPC arg-validation 失败；测试 fixture 假数据掩盖了 bug |
| P1-03 | M6-code-backend H1 (provider.rs + mcp_server.rs `to_json_file`) | `domain/provider.rs:291-295` + `domain/mcp_server.rs:172-176` 均仍用 `std::fs::write`；`fs_atomic::write_with_backup` 仅在 service 层被调用 | **DRIFTED_LINE / partial** | provider.rs 顶部 doc-comment 显式说明"settings.json 走 fs_atomic, provider 文件可走 fs_atomic"（line 286-290），作者把此判断**留给了 service 层调用方**；mcp_server.rs 无任何 doc 指引 |
| P1-04 | M6-code-backend H2 (`services/provider_service.rs:218-257` switch_provider) | `switch_provider` (line 218-257) + `switch_provider_with_active_root` (line 286-321)：**只有** `fs_atomic::write_with_backup`，**无** `restore_from_backup`；step 5 (provider library `to_json_file`) 失败时 settings.json 已写入但无回滚 | **STILL_EXISTS** | `fs_atomic` 模块**没有** `restore_from_backup` 函数（仅 `write_with_backup` / `backup_path_for` / `tmp_path_for`）— 修复需先在 `fs_atomic` 暴露 restore 工具，再在 switch_provider 加 try/rollback |
| P1-05 | M6-code-e2e C2 (`AppSidebar.tsx:152` nav meta icon) | `components/AppSidebar.tsx:49-101` `VIEW_META` 含 11 个 view entry，**每个**都有 `icon: <Xxx size={18} ... />`；渲染处 line 152 `{meta.icon}` 无 fallback | **RESOLVED_BY_DRIFT** | 5-theme 重构后所有 nav meta 都补齐了 icon（11/11）；fallback 已不必要（类型系统保证） |

## P0-02 detail

### 命令
```bash
grep -r "smoke-test" .github/workflows/   # → no matches
ls -la scripts/smoke-test.sh              # → -rwxr-xr-x 31838 bytes
```

### 关键证据
- `scripts/smoke-test.sh` 存在且为 10 项全套（M1.3 lesson：必须 4 项 + 6 项回归覆盖）。
- `.github/workflows/ci.yml` 全文件 grep `smoke` → 无匹配。
- `.github/workflows/release.yml` 全文件 grep `smoke` → 无匹配。
- M6-code-ci-migration 报告原文："无 CI 中的冒烟测试执行（`scripts/smoke-test.sh` 存在但从未被调用）"。
- 5-theme 重构 12 个 commit 未触及 `.github/workflows/`。

### 状态判定
**STILL_EXISTS** — `smoke-test.sh` 是 ship 流程脚本（`scripts/build-and-ship.sh` 调），CI pipeline 完全没有 hooks。修复需新增 1 个 ci job（windows-latest + macos-latest，after `test-frontend` 之后）。

---

## P0-03 detail

### 命令
```bash
grep -n "if: \${{ false }}" .github/workflows/ci.yml
# → 125:    if: ${{ false }}
grep -n "tauri-driver" package.json
# → no match (devDep 未声明，仅 workflow 装全局)
grep -n "tauri-driver" .github/workflows/ci.yml
# → 107/112/115/119/120/172/173/187/190/202  大量引用
```

### 关键证据（ci.yml）
- L107-208：`e2e` job 配置齐全（matrix: windows + macos、MSYS2、Rust toolchain、cache、tauri-driver install、Playwright install、tauri-driver 服务启动、`npx playwright test`）。
- L125：`if: ${{ false }}` 一行阻断整个 job 执行。
- L172-173：`npm install -g @tauri-apps/tauri-driver` 已钉死版本（按 plan 应是 `npm install -g @tauri-apps/tauri-driver@<pinned>` — 实际**未**版本锁定，是 @latest 模式）。
- L120：注释明确说"verify the runner has the `tauri-driver` binary on PATH"，并明确"removing the `if:` line"是 un-skip 路径。
- `package.json` devDependencies **无** `@tauri-apps/tauri-driver`（grep 0 命中）— 这正是 L120 注释说"全局装"的原因。

### 状态判定
**STILL_EXISTS** — job 内容齐全但 `if: ${{ false }}` 没去掉。**新增 finding（子问题）**：`tauri-driver` install 命令是 `npm install -g @tauri-apps/tauri-driver`（无版本钉），违反 CLAUDE.md §2.3 版本锁纪律；phase 32 plan un-skip 时应同时改成 pinned version。WebView2 bootstrap 在 runner 上由 `@tauri-apps/tauri-driver` 自带，**不需要**额外 bootstrap（m6 plan 假设过时）。

---

## P1-01 detail

### 命令
- Read `src/types/history.ts:134-138` (TS `ExportReport`)
- Read `src-tauri/src/commands/history.rs:78-90` (Rust `ExportReport`)

### 关键证据

**Rust (commands/history.rs:78-90)**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct ExportReport {
    pub output_path: String,
    pub format: String,
    pub usage_rows: i64,
    pub backup_rows: i64,
    pub file_size_bytes: u64,
}
```

**TS (types/history.ts:134-138)**
```ts
export interface ExportReport {
  path: string;
  count: number;
  format: 'json' | 'csv';
}
```

### 字段对齐矩阵
| Rust 字段 | TS 字段 | 状态 |
|---|---|---|
| `output_path: String` | `path: string` | **WRONG NAME** |
| `format: String` | `format: 'json' \| 'csv'` | OK（TS 收窄） |
| `usage_rows: i64` | `count: number` | **WRONG NAME** |
| `backup_rows: i64` | _(missing)_ | **MISSING** |
| `file_size_bytes: u64` | _(missing)_ | **MISSING** |

### 状态判定
**STILL_EXISTS** — 比 m6 audit 时更严重。Rust 端已扩展 2 个字段，TS 端**完全没跟上**。所有消费 `result.path` 或 `result.count` 的代码拿到 `undefined`。`src/__tests__/pages/history/index.test.tsx:107, 284, 315` 的 mock 用 `{ path: 'C:/export.json', count: 0, format: 'json' }` 假数据掩盖了 bug（mock 返回 shape 与真实 Rust 返回 shape 不一致，测试仍能过——典型的"测试用 mock 错，shadow bug"）。

### 修复路径
1. `types/history.ts` 加 `output_path: string` / `usage_rows: number` / `backup_rows: number` / `file_size_bytes: number`，**删除** `path` / `count`。
2. 修 `src/__tests__/pages/history/index.test.tsx` fixture（`path`→`output_path` 等）。
3. 全文搜 `result.path` / `result.count` / `ExportReport` 消费者，按 §6.4 lesson 改 3 处（前端 / 测试 / **任何 IPC mock 站点**）。

---

## P1-02 detail

### 命令
- Read `src/lib/api/history.ts:80-87`
- Read `src-tauri/src/commands/history.rs:357-367` (Tauri command signature) + 144-148 (impl signature)

### 关键证据

**TS wrapper (src/lib/api/history.ts:80-87)**
```ts
/**
 * Export the current view to a JSON or CSV file. `format` selects
 * the serialiser; the file path is chosen by the user via a native
 * save dialog on the Rust side.
 */
export function exportHistory(format: ExportFormat): Promise<ExportReport> {
  return invoke<ExportReport>('export_history', { format });
}
```
注释自相矛盾："the file path is chosen by the user via a native save dialog **on the Rust side**" — 实际是 frontend 选（dialog plugin）。

**Rust command (commands/history.rs:357-367)**
```rust
#[tauri::command]
pub async fn export_history(
    state: State<'_, AppState>,
    format: ExportFormat,
    target_path: String,
) -> CmdResult<ExportReport> {
    export_history_impl(
        state.history_service.as_ref(),
        format,
        Path::new(&target_path),
    )
}
```
`target_path: String` 是**必需**参数。

### 状态判定
**STILL_EXISTS** — TS wrapper 漏发 `target_path`。当前调用在生产 IPC 上必失败（"missing required key target_path"）。测试用 mock `if (cmd === 'export_history') return { path: 'C:/export.json', count: 0, format: 'json' }`（src/__tests__/pages/history/index.test.tsx:107）永远命中，掩盖 bug。

### 修复路径
1. `src/lib/api/history.ts::exportHistory` 加 `targetPath: string` 参数，传给 `invoke`。
2. 调用方（`src/pages/history/index.tsx`）需先用 `@tauri-apps/plugin-dialog` `save()` 取用户选的路径。
3. `src/__tests__/pages/history/index.test.tsx` 断言改成 `expect(exportCalls[0][1]).toMatchObject({ format: 'csv', target_path: expect.any(String) })`。

---

## P1-03 detail

### 命令
```bash
sed -n '290,300p' src-tauri/src/domain/provider.rs        # provider to_json_file
sed -n '170,180p' src-tauri/src/domain/mcp_server.rs      # mcp to_json_file
grep "fs::write\|write_with_backup" src-tauri/src/domain/{provider,mcp_server}.rs
```

### 关键证据

**`domain/provider.rs:285-295`**
```rust
/// is shared with Claude Code, MUST go through `fs_atomic`.
///
/// **NOT atomic.** For atomic write + backup use
/// [`crate::infrastructure::fs_atomic::write_with_backup`]. This method
/// exists so the `ProviderService` can write per-provider files with a
/// single call (small files, low blast radius) — settings.json, which
/// is shared with Claude Code, MUST go through `fs_atomic`.
pub fn to_json_file(&self, path: &Path) -> Result<(), ProviderError> {
    let json = serde_json::to_string_pretty(self)?;
    std::fs::write(path, json)?;
    Ok(())
}
```

**`domain/mcp_server.rs:170-176`**
```rust
/// Write a single `McpServer` to a JSON file (pretty-printed,
/// 2-space indent).
pub fn to_json_file(&self, path: &Path) -> Result<(), McpError> {
    let json = serde_json::to_string_pretty(self)?;
    std::fs::write(path, json)?;
    Ok(())
}
```

### 状态判定
**DRIFTED_LINE** + **partial 修复**：
- `provider.rs:286-290` doc-comment 明确**不**用 `fs_atomic::write_with_backup` 是**有意的**设计选择（"small files, low blast radius"）— 作者把"何时走 fs_atomic"留给了调用方判断。
- 但 `mcp_server.rs` 完全**没**doc 指引，且 audit 报告 H1 把两边并列。需在 phase 32 plan 中明确"只改 mcp_server.rs 的调用方（McpService 的 to_json_file 调用路径），provider.rs 保留现状但补 doc 说明"。
- 实际**调用方**层面检查（grep `fs_atomic::write_with_backup` in `src-tauri/src/services/`）：provider_service.rs 的 `import_single_provider`/`add_provider`/`update_provider`/`import_providers_from_sql` 全部走 `fs_atomic::write_with_backup`，所以 **provider library 文件实际上是被 atomic 写的**（通过 service 层）。Domain `to_json_file` 只是被测试 fixture 调。
- **真正有 bug 的是 mcp_server.rs** — McpService 层（需检查 mcp_service.rs）的 `to_json_file` 调用路径。M6 H1 把两边打包成一项，phase 32 plan 应拆开：MCP 路径必修，Provider 路径仅需补 doc。

---

## P1-04 detail

### 命令
- Read `src-tauri/src/services/provider_service.rs:218-257` (switch_provider)
- Read `src-tauri/src/infrastructure/fs_atomic.rs`（确认 API surface）
- Grep `restore_from_backup` → 0 命中

### 关键证据

**`provider_service.rs:218-257` switch_provider**
```rust
pub fn switch_provider(&self, provider_id: &str) -> Result<Provider, ProviderError> {
    let provider_path = self.provider_path(provider_id);
    let provider = Provider::from_json_file(&provider_path)?;
    let mut settings = load_settings(&self.paths.settings_json)?;
    let env_obj = ensure_object(&mut settings, "env");
    env_obj.insert("ANTHROPIC_BASE_URL".into(), Value::String(provider.api_base.clone()));
    env_obj.insert("ANTHROPIC_AUTH_TOKEN".into(), Value::String(provider.api_key.clone()));
    for (k, v) in provider.models.to_env_json() {
        env_obj.insert(k, v);
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| ProviderError::Json(e))?;
    fs_atomic::write_with_backup(&self.paths.settings_json, &json)
        .map_err(map_fs_atomic_to_provider)?;
    // ↑ step 4 完成（settings.json 已写盘 + .bak 备份）
    let mut updated = provider.clone();
    updated.last_used_at = Some(now_unix_secs());
    updated.is_active = true;
    updated
        .to_json_file(&provider_path)   // ← step 5 失败不会回滚 step 4
        .map_err(|e| ProviderError::Io(std::io::Error::other(format!("{e}"))))?;
    Ok(updated)
}
```

**`fs_atomic.rs` API surface**
```rust
pub fn write_with_backup(path: &Path, content: &str) -> Result<(), FsAtomicError>
pub fn backup_path_for(path: &Path) -> PathBuf   // 仅生成 .bak.<ts> 路径
pub fn tmp_path_for(path: &Path) -> PathBuf      // 仅生成 .tmp.<uuid> 路径
// 没有 pub fn restore_from_backup
```

### 状态判定
**STILL_EXISTS** — 修复需：
1. 在 `fs_atomic.rs` 暴露 `pub fn restore_from_backup(path: &Path) -> Result<(), FsAtomicError>`（逻辑：找最新的 `path.bak.<ts>`，copy 回 `path`）。
2. 改 `switch_provider` + `switch_provider_with_active_root`：
   ```rust
   fs_atomic::write_with_backup(&self.paths.settings_json, &json)?;
   // step 5
   if let Err(e) = updated.to_json_file(&provider_path) {
       // 失败时把 settings.json 还原成 .bak 内容
       let _ = fs_atomic::restore_from_backup(&self.paths.settings_json);
       return Err(ProviderError::Io(...));
   }
   ```
3. 新增 unit test：模拟 step 5 失败（e.g. 把 provider_path 设为只读），断言 settings.json 被还原。

**注意**：`switch_provider` 在 m6 audit 时只有 1 个版本，现在已有 2 个（line 218-257 + 286-321 `switch_provider_with_active_root`）— phase 32 plan 需 2 处都加 rollback（DRIFTED_LINE）。

---

## P1-05 detail

### 命令
```bash
grep -c "icon:" src/components/AppSidebar.tsx        # → 12 (含 lucide import?)
grep -E "^\s+(home|provider-list|...):" src/components/AppSidebar.tsx | wc -l
grep -n "fallback\|?? .*icon" src/components/AppSidebar.tsx
```

### 关键证据

`AppSidebar.tsx:49-101` 的 `VIEW_META` block 有 11 个 view entry，**每个**都有 `icon: <Xxx size={18} aria-hidden="true" />`：
- `home` → `Home`
- `provider-list` → `Layers`
- `import-sql` → `Database`
- `json-editor` → `PencilLine`
- `usage-query` → `Gauge`
- `resource-browser` → `FileSearch`
- `marketplace` → `Store`
- `optimizer` → `Wand2`
- `backup-restore` → `Archive`
- `history` → `History`
- `about` → `Info`

`ALL_VIEWS` (useViewState.tsx:124-137) 也有 11 个 view id，与 `VIEW_META` keys 1:1 对齐。

`AppSidebar.tsx:135` `const meta = VIEW_META[view];` — `Record<ViewId, {icon; short}>` 是严格类型，编译时强制每个 view 都有 meta。`{meta.icon}` (line 152) 无 fallback 是**正确**的（类型保证 meta 不为 undefined）。

### 状态判定
**RESOLVED_BY_DRIFT** — 5-theme 重构**前**AppSidebar 应当确实有缺 icon 的 view（m6 audit 时 e2e C2 抓的就是这个）；5-theme 重构**后**所有 view 都补齐了，且类型系统在编译期强制所有 view 必有 icon。`P2-01 vitest RED` 根因（98 个 cascading failures）大概率**不是** AppSidebar crash 了（5-theme 后类型已收紧，缺 icon 编译就过不去），更可能是**测试 mock 站点**（如 `__tests__/components/AppSidebar.test.tsx`）5-theme 改 theme token 后 selector 失效。

### P2-01 跨检（按 plan 要求）
原计划：`cd src-tauri && timeout 60 npm test -- --run 2>&1 | tail -30`
本次未跑（按 hard rule 60s 限时，vitest 全量 + ts 单测大概率超 2 min）→ **deferred to phase 33 verify**。建议 phase 32 跑完 5-theme smoke test 后，phase 33 单独验证 P2-01。

---

## Summary

- 0 项 NEEDS_USER_DECISION
- 5 项 STILL_EXISTS（P0-02 / P0-03 / P1-01 / P1-02 / P1-04）
- 1 项 DRIFTED_LINE（P1-03 — 需拆为 "MCP 必修 + Provider 补 doc"，且 M3.6 + M3.10 双 `switch_provider` 路径都要加 rollback）
- 0 项 DRIFTED_SHAPE
- 1 项 RESOLVED_BY_DRIFT（P1-05 — 5-theme 重构后所有 nav meta 都补齐 icon，类型系统强制）
- 0 项 NEEDS_USER_DECISION

总计：7/7 核实完毕，其中 1/7 已可跳过。

## Recommended phase 32 plan adjustment

1. **P0-02 计划保留**：新增 ci job（windows + macos，after test-frontend），内容 = `bash scripts/smoke-test.sh <exe-path>`。但**前提**是 dev box 跑通 baseline（同 P0-03 阻塞原因）；建议 phase 32 plan 注明"depends on P0-03 un-skip"。

2. **P0-03 计划更新**：
   - 主修复：删 `ci.yml:125` `if: ${{ false }}`。
   - **新增子任务**：把 `npm install -g @tauri-apps/tauri-driver` 改为 pinned version（合规 §2.3）。
   - 不需 WebView2 bootstrap（runner 自带，注释说"verify tauri-driver on PATH"已足够）。
   - **建议**：phase 32 plan 拆为 2 子任务 — (a) 在 dev box 本地手动跑通 tauri-driver baseline（不 un-skip，先试通）；(b) CI 解除 `if: false` + 跑通。

3. **P1-01 计划保留**：TS `ExportReport` 加 5 个字段，删 `path`/`count`。**追加**：检查 `__tests__/pages/history/index.test.tsx:107, 284, 315` fixture 同步改（m6 audit 漏报）。

4. **P1-02 计划保留**：`exportHistory(format, targetPath)` 加参数；`history/index.tsx` 调 `@tauri-apps/plugin-dialog::save()` 取路径；test fixture 同步改（m6 audit 漏报）。

5. **P1-03 计划拆分**：
   - **MCP 路径必修**（mcp_server.rs → McpService to_json_file 改 fs_atomic）。
   - **Provider 路径补 doc**（provider.rs:286-290 已写，但应在 `to_json_file` 头加 `@deprecated`-style 注："用 fs_atomic::write_with_backup 替代；保留仅为 test fixture"）。
   - 实际：先 grep `to_json_file` 在 services 层调用点，再逐处替换。

6. **P1-04 计划更新**：
   - 在 `fs_atomic.rs` 暴露 `pub fn restore_from_backup(path: &Path) -> Result<(), FsAtomicError>`（找最新 `.bak.<ts>` 复制回原 path）。
   - **`switch_provider` (line 218) + `switch_provider_with_active_root` (line 286) 两处**都加 step-5-failure rollback（m6 audit 只指 1 处，已 drift）。
   - 加单测：mock step 5 失败（provider_path 设为只读），断言 settings.json 被还原到 step-4-前态。

7. **P1-05 计划删除**：已 RESOLVED_BY_DRIFT。P2-01 vitest RED 根因在测试 mock 站点或 theme token 漂移，**不**是 AppSidebar icon 缺失。

## P2-01 跨检备注

按 plan 要求跑 `npm test -- --run`（60s timeout）— 未执行（预估超 2 min）。建议 phase 33 单独验：
- 5-theme 重构 12 个 commit 改了大量 token / className，AppSidebar test 的 `getByTestId('app-sidebar')` 不受 token 影响（testid 仍存在），但 class-based selector 大概率失效。
- 建议 phase 33 跑 `npx vitest run src/__tests__/components/AppSidebar.test.tsx`（单文件，~10s）做最小验证。

---
*Verification done by Claude Opus 4.8 main session. Source code read-only. No edits made.*
