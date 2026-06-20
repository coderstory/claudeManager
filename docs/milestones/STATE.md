# Project State — Claude Config Manager

> Iteration-by-iteration record. Updated by each ship.
> Per CLAUDE.md §6 step 5: "核定记录写入 STATE.md（迭代号 / 日期 / 用户反馈 / 下一步）".

## Milestone M2 — 业务实现期

### M2.4 — F5 JSON 编辑器 (2026-06-20)

**Ship**:
- Desktop: `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.2.4-f5-json-editor.exe`
- WebView2 DLL: shipped alongside exe
- Smoke: 7/7 passed (launch / window / webview / title / assets / tray / kill)
- Vitest: 122/122 passed (up from 99 → +23 cases for json-editor)
- Cargo build: clean (lib compiles; cargo test blocked by env WebView2 DLL, known M2.x issue)
- Build time: 159s (release)

**Commits (5 total)**:
1. `M2.x-lock: cargo.lock update after dev-mode verification (no source change)`
2. `M2.2.3-verify: keep real-invoke e2e spec for F1+F3 regression (per M2.1 verification)`
3. `M2.4-design: F5 JSON editor dataflow + module boundaries`
4. `M2.4-utils: token masking + json validate + format with TDD (13 cases)`
5. `M2.4-commands: read_file + write_file_atomic (reuses fs_atomic, security-scoped to ~/.claude/)`
6. `M2.4-page: JsonEditorPage real impl with token masking + atomic save + e2e`
7. `M2.4-types: narrow ValidateResult discriminated union in tests + page`

**Files created**:
- `docs/design/M2.4-dataflow.md` (design doc)
- `src/lib/json-editor.ts` (maskTokens / validateJson / formatJson + DEFAULT_TOKEN_FIELDS)
- `src/lib/api/fs.ts` (readFile / writeFileAtomic IPC wrappers)
- `src-tauri/src/commands/fs.rs` (commands + 7 unit tests)
- `src/pages/json-editor/index.tsx` (real impl, replaces M1.9 placeholder)
- `src/__tests__/lib/json-editor.test.ts` (13 vitest cases)
- `src/__tests__/pages/json-editor.test.tsx` (10 vitest cases)
- `tests/e2e/m2-4-json-editor.spec.ts` (3 playwright cases)

**Files modified**:
- `src/App.tsx` (route JsonEditorPage for 'json-editor' view)
- `src/__tests__/integration/App.test.tsx` (assert real page instead of placeholder)
- `src-tauri/src/commands/mod.rs` (register `fs` module)
- `src-tauri/src/lib.rs` (register `read_file` / `write_file_atomic` in invoke_handler)
- `src-tauri/Cargo.lock` (lock-only bump, no source change)
- `tests/e2e/m2-2-3-real-invoke.spec.ts` (kept as regression test)

**Business delivered**:
- F5 JSON editor: 选择文件 / 实时校验 / 格式化 (Ctrl+Shift+F) / 撤销重做 (Ctrl+Z/Y) / token 遮罩 (api_key / token / password / secret 默认遮罩) / 保存 (Ctrl+S,走 atomic + backup)
- Security: write_file_atomic 路径必须 starts_with(`~/.claude/`),拒绝 `..` traversal
- Token leak prevention: 默认遮罩 ON,避免截图泄漏

**User feedback**: _pending_

**Next step**: M2.5 — F6 MCP 管理 (MCP server list + enable toggle + CRUD)
— OR — M2.5 = F13 备份 (近期 settings.json 时间线 + diff + 回滚)
— 等待用户核定

---

### M2.3 — F4 deeplink 导入 (2026-06-20)
(see M2.3-state commit b3f50ca)
5 commits / 99 vitest / 7 smoke. Shipped ClaudeConfigManager-M2.2.3.

### M2.2 — F3 .sql 导入 (2026-06-20)
(see M2.2 commits)
Shipped ClaudeConfigManager-M2.2.2.

### M2.1 — F1 + F2 provider 列表 / 切换 (2026-06-20)
(see M2.1 commits + M2-state P0 bug fix)
Shipped ClaudeConfigManager-M2.2.1.