# M3.11 A1#10 — F18 optimizer 白名单

## 改动的文件 (3 个)
- `D:\project\winui3\src-tauri\src\services\optimizer_service.rs`
  - 改 5 个区域: `use` 声明、`scan` (包装) + `scan_with_root` (新)、`apply_findings` (签名 + 安全边界)、
    `build_context` (签名 + settings_path 路由)、4 个旧 test 补 `, None` 第二参
  - 加 1 个测试区: 4 个新 unit test + 1 个 helper
- `D:\project\winui3\src-tauri\src\commands\optimizer.rs`
  - 改 2 个 `#[tauri::command]` 调用点: `scan_optimizations` (改用 `scan_with_root`)、`apply_optimizations` (传第二参)
- `D:\project\winui3\src-tauri\tests\optimizer_fix.rs`
  - 改 1 行: 集成 test harness `apply()` 方法补 `, None` (用户级模式)

## 新增文件 (0 个)

## 严禁改动 (再次确认)
- ❌ platform/ 层 (M3.10 已就位, 不动)
- ❌ 其他 plugin 的 commands/services (本次只动 F18)
- ❌ 前端代码 (F18 前端无改动 — 原本就是 `Vec<ApplyResult>` 接口)
- ❌ SPEC.md (实现参考文档, 不可改)
- ❌ 任何"既然要改 optimizer 顺便清理 X"
- ❌ 自动 mkdir 未知 root (安全边界, 测试 3 显式断言拒绝)

## 测试代码
4 个新 test + 1 个 helper 全部在 `src-tauri/src/services/optimizer_service.rs` 的
`#[cfg(test)] mod tests` 内,不创建独立测试文件,符合 CLAUDE.md §2.4 最小化影响原则。

## Review / 白名单文件
- 自审: `D:\project\winui3\tmp\reviews\m3.11-f18-optimizer-self.md`
- 白名单: 本文件
