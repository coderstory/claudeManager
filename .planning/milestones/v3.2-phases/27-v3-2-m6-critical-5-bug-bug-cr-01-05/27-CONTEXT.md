# Phase 27: v3.2 M6 critical 5 bug 修复 - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

修复 v3.0.1 M5 ship 后用户实测 ClaudeManager.app 发现的 5 个 critical bug 反馈（拆为 6 个独立 fix，因为 #8/#10/#12 同根 = 1 fix），同时合并 F6 MCP 管理到 F16 资源浏览 MCP 节点。

**Phase 27 实际修复清单**（实测反馈 11 条 → 预排 slot 映射，按"映射决策 C"）：

| Fix | slotID | 实测反馈 # | 简述 | 严重度 | 模块 |
|---|---|---|---|---|---|
| 1 | BUG-CR-01 (重定义) | #1 | 鼠标按住 header 不能拖动窗口 | P1 | 自定义 chrome / platform::window_chrome |
| 2 | BUG-CR-02 (重定义) | #2/#6/#7 | 用量三件套共根：SQL MIN() column type Null + 7 天趋势只查当天 1 条 + 刷新用量静默失败 | P0 | F7 UsageService + 21-history 集成 |
| 3 | BUG-CR-03 (重定义) | #4 | JSON 编辑器打开报错 "无法解析路径 /Users/coderstory/providers/default.json:api_key" | P0 | F5 JSON 编辑器 + F18 配置优化 |
| 4 | BUG-CR-04 (重定义) | #8/#10/#12 | scope 切换失效三件套：MCP 切到项目级不读 / JSON 树切不到 user 级 / 资源浏览切到项目级仍显示用户级 | P0 | 顶层 zustand scope state + 3 个组件 useEffect 漏依赖 |
| 5 | BUG-CR-05 (重定义) | #11 | SQL 导入勾选 1 个 → 提示导入 6 个（破坏 CLAUDE.md §1 核心价值"切换绝不出错"）| P0 | F3 SQL 导入 / sql-validator |
| 6 | BUG-CR-06 (新增) | 合并重构 | F6 MCP 管理顶级菜单 → F16 资源浏览 MCP 子节点（路由 + 侧边栏 + 入口 + 默认 tab） | 业务重构 | F6 + F16 合并 |

**剩余实测反馈不进 phase 27**（按映射决策 C 推到 phase 28）：
- #5 资源浏览 plugins 数据源错 → BUG-BZ-01
- #9 JSON 编辑器目录树默认折叠 → BUG-BZ-02

**预排 ROADMAP.md BUG-CR-01~05 原始定义作废**（slotID 重新映射到实测反馈，原内容记入 v3.2.1 backlog）：
- 原 BUG-CR-01 (F2 switch atomic) / BUG-CR-02 (F13 备份可恢复) / BUG-CR-03 (sqlite read settings) / BUG-CR-04 (F2 round-trip) / BUG-CR-05 (F18 finding 过期) → v3.2.1 backlog

**In scope**:
- 6 个 fix 各加 1 个 vitest + 1 个 Playwright e2e spec
- 修 MCP 路由合并 + 侧边栏清理
- 不动预排的 F2 switch atomic / F13 backup / sqlite read / F18 finding 过期（保留 v3.2.1 backlog）

**Out of scope**:
- phase 28 业务 bug（#5 #9 已规划）
- phase 29 重构 bug（保留 v3.2.1）
- phase 30 UI-A 类 5 bug（保留 v3.2.1）
- FTS5 全文搜索 / 云备份 / updater UI（已废弃）
- M4 e2e 既有 15/15 场景的回归（由 test-all 6 阶段保证，不重写）

</domain>

<decisions>
## Implementation Decisions

### 1. scope 状态修复策略（fix 4: #8 #10 #12）
- **D-01:** 用 zustand `subscribeWithSelector` middleware 重构顶层 scope state 为 atom
- **D-02:** 新增 `useScope` hook（`src/hooks/useScope.ts`）统一封装 `scope + projectRoot + setScope`
- **D-03:** 3 个受影响组件 (`McpPanel` / `JsonEditorTree` / `ResourceBrowser`) 改 `key={scope + projectRoot}` 强制重 mount
- **D-04:** MCP 合并后（fix 6），`/resource-browser` 路由默认展开 MCP tab，`useScope` 在 ResourceBrowser 顶层订阅
- **D-05:** 后端不动（保留 R2 决策：state 管理在顶层，service 层接受 scope 入参已经存在）

### 2. 用量三件套共根（fix 2: #2 #6 #7）
- **D-06:** 3 个反馈同根 — 1 份 query fix 解决：`UsageService::get_trend_7day` 重写
- **D-07:** SQL `MIN()` 列类型错改用 `COALESCE(MIN(recorded_at), 0) AS first_recorded_at`（cast integer 显式）
- **D-08:** 时间窗默认 30 天 + `GROUP BY strftime('%Y-%m-%d', recorded_at, 'unixepoch')` 按天聚合
- **D-09:** refresh IPC 写库后立即 `SELECT COUNT(*)` verify + toast 显示实际行数（CLAUDE.md §7 不静默吞错）

### 3. MCP 合并重构（fix 6）
- **D-10:** 删除 `/mcp-management` 路由（`src/router/index.tsx` 移除导入 + 路由表）
- **D-11:** `ResourceBrowser` 顶层加 tab 结构：plugins / prompts / agents / mcp（默认 mcp）
- **D-12:** 侧边栏删除 "MCP 管理" 入口（`src/components/sidebar/index.tsx`）
- **D-13:** 老用户入口兼容：`<Navigate from="/mcp-management" to="/resource-browser?tab=mcp" replace />`（保留 1 个里程碑后删除）
- **D-14:** 数据 schema 不合并：F6 独立 SQLite 表 `mcp_servers` 保留，`ResourceBrowser` 读 `ResourceService::list_mcp(scope)` 转发

### 4. SQL 导入数量错（fix 5: #11）
- **D-15:** SQL parser 改"1 INSERT = 1 provider"语义（不管 VALUES 多少行）
- **D-16:** 加 dedup 唯一键 `UNIQUE(provider_name, source_path)` 防御重复写入
- **D-17:** "导入 N 个" 提示统计 distinct provider（不是 row count）
- **D-18:** 前端勾选 → 传 selected provider ID list，后端按 ID 查回对应实体

### 5. JSON 编辑器路径错（fix 3: #4）
- **D-19:** 路径和 field 拆 IPC 参数 `(path: String, field: Option<String>)` 两个独立字段
- **D-20:** 虚拟路径协议用双冒号 `path::field`（前端传参时显式 join）
- **D-21:** 后端解析先 split `::`，再分别处理 path 和 field

### 6. header 拖动（fix 1: #1）
- **D-22:** header 容器加 `data-tauri-drag-region` + CSS `-webkit-app-region: drag`
- **D-23:** 按钮（菜单/主题切换/最小化）加 `-webkit-app-region: no-drag`
- **D-24:** macOS 平台检查 vibrancy 模式下 `decorations: false`（避免重复 title bar 抢 drag）

### 7. 测试覆盖
- **D-25:** 每个 fix 加 1 个 vitest 单元 + 1 个 Playwright e2e spec（决策 T2）
- **D-26:** 5 fix → 5 新 e2e 场景，ship gate 从 15/15 → 20/20
- **D-27:** 集成测试复用 phase 21 已有 `rusqlite` fixture（不重写 SQLite 测试 setup）
- **D-28:** e2e 新场景命名 `tests/e2e/m6-p27-{fix-name}.spec.ts`

### 8. 修法时序
- **D-29:** 5 subagent 并行（D11 限 4 槽 → 2 批：第 1 批 4 subagent 派 fix 1/2/3/4，第 2 批 1 subagent 派 fix 5；fix 6 跨 fix 4 跟在第 2 批里）
- **D-30:** 主 session 负责后续 rebase 协调（按修改文件互不重叠原则分配 slot）
- **D-31:** 修法顺序：fix 1 (CSS 独立) → fix 2 (F7 独立) → fix 3 (F5 独立) → fix 4 + fix 6 (F6+F16 联动，第 2 批) → fix 5 (F3 独立)
- **D-32:** 每个 subagent 必须遵守 CLAUDE.md §10（不联网 / 不用内置 WebFetch）

### 9. 不做（明确排除）
- 不重写 F2 switch atomic / F13 backup 可恢复 / sqlite read settings 缺表 / F18 finding 过期（原 CR-01~05 预排内容）—— 推到 v3.2.1 backlog
- 不动 phase 28/29/30 已规划 bug（#5 plugins / #9 目录树折叠等）
- 不重写 F7 5min cache（不动，只修 query 逻辑）
- 不重写 zustand store（只加 middleware，不重构既有 slice）

### 10. Claude's Discretion
- 单元测试 fixture 复用 `src-tauri/src/services/` 既有 test helper
- Playwright e2e spec 走 M1.8 已建框架（`tests/e2e/`）
- vitest mock 模式：Rust IPC mock 用 `@tauri-apps/api` mock 模板
- `useScope` hook API 形态：返回 `[scope, setScope, projectRoot, setProjectRoot]` 4-tuple
- 5 fix 原子 commit message 风格：沿用 M5 模式 `fix(27-{n}): {description}`
- 路由表修改走 `src/router/index.tsx` 既有模式

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规则
- `CLAUDE.md` §1 项目核心价值 ("Provider 切换 1 秒搞定，绝不出错") — D-18 触发
- `CLAUDE.md` §2.2 TDD 强制 + §5.3 e2e ship gate — D-25~D-27
- `CLAUDE.md` §3.2 OS 抽象层 (window_chrome 平台分离) — fix 1
- `CLAUDE.md` §6.5 显示名 vs 系统标识分层 — 跟本 phase 无关但需保持
- `CLAUDE.md` §7 内存/状态纪律 ("不允许静默吞错") — D-09 触发
- `CLAUDE.md` §10 主 session 不亲自跑命令 — D-32 触发
- `CLAUDE.md` §12.2 sccache 加速 — subagent 编译用

### 规划文档
- `.planning/ROADMAP.md` Phase 27-30 — 原预排 bug 列表（本 phase 重新映射后原 CR-01~05 推到 v3.2.1 backlog）
- `.planning/REQUIREMENTS.md` v3.2 — 同上
- `.planning/STATE.md` 顶部 v3.2 milestone context — 全局规划说明
- `.planning/PROJECT.md` — 项目背景 / 核心价值

### prior CONTEXT 参考
- `.planning/phases/21-m46-sqlite-history/21-CONTEXT.md` — SQLite history schema (D-27 触发，复用 rusqlite fixture)
- `.planning/phases/18-m1-l1-playwright-e2e-windows-only/18-CONTEXT.md` — Playwright e2e 框架 (D-28 触发)

### 技术栈参考
- M5 ship commits (Phase 23-26) — 33 bug 修完的 commit 风格作为本 phase 参考
- `src-tauri/src/platform/traits.rs` IPlatformWindowChrome / IPlatformPaths — fix 1 / fix 4 触发
- `src-tauri/src/services/usage_service.rs` UsageService — fix 2
- `src-tauri/src/services/mcp_service.rs` McpService — fix 4 + fix 6
- `src-tauri/src/services/import_sql.rs` SQL 导入 — fix 5
- `src/pages/resource-browser/index.tsx` ResourceBrowser — fix 4 + fix 6
- `src/pages/mcp-management/index.tsx` McpManagement — fix 6（待删除）
- `src/router/index.tsx` — fix 6（路由表）
- `src/components/sidebar/index.tsx` — fix 6（侧边栏入口）
- `src/stores/scope.ts` (假设) — fix 4 (zustand scope state)

### SPEC
- `./SPEC.md` §5 设计规范 — UI 颜色 / 间距 / 字号基线（不直接相关，保持遵守）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 21 SQLite history fixture** (`src-tauri/src/services/usage_service.rs` 测试 setup): D-27 复用
- **Playwright e2e 框架** (`tests/e2e/m4-{name}.spec.ts`): D-28 沿用
- **vitest `@tauri-apps/api` mock 模板** (`src/__tests__/helpers/`): D-25 沿用
- **M5 fix commit message 风格**: D-29 沿用

### Established Patterns
- **M5 phase 23-26 33 bug 修法模式**: 5 fix atomic commit + test-all 6 阶段 PASS + M4 e2e 15/15 保持 → D-25~D-28 沿用
- **CLAUDE.md §3.2 OS 抽象层**: window_chrome / paths 已分平台，fix 1 / fix 4 不破坏 → D-22~D-24 约束
- **M5 subagent 4 槽并发 (D11)**: 5 fix 拆 2 批 → D-29~D-31 沿用
- **sccache 跨平台项目级 config** (`src-tauri/.cargo/config.toml`): subagent 编译自动用 → CLAUDE.md §12.2

### Integration Points
- **F7 用量查询** ↔ **Phase 21 SQLite history** (`src-tauri/src/services/usage_service.rs`): fix 2 重写 query 时需保持 Phase 21 schema 兼容
- **F6 MCP 管理** ↔ **F16 资源浏览**: fix 6 合并后 `/resource-browser?tab=mcp` 接管
- **F5 JSON 编辑器** ↔ **F18 配置优化**: fix 3 路径错在两个页面共享调用 → 改一处全修
- **顶层 zustand scope state** ↔ **3 个组件 (McpPanel / JsonEditorTree / ResourceBrowser)**: fix 4 重构 store + 强制重 mount

</code_context>

<specifics>
## Specific Ideas

### 用户实测反馈原文（11 条 2026-06-26）

1. **#1 header 不可拖动**: "鼠标按住 header 不能拖动窗口"
2. **#2 用量 SQL 类型错**: "用量查询页面报错 加载失败: sqlite error: Invalid column type Null at index: 0, name: MIN(recorded_at)"
3. ~~#3 备份详情全屏~~ ❌ 用户忽略（已有全屏按钮）
4. **#4 JSON 编辑器路径错**: "配置与优化，点击打开 json 编辑器报错 读取失败: 无法解析路径 /Users/coderstory/providers/default.json:api_key: No such file or directory (os error 2)"
5. **#5 资源浏览 plugins 数据源错**: "资源浏览 -plugins 当前列表里显示的压根不是 claude 定义的插件" → **不进 phase 27，进 phase 28**
6. **#6 用量趋势按天只查当天**: "用量趋势 (按天) 只能显示当天数据 也只查询到了一条 明显不对 存在历史数据的"
7. **#7 刷新用量无效**: "暂无 7 天趋势数据 — 刷新用量后会写入 SQLite 我点了刷新还提示这个"
8. **#8 MCP 项目级 scope 未读**: "MCP 管理切换到项目级，没有读取项目中的 mcp"
9. **#9 JSON 目录树默认折叠**: "json 编辑器的左侧目录树 需要支持展开和折叠 默认是折叠的" → **不进 phase 27，进 phase 28**
10. **#10 JSON 目录树切不到 user 级**: "json 编辑器的左侧目录树 不能正确切换到用户级的目录"
11. **#11 SQL 导入数量错**: "SQL 导入我实际勾选一个，导入后提示我导入 6 个"
12. **#12 资源浏览 scope 切换不响应**: "切换到项目级后，资源浏览显示的还是用户级"

### MCP 合并决策（2026-06-26）
"mcp 管理功能要合并到资源管理中的 mcp 中" — 合并到 `ResourceBrowser` 顶层 tab

### 实测 vs 预排错位（meta 决策）
- ROADMAP.md 预排 BUG-CR-01~05 是 F2 switch atomic / F13 backup / sqlite read / F2 round-trip / F18 finding 过期
- 实测 11 条 P0/P1 跟预排完全不重叠
- 用户拍板"实测映射到预排阶段 (C)" — 重新定义 slotID

### 测试策略选择（T2）
"坚持 T2 (你刚选的)" — 每个 fix 加 vitest + 1 个 Playwright e2e，ship gate 15/15 → 20/20

### 修法时序选择（P1）
"(P1) 5 subagent 并行 (限 4 槽)" — 5 subagent 2 批：4+1

</specifics>

<deferred>
## Deferred Ideas

### v3.2.1 backlog（实测未发现 + 预排原内容）
- 原 BUG-CR-01: F2 switch atomic backup → write → reload Claude 不报错
- 原 BUG-CR-02: F13 备份可恢复（字节级一致）
- 原 BUG-CR-03: sqlite read settings 缺表 / 解析错容错 → Settings::empty() 而非 panic
- 原 BUG-CR-04: F2 switch UI round-trip 后 is_active 状态正确反映
- 原 BUG-CR-05: F18 finding timestamp 过期检测 + 重新扫描触发器
- 原 BUG-BZ-01 ~ BUG-BZ-07: 7 个原规划业务 bug
- 原 BUG-RF-01 ~ BUG-RF-09: 9 个原规划重构 bug
- 原 UI-A-01 ~ UI-A-05: 5 个原规划 UI-A bug

### phase 28 业务 bug 候选
- #5 资源浏览 plugins 数据源错 → BUG-BZ-01
- #9 JSON 编辑器目录树默认折叠 → BUG-BZ-02

### 跨 phase 决策（不属 phase 27 范畴）
- v3.0 round 3 废弃项（云备份 / updater UI / M4.6 长尾）保持废弃
- FTS5 全文搜索 / SQLCipher 加密 / 跨 process SQLite 共享 — 独立 backlog

</deferred>

---

*Phase: 27-v3.2 M6 critical 5 bug 修复*
*Context gathered: 2026-06-26*
</content>
</invoke>