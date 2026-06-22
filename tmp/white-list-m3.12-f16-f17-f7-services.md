# M3.12 A1#11+A1#12+A1#13 — F16+F17+F7 services 白名单

## 改动的文件 (6 个)
- `D:\project\winui3\src-tauri\src\services\resource_service.rs`
  - 改 1 个方法 `list(kind)` → `list_with_active_root(kind, active_root_dir)` (新签名,旧签名作为 thin wrapper 保留向后兼容)
  - `detail()` / `reveal()` 不动(跟 active root 无关,前者只对 path 校验 `..`,后者是 platform trait)
  - 加 2 个新 test: `list_with_active_root_none_reads_user_dotclaude` + `list_with_active_root_some_reads_project_dotclaude`

- `D:\project\winui3\src-tauri\src\commands\resource.rs`
  - 改 1 个 `#[tauri::command]`: `list_resources` 调 `list_with_active_root(active_root.as_deref())`
  - `get_resource_detail` / `reveal_in_file_manager` 不动

- `D:\project\winui3\src-tauri\src\services\marketplace_service.rs`
  - 改 3 个方法 `install_resource` / `install_builtin` / `install_npx` 接收 `active_root_dir: Option<&Path>`
  - 加 3 个新方法 `install_resource_with_active_root` / `install_builtin_with_active_root` / `install_npx_with_active_root`(新签名,旧签名作为 thin wrapper 保留向后兼容)
  - `clone_and_scan` / `list_builtin_repos` 不动(纯 read / 常量)
  - `install_third_party` 改签名接受 active_root,内部 delegate 到 `_with_active_root`
  - 加 `MarketplaceError::RootNotFound(PathBuf)` variant(写路径 root 不存在拒绝)
  - 加 3 个新 test: `install_resource_with_active_root_none` / `install_resource_with_active_root_some` / `install_resource_rejects_missing_root`
  - 已有的 18 个 test 全部不动 / 旧签名保留 → 无破坏性

- `D:\project\winui3\src-tauri\src\commands\marketplace.rs`
  - 改 4 个 `#[tauri::command]`: `install_from_marketplace` / `install_builtin_plugin` / `install_third_party_repo` / `install_npx_package` 都读 `active_root.as_deref()` 并传下去
  - `list_marketplace_repos` / `clone_and_scan` 不动(纯 read / 缓存)

- `D:\project\winui3\src-tauri\src\services\usage_service.rs`
  - 改 1 个方法 `get_usage` / `get_snapshot_only` / `get_history_only` / `refresh` 内部新增 active_root 解析,加 4 个 `_with_active_root` 方法(新签名,旧签名保留)
  - 内部 helper `compute_usage_for_window` 加 active_root 参
  - 已有的 8 个 test 全部不动(旧签名保留)
  - 加 2 个新 test: `get_usage_with_active_root_none` / `get_usage_with_active_root_some`

- `D:\project\winui3\src-tauri\src\commands\usage.rs`
  - 改 3 个 `#[tauri::command]`: `get_current_usage` / `get_usage_history` / `refresh_usage` 都读 `active_root.as_deref()` 并传下去

## 新增文件 (0 个)

## 严禁改动 (再次确认)
- ❌ platform/ 层 (M3.10 已就位, 不动)
- ❌ 其他 plugin 的 commands/services (本次只动 F16 / F17 / F7)
- ❌ 前端代码 (前端 invoke 接口不变,后端路由到不同根目录透明)
- ❌ SPEC.md (实现参考文档, 不可改)
- ❌ 任何"既然要改 F16 顺便清理 X"
- ❌ 自动 mkdir 未知 root (marketplace 写路径安全边界, 测试 3 显式断言拒绝)
- ❌ `app_state.rs` (services 的 constructor 签名不变,新行为通过 command 层的 active_root 路由)
- ❌ `resource_detail` / `IPlatformReveal` / `IPlatformPaths` / `IPlatformGit` trait

## 测试代码
- F16: 2 个新 test 在 `services/resource_service.rs` 的 `#[cfg(test)] mod tests` 内
- F17: 3 个新 test 在 `services/marketplace_service.rs` 的 `#[cfg(test)] mod tests` 内
- F7: 2 个新 test 在 `services/usage_service.rs` 的 `#[cfg(test)] mod tests` 内
- 全部不创建独立测试文件,符合 CLAUDE.md §2.4 最小化影响原则

## 旧签名兼容策略
- 3 个 service 各自保留原方法签名(不加 `Option<&Path>` 参的版本),作为 thin wrapper delegate 到新签名,这样:
  - 已有 18 + 8 个 test 全部不破坏
  - future 内部 helper 也能继续用旧签名
  - command 层是唯一接入点(CLAUDE.md §3.2 分层原则)

## Review / 白名单文件
- 自审: `D:\project\winui3\tmp\reviews\m3.12-f16-f17-f7-services-self.md`
- 白名单: 本文件
