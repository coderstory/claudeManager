# M3.12 F6 mcp-management 白名单

> 任务: M3.12 (A 组) — F6 mcp-management 接入 `active_root_dir` (A1#4)
> 改动前提交 (SHA): 见 `git log -1` 在本文件生成前的 commit
> 任务来源: v2.0-BACKLOG.md A1#4 ("F6 mcp-management 读写 active_root/.claude.json")

---

## 白名单 (允许改动的文件)

### 生产代码 (production)

| 文件 | 改动性质 |
|---|---|
| `D:\project\winui3\src-tauri\src\commands\mcp.rs` | 修改 (6 个 mcp command 加 `with_root(active_root)`) |
| `D:\project\winui3\src-tauri\src\services\mcp_service.rs` | 修改 (加 `active_root_dir` 字段、`new_with_active_root` 构造器、`with_root` 方法、`write_all` 安全边界) |

### 测试代码 (test)

| 文件 | 改动性质 |
|---|---|
| `D:\project\winui3\src-tauri\src\services\mcp_service.rs` 的 `#[cfg(test)] mod tests` 内 | 追加 (4 个新场景 + 1 个 helper,**不**改现有测试) |

### 文档 (doc)

| 文件 | 改动性质 |
|---|---|
| `D:\project\winui3\tmp\reviews\m3.12-f6-mcp-self.md` | 新增 |
| `D:\project\winui3\tmp\white-list-m3.12-f6-mcp.md` | 本文件 (新增) |

---

## 不在白名单 (严守不动)

| 文件 / 范围 | 不动原因 |
|---|---|
| `D:\project\winui3\src-tauri\src\platform/**` | M3.10 已就位 (`IPlatformPaths::active_root_dir()`),严守;M3.12 是接入,不是改平台层 |
| `D:\project\winui3\src-tauri\src\app_state.rs` | `AppState` 仍是 `Arc<McpService>`,命令层 `with_root()` 派生新实例,不修改字段 |
| `D:\project\winui3\src-tauri\src\commands/{marketplace,providers,resource,backup,...}.rs` | 属于其他 wave(M3.12 B 组 / C 组)的范围,本任务 F6 不涉及 |
| `D:\project\winui3\src-tauri\src/services/{marketplace,provider,resource,backup,optimizer}_service.rs` | 同上 |
| `D:\project\winui3\src/**` (前端) | M3.12 焦点是 backend,F6 UI 联动 project switcher 推到后续迭代 |
| `D:\project\winui3\SPEC.md` | 实现唯一参考,禁止修改 |
| `D:\project\winui3\.planning/research/**` | 决策依据,禁止修改 |
| `commands/mcp.rs::parse_mcp_deeplink` | 纯 URL 解析,与 path 无关,故意不改 |

---

## 改动前 vs 改动后 (代码契约)

### `services/mcp_service.rs`

**前** (M2.5 ~ M3.11):
```rust
pub struct McpService {
    paths: AppPaths,
    mcp_json_path: PathBuf,  // hardcoded: <claude_dir>/mcp.json
}
pub fn new(paths: AppPaths) -> Self { ... }
```

**后** (M3.12):
```rust
pub struct McpService {
    paths: AppPaths,
    active_root_dir: Option<PathBuf>,         // NEW
    mcp_json_path: PathBuf,                    // resolved: Some → <root>/.claude/mcp.json; None → <claude_dir>/mcp.json
}
pub fn new(paths: AppPaths) -> Self { Self::new_with_active_root(paths, None) }  // backward-compat
pub fn new_with_active_root(paths: AppPaths, active_root_dir: Option<&Path>) -> Self { ... }  // NEW
pub fn with_root(&self, active_root_dir: Option<&Path>) -> Self { ... }  // NEW (command-layer convenience)
pub fn active_root_dir(&self) -> Option<&Path> { ... }  // NEW (getter)
fn write_all(&self, servers: &[McpServer]) -> Result<(), McpError> {
    // NEW safety boundary:
    if let Some(root) = &self.active_root_dir {
        if !root.exists() {
            return Err(McpError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("active root 目录不存在: {} (拒绝写入,避免 mkdir 未知路径)", root.display()),
            )));
        }
    }
    // ... existing logic (fs_atomic::write_with_backup unchanged)
}
```

### `commands/mcp.rs`

**前**: 6 个 command 直接 `state.mcp_service.list()` / `.add(s)` / etc

**后**: 6 个 command 入口加 3 行:
```rust
let active_root = crate::platform::runtime::paths().active_root_dir();
state.mcp_service.with_root(active_root.as_deref()).list()  // 或 add/toggle/update/remove
```

`parse_mcp_deeplink` 保持不变(与 path 无关)。

---

## 决策日志

| 决策 | 替代方案 | 选择 |
|---|---|---|
| 用 `with_root()` 派生新 `McpService` | (a) 给 `AppState` 加 setter; (b) 命令层手写 `new_with_active_root` | 选 `with_root()` — 封装 + 不改 `AppState` 公共接口 + 命令层一行调用 |
| `Some(root) + !root.exists()` 拒绝写 + 不 mkdir | 自动 mkdir project root + `.claude/` | 拒绝 — 与 F18 `apply_findings` 同源,CLAUDE.md §2.4 + §7 满足;用户未授权的目录不能擅自建 |
| 读路径不检查 root 存在 | 读也拒绝(对齐写) | 不拒绝 — `list_with_warnings` 已支持"文件不存在返回空 Vec";F18 `scan_with_root` 也读宽容;用户能看到"空列表"远比"启动报错"友好 |
| `McpError::Io(NotFound)` 包装 | 新增 `McpError::RootNotFound` 变体 | `Io(NotFound)` — 复用现有 variant,错误信息自描述足够;新增变体要更新 `#[from]` derive 链,影响面更大 |
| `parse_mcp_deeplink` 不改 | 一并加 active_root 透传 | 不改 — deeplink 是 URL → ParsedDeeplink 的纯函数,无运行时 path 依赖,改之无意义 |
| F6 UI 暂不联动 project switcher | 本次同步改前端 | 后端先就位,UI 联动推后续迭代 — 避免单次改动跨 4 个文件(命令/service/UI/state) 违反 §2.4 |

---

## 验证清单

- [x] `cargo build --tests` 通过(56.78s,零 mcp 相关诊断)
- [x] `cargo build` (debug) 通过(22.48s)
- [x] `tauri build --no-bundle` (release) 通过(156s)
- [x] 4 个 TDD 场景覆盖 None 读 / Some 读 / Some 写+备份 / root 不存在拒绝
- [x] Smoke test 7/7 passed (4 core + 3 bonus)
- [x] exe 在桌面:`ClaudeConfigManager-M3.3.12-f6-mcp-adapter.exe` + `WebView2Loader.dll`
- [x] `AppState` 未改
- [x] `platform/` 未改
- [x] 其他 plugin 未改
- [x] 前端未改
- [x] `SPEC.md` 未改
- [x] `parse_mcp_deeplink` 未改

---

## 失败回退 (如有)

本次无失败,无回退操作。`cargo check --lib` 有 4 个 pre-existing 错误在 `commands/backup.rs` (F13/F19 wave 未完成中间状态),与本次任务无关,未触碰。