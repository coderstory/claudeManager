# D-槽3 白名单 — 清单 20 JSON 编辑器路径 bug 修复

## 根因 (summary)
- **前端**: `src/pages/json-editor/index.tsx:157` 把 `file.name`(HTML `<input type=file>` 给的裸文件名,如 `settings.json`)直接传给 `readFile()`。
- **后端**: `src-tauri/src/commands/fs.rs::resolve_claude_path` 收到裸文件名后走"非绝对 + 非 `~/`"分支,与 `state.paths.home` 拼接 → `<home>/settings.json`,**缺失 `.claude/` 段**,scope 检查失败,返回 `"路径超出允许范围(只允许 <home>/.claude/**): <home>/settings.json"`。
- **结果**: 用户在 JSON 编辑器选任何 `~/.claude/*.json` 文件,InfoBar 永远显示"读取失败: 路径超出允许范围…"。**清单 20 P0 bug**。

## 修复策略 (CLAUDE.md §2.4 — 严格白名单)

### 后端 (核心修复)
- `src-tauri/src/commands/fs.rs` — `resolve_claude_path` 增加"bare filename"识别:若路径不包含 `/` 或 `\`、不是绝对路径、不以 `~/` 开头、不是 `.` 或 `..`,则视作相对 `~/.claude/` 的裸文件名,在前面拼上 `<home>/.claude/`。同时把 std::fs IO 错误的 `e` 分类映射成 4 个明确场景 (合法 / 不存在 / 权限 / 编码)。
- `src-tauri/src/commands/fs.rs` (tests) — 新增 4 个单元测试 + 2 个 bare filename 测试。

### 前端
- `src/pages/json-editor/index.tsx` — ErrorBanner 文案针对后端的 4 类错误给出更可读的中文翻译 (文件不存在 / 无权限 / 编码错误 / 路径越界)。
- `src/pages/json-editor/index.tsx` — `handleFileChosen` 里把 `file.name` 透传 (安全了,因为后端现在能正确解析裸文件名)。
- `src/__tests__/pages/json-editor.test.tsx` — 新增/调整 4 个场景的单测。

### 不修改
- ❌ `src-tauri/src/commands/usage.rs` / `providers.rs` / `optimizer.rs` (其他命令)
- ❌ `src-tauri/src/services/*` / `src-tauri/src/domain/*` (业务层)
- ❌ `src-tauri/src/platform/*` (平台抽象层,D-槽1 占用)
- ❌ `src-tauri/src/commands/marketplace.rs` (D-槽2 占用)
- ❌ `src/lib/api/fs.ts` (IPC 包装不变,接口保持稳定)
- ❌ `src-tauri/Cargo.toml` / `package.json` (依赖锁,CLAUDE.md §2.3)
- ❌ `src/pages/{marketplace,resource-browser,welcome,sidebar}/` (其他槽位)
- ❌ `.planning/**` (决策文档,只读)

## 文件白名单 (实际改动)

| 路径 | 改动类型 | 行数估算 |
|---|---|---|
| `src-tauri/src/commands/fs.rs` | MODIFY (resolve_claude_path + tests) | +60 / -10 |
| `src/pages/json-editor/index.tsx` | MODIFY (error mapping) | +30 / -5 |
| `src/__tests__/pages/json-editor.test.tsx` | MODIFY (4 scenario tests) | +80 / 0 |
| `src/__tests__/lib/json-editor.test.ts` | (already exists, no change) | 0 |

## 4 场景测试矩阵

| 场景 | 输入 (frontend) | 后端期望 | ErrorBanner 文案 |
|---|---|---|---|
| 1. 合法 | `~/.claude/settings.json` | 读成功 | (无,正常加载) |
| 2. 不存在 | `~/.claude/nope.json` | `NotFound` | "文件不存在" |
| 3. 权限拒绝 | `~/.claude/locked.json` (mode 000) | `PermissionDenied` | "无权限读取" |
| 4. 编码错误 | `~/.claude/bom.json` (UTF-8 BOM) | `InvalidData` | "编码错误,请检查文件" |