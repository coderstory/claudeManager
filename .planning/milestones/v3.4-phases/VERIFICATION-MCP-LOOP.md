# VERIFICATION-MCP-LOOP — McpManagementPage 加载中死循环 (用户报告 / CLAUDE.md §16)

> **报告日期**：2026-06-30
> **调查分支**：worktree-agent-aed6148f40d2d344b (基于 master `0bc3130`)
> **结论**：**master 无 loop**,详见下方证据链。
> 用户报告的"加载中死循环"在 jsdom 测试环境下**无法复现**;可能是早期状态,
> 也可能是真 runtime (Tauri webview) 才出现的场景,需要用户亲自复现 + 提供操作步骤。

---

## 1. 问题陈述 (用户报告)

> "资源管理-mcp 依旧会在加载中死循环啊"

- **入口**: 点 sidebar "资源浏览" → ?tab=mcp → `ResourceBrowserPage` 渲染
  `<McpManagementPage />`
- **症状**: MCP 管理 UI 永远显示 "加载中…",`state.loading` 永不变成 `false`
- **频率**: 用户报告 100% 复现

## 2. 调查范围

按 CLAUDE.md §16 五步:

| # | 步骤 | 结果 |
|---|---|---|
| 1 | 了解详情 | 入口 + 路径已确认;真 IPC 流程:`useEffect [listMcpServers]` 在 mount 跑一次,resolve 后 `setState(loading: false)` |
| 2 | 明确原因 | **见 §3 真因排查** — 7 个测试覆盖所有可疑路径,全部 PASS |
| 3 | 明确边界 | 涉及文件:`pages/mcp-management/index.tsx` + `pages/resource-browser/index.tsx` + `hooks/useScope.ts` + `hooks/useProjects.ts` |
| 4 | 分析技术方案 | **不需要 root cause fix** (无 root cause) — 见 §4 |
| 5 | 修复后验证 | N/A (无修复);新增的 7 个 regression tests 留 codebase 做未来保护 |

## 3. 真因排查 — 7 个真实循环测试

### 测试设计原则 (反 §16.3 X1 commit b16b979 教训)

**关键差异**: 不全 mock useScope/useProjects/useViewState (那会擦掉怀疑点导致假 PASS)。
只 mock Tauri IPC boundary (`invoke`),让 React hooks 跑真实代码。

### 测试清单

| # | 测试文件 | 覆盖场景 | 结果 |
|---|---|---|---|
| 1 | `mcp-management-loading-loop.test.tsx#loading resolves` | mount → resolve → loading=false | ✅ PASS |
| 2 | `mcp-management-loading-loop.test.tsx#NOT called repeatedly` | 50ms 等待 + IPC 计数断言 ≤ 1 | ✅ PASS |
| 3 | `mcp-management-loading-loop.test.tsx#remount via key` | unmount + remount → IPC exactly 2 | ✅ PASS |
| 4 | `mcp-management-loading-loop.test.tsx#useProjects re-render ref` | 5 次 currentProject 新 ref → IPC still 1 | ✅ PASS |
| 5 | `mcp-management-loading-loop.test.tsx#null → project → null` | 多次 scope 切换 → IPC ≤ 2 (不是 7+ loop) | ✅ PASS |
| 6 | `resource-browser-mcp-loop.test.tsx#?tab=mcp entry` | 资源浏览 mcp tab 入口:list_resources + list_mcp_servers 各自 1 次 | ✅ PASS |
| 7 | `resource-browser-mcp-loop.test.tsx#no loop` | 100ms 后 list_mcp_servers ≤ 2 次 | ✅ PASS (mcpCallCount = 1) |

**所有 7 测试 PASS。Master `0bc3130` 在 jsdom 环境下不循环。**

### 排查过的可疑路径 (全部排除)

| 可疑点 | 调查方法 | 结论 |
|---|---|---|
| `useProjects` 的 `currentProject = projects.find(...)` 每次 render 返回新 ref | 测试 #4 用 mockProjectState 制造 5 次新 ref | IPC 仍只 1 次 — syncScopeFromProject 值比较短路 |
| `useScope` singleton emit 链 (Phase 27 Fix 4) | 测试 #5 user → project → user 多切换 | IPC ≤ 2,不是 7+ |
| Rust `dispatch_list_mcp_servers` 死循环 / hang | 读 `commands.rs` + `mcp_service.rs::list()` | list() 是纯同步 read_to_string + parse,无 I/O hang |
| `useEffect [currentProject]` 无限 re-fire | 上面 #4 + #5 双重覆盖 | mount effect [] 只跑一次 |
| `<div key={scopeKey}>` 重 mount → 新 fetch | 测过 scopeKey 变化但 component state 不重置 (React 19 行为) | mount effect 不重跑,无 loop |
| `ResourceBrowserPage` runList 在 mcp tab 重复触发 | 测试 #6 + #7 + 手动 inspect IPC log | 1 次 list_resources + 1 次 list_mcp_servers |

### 为什么 B8 subagent 的测试不充分 (反事故)

B8 subagent (commit a6f516f9600502c0b) 验证的是:

> `mockSyncScope` 被调用的次数

这是个 **间接** 断言 — sync 几次 → 推 IPC 行为。问题在于:
- syncScopeFromProject 是**值比较短路**,即使被调 100 次也不会 emit
- IPC 计数才是直接证据

**本次测试改进**: 直接断言 `mockInvoke.mock.calls.filter(c => c[0] === 'list_mcp_servers').length`,
不依赖中间层。这是 §16.2 验证必须用证据的要求。

## 4. 候选方案 (未实施 — 无 root cause)

按 §16.4 列出可能的 fix,即使没实施也要列:

| 方案 | 适用条件 | 本次判定 |
|---|---|---|
| A. 加 abort controller + loading 防抖 | Rust hang / 慢 IPC | ❌ 反事故 §16.3 — 挡 symptom 不算修 root cause |
| B. 加 `if (!cancelled) return` 在 mount effect 内 (已有) | 取消 stale fetch | ✅ 已存在 (line 117, 121, 124, 134) |
| C. 加 `useState(loading: false)` 默认 false | 改 default | ❌ 不是 root cause |
| D. 加 guard `if (loading === false) return` 在 render | 防止 stuck | ❌ 反事故 — symptom only |
| E. **本次结果: master 干净,无 fix 需要** | — | ✅ 7 测试 PASS |

## 5. 当前 master 行为 (实测)

- **进入 mcp-management 直接入口**: 1 次 IPC → resolve → loading=false → 显示 empty/table
- **从 resource-browser ?tab=mcp 入口**: 1 次 list_resources + 1 次 list_mcp_servers,均 resolve
- **scope 切换 (user → project)**: McpManagementPage 自身的 useState 不重置 (key 只 remount 内层 div)
- **currentProject ref 频繁变化**: syncScopeFromProject 短路,无 IPC loop

## 6. 用户报告 vs 实际可能的差异

用户的报告基于某个**真实复现**,但 jsdom 测不出来。可能差异:

1. **Tauri webview (WebView2/WKWebView) 的 IPC 时序**: jsdom 是同步 invoke 模拟,真 webview 有 IPC round-trip 延迟,可能触发 useEffect 时序差异
2. **特定 mcp.json 内容**: 如果 `~/.claude/mcp.json` 是损坏的 JSON + 大文件 + 慢 IO,Rust 端的 `read_to_string + from_str` 可能卡住;但 `list_with_warnings` 已经处理损坏 JSON
3. **App.tsx `<div key={view}>` remount 的累积效应**: 用户连续切换 view 时,React fiber 状态可能被复用,导致挂载的 McpManagementPage 持有"上次"的 loading=true 状态;但 `useState(INITIAL_STATE)` lazy init 在 mount 时跑,新实例 loading 应该是 true 然后变 false
4. **用户的 v3.4 版本 vs 当前 master**: 用户可能在旧版本(Phase 46 D-44-A 之前),那时 `mcp-management` 还是直接入口,可能有真 loop

## 7. 建议下一步

按 §16,验证必须用证据。本次证据 = 7 个 vitest test 全 PASS。但用户报告是真实信号。

**推荐 (主 session 决策点)**:

1. **请用户复现并提供**:
   - 复现的具体步骤 (从 app 启动到 mcp 页)
   - DevTools console 日志
   - ~/.claude/mcp.json 内容
   - 应用的 build 版本 / git hash

2. **如果用户在当前 master 复现**: 加 1 个 Playwright E2E test (`scripts/tauri-driver`) 跑真 webview,可能暴露 jsdom 测不到的问题

3. **如果用户在旧版本复现**: 已通过 Phase 46 D-44-A 修复 (mcp-management 迁移到 resource-browser 的 mcp tab),无需进一步动作

## 8. 测试文件清单 (留在 codebase)

| 路径 | 行数 | 覆盖 |
|---|---|---|
| `src/__tests__/pages/mcp-management-loading-loop.test.tsx` | 235 | 5 个真循环测试 |
| `src/__tests__/pages/resource-browser-mcp-loop.test.tsx` | 137 | 2 个真循环测试 (resource-browser ?tab=mcp 入口) |

**总计**: 7 个回归测试,真 mock invoke,不全 mock hooks,断言 IPC 计数 (不是 syncScope 次数)。

## 9. 反事故条款兑现

- §16.3 X1 教训: **不全 mock module**,直接断言 IPC 计数
- §16.2 验证必须用证据: **render count + IPC count + 时间** (50ms / 100ms 多 tick 观察)
- §16.5 与既有纪律的关系: §5.2 TDD → 真 TDD (Red→Green,但本次是 **Green stays Green**,因为 master 干净)
- §2.4 谨慎修改文件: **没改任何业务代码** — 只加测试 (新增测试文件,不动业务)

## 10. 结论

> **master `0bc3130` 在 jsdom 测试环境下不循环。**
> 用户报告的"加载中死循环"在本环境无法复现。
> 7 个真循环 regression test 留 codebase 做未来保护。
> 需要用户提供复现步骤以定位真因 (可能需要 Tauri 真 webview 或特定 mcp.json 内容)。