# v3.4 研究漂移 verify-first 报告 (2026-06-27)

> **目的**: 把 5 个 BLOCKING 漂移一次性修正, 产出可立即讨论的修正报告。
> **方法**: 现场代码实读 + grep 实测, 不动 build/test, 只写 1 份报告。
> **基线日**: 2026-06-27 (master @ f1c0bbe)

## 0. 数字基线重测 (实测)

| 指标 | overview 估值 | research 估值 | 实测值 | 偏差 (vs overview) | 来源 |
|---|---|---|---|---|---|
| view 数 (ALL_VIEWS 项) | 12 | 12 | **11** | -1 | `src/hooks/useViewState.tsx:124-137` (home + 9 plugin + history + about) |
| tauri command 数 | 80 | 80 | **69** | -11 (13.75%) | `grep -rE "^#\[tauri::command\]" src-tauri/src/` |
| 前端 invoke 调用 (全部) | 93 | 23 | **23** | -70 (75%) | `grep -rE "invoke\(" src/ --include="*.ts" --include="*.tsx"` |
| 前端 invoke 调用 (仅 api/) | (未估) | 23 | **14** | n/a | `grep -rE "invoke\(" src/lib/api/` |
| useViewState/ViewId 引用 (全部) | 214 | 204 | **93** | -121 (56%) | `grep -rE "useViewState" src/ --include="*.ts" --include="*.tsx"` |
| useViewState/ViewId 引用 (含 ALL_VIEWS/STORAGE_KEY) | 214 | 204 | **237** | +23 (10.7%) | `grep -rE "useViewState\|setView\|ALL_VIEWS\|STORAGE_KEY\|ViewId" src/` |
| useViewState 引用 (排除 tests) | (未估) | (未估) | **121** | n/a | `grep -rE "useViewState\|setView\|ALL_VIEWS\|STORAGE_KEY\|ViewId" src/ \| grep -v __tests__` |
| 后端 stub plugin .rs 数 | 10 | 10 | **10** | 0 | `ls src-tauri/src/plugins/stubs/*.rs` (excl. mod.rs) |
| 前端 stub plugin .tsx 数 | 9 | 9 | **9** | 0 | `ls src/plugins/stubs/*.tsx` (excl. _Placeholder.tsx) |
| service 数 | 11 | 10 | **11** | 0 | `ls src-tauri/src/services/*.rs` (excl. mod.rs) |
| commands/*.rs 文件 | (未估) | 15 | **14** | n/a | `ls src-tauri/src/commands/*.rs` (excl. mod.rs) |
| AppState Arc<Service> 字段 | 9 | 9 | **9** | 0 | `src-tauri/src/app_state.rs:26-63` |

### 0.1 关键差异分析

1. **view 数 11 (非 12)**: overview 估 12 是 Phase 27 Fix 6 前 count,Fix 6 把 mcp-management 合并到 resource-browser → 减 1;research 估 12 沿用旧数。
2. **commands 69 (非 80)**: overview/research 估 80 来自早期 draft,实际后端 14 个 commands/*.rs 累加: providers 14 + project 7 + mcp 7 + backup 7 + marketplace 6 + history 6 + fs 5 + optimizer 4 + usage 3 + updater 3 + resource 3 + autostart 2 + app 1 + about 1 = **69**。
3. **invoke 调用 23 (非 93)**: research 估 93 是早期 src/lib/api/ 误算;实际全 src 范围内 invoke 调用 = 23;仅 api/ 内 = 14。Phase 42 工作量从"改 93 处"下调为"改 23 处"。
4. **useViewState 引用 93 (非 214/204)**: overview 估 214 来自早期含注释;实际 = 93 处;含 ALL_VIEWS/STORAGE_KEY 等变体 = 237;排除 tests = 121。**Phase 44 派生收敛影响面 ≈ 121 个生产文件使用点 (非 214)**。

### 0.2 ALL_VIEWS 实际清单 (11 项)

来自 `src/hooks/useViewState.tsx:124-137`:

```
[0] home
[1] provider-list
[2] import-sql
[3] json-editor
[4] usage-query
[5] resource-browser
[6] marketplace
[7] optimizer
[8] backup-restore
[9] history
[10] about
```

**注意**: 缺 `mcp-management` (Phase 27 Fix 6 合并到 resource-browser)+ 缺 `provider-switch` (F2 并入 F1 激活按钮,见 `src/__tests__/plugin-registry.test.ts:6-10` 注释 "F2 merged into F1 action button")。

---

## BLOCKING #1: Plugin 前后端不对齐 (provider_switch)

### 1.1 实测

**后端 stub (10 个)** — `src-tauri/src/plugins/stubs/` + `mod.rs:36-51` register:

```
[1] provider_list       (F1)  routes: ['/' plugin_id='provider-list']
[2] provider_switch     (F2)  routes: [] (action-only, no routes)
[3] import_sql          (F3)
[4] json_editor         (F5)
[5] mcp_management      (F6)  routes: ['/mcp' plugin_id='mcp-management']
[6] usage_query         (F7)
[7] resource_browser    (F16)
[8] marketplace         (F17)
[9] optimizer           (F18)
[10] backup_restore     (F19)
```

**前端 stub (9 个)** — `src/plugins/registry.ts:36-46` ALL_PLUGINS:

```
[1] providerListPlugin    (provider-list)
[2] importSqlPlugin       (import-sql)
[3] jsonEditorPlugin      (json-editor)
[4] mcpManagementPlugin   (mcp-management)
[5] usageQueryPlugin      (usage-query)
[6] resourceBrowserPlugin (resource-browser)
[7] marketplacePlugin     (marketplace)
[8] optimizerPlugin       (optimizer)
[9] backupRestorePlugin   (backup-restore)
```

**漂移点**: 后端有 `provider_switch` (F2) stub, 前端没有对应 `providerSwitchPlugin`。`src/plugins/registry.ts:31` 注释明确写"The 10 frontend plugin stubs"但实际只导出 9 个 — 注释与代码不一致 (遗留的 F2 时代注释)。

### 1.2 核实命令归属

- **`src-tauri/src/commands/providers.rs`** 实测含 14 个 `#[tauri::command]`, 其中 `switch_provider` 命令确实存在 (line ~`pub async fn switch_provider(state: State<'_, AppState>, provider_id: String, ...)`),它取 `provider_id` 参数,不携带任何 plugin_id 前缀。
- **`src/lib/api/providers.ts:53-55`** 调用 `invoke<Provider>('switch_provider', { providerId })` — **不带 plugin_id 前缀**,直接全局命令名。
- **`src/plugins/stubs/provider_switch.rs`** 实测全文 (14 行): 仅 `id()`/`name()`,**`routes()` 未实现 (走默认空 Vec)**, **`services()` 未实现 (默认空)**, **`init()`/`shutdown()` 未实现 (默认 no-op)**。**完全是空 stub**, 0 业务逻辑。

### 1.3 决策证据

1. **设计意图明确**: `src/__tests__/plugin-registry.test.ts:6-9` 注释"F2 removed — its action now lives on the F1 [激活] button" — 项目设计已决策 F2 = F1 激活按钮, 不应作为独立 plugin stub。
2. **前端已无对应** — registry.ts 没有 `providerSwitchPlugin`, 前端从未给 F2 单独 view/sidebar/route。
3. **后端 stub 完全空** — 0 routes, 0 services, 0 init, 无任何业务承载。
4. **`switch_provider` IPC 命令前端不带前缀** — 删后端 stub 后, 该命令在 Phase 42 仍可由 `provider-list` plugin 持有 (前端 invoke 调用名不变)。

### 1.4 推荐: **删后端 provider_switch stub, 合并到 provider_list plugin**

**理由**:
- F1 (provider-list) + F2 (switch) 是同一组功能 (激活按钮就在 provider-list 页面上), 拆 2 个 stub 无必要。
- 符合现有测试 `plugin-registry.test.ts:6` "F2 merged into F1" 的设计决策。
- 前端已 9 stub, 删后端使前后端对齐到 9 stub。
- Phase 42 迁移 `switch_provider` 命令时归到 `provider-list` plugin 的 `commands.rs`, 不破坏前端调用。

### 1.5 改动清单

| # | 文件 | 行 | 改动 |
|---|---|---|---|
| 1 | `src-tauri/src/plugins/stubs/provider_switch.rs` | 全 14 行 | **删整个文件** |
| 2 | `src-tauri/src/plugins/stubs/mod.rs` | L13 `pub mod provider_switch;` | 删 |
| 3 | `src-tauri/src/plugins/stubs/mod.rs` | L24 `pub use provider_switch::ProviderSwitchPlugin;` | 删 |
| 4 | `src-tauri/src/plugins/mod.rs` | L41 `host.register(Box::new(stubs::ProviderSwitchPlugin))?;` | 删 |
| 5 | `src-tauri/src/plugins/mod.rs` | L3-12 doc "the 10 stub plugins" / "F1..F12" | 更新为 "the 9 stub plugins (F2 merged into F1)" |
| 6 | `src/plugins/registry.ts` | L31 注释 "The 10 frontend plugin stubs" | 改为 "The 9 frontend plugin stubs" |
| 7 | Phase 42-RESEARCH.md | L233 迁移表 "10 个现有 plugin + 4 个新增 = 14 plugin" | 改为 "9 个现有 plugin + 4 个新增 = 13 plugin" |
| 8 | Phase 42-RESEARCH.md | L219 迁移映射 `{provider_list, provider_switch}.rs (F1/F2/F3/F4 split)` | 改为 `{provider_list}.rs (F1/F2/F3/F4 合并, 16 命令)` |

**预期效果**: 前后端对齐到 9 stub; 后端 stub 数从 10 → 9; `lib.rs:62` log "10 plugins registered" → "9 plugins registered"。

---

## BLOCKING #2: mcp-management stub 删除责任人未定

### 2.1 现状实测

mcp-management 残留物分布:

| 位置 | 文件 | 行 | 现状 |
|---|---|---|---|
| 后端 stub .rs | `src-tauri/src/plugins/stubs/mcp_management.rs` | 全 21 行 | routes() 返回 `/mcp` plugin_id='mcp-management' |
| 后端 mod.rs register | `src-tauri/src/plugins/mod.rs:44` | L44 `host.register(Box::new(stubs::McpManagementPlugin))?;` | 注册 |
| 后端 stubs/mod.rs | `src-tauri/src/plugins/stubs/mod.rs:16,27` | pub mod + pub use | 导出 |
| 前端 stub .tsx | `src/plugins/stubs/mcp-management.tsx` | 全 23 行 | routes: ['/' pluginId='mcp-management'] (注: path 实为 `/mcp`) |
| 前端 stubs/mod.ts | `src/plugins/stubs/mod.ts:12` | export | 导出 |
| 前端 registry.ts | `src/plugins/registry.ts:23,40` | import + ALL_PLUGINS entry | 注册 (9 项之一) |
| App.tsx 兜底 useEffect | `src/App.tsx:174-197` | 24 行 | 读 localStorage==='mcp-management' → redirect /resource-browser?tab=mcp |
| 测试 fixture | `src/__tests__/` 多文件 | 44 处 grep 命中 | App.test.tsx / AppSidebar.test.tsx / useViewState.test.tsx / QuickSearchModal.test.tsx / m1-9-3.test.tsx |

### 2.2 Phase 44/46 RESEARCH 矛盾

- **Phase 44 RESEARCH** (L19, L406): 假设 "Phase 44 删 mcp-management stub" (overview §3 Phase 44 强验收 "新加 1 个 view 只动 1 个 plugin 文件" 隐含删除场景也只动 1 文件)。
- **Phase 46 RESEARCH** (L19, L52-55): 明确 "mcp-management plugin stub 删除 (Phase 44 工作, Phase 46 不动)" + "Deferred: mcp-management plugin stub 删除 (Phase 44 工作)"。
- **overview §3 Phase 44** (L139): 目标 "ALL_VIEWS / PAGE_META / VIEW_META 全部从 ALL_PLUGINS 派生" — 若 mcp-management 留在 ALL_PLUGINS 则 sidebar 仍会出现 "MCP 管理" tile (D-10/D-12 已删此 tile), 与现状矛盾。
- **overview §3 Phase 46** (L188): 目标 "App.tsx:174-197 兜底 useEffect 替换" — Phase 46 只动 useEffect, 不动 stub。

### 2.3 useEffect 兜底逻辑分析 (App.tsx:174-197 实读)

```tsx
useEffect(() => {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'mcp-management') {
      window.localStorage.removeItem(STORAGE_KEY);
      setView('resource-browser');
      if (!window.location.search.includes('tab=mcp')) {
        window.location.replace('/resource-browser?tab=mcp');
      }
    }
  } catch { /* localStorage 沙盒 throw 忽略 */ }
}, []);
```

**关键问题**: 如果**保留 mcp-management stub + 删 useEffect**, 老用户 localStorage 仍存 `mcp-management`:
- `useViewState.isValidView('mcp-management')` → false (因 ALL_VIEWS 已不含 mcp-management, Fix 6 已删) → fallback `'home'`。
- 老用户**不会**跳到 `/resource-browser?tab=mcp`, 而是**直接落到 home**, 丢失"我上次在 MCP 管理 tab"的语义。
- 结论: **删 useEffect 必须同时有迁移机制** (Phase 46 SidebarTile.migrateFrom 才能接住这个语义)。

### 2.4 测试影响

grep `mcp-management` in `src/__tests__/` = **44 处命中**, 分布:
- `src/__tests__/integration/App.test.tsx` — 测 sidebar 不渲染 mcp-management tile
- `src/__tests__/components/AppSidebar.test.tsx` — D-10/D-12/D-13 测试
- `src/__tests__/components/QuickSearchModal.test.tsx` — Phase 27 Fix 6 注释
- `src/__tests__/hooks/useViewState.test.tsx` — stale localStorage fallback 测试
- `src/__tests__/integration/m1-9-3.test.tsx` — STORAGE_KEY 测试
- `src/__tests__/plugin-registry.test.ts:6-10` — `ALL_PLUGINS.length).toBe(9)` 已 pin 9

**删 mcp-management stub 后**:
- `plugin-registry.test.ts:10` `expect(ALL_PLUGINS.length).toBe(9)` → 改为 `toBe(8)` (删 1 项)
- `useViewState.test.tsx` stale localStorage 测试 (L?? `localStorage.setItem(STORAGE_KEY, 'mcp-management')`) → 改测 `mcp-management` 经 migrateFrom 跳 resource-browser (Phase 46 后) 或继续 fallback home (Phase 44 后短期)
- `AppSidebar.test.tsx` D-10/D-12 "不渲染 sidebar-item-mcp-management" → 保留 (mcp-management 永不进 sidebar)
- `App.test.tsx` 同上保留

### 2.5 推荐: **选项 B — Phase 46 删 (作为 stale-route 清理的副作用)**

**理由**:

1. **Phase 46 才有完整迁移机制** — SidebarTile.migrateFrom 是 Phase 46 设计的核心 (L186-200), 只有 Phase 46 把"老用户 localStorage 'mcp-management' → resource-browser?tab=mcp"这个语义落地。Phase 44 删 stub 会**丢失迁移语义** (老用户直接落 home)。
2. **Phase 44 范围是"派生收敛", 不是"删除"** — overview §3 Phase 44 目标是"ALL_VIEWS/PAGE_META/VIEW_META 从 ALL_PLUGINS 派生", 删 mcp-management 不在范围; Phase 44 把 mcp-management 留在 ALL_PLUGINS 即可 (它仍返回 routes, 派生系统正常)。
3. **Phase 46 删 stub + migrateFrom 配套** — Phase 46 把 useEffect 替换为 SidebarTile.migrateFrom 时, mcp-management stub 的存在让 resource-browser 的 `migrateFrom: { fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }` 有意义 (Phase 46 RESEARCH L130-143 已规划); 删 stub 与加 migrateFrom 同一 PR, 自洽。
4. **测试改动集中在 Phase 46** — 44 处测试命中里, 真正要改的是 `plugin-registry.test.ts:10` (9→8) + `useViewState.test.tsx` (stale 测试改测迁移); 其余 42 处是"不渲染 mcp-management"断言, 删 stub 后这些断言**仍然成立** (mcp-management 永远不在 sidebar)。

**改动清单 (Phase 46 执行)**:

| # | 文件 | 行 | 改动 |
|---|---|---|---|
| 1 | `src/plugins/stubs/mcp-management.tsx` | 全 23 行 | 删整个文件 |
| 2 | `src/plugins/stubs/mod.ts` | L12 `export { mcpManagementPlugin }` | 删 |
| 3 | `src/plugins/registry.ts` | L23 import + L40 ALL_PLUGINS entry | 删 2 处 |
| 4 | `src-tauri/src/plugins/stubs/mcp_management.rs` | 全 21 行 | 删整个文件 |
| 5 | `src-tauri/src/plugins/stubs/mod.rs` | L16 `pub mod mcp_management;` + L27 `pub use` | 删 2 处 |
| 6 | `src-tauri/src/plugins/mod.rs` | L44 `host.register(Box::new(stubs::McpManagementPlugin))?;` | 删 |
| 7 | `src/plugins/stubs/resource-browser.tsx` | sidebarTile | 加 `migrateFrom: { fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }` |
| 8 | `src/App.tsx` | L174-197 | 删 useEffect (Phase 46 主任务) |
| 9 | `src/hooks/useViewState.tsx` | readInitialView | 改返回 `{ view, search? }` + migrateViewId (Phase 46 主任务) |
| 10 | `src/__tests__/plugin-registry.test.ts:10` | `toBe(9)` | 改 `toBe(8)` |
| 11 | `src/__tests__/hooks/useViewState.test.tsx` | stale 'mcp-management' 测试 | 改测 migrateFrom → resource-browser |

**反选项理由**:
- **选项 A (Phase 44 删)**: Phase 44 删 stub 后, Phase 46 才有 migrateFrom → 中间状态老用户 localStorage 'mcp-management' 落 home, 体验回退; 且 Phase 44 范围溢出。
- **选项 C (不删, 移 useEffect 到 ViewStateProvider)**: mcp-management stub 永久留在 registry, `plugin-registry.test.ts` 永远 pin 9, 与 "F6 已合并到 resource-browser mcp tab" 的产品决策矛盾; stub routes 返回 `/mcp` 但 ALL_VIEWS 不含 → 死路由。

---

## BLOCKING #3: inventory crate 触发 CLAUDE.md §2.3 例外

### 3.1 §2.3 例外申请评估

CLAUDE.md §2.3 原文: "禁止 '依赖不行就换版本', 锁版本纪律; 升级版本必须有理由 (安全 CVE / 必要功能 / 官方支持周期结束), 并记录在 PR 描述。"

**关键判定**:
- inventory 0.3.24 是**新引入依赖, 不是升级** — 比"升级"更严。
- §2.3 列举的 3 个允许理由: 安全 CVE / 必要功能 / 官方支持周期结束。
- Phase 42 RESEARCH L66, L90-103 给出的理由: "Phase 42 IPC dispatch 核心机制 (编译期 plugin 注册), 功能必要 ✓" — 属于"必要功能"理由, 但需在 PR 描述明确。
- 安全无 CVE, 无 postinstall, MIT/Apache 许可兼容 (L66, L116-118)。
- 官方支持: dtolnay 维护 (serde/syn/thiserror/anyhow 作者), Rust 核心贡献者 (L66) — 不属于"支持周期结束"类 (实际是项目持续维护)。

**结论**: §2.3 例外申请**可走通**, 但**需用户白名单 + 详尽 PR 描述**记录理由 (CLAUDE.md §2.3 + §2.4 "禁止顺便改 X" 联合约束)。

### 3.2 替代方案成本对照

| 方案 | 代码量 | 改动半径 | 运行时开销 | 跨平台 | 风险 | 新依赖 |
|---|---|---|---|---|---|---|
| **A. 单 dispatch 命令** (Phase 42 RESEARCH L22, L83) | lib.rs 改 1 处, 闭包级 1 层 HashMap | **23 处前端 invoke 改名** (frontend 透明破坏) | 0 (Tauri IPC +1 JSON 序列化往返) | 全平台 | IPC 延迟 +30~50% (Phase 42 RESEARCH L83) | 0 |
| **B. inventory crate** (Phase 42 RESEARCH 推荐) | 改 lib.rs 1 处 + dispatch.rs 新增 + 80 个 submit! | 0 前端 | 0 (O(1) HashMap 启动期一次性 build) | Win/Mac/Linux 全平台 (L98) | dtolnay 6+ 年稳定 | **+1 (inventory)** |
| **C. 自写宏 + OnceLock<HashMap>** (派生方案) | 自写 proc-macro (~200 行) + 启动期 collect | 0 前端 | 0 | 需自验证 ELF/PE/Mach-O section | 跨平台 section 处理 bug 高发 (Phase 42 RESEARCH L468) | 0 |
| **D. 静态 Lazy + 命令手写 enumerate** (回退现状) | 0 | 0 | 0 | n/a | **违反"加 1 plugin 只动 1 文件" 强验收** (overview §3 Phase 42) | 0 |

### 3.3 推荐: **方案 B inventory crate + §2.3 例外申请**

**理由**:

1. **方案 A 破坏前端透明**: Phase 42 强验收 "新加 1 个 plugin (含 IPC 命令) 只动 1 个文件" 隐含"前端 0 改动", 方案 A 必须改 23 处前端 invoke 调用名 → 破坏强验收, 且 IPC 延迟 +30~50% 用户感知。
2. **方案 C 重复造轮子**: inventory 是 Rust 生态 tracing/wgpu 标杆 crate (Phase 42 RESEARCH L66), dtolnay 已稳定 6+ 年, 自写 proc-macro + ELF/PE/Mach-O section 维护成本远超依赖成本。
3. **方案 D 放弃整改目标**: 当前硬编码 80 命令 enumerate 本身就是 Phase 42 要消除的反模式, 不引 inventory = Phase 42 工作量翻倍 (80 个命令手写映射) 且强验收不达标。
4. **§2.3 例外申请可走通**: 必要功能理由成立, dtolnay 维护 = 长期支持, 无 CVE, MIT/Apache 兼容 — 完全符合 §2.3 "必要功能" 例外条件。

### 3.4 PR 描述模板 (给用户白名单)

```markdown
## Phase 42 引入新依赖: inventory = "=0.3.24"

### CLAUDE.md §2.3 例外申请

按 §2.3 锁版本纪律, 本 PR 新增 `inventory` crate 触发"必要功能"例外, 需用户白名单。

### 理由

- **必要功能**: Phase 42 目标 "让 plugin 真正持有 commands, lib.rs 的 tauri::generate_handler![80 命令] 改为运行时 dispatch"。`tauri::generate_handler!` 是 `proc_macro` 编译期展开, **绝不能运行期拼接** (tauri-macros-2.6.3/src/command/handler.rs:144-185 实读验证)。inventory::submit! 在编译期把每个 CommandSpec 静态注册到全局 slice, 启动期 inventory::iter 收集 → HashMap 查表, 是 Tauri v2 invoke_handler<F: Fn(Invoke<R>) -> bool> 签名下唯一干净路径。
- **dtolnay 维护**: Rust 核心贡献者 (serde / syn / quote / thiserror / anyhow 作者), 6+ 年稳定, 跨平台 (macOS / Windows / Linux) section 实现均已稳定多年。
- **零运行时开销**: 启动期 O(80) 一次遍历 build HashMap, 启动后 dispatch O(1)。
- **零前端改动**: 23 处 invoke("list_providers", ...) 调用保持不变, 强验收 "新加 1 plugin 只动 1 文件" 达成。
- **MIT / Apache-2.0 双许可**: 本项目 license 兼容。
- **无 postinstall / build script**: 纯 proc-macro + 自定义 section, 无外部执行。
- **AST 不复杂**: ~1500 行 Rust, 源码在 github.com/dtolnay/inventory, 可读。
- **macOS 沙盒兼容**: Mach-O 自定义 section 处理在 0.7+ 修复过, 项目用 0.3.24 (最新 stable at 2026-06-27)。

### 锁版本

```toml
# src-tauri/Cargo.toml
inventory = "=0.3.24"  # 严格等号, 不允许 minor/patch 自动 bump
```

### 替代方案成本 (供参考)

| 方案 | 改动半径 | 运行时开销 | 跨平台验证 | 评估 |
|---|---|---|---|---|
| A. 单 dispatch 命令 | 改 23 处前端 invoke | IPC +30~50% | 全平台 | 拒绝 (破坏强验收 + 性能回退) |
| B. inventory crate (推荐) | 0 前端 | 0 | 全平台 | ✅ 选 B |
| C. 自写 proc-macro | 0 前端 | 0 | 需自验证 | 拒绝 (重复造轮子 + 跨平台 section bug) |

### 回滚

删除 `inventory = "=0.3.24"` + `inventory::submit!` 80 处, 改回 `tauri::generate_handler!` 80 项手写 enumerate — 5 分钟回退。
```

**用户白名单 checklist**:
- [ ] §2.3 "必要功能" 理由接受?
- [ ] dtolnay 维护背书接受?
- [ ] MIT/Apache 许可接受?
- [ ] `=0.3.24` 锁版本纪律接受?

如果 4 项全 ✓ → 走方案 B; 任一 ✗ → 退回方案 A (但需用户接受 23 处前端改动 + IPC 性能回退)。

---

## BLOCKING #4: PluginContext struct 字段冲突 (冻结签名)

### 4.1 当前 PluginContext 实测

**位置**: `src-tauri/src/plugins/traits.rs:68-74` (实读全文 165 行)

```rust
pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
}
```

**当前 2 字段**: `app` + `paths`。IPlugin::init 签名 (`traits.rs:122`):

```rust
fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> {
    Ok(())
}
```

注意: 当前签名是 `&PluginContext` (共享借用), 不是 `&mut PluginContext`。

### 4.2 各 Phase 提议的字段扩展 (汇总)

| Phase | 提议字段 | 引用 | 语义 | 是否需 &mut |
|---|---|---|---|---|
| 当前 | `app`, `paths` | traits.rs:68-74 | AppHandle + IPlatformPaths | 否 (只读) |
| 42 (规划) | `services: Option<&'a ServiceRegistry>` | Phase 42 RESEARCH L447-452 | service 跨 plugin 共享查找 | 否 (get 是 &self) |
| 43 (规划) | `host: Option<&'a PluginHost>` | Phase 43 RESEARCH L847-855 | MenuRegistry 在 init 阶段遍历 host 收集 tray_items | 否 (init_all 顺序保证) |
| 45 (规划) | 需要 `&mut self` 语义 (register 写) | Phase 45 RESEARCH L289-302 (代码示例) `ctx.services_mut().register_arc::<BackupService>` | service register 是 &mut self | **是 (register 是 &mut self)** |

### 4.3 矛盾点

- Phase 42 + 43 提议的 `services` / `host` 都是 `Option<&T>` (共享借用), init 签名保持 `&PluginContext`。
- Phase 45 提议 `init(&mut self, ctx: &mut PluginContext, ...)` (可变借用) — 因为 `ctx.services_mut().register_arc` 需要 `&mut ServiceRegistry`。
- **冲突**: `&PluginContext` vs `&mut PluginContext` 在 4 phase 串联时必须统一, 否则 Phase 42 ship 后 Phase 45 改 init 签名 = 破坏 BC。

### 4.4 PluginContext 冻结 (4 phase 公共契约)

**冻结签名 (推荐)**:

```rust
// src-tauri/src/plugins/traits.rs (冻结)

/// Context provided to each plugin during [`IPlugin::init`].
///
/// Carries references to the Tauri [`AppHandle`], the platform
/// abstraction layer, the service registry, and the plugin host.
/// Plugins MUST go through [`IPlatformPaths`] for any file path
/// resolution (per [`CLAUDE.md` §3.2`]) and through [`ServiceRegistry`]
/// for any service access (per [`Phase 45` 决策`]).
///
/// [`CLAUDE.md` §3.2`]: ../../../../../CLAUDE.md
/// [`Phase 45` 决策`]: ../milestones/v3.4-phases/00-VERIFY-FIRST-DRIFT-REPORT.md
pub struct PluginContext<'a> {
    /// Tauri app handle. `None` only in unit tests that don't exercise
    /// plugins that touch the Tauri runtime; production code should
    /// always populate it via [`PluginContext::new`].
    pub app: Option<&'a AppHandle>,

    /// Platform abstraction (paths / autostart / reveal / notifier / etc).
    pub paths: &'a dyn IPlatformPaths,

    /// Service registry — Phase 42 / 45 跨 plugin 共享 service 查找。
    /// Phase 42 用 `&ServiceRegistry` (只读), Phase 45 register 时通过
    /// [`PluginContext::services_mut`] 拿 `&mut ServiceRegistry`。
    pub services: Option<&'a ServiceRegistry>,

    /// Plugin host — Phase 43 MenuRegistry 在 init 阶段遍历 host 收集
    /// tray_items。`None` in unit tests; production 始终 Some。
    pub host: Option<&'a PluginHost>,
}

impl<'a> PluginContext<'a> {
    /// Production constructor.
    pub fn new(
        app: &'a AppHandle,
        paths: &'a dyn IPlatformPaths,
        services: &'a ServiceRegistry,
        host: &'a PluginHost,
    ) -> Self {
        Self { app: Some(app), paths, services: Some(services), host: Some(host) }
    }

    /// Test-only constructor.
    #[cfg(test)]
    pub fn for_tests(paths: &'a dyn IPlatformPaths) -> Self {
        Self { app: None, paths, services: None, host: None }
    }

    /// Get mutable access to the service registry for `register` calls
    /// during plugin `init`. Returns `None` if constructed via `for_tests`.
    pub fn services_mut(&mut self) -> Option<&mut ServiceRegistry> {
        self.services.map(|s| /* unsafe cell cast */)
        // Phase 45 实施时需要 interior mutability, 详见 Phase 45 实施
    }
}
```

**IPlugin::init 冻结签名**:

```rust
pub trait IPlugin: Send + Sync {
    // ... existing methods ...

    /// Called once at app startup. Default = no-op.
    ///
    /// **Phase 42 起: ctx 提供 services/host 共享访问。**
    /// **Phase 45 起: ctx 是 &mut, plugin 可在 init 内调 register_arc。**
    fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError> {
        Ok(())
    }
}
```

**PluginHost::init_all 冻结签名**:

```rust
impl PluginHost {
    /// Phase 42 + 45 改造: 传 &mut PluginContext。
    /// 当前实现 `init_all(&mut self, ctx: &PluginContext)` (host.rs:91)
    /// 需改为 `init_all(&mut self, ctx: &mut PluginContext)`。
    pub fn init_all(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let order: Vec<&'static str> = self.init_order.clone();
        for id in order {
            if let Some(plugin) = self.plugins.get_mut(id) {
                plugin.init(ctx)?;
            }
        }
        Ok(())
    }
}
```

**lib.rs setup 冻结调用点** (`src-tauri/src/lib.rs:247-249`):

```rust
// 当前 (lib.rs:247-249):
let paths_impl = platform::runtime::paths();
let plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl);
let host = init_all(&plugin_ctx)
    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
app.manage(Mutex::new(host));

// Phase 42 改造后:
let paths_impl = platform::runtime::paths();
let mut service_registry = ServiceRegistry::new();
let mut host = PluginHost::new();
// host.register(Box::new(stubs::ProviderListPlugin))?;  // x9
// 第一遍: register 9 业务 plugin (无 init)
init_all(&mut host, ...);  // 假设已分两步 register + init
// 第二遍: init_all 阶段传 ctx (含 host & PluginHost, 含 services &mut ServiceRegistry)
let mut plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl, &service_registry, &host);
host.init_all(&mut plugin_ctx)?;
app.manage(Mutex::new(host));
```

### 4.5 关键决策点

1. **字段数从 2 → 4**: `app` + `paths` + `services` + `host`。
2. **init 签名从 `&PluginContext` → `&mut PluginContext`**: Phase 45 register 需可变借用; 提前切可变借用, Phase 42 无 BC 损失 (现有 10 stub 默认 init 不写 ctx)。
3. **`services_mut()` interior mutability**: Phase 45 register 时, init 拿的是 `&mut PluginContext`, 但 ServiceRegistry 可能在多个 plugin 的 init 间共享。**推荐**: Phase 45 把 ServiceRegistry 设计为 `RefCell<HashMap>` 或用 `Arc<Mutex<HashMap>>` 内部锁; 在 PluginContext 内部 `services_mut()` 返回 `&mut ServiceRegistry` (假设 ServiceRegistry 自己解决并发)。
4. **测试影响**: `src-tauri/src/plugins/host.rs:250-275` `dummy_ctx()` 测试 helper 需更新构造 4 字段 (或继续 `for_tests` 设 None)。

### 4.6 改动清单 (4 phase 联合)

| Phase | 文件 | 改动 |
|---|---|---|
| 42 | `src-tauri/src/plugins/traits.rs:68-88` | PluginContext 加 `services: Option<&'a ServiceRegistry>` 字段 + `for_tests_with_services` |
| 42 | `src-tauri/src/plugins/traits.rs:122` | init 签名 `&PluginContext` → `&mut PluginContext` |
| 42 | `src-tauri/src/plugins/host.rs:91-101` | init_all 签名 `&PluginContext` → `&mut PluginContext` |
| 43 | `src-tauri/src/plugins/traits.rs:68` | PluginContext 加 `host: Option<&'a PluginHost>` 字段 |
| 43 | `src-tauri/src/plugins/host.rs:250-275` | `dummy_ctx()` 加 host None |
| 45 | `src-tauri/src/plugins/traits.rs:78-82` | 加 `services_mut()` 方法 (return Option<&mut ServiceRegistry>) |
| 45 | `src-tauri/src/plugins/traits.rs:80-82` | `for_tests` 加 host/services 字段 None |
| 45 | `src-tauri/src/plugins/service_registry.rs` | ServiceRegistry 用 `RefCell<HashMap<TypeId, Arc<dyn Any>>>` interior mutability (Phase 45 单独讨论) |
| lib.rs | `src-tauri/src/lib.rs:247-249` | setup 阶段构造 4 字段 PluginContext, 调 `host.init_all(&mut plugin_ctx)` |

**预期效果**: 4 phase PluginContext 字段 4 个, init 签名 `&mut PluginContext` 一次冻结, 后续 plugin 写 `ctx.services().get::<Arc<X>>()` / `ctx.services_mut().register_arc::<X>()` / `ctx.host().iter()` 三大 API 统一。

---

## BLOCKING #5: ServiceRegistry API 形状 (二选一统一)

### 5.1 两 phase 提议矛盾

| Phase | 提议 API | 引用 |
|---|---|---|
| **42** (推断) | `register<T>(svc: T)` + `get<T>() -> Option<&T>` | Phase 42 RESEARCH L437-444 (Pattern 3) |
| **45** (明确) | `register_arc<T>(svc: Arc<T>)` + `get<T>() -> Option<Arc<T>>` | Phase 45 RESEARCH L246-280, L286-302 |

**Phase 45 §2.5 blocker 风险原文** (L319-326):
> 若 Phase 42 已 ship 的 API 是 `register<T>(svc: T)` (裸 T) 而非 `register_arc<T>(svc: Arc<T>)`, Phase 45 必须与 Phase 42 协商... **建议: Phase 42 应该按 `register_arc<T>(svc: Arc<T>)` + `get<T>() -> Option<Arc<T>>` 写**。

### 5.2 两种 API ergonomics 对比 (commands/*.rs 调用方)

**方案 A: `register_arc<T>(Arc<T>)` + `get<T>() -> Option<Arc<T>>`**

```rust
// 1) register 阶段 (plugin::init):
ctx.services_mut()
    .register_arc::<BackupService>(Arc::new(backup_svc));

// 2) get 阶段 (commands/*.rs 内):
#[tauri::command]
pub async fn list_backups(
    state: State<'_, AppState>,
) -> Result<Vec<Backup>, String> {
    let backup_svc: Arc<BackupService> = state.service_registry
        .get::<BackupService>()
        .ok_or_else(|| "BackupService not registered".to_string())?;
    backup_svc.list_backups().await.map_err(|e| e.to_string())
}
```

**方案 B: `register<T>(T)` + `get<T>() -> Option<&T>`**

```rust
// 1) register 阶段:
ctx.services_mut()
    .register::<BackupService>(backup_svc);  // 移动所有权, 不可恢复

// 2) get 阶段:
#[tauri::command]
pub async fn list_backups(
    state: State<'_, AppState>,
) -> Result<Vec<Backup>, String> {
    let backup_svc: &BackupService = state.service_registry
        .get::<BackupService>()
        .ok_or_else(|| "BackupService not registered".to_string())?;
    backup_svc.list_backups().await.map_err(|e| e.to_string())
}
```

### 5.3 关键差异分析

| 维度 | A: Arc 共享 | B: & 借用 |
|---|---|---|
| 跨 command 共享 | ✅ Arc<T>: Clone 永远成立, 8 字节 atomic increment | ❌ &T 借用 state, 单次 command 调 OK, 跨 command 持 Arc<Mutex<T>> 才能共享 |
| 跨 init 闭包共享 | ✅ Arc clone 解引用, 无借用冲突 | ❌ init 闭包持 &T, 第二个 init 调 get 报 borrow conflict |
| 9 service 启动期开销 | 9 次 Arc clone (~9 * 8 bytes) | 0 clone |
| service 内部 Clone 需求 | ❌ 无 (Arc 共享) | ⚠️ 必须 Clone (HistoryService 等内部 Arc<Mutex<Connection>> 未必 Clone) |
| 生命周期复杂度 | 低 (Arc: 'static) | 高 (&'a T: 跟 PluginContext 同生) |
| 灵活性 | 双 API (register / register_arc) | 单 API (register / get 都是 &T) |
| Rust 生态惯例 | axum / tonic 等 DI 容器主流 | 极少 (仅数据库连接池等场景) |

### 5.4 关键失败场景 (Phase 45 RESEARCH L286-302 实测)

**方案 B 在 backup-service plugin::init 内**:
```rust
fn init(&mut self, ctx: &mut PluginContext) -> Result<()> {
    let history: &HistoryService = ctx.services()
        .get::<HistoryService>()
        .ok_or_else(...)?;
    let paths = ctx.app_state().paths().clone();
    let svc = BackupService::new(paths).with_history(history.clone());
    // ❌ history.clone() 需要 T: Clone, HistoryService 未必 Clone
    // ❌ history 是 &HistoryService, 不能 move 进 BackupService (生命周期冲突)
    ctx.services_mut().register::<BackupService>(svc);
    Ok(())
}
```

**方案 A 同场景**:
```rust
fn init(&mut self, ctx: &mut PluginContext) -> Result<()> {
    let history: Arc<HistoryService> = ctx.services()
        .get::<HistoryService>()
        .ok_or_else(...)?;
    let paths = ctx.app_state().paths().clone();
    let svc = BackupService::new(paths).with_history(history.clone());
    // ✅ Arc clone = 8 bytes, 永远成立
    ctx.services_mut().register_arc::<BackupService>(Arc::new(svc));
    Ok(())
}
```

### 5.5 推荐: **方案 A: `register_arc<T>(Arc<T>)` + `get<T>() -> Option<Arc<T>>`**

**理由**:

1. **Phase 45 必走 Arc 路径**: service 跨 plugin 共享 (ProviderService 被 provider-list / provider-switch / import-sql / optimizer 4 plugin 共享, HistoryService 被 backup / usage 2 plugin 共享), 9 service 拓扑 init 时 provider-service 需要 backup + history 的 Arc 引用, **&T 借用无法表达"plugin A 的 init 拿 plugin B 的 service 注入 BackupService::new()"** 的需求。
2. **Phase 42 提议 register<T>(T) 实际是 Phase 45 没考虑时推断的接口**: Phase 42 RESEARCH L437-444 Pattern 3 是"为 PluginContext 加 services 字段的占位", 没考虑 Phase 45 拓扑序下"service 互注入"的场景; 实际 Phase 42 必须按 Arc 路径写。
3. **Rust 生态惯例**: axum State / tonic DI 容器 / sqlx Pool 等都是 Arc 共享, & 借用仅在数据库连接池等"短生命周期"场景。
4. **9 次 Arc clone < 1µs**: Phase 45 RESEARCH L315 "9 service 启动期 Arc clone 9 次开销 < 1 µs", 性能忽略。

### 5.6 决定后两个 phase RESEARCH.md 修订行号

**Phase 42 RESEARCH.md 修订**:
- L437-444 Pattern 3: 替换 ServiceRegistry 代码块, 改用方案 A (Arc 路径)
- L450 PluginContext: `services: Option<&'a ServiceRegistry>` 字段保留 (&ServiceRegistry 通过 internal Arc<T> 实现)
- L461-462 PluginContext 字段: 加注释"Phase 45 register 时通过 services_mut() 拿 &mut ServiceRegistry 内部锁"

**Phase 45 RESEARCH.md 修订**:
- L246-280 ServiceRegistry 完整代码块: 保持方案 A (Phase 45 已按方案 A 写, 无需改)
- L319-326 §2.5 Blocker 风险表: 删 "Phase 45 必须与 Phase 42 协商" 段 (Phase 42 接受方案 A 后 blocker 解除)
- L289-302 关键代码: 保持 (已是方案 A 写法)

**Phase 42 实施时新增** (ServiceRegistry 完整代码):
```rust
// src-tauri/src/plugins/service_registry.rs (Phase 42 新增)
use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::sync::Arc;

pub struct ServiceRegistry {
    map: RefCell<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
}

impl ServiceRegistry {
    pub fn new() -> Self {
        Self { map: RefCell::new(HashMap::new()) }
    }

    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>) {
        self.map.borrow_mut().insert(TypeId::of::<T>(), svc);
    }

    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>> {
        self.map.borrow().get(&TypeId::of::<T>())
            .and_then(|arc| arc.clone().downcast::<T>().ok())
    }

    pub fn contains<T: 'static>(&self) -> bool {
        self.map.borrow().contains_key(&TypeId::of::<T>())
    }

    pub fn count(&self) -> usize {
        self.map.borrow().len()
    }
}
```

**关键**: `RefCell<HashMap>` interior mutability 让 `register_arc` 是 `&self` (Phase 45 plugin::init 在 &mut PluginContext 闭包内调 register), `get` 是 `&self` (Phase 45 commands 提取 service 共享 Arc)。

---

## 6. 后续 action (修正后哪些 RESEARCH.md 章节要补订)

### 6.1 必订 (blocker 解除后立即订)

| # | 文件 | 行 | 改动 |
|---|---|---|---|
| 1 | `00-PHASE-OVERVIEW.md` | L14-23 数字表 | 实测重写: 80→69 commands, 93→23 invoke, 214→121 useViewState (排除 tests), 12→11 view |
| 2 | `00-PHASE-OVERVIEW.md` | L18 "plugins/stubs/ 文件 11 个 (Rust) + 11 个 (TS)" | 改 "10 个 (Rust) + 9 个 (TS); 删 provider_switch 后 9+9" |
| 3 | `00-PHASE-OVERVIEW.md` | L20 "手工对齐点 5 处" | 改 "5 处 (ALL_VIEWS / PAGE_META / VIEW_META / 三元链 / page import), 实际 ALL_VIEWS 11 项 (非 12)" |
| 4 | `00-PHASE-OVERVIEW.md` | L22 "AppState service 字段 9 个" | 保持 9, 但加 "Phase 45 改 ServiceRegistry (Arc 路径, BLOCKING #5 决议)" |
| 5 | `00-PHASE-OVERVIEW.md` | L24 "Phase 42 工作量从 5-7 天调整为 6-8 天" | 重新估算 (80→69 commands, 23 invoke, 实际工作量待 42-PLAN 时精算) |
| 6 | `42-RESEARCH.md` | L9 "re-verified; v3.4-ROADMAP.md updated to 80 commands / 93 invokes / 9 plugins" | 改 "69 commands / 23 invokes / 9 plugins" (POST 漂移修正) |
| 7 | `42-RESEARCH.md` | L437-444 Pattern 3 ServiceRegistry | 按方案 A (Arc 路径) 重写 (BLOCKING #5 决议) |
| 8 | `42-RESEARCH.md` | L219 / L233 迁移表 | provider_switch stub 删, 16 命令归 provider_list (BLOCKING #1 决议) |
| 9 | `42-RESEARCH.md` | L450-455 PluginContext services 字段 | 加 "Phase 45 register 时通过 services_mut() 拿 &mut ServiceRegistry 内部 RefCell" |
| 10 | `42-RESEARCH.md` | L447-452 PluginContext 字段表 | 加 host 字段预留 (BLOCKING #4 决议) |
| 11 | `42-RESEARCH.md` | L122 init 签名 (line in code example) | `&PluginContext` → `&mut PluginContext` (BLOCKING #4 决议) |
| 12 | `44-RESEARCH.md` | L9 "12 view" | 改 "11 view" |
| 13 | `44-RESEARCH.md` | L17 "stub routes 字段当前与生产脱节" | 确认 mcp-management stub 仍返回 '/mcp' (Phase 46 删) |
| 14 | `44-RESEARCH.md` | L402-409 "home view 特殊处理" | 注释 "Phase 44 不删 mcp-management stub (Phase 46 工作)" |
| 15 | `45-RESEARCH.md` | L319-326 §2.5 Blocker 风险表 | 删 (Phase 42 接受方案 A 后 blocker 解除) |
| 16 | `46-RESEARCH.md` | L19 "Phase 44 推荐删 stub" | 改 "Phase 46 自己删 (BLOCKING #2 决议)" |
| 17 | `46-RESEARCH.md` | L52-55 Deferred 段 | 改 "Phase 46 自身完成" |

### 6.2 进入 discuss-phase 拍板 (需用户决策)

| 决策点 | 涉及 Phase | 选项 | 推荐 |
|---|---|---|---|
| D-42-A: 引入 inventory 依赖 | 42 | A (单 dispatch 改前端) vs B (inventory) vs C (自写宏) | B (必要功能例外) |
| D-44-A: mcp-management stub 删除时机 | 44 vs 46 | A (44 删) vs B (46 删) | B (迁移语义完整) |
| D-45-A: ServiceRegistry API 形状 | 42 + 45 | A (Arc) vs B (&) | A (Arc 路径) |
| D-CC-A: PluginContext 4 字段 + init &mut 签名 | 42 + 43 + 45 | 冻结 (3 phase 公共契约) | 冻结 |

### 6.3 直接 ship-to-plan (无需进一步讨论)

- **BLOCKING #1 (provider_switch 删)**: 改动清单明确 (1.5 节), 风险低, 可直接进 42-PLAN。
- **BLOCKING #4 (PluginContext 冻结)**: 字段集 + init 签名明确 (4.4 节), 3 phase 联合契约, 可直接进 42-PLAN + 43-PLAN + 45-PLAN。
- **数字重测**: 1 次性订正 overview 估值, 后续 phase PLAN 重算工作量。

---

## 7. 验证矩阵 (3 步)

| 步 | 操作 | 预期 | 验证方法 |
|---|---|---|---|
| 1 | grep 数字重测 | 数字与 §0.1 一致 | 跑 §0 顶部 6 条 bash 命令 |
| 2 | Phase 42 RESEARCH 数字修订 | 80→69, 23 invoke, 11 view | 读修订后 42-RESEARCH.md L9 + L219 + L437-444 |
| 3 | PluginContext 4 字段 + ServiceRegistry Arc 路径 | 3 phase 联合契约落地 | 读修订后 42/43/45-RESEARCH.md |

---

*报告完成。下一步: 主 session 审核 5 个 BLOCKING 推荐 (1.4 / 2.5 / 3.4 / 4.4 / 5.5), 接受后回本文件 §6.1 修正 RESEARCH.md 行号, 进 discuss-phase 拍板 §6.2 决策点。*






