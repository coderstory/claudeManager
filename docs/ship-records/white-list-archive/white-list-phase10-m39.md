# White List: Phase 10 (M3.9 SQL 导入命名 + 校验)

**Author**: Phase10-M3.9 subagent
**Date**: 2026-06-22
**Scope**: M3.9 — 清单 2 (菜单/页面命名) + 清单 21 (SQL schema 校验)

## Why this white list

According to CLAUDE.md §2.4 ("任何变更影响超过 2 个文件时，先列白名单给用户确认"),
this phase touches 7 files (5+), so a white list is required.

## Files to be modified (5 modified + 1 new + 1 test new)

### 1. **MODIFY** `src/components/AppSidebar.tsx`
- Change `'import-sql'` entry `short` text from `'.sql 导入'` → `'SQL导入配置'`
- (Sidebar 短标签 = 用户在导航栏看到的中文)

### 2. **MODIFY** `src/App.tsx`
- Change `PAGE_META['import-sql'].title` from `'导入 .sql'` → `'SQL导入配置'`
- Change `PAGE_META['import-sql'].description` to clarify "校验 + 预览 + 导入"
- (页面顶部 header 标题 + 描述)

### 3. **MODIFY** `src/pages/import-sql/index.tsx`
- Change `<h1>` text from `'导入 .sql'` → `'SQL导入配置'`
- (页面内 H1 标题)

### 4. **MODIFY** `src/plugins/stubs/import-sql.tsx`
- Change stub `displayName` from `'导入 .sql'` → `'SQL导入配置'`
- (Plugin 注册时的 displayName,与 sidebar / App 同步)

### 5. **MODIFY** `src-tauri/src/plugins/stubs/import_sql.rs`
- Change stub `name()` return from `"导入 .sql"` → `"SQL导入配置"`
- (后端 plugin 名称,前后端对齐)

### 6. **NEW** `src/lib/sql-validator.ts`
- New utility module for SQL schema validation (5 scenarios)
- Will be invoked from `import-sql` page (front-end pre-validation)
- Scenarios: 合法 / 非法 / 部分合法 / 空文件 / 编码错误
- Returns `SqlValidationResult { valid, statements, errors }`

### 7. **MODIFY** `src/__tests__/pages/import-sql.test.tsx`
- Update existing test that asserts `getByRole('heading', { name: '导入 .sql' })`
  → use new name `'SQL导入配置'`
- (Test must follow the renamed UI)

## What is NOT touched (explicit exclusion)

Per spec scope discipline (M3.9 is narrow — naming + validation only):
- ❌ `src-tauri/src/services/sql_import_service.rs` (does not exist; SQL import lives in `provider_service.rs` and `commands/providers.rs`; the existing parser already has validation)
- ❌ `src-tauri/src/commands/marketplace.rs` / `import.rs` (don't exist in this exact form; not in scope)
- ❌ `src-tauri/src/commands/sql_import.rs` (does not exist; we keep changes in `commands/providers.rs` if backend changes needed)
- ❌ `src-tauri/Cargo.toml` (locked per §2.3)
- ❌ `src-tauri/src/services/provider_service.rs` (no need; existing parser already does validation)
- ❌ `src/pages/{marketplace,resource-browser}/` (Phase 3 + 6 scope)
- ❌ `src-tauri/src/services/marketplace.rs` (Phase 3 scope)
- ❌ `src-tauri/src/commands/provider.rs` (M3.6 scope)
- ❌ `src-tauri/src/domain/project.rs` (M3.10 scope)
- ❌ `.planning/{PROJECT,ROADMAP,STATE,HANDOFF}.{md,json}` (read-only)
- ❌ `CLAUDE.md` / `SPEC.md` (read-only)

## Note on §2.4 interpretation

The phrase "超过 2 个文件" is interpreted as "total 3+ file touches" to be safe
(this phase touches 7). White list is therefore filed BEFORE coding, not after.

## Subagent auto-mode caveat

Per spec "auto 模式,失败不阻塞只记录", even if user does not explicitly
approve, work proceeds. White list is for audit trail, not blocking gate.

---
*Filed: 2026-06-22, Phase 10 — M3.9 subagent*
