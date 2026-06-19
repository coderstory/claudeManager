# M2 路线图草案（M2 Roadmap Draft — for User Review）

> 阶段：M2 业务功能期
> 起草日期：2026-06-20（M1.12 收尾时）
> 输入：SPEC.md §F1~F24 + CLAUDE.md §3.3 plugin 契约 + M1 已知限制（见 `docs/reviews/m1-12-final-audit.md` §3 R1~R15）
> 状态：**草案待用户核定**。M2.1 启动前需主 session 拍板 3 个决策（见 §6）。

---

## 1. M2 范围

M2 = **12 plugin stubs 改为真实业务实现**（CLAUDE.md §3.3 plugin 接口契约，路径 `src-tauri/src/plugins/stubs/*.rs` + `src/plugins/stubs/*.tsx` → `src/pages/<id>/index.tsx`）。

**SPEC.md §F1~F24 共 24 个 F**，M2 范围"**至少**实现 F1 + F2 + F5 + F6 这 4 个高频"，其余 8 个（M2.2~2.12）按 §3 优先级排程。

| Plugin ID | F 编号 | 名称 | M2 优先级 |
|---|---|---|---|
| `provider_list` | F1 | Provider 列表 | **P0** |
| `provider_switch` | F2 | Provider 切换 | **P0** |
| `import_sql` | F3 | .sql 导入 | P2 |
| `deeplink_import` | F4 | deeplink 导入 | P2 |
| `json_editor` | F5 | JSON 编辑 | **P0** |
| `mcp_management` | F6 | MCP 管理 | **P0** |
| `usage_query` | F7 | 用量查询 | P1 |
| `single_file_deploy` | F8 | 单文件部署 | P3（M3 公证前不做） |
| `resource_browser` | F16 | 资源浏览 | P3 |
| `marketplace` | F17 | 在线安装 | P3 |
| `optimizer` | F18 | 配置优化 | P3 |
| `backup_restore` | F13 / F19 | 备份与恢复 | P1（F19 与 F2 切换强耦合） |

> **P0** = 启动候选 4 个；**P1** = M2 中期；**P2** = M2 后期；**P3** = M2.5+ 或 M3。

---

## 2. 优先级理由

### 2.1 P0 选 F1 + F2 + F5 + F6 的逻辑

按**用户使用频次 × 数据准备成本 × 架构杠杆** 三维度评分：

| Plugin | 使用频次（用户旅程） | 数据准备成本 | 架构杠杆 | 综合 |
|---|---|---|---|---|
| F1 Provider 列表 | **★★★★★**（每次启动 + 切换前必看） | 中（解析 settings.json） | 高（Provider domain 模型） | **首选** |
| F2 切换 | **★★★★★**（核心价值主张） | 高（原子 rename + 备份 + 切换历史） | 高（写盘原子性 + 备份体系） | **首选** |
| F5 JSON 编辑 | ★★★☆☆（高级用户） | 中（schema + Monaco） | 中 | 必备（无编辑 = 不可救场） |
| F6 MCP 管理 | **★★★★**（高频使用，但独立于 Provider） | 中（.mcp.json 解析） | 中（独立子系统） | 必备（独立价值） |
| F7 用量查询 | ★★★☆☆ | 高（HTTP + 缓存） | 中 | 次选（需要外部 API） |
| F13 备份 | **★★★★**（F2 强依赖） | 低（FS copy） | **极高**（CLAUDE.md §7 写盘原子性要求） | **F2 启动前必做** |

**为什么 P0 是这 4 个**：
1. **F1 + F2**：核心价值主张（"在多个 provider 间快速切换"），缺一不可
2. **F13 备份**：F2 切换的前置依赖（CLAUDE.md §7 "任何写盘操作必须先备份"），**实际上 F2 + F13 是一对**，建议 M2.1 把 F13 备份基础设施先做，M2.2 接 F2 切换
3. **F5 JSON 编辑**：救场工具（settings.json 损坏 / 高级用户手改），独立低耦合
4. **F6 MCP**：独立子系统（不依赖 Provider），并行做

### 2.2 不在 M2 P0 的原因

- **F3 .sql 导入 / F4 deeplink**：依赖 F1 已经能读 Provider 列表，且 SQL 解析器本身是独立工作（M2.3 启动条件 = F1 完成 + cc-switch SQL schema 已稳定）
- **F7 用量查询**：需要外部 API（Anthropic / OpenAI），CLAUDE.md §8 "Subagent 联网必须用 cs-web-fetch"，M2.1 不阻塞但需要先确认 API 配额
- **F8 单文件部署 / F16 / F17 / F18 / F23**：M2.5+ 或 M3 范围

---

## 3. 关键风险（M2 启动必须预案）

### 3.1 写盘原子性（CLAUDE.md §7 + SPEC §6.1）

**场景**：用户点 F2 切换 → 后端读 `settings.json` → 备份到 `backups/<timestamp>/` → 原子 rename 新配置 → 失败回滚

**风险**：
- 备份目录创建失败（权限 / 磁盘满）
- `atomic rename` 在 Windows 上不是真原子（ReplaceFile API 才能保证）
- rename 成功但后续 cleanup 失败，遗留垃圾

**预案**：
- 用 `tempfile::NamedTempFile` + `persist_noclobber` 走 atomic rename
- Windows 上用 `windows::Win32::Storage::FileSystem::ReplaceFileW`
- cleanup 失败不阻塞主流程（用 `tauri-plugin-log` 记录，CI 巡检）

### 3.2 备份版本管理（F13 / F19 / F24）

**场景**：用户切换 50 次 → 50 个 backup → 备份目录膨胀 → 历史查询慢

**风险**：
- 备份无 retention policy（100GB 备份盘满）
- 备份无索引（找"上周二 14:30 那次"靠 ls）
- 备份与当前 settings.json 内容对比无工具（F24）

**预案**：
- 默认保留最近 30 次 + 总大小上限 500MB
- 备份元数据进 SQLite（F13 用 `tauri-plugin-store`，F19/F24 用 `rusqlite` 独立 DB）
- F19 恢复 = 选 backup → 校验 SHA256 → 备份当前 → 原子 rename

### 3.3 Provider 切换并发安全

**场景**：用户同时点 "切换到 provider A" 两次 / 设置页 toggle autostart 同时触发 / 用量查询后台刷新读到中间态

**风险**：
- 两次并发切换 → 第二次读到第一次写一半的 state
- 后台读（usage query）与前台写（switch）冲突

**预案**：
- 后端 `ProviderService::switch()` 拿 `Mutex<ProviderState>` 锁，串行化所有写
- 读操作拿 `RwLock` 共享读
- 写操作走"读 → 校验 → 备份 → 写 → 校验"5 步，任一步失败回滚
- 前端 button disabled 状态反映 in-flight 操作

### 3.4 settings.json schema 演进

**场景**：Claude Code 升级 → settings.json 加新字段（如 `theme.darkMode`）→ 我们的 Provider 解析逻辑 panic

**风险**：
- serde derive 严格匹配 → 未知字段 panic
- 用户手动编辑后格式漂移

**预案**：
- 用 `#[serde(default)]` + `#[serde(deny_unknown_fields)]` 按域区分：Provider 域 deny（防止漂移），settings.json 全集 default（向前兼容）
- F5 JSON 编辑时实时 schema 校验（JSON Schema 2020-12）

### 3.5 macOS 真实路径（F2 在 Mac 上的 settings.json 路径）

**场景**：当前 macOS impl 全是 stub → F2 在 Mac 上点切换 → panic

**风险**：
- F2 在 Mac 上的 `~/.claude/settings.json` 路径解析可能跟 Windows 不一致
- Mac 上的 "atomic rename" 行为差异

**预案**：
- M2 启动前**必须**先做 Mac 真机验证（哪怕是 1 台 MacBook Air）
- 路径解析有 integration test（`tests/platform_paths.rs` 7 用例）覆盖 Mac stub
- Mac 真机接入前 F2 不上 ship

---

## 4. 估算

### 4.1 M2.1 启动前必做 3 件套（详见 §5）

| 任务 | 子 agent 数 | 时间 | 备注 |
|---|---|---|---|
| **3.1 PluginHost wiring** | 1 | 半天 | 把 12 stub 接到 `plugins/mod.rs::init_all`，同步 HANDOFF.json |
| **3.2 M1.10 收尾** | 1 | 1-2 天 | ci.yml 加 npm test / build / e2e；beforeBuildCommand；tsconfig strict 审计 |
| **3.3 M1.11 文档** | 1 | 1 天 | README.md + docs/ARCHITECTURE.md + AGENTS.md |
| **小计** | 3（并行） | **2 天** | 4 槽留 1 槽给主 session 决策 |

### 4.2 M2 P0 4 个 plugin

| 任务 | 子 agent 数 | 时间 | 备注 |
|---|---|---|---|
| **M2.1 F1 Provider 列表 + F13 备份基础设施** | 1 | 2-3 天 | Provider domain model + 解析 + 表格 UI + 备份 atomic rename 基础设施 |
| **M2.2 F2 Provider 切换** | 1 | 2 天 | 切换逻辑 + 切换历史 + 切换确认对话框 |
| **M2.3 F5 JSON 编辑** | 1 | 2-3 天 | Monaco 集成 + schema 校验 + 保存 |
| **M2.4 F6 MCP 管理** | 1 | 2 天 | .mcp.json 解析 + 启停控制 + 健康检查 |
| **小计** | 4（顺序：1→2 并行→3/4 并行） | **6-7 天** | F2 依赖 F1 + F13；F5/F6 独立可与 F2 并行 |

### 4.3 M2 P1 + P2（中期 + 后期）

| 任务 | 子 agent 数 | 时间 |
|---|---|---|
| M2.5 F7 用量查询 | 1 | 2-3 天 |
| M2.6 F3 .sql 导入 | 1 | 2-3 天 |
| M2.7 F4 deeplink 导入 | 1 | 1-2 天 |
| M2.8 F19 备份恢复 UI + F24 diff | 1 | 2-3 天 |
| M2.9 F11 快捷键 / F10 拖放 / F12 主题完善 | 1 | 1 天 |
| **小计** | 5（顺序 + 并行混合） | **8-10 天** |

### 4.4 总估算

- M2 P0 + P1 + P2 = **~18 个 subagent 任务 / 16-19 天**
- 4 槽上限 + 顺序依赖 ≈ **实际日历 25-30 天**
- 估算含集成测试 + e2e + smoke + ship，不含返工

---

## 5. M2 启动前主 session 必须拍板

### 5.1 决策 D1：M1.10 / M1.11 / M1.12 三件套优先级

- **选项 A**：先补齐三件套（2 天）再 M2.1
- **选项 B**：M2.1 与三件套并行（M2.1 = F1 + F13 备份基础设施；M1.10/1.11 走另外 2 槽）
- **选项 C**：跳过 M1.10/1.11 的文档化（CI 仍补，文档延后 M3）
- **推荐**：B（3 槽并发：F1 / M1.10 / M1.11）

### 5.2 决策 D2：M2 启动 4 个 plugin 的执行顺序

- **选项 A**：F1+F13 → F2 → F5 → F6（严格顺序，依赖清晰）
- **选项 B**：F1+F13 → (F2 || F5 || F6)（F1 完成即派 3 槽并行 F2/F5/F6）
- **选项 C**：F6 + F1 并行（两个独立子系统先动）→ F2 + F5 后接
- **推荐**：B（依赖清晰 + 最大化 4 槽利用率，符合 CLAUDE.md §11.3 流式派单）

### 5.3 决策 D3：是否启用 react-router 重新接入

- **选项 A**：保持 M1.9 的 `useViewState` 方案，M2.1 在 deeplink 时用 `useEffect + listen("deeplink")` 调 setView
- **选项 B**：M2.1 切到 react-router HashRouter，方便 F4 deeplink → URL → view 跳转
- **推荐**：A（M1 决策已经定，少改动；B 改动面大）

### 5.4 决策 D4（如果选 B/D2）：是否需要 Mac 真机验证 F1

- F1 只读 `~/.claude/settings.json`，路径解析走 `IPlatformPaths`，已有 integration test 覆盖
- 风险：Mac stub 的 `ensure_dirs` 是 `unimplemented!()`，如果 Mac 真机用户 F1 列不出 provider，会立刻被发现
- **建议**：M2.1 先 Windows ship，F2 启动前再决定 Mac 真机验证时机

### 5.5 决策 D5（独立项）：M1 全部 exe 是否一次性 batch approve

- 用户当前 ⏳ 待审 8 个 exe（M1.2 / M1.3-v3 / M1.4 / M1.5~1.9.2 合并）
- 选项：
  - **A**：逐个核定（保守，8 次往返）
  - **B**：batch 信任 subagent 报告，一次性过（激进，加速 M2 启动）
  - **C**：抽查 M1.9.2（最新 exe）+ M1.3 v3（最有风险的 fix），其余 trust
- **推荐**：C（最经济）

---

## 6. 待用户确认

> 本节是给主 session 的问题清单，每个问题对应一个 §5 决策。

1. **D1**：M2 启动前是否先补 M1.10/1.11？A / B / C？
2. **D2**：M2 4 个 P0 plugin 的执行顺序？A / B / C？
3. **D3**：是否启用 react-router？A / B？
4. **D5**：M1 exe 批量核定策略？A / B / C？

（4 个问题，每个回答 1-3 个选项，约 5 分钟决策。决策后主 session 派 3-4 个 subagent 并行启动 M2.1）

---

## 7. 附录：M2.1 F1 + F13 详细范围（待 D1/D2 拍板后启动 subagent）

### 7.1 F1 Provider 列表

**后端**：
- `src-tauri/src/domain/provider.rs`：`Provider` struct（id / name / base_url / api_key_env / model / created_at）
- `src-tauri/src/services/provider_service.rs`：`list_providers()` 读 `~/.claude/settings.json` → 解析 → 返回 `Vec<Provider>`
- `src-tauri/src/commands/provider.rs`：`#[tauri::command] list_providers() -> Vec<Provider>`
- `src-tauri/tests/provider_service.rs`：unit test + integration test（mock settings.json）

**前端**：
- `src/pages/provider-list/index.tsx`：表格 UI（DataTable from shadcn/ui or 手写）
- `src/hooks/useProviders.ts`：invoke('list_providers') + React Query / Zustand
- `src/__tests__/pages/provider-list.test.tsx`：渲染 + 排序 + 过滤

**业务逻辑要点**：
- Provider 唯一 id = settings.json 里的 key（如 `env.ANTHROPIC_BASE_URL` 的值）
- base_url 不为空 + api_key_env 非空 = "有效"
- 排序：created_at DESC（最新在顶）

### 7.2 F13 备份基础设施（M2.1 与 F1 同时做）

**后端**：
- `src-tauri/src/services/backup_service.rs`：
  - `backup_file(path: &Path) -> Result<PathBuf>`（读 → SHA256 → 写 `<backups_dir>/<timestamp>-<sha256[0..8]>-<filename>`）
  - `restore_file(backup: &Path) -> Result<()>`（校验 SHA256 → 备份当前 → 原子 rename）
  - `list_backups() -> Vec<BackupMetadata>`
  - `cleanup_old_backups(retention_count: usize) -> Result<usize>`
- `src-tauri/src/commands/backup.rs`：4 个 command
- `src-tauri/tests/backup_service.rs`：覆盖 atomic rename / SHA256 / retention

**前端（M2.8 才做 UI，M2.1 只做 backend）**：
- 无前端（M2.1 后端 ready，M2.8 F19 备份恢复 UI 调用）

**业务逻辑要点**：
- 备份目录 = `IPlatformPaths::backups_dir`（Windows: `%APPDATA%\ClaudeConfigManager\backups` / Mac: `~/Library/Application Support/ClaudeConfigManager/backups`）
- 默认 retention = 30
- 备份元数据写入 `backups_dir/index.json`（轻量，避免 SQLite 依赖）

### 7.3 PluginHost wiring（M2 启动前 3 件套之 1）

**后端**：
- `src-tauri/src/plugins/mod.rs::init_all`：遍历 12 stub → `PluginHost::register` → `init_all`
- 每个 stub 改 `IPlugin::init` 真实初始化（不是 no-op）
- `lib.rs` 加 `.setup(|app| { plugins::init_all(...); })`

**测试**：
- `src-tauri/tests/plugin_host.rs`：已覆盖 register / unregister / init order，新增 "all 12 plugins can register without panic"

---

*本文件由 M1.12 子代理在 worktree `agent-a31f4ddce79088ee7` 生成，等主 session 拍板 §5 决策后即启动 M2.1。*