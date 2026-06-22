# M3.11 A1#5 — F5 json-editor 白名单

## 改动的文件 (1 个)
- `D:\project\winui3\src-tauri\src\commands\fs.rs`
  - 改 3 个区域: `use` 声明、两个 `#[tauri::command]` 调用点 (`read_file` + `write_file_atomic`)、
    `resolve_claude_path` 函数签名 + 实现体
  - 加 1 个测试区: 4 个 unit test + 1 个 helper

## 新增文件 (0 个)

## 严禁改动 (再次确认)
- ❌ platform/ 层 (M3.10 已就位, 不动)
- ❌ 其他 plugin 的 commands/services (本次只动 F5)
- ❌ 前端代码 (F5 前端无改动)
- ❌ SPEC.md (实现参考文档, 不可改)
- ❌ 任何"既然要改 fs.rs 顺便清理 X"

## 测试代码
4 个新 test 全部在 `src-tauri/src/commands/fs.rs` 的 `#[cfg(test)] mod tests` 内,
不创建独立测试文件,符合 CLAUDE.md §2.4 最小化影响原则。

## Review / 白名单文件
- 自审: `D:\project\winui3\tmp\reviews\m3.11-f5-json-editor-self.md`
- 白名单: 本文件
