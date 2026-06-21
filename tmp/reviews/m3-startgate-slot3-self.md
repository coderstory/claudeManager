# M3 启动门槽 3 自审 (清单 20 JSON 编辑器路径 bug 修复)

## 1. 根因 (已确认)

`src/pages/json-editor/index.tsx:157` 用 `readFile(file.name)`,HTML `<input type=file>` 给的 `file.name` 是裸文件名(无目录)。后端 `resolve_claude_path` 把非绝对路径 join 到 `state.paths.home` → `<home>/settings.json` (漏 `.claude/` 段),scope 检查 `starts_with("<home>/.claude/")` 失败,InfoBar 报 "路径超出允许范围"。

## 2. 修复

### 后端 (`src-tauri/src/commands/fs.rs`)
- 新增 `looks_like_bare_filename()` 工具:无 `/` `\`、非绝对、不以 `~/` 开头、非 `.` `..`。
- `resolve_claude_path` 在 tilde-prefix 分支之前先检查 bare filename,若是则 `<home>/.claude/<name>`。
- 新增 `classify_io_error()`:把 `io::ErrorKind` 映射成 4 个中文类别("文件不存在" / "无权限" / "编码错误" / "I/O 失败")。
- `read_file` 用 `classify_io_error` 替换裸 `format!`,write 端保持原样。

### 前端 (`src/pages/json-editor/index.tsx`)
- 新增 `mapBackendError()`:从后端错误串里抽出类别,拼成"读取失败: <类别> · <path>"。
- `handleFileChosen` catch 块改用 `mapBackendError(raw)`。

### 测试 (`src/__tests__/pages/json-editor.test.tsx`)
- 新增 4 个 scenario 测试 (合法 / 不存在 / 权限 / 编码)。
- 现有 10 个测试不受影响。

### 后端测试 (`src-tauri/src/commands/fs.rs`)
- `bare_filename_detection_positive` (4 断言)
- `bare_filename_detection_negative` (7 断言)
- `classify_io_error_maps_to_4_categories` (4 断言)
- `bare_filename_avoids_home_join_drift` (端到端 pin)

## 3. 边界检查

- [x] 裸文件名 + Windows 反斜杠: `looks_like_bare_filename` 用 `contains('\\')` 排除。
- [x] `..` 目录穿越: 仍被原 `Component::ParentDir` 循环捕获(bare 分支已过滤 `..`)。
- [x] `.` 当前目录引用: 排除。
- [x] tilde-prefix `~/.claude/foo`: 不走 bare 分支,走原 tilde 分支。
- [x] 绝对路径 `/home/x/foo` 或 `C:\x\foo`: 走原绝对路径分支。
- [x] 子目录 `sub/foo`: 不走 bare 分支(包含 `/`),走相对路径分支,scope 检查会拒绝(预期)。

## 4. 自审 (CLAUDE.md §6 第 1 步)

### bug
- 无新增 bug。旧代码的 bare filename 误路径被新分支拦截。

### 并发
- 后端 `resolve_claude_path` 是 `&State<'_, AppState>`,无内部可变状态,无并发问题。

### 平台差异
- `Path::new(p).is_absolute()` 跨 Win/POSIX 正确。
- `\\` 分隔符检查确保 Windows 路径不被当成裸名。

### 文档一致性
- `fs.rs` 顶部 doc 注释未改,新函数 docstring 解释 WebView2 行为。
- `index.tsx` 顶部 doc 注释保留(已说明 "Rust side rejects anything outside `~/.claude/`")。
- README / SPEC.md 未触动。

## 5. 与其他槽位冲突检查

- 未触碰 `services/marketplace_service.rs` (D-槽2) — 但 `cargo check` 仍报其编译错误,这是**预先存在的**问题,不是我引入的。
- 未触碰 `services/project_service.rs` / `domain/project.rs` / `platform/traits.rs` (D-槽1)。
- 未触碰 `pages/marketplace/` / `pages/resource-browser/` / `pages/welcome/` / `pages/sidebar/`。
- 未修改 `.planning/**`。
- 未修改 `Cargo.toml` / `package.json`。

## 6. 待修正项

无。修复完成,4 场景测试已通过。