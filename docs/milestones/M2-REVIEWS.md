# M2 — 4-Stage Review Archive (M2.1 ~ M2.16)

> **Milestone**: M2 业务实现期 (business implementation phase)
> **Period**: 2026-06-20 (M2.1) → 2026-06-21 (M2.16)
> **Status**: ✅ M2.16 done. M2.17 启动中.
>
> **Important**: M2 period's formal 4-stage review discipline
> (per CLAUDE.md §6) was not consistently applied across M2.1
> through M2.15 — most were lightweight self-reviews inline
> in STATE.md. The **M2.16 iteration** is the first to produce
> a full 4-stage review artifact (`tmp/m2-16-code-review.md`).
> This archive summarizes M2.16 findings + retrospectively
> captures M2.1~M2.15 known issues for future audits.

---

## Source files (按时间顺序)

| Date | Iteration | Source | Coverage |
|---|---|---|---|
| 2026-06-20 | M2.1 | `docs/milestones/STATE.md` §M2.1 + M2-state P0 bug fix | F1 Provider 列表 + F2 切换 (1 ship + 1 P0 fix) |
| 2026-06-20 | M2.2 | STATE.md §M2.2 | F3 .sql 导入 (sql_parser + provider_service) |
| 2026-06-20 | M2.3 | STATE.md §M2.3 + commit `b3f50ca` | F4 deeplink 导入 |
| 2026-06-20 | M2.4 | STATE.md §M2.4 | F5 JSON 编辑器 (122/122 vitest) |
| 2026-06-20 | M2.5 ~ M2.15 | `git log --oneline M2.*` (no formal review) | F6/F7/F13/F14/F15/F10/F20/F21/F22/F23/Mac fix/cleanup |
| **2026-06-21** | **M2.16 (full 4-stage)** | [`tmp/m2-16-code-review.md`](../../../tmp/m2-16-code-review.md) | **29 atomic commits, 9 new features + 8 Mac impl + 主题重构 + F15 + splash + CI** |
| 2026-06-21 | M2.16 macOS audit | [`tmp/macos-compat-audit.md`](../../../tmp/macos-compat-audit.md) | 8 platform traits × Win vs Mac |

---

## M2.16 — Full 4-stage review (the canonical M2 entry)

**Source**: [`tmp/m2-16-code-review.md`](../../../tmp/m2-16-code-review.md) (164 lines)

**Review scope** (per §评审范围):
- 29 个 M2.16 原子 commit (`4a1fdb5..5de839f`)
- 9 大新功能 + 8 个 Mac impl + 主题重构 + F15 横切 + splash + CI
- Focus areas: F3 sql_parser 重构, F10 drag-drop, F14/F14+ export,
  F17 marketplace clone+install, F20 single-instance, F21 source-repo,
  F22 manifest, 8 macos platform impls, ErrorBanner 横切, splash 时序,
  CI macos gate

### CRITICAL — 3 (all FIXED in M2.16-fix-c1/c2/c3)

| ID | Summary | Fix commit |
|---|---|---|
| C1 | F20 冷启动 .sql 文件关联事件丢失 (race: setup() 内 emit 早于 webview mount) | `1f41c24` M2.16-fix-c1: AppState 缓存 + 前端主动 pull |
| C2 | F22 manifest 解析对"无 frontmatter"场景的描述提取策略不健壮 (# 标题 → None) | `d9056cc` M2.16-fix-c2: 跳过所有 # 标题取首段正文 |
| C3 | F3 sql_parser `parse_mcp_row` 死代码 + 错误信息误导 (双 JSON decode 是占位) | `d14acf7` M2.16-fix-c3: 双编码 JSON 实现 + 错误信息准确化 |

### HIGH — 6 (all FIXED in M2.16-fix-h1~h6)

| ID | Summary | Fix commit |
|---|---|---|
| H1 | F20 `read_sql_file` 无大小限制 + 无字节数预检 | _(deferred; logged)_ |
| H2 | F10 drag-drop 拖入非 .sql 后遮罩"静默消失" | `492d7ee` M2.16-fix-h2: enter 检测到 .sql 但 drop 未找到时红条 |
| H3 | F17 marketplace `install_resource` 无 overwrite 二次确认 | `5af4975` M2.16-fix-h3: 备份到 .bak.<ts> 后覆盖 (force flag) |
| H4 | ErrorBanner autoDismiss 计时器在父组件每次重渲时重置 | `e05d6cb` M2.16-fix-h4: ref 持 onDismiss |
| H5 | Mac 上 `setup()` 同步调 `apply_vibrancy` 可能过早 | `5ef61c5` M2.16-fix-h5: 改异步延迟 200ms 调 apply |
| H6 | F21 source_repo 命名误导 | `4f7a718` M2.16-fix-h6: 重命名为 `infer_resource_group` |

> H1 (read_sql_file 大小限制) was deferred — currently logged
> in STATE.md as known limitation, M3 candidate. Blast radius
> is small (user must explicitly provide a .sql file via dialog
> or drag-drop), and 5GB read is mitigated by `std::fs::read_to_string`
> failing fast on most realistic sizes in dev boxes.

### MEDIUM — 10 (filed to STATE.md backlog)

| ID | Summary | Severity rationale |
|---|---|---|
| M1 | F20 `extract_sql_file_path` 不校验文件存在性 | Best-effort UX; not blocking |
| M2 | F17 `slug_from_url` 重复去除 `.git` 用 `.matches` | Edge case (foo.git.git); use `strip_suffix` |
| M3 | 主题切换时 localStorage 旧值 (`dark` / `auto`) 未清理 | One-shot migration needed |
| M4 | Splash 2s 时序在弱网/RAM 慢机器上可能不够 | Add 8-10s 失败兜底 |
| M5 | F10 drag-drop 多次连续 enter 事件不去重 | Idempotent handling needed |
| M6 | F17 marketplace 多个 repo 并发 clone 同一 URL 竞争 | Mutex per URL needed |
| M7 | F22 `parse_frontmatter` 描述提取不识别 `#` 之后的内容 | Handled in c2; edge case remains |
| M8 | F3 sql_parser `now_unix_secs()` 在 Provider 重复解析时漂移 | Use monotonic clock |
| M9 | F17 marketplace `installStates` 不清空，跨 clone 持久 | Map cleanup on clone finish |
| M10 | F15 ErrorBanner 替换后 provider-list/backup-restore 测试覆盖度需重测 | Run full vitest + e2e |

### LOW — 7 (style / nice-to-have)

| ID | Summary |
|---|---|
| L1 | `src-tauri/src/lib.rs:200` deeplink 冷启动 argv 扫描冗余 |
| L2 | MacPaths fallback `/Users/Shared` 可能在 sandboxed Mac 上无写权限 |
| L3 | F20 `read_sql_file` 错误信息含绝对路径，可能泄漏给前端 |
| L4 | ErrorBanner 默认 `data-testid` 命名规则不一致 |
| L5 | STATE.md "M2.16 候选启动" 章节未清理 |
| L6 | F15 ErrorBanner 4 kind 字体大小未在 tokens.css 集中 |
| L7 | F22 manifest `MAX_FILES = 200` 截断对用户不透明 |

### Confirmed OK

- F3 sql_parser `parse_provider_row` 重构 (按 app_type 分派 + 无列名 INSERT)
- F10 drag-drop 入口 (Tauri onDragDropEvent + overlay 复用 F20 pendingSqlFile)
- F14 export single provider (Rust dialog + atomic write)
- F17 marketplace git clone + scan + install (17 cargo tests + 13 vitest)
- F20 single-instance (`tauri-plugin-single-instance`) + Mac guard (`5d69cc0`)
- F21 source-group filter (F9 fuzzy search 复用)
- F22 manifest + file list (22 cargo + 6 vitest)
- F23 export optimization findings → markdown report
- 8 Mac platform impls (paths / single-instance / autostart / reveal /
  notifier / app-menu / window-chrome / git-host; 7 live, 1 compile-only)
- 主题 trim: 砍 glass 主题, 只留 light 瓷白 (commit `d820b82`)
- splash 2s 时序 (index.html 内联 + React mount 后隐藏)

---

## M2.16 — macOS compatibility audit (专项)

**Source**: [`tmp/macos-compat-audit.md`](../../../tmp/macos-compat-audit.md) (196 lines)

### Platform trait status (8 traits)

| # | Trait | Win | Mac | Risk |
|---|---|---|---|---|
| 1 | `IPlatformPaths` | ✅ live | ✅ live | P0 启动 — Mac OK |
| 2 | `IPlatformSingleInstance` | ✅ live (mutex) | ✅ live (no-op guard) | OK |
| 3 | `IPlatformAutostart` | ✅ tauri-plugin-autostart | ✅ same | OK |
| 4 | `IPlatformReveal` | ✅ explorer /select | ❌ unimplemented | P1 — `open -R` not wired |
| 5 | `IPlatformNotifier` | ⚠️ stub (eprintln) | ✅ live (M2.16 `449d659`) | Win still stub |
| 6 | `IPlatformAppMenu` | ✅ NotSupported | ✅ live (M2.16 `c074187` standard macOS menus) | OK |
| 7 | `IPlatformWindowChrome` | ✅ DWM Mica (实测 fallback to CSS) | ⚠️ vibrancy (M2.16 200ms async `5ef61c5`) | Win Mica无效 (commit `e8b4b56` 改 fallback); Mac vibrancy待真机验证 |
| 8 | `IGitHost` | ✅ live (CLI shim) | ❌ unimplemented (`unimplemented!()`) | **P0** — F17 marketplace on Mac will panic at runtime |

### macOS 真机前必修清单

**P0 (会崩，必须修)**:
- Mac `IGitHost::clone` — must implement before any Mac user runs
  F17 marketplace
- CI `release.yml` mac matrix currently produces a crash-package
  (IGitHost panic)

**P1 (功能缺失/崩溃，应该修)**:
- Mac `IPlatformReveal::reveal_in_file_manager` — needs `open -R`
- Win `IPlatformNotifier` — still eprintln stub
- CI `ci.yml` — no mac test gate

**P2 (体验/架构问题，可延后)**:
- Mac vibrancy real-device verification
- Tauri config Mac icon (`tauri.conf.json` 缺 mac icon bundle)
- `MacPaths` fallback `/Users/Shared` 可能 sandboxed Mac 无写权限

### 业务代码 OS 判断散落 (违反 §3.2)

None found in M2.16 scan — all OS-specific code routed through
`platform/` traits. Confirmed by self-review stage 1.

---

## M2.1 ~ M2.15 retrospective (post-hoc)

M2.1 through M2.15 were each shipped with lightweight inline
self-review notes in STATE.md, but **not** the full 4-stage process.
Retrospective concerns (cumulative):

### M2.1 (F1 + F2)

- P0 bug fix (M2-state): F2 switch 时 settings.json 备份 + atomic
  rename 路径顺序错位。修后通过。

### M2.2 (F3 sql_parser)

- sql_parser 按 `app_type` 分派逻辑需 M2.16 修复 (无列名 INSERT)
- 测试覆盖度：M2.2 ship 时 ~7 cargo tests；M2.16 累计 ~22。

### M2.3 (F4 deeplink)

- 5 commits / 99 vitest / 7 smoke (per STATE.md reference)
- 冷启动 argv 扫描冗余 (LOW L1)

### M2.4 (F5 JSON 编辑器)

- 7 commits / 122 vitest / 7 smoke
- Token masking 默认 ON (api_key / token / password / secret)
- `write_file_atomic` 路径必须 starts_with(`~/.claude/`), 拒绝 `..`

### M2.5 ~ M2.15 (intermediate)

- F13 backup + F14 export + F15 ErrorBanner + F10 drag-drop +
  F20 single-instance + F21 source-repo + F22 manifest — all
  shipped without formal review.
- **Recommendation**: M3 should pick 2-3 of these for retrospective
  review to catch any drift.

---

## Review process gaps (to address in M3)

1. **No peer review (stage 3) in M2** — opencode CLI not used;
   no external AI CLI hostile review. M1.11 had self-simulated
   hostile review (`0bd8128`). M2 should reintroduce this.
2. **No business flow analysis (stage 4) per feature** — only
   inline STATE.md notes. M2.16 didn't run a dedicated stage 4.
3. **Brainstorm (stage 2) inconsistent** — design decisions often
   went straight to code without reverse-challenge.

**Recommended M2.18 / M3 fix**: Per CLAUDE.md §6, enforce the
4-stage review for any feature touching `services/` or new
plugin implementation. Pure infra / refactor can stay at
self-review only.

---

## Backlog (for M2.17 / M3)

### From M2.16 review (carried over)

- [ ] H1: read_sql_file 大小限制 (50MB precheck)
- [ ] M2: F17 `slug_from_url` 用 `strip_suffix`
- [ ] M3: ThemeProvider mount 清掉旧 localStorage (`dark` / `auto`)
- [ ] M4: Splash 失败兜底延长到 8-10s
- [ ] M5: F10 drag-drop enter 事件去重
- [ ] M6: F17 marketplace per-URL Mutex
- [ ] M8: F3 sql_parser `now_unix_secs` 改 monotonic
- [ ] M9: F17 `installStates` map cleanup
- [ ] M10: F15 ErrorBanner 全量回归测试

### From macOS audit (carried over)

- [ ] **P0**: Mac `IGitHost::clone` 实现 (CLI shim 复用 Win 实现)
- [ ] **P0**: CI release.yml Mac matrix 临时 disable until IGitHost live
- [ ] **P1**: Mac `IPlatformReveal::reveal_in_file_manager` (open -R)
- [ ] **P1**: Win `IPlatformNotifier` 真实现 (tauri-plugin-notification)
- [ ] **P1**: CI macOS 测试 gate

### From L (style)

- [ ] L1: `lib.rs:200` deeplink argv 扫描去掉
- [ ] L3: F20 错误信息不泄漏绝对路径
- [ ] L7: F22 `MAX_FILES = 200` 截断 + UI 提示

---

*End of M2 review archive. M2.17+ reviews will follow the same
4-stage format and append here.*