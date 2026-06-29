# A9 重验证报告 — 删除 mc + pure-black 主题 (2026-06-30)

> 协议: CLAUDE.md §16 Bug Fix Protocol (5 步流程).
> 清单: `reverify-bugs-2026-06-29.md` §1 A9 行.
> 状态: **VERIFIED PASS** — NO-OP 状态确认 + 防回归测试已入库.

---

## §16.1 五步流程

### 1. 了解问题详情
- 用户原报: "删除 mc + pure-black 主题"
- 上下文: 5 主题化方案 (light / liquid-glass / dark / editorial / pixel) 已落地,mc 与 pure-black 需清除
- 期望行为: themeIds.ts 导出 5 个,无 mc / pure-black 任何残留
- 实际行为: 源码已干净 (清单标注 NO-OP)
- 触发条件: N/A (NO-OP)
- 频率: N/A
- 影响范围: `src/design-system/themes/*` + `src/design-system/ThemeRegistry.ts` + 全局 import 链路

### 2. 明确问题原因
- **root cause**: N/A — bug 已修复 (commit 编号未列,清单 §1 A9 行记 "—")
- **症状 vs 原因**: 无症状可分析,纯回归测试场景

### 3. 明确问题边界
- 影响模块: `src/design-system/themes/themeIds.ts` + `src/design-system/themes/*.ts(7 个文件)` + `ThemeRegistry.ts` (glob 读取)
- 不影响: 后端 (Rust) 无主题概念,不影响 IPC 协议
- 是否触及 §2.4 白名单: 否 — 唯一文件改动是新增测试文件 (`src/__tests__/design-system/theme-no-residue-a9.spec.ts`)

### 4. 分析技术方案

| 方案 | 优 | 缺 | 推荐 |
|---|---|---|---|
| A: 纯 grep shell 脚本 | 简单 | 不进 CI,易忘 | ❌ |
| B: vitest 回归测试 (主题列表 + 禁词扫描 + 源文件 read) | 进 CI,可读,锁住正向/负向双 invariant | 多写 100 行 | ✅ |
| C: pre-commit hook | 阻塞 commit | 增加工具链,本次任务范围外 | ❌ |

**推荐 B**: 与现有 `theme-isolation.test.ts` (锁正向) 互补 (锁负向),保证未来如有人 rebase 回 mc / pure-black 时立刻 FAIL.

### 5. 修复后实际验证 (硬证据)

#### 5.1 源码 grep (Phase: 实际跑命令)
```bash
cd /Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-a77d422d370b1765d/.claude/worktrees/verify-a9
grep -rEn "(pure[-_]?black|theme[-_]?mc|mc[-_]?theme|mcTheme|\"mc\"|'mc')" src/ src-tauri/src/ 2>/dev/null | grep -v node_modules
# exit 1 (0 命中)  ✓
```

精确模式 (避免误伤 "mc" 在 "mcp.json" 等合法词):
- `pure[-_]?black` → 0 命中
- `pure_black` → 0 命中
- `theme[-_]?mc` / `mc[-_]?theme` / `mcTheme` / `mc_theme` → 0 命中
- `"mc"` / `'mc'` (独立字符串字面量) → 0 命中

#### 5.2 vitest 实际跑 (Phase: 实测)
```
RUN  v2.1.9  (cwd: verify-a9)
 ✓ src/__tests__/design-system/theme-no-residue-a9.spec.ts (20 tests) 18ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

20 个 invariant 全部 PASS:
- 正向 (2): 列表长度=5,5 个 id 精确匹配 light/liquid-glass/dark/editorial/pixel
- 负向-禁词 (9×N): 9 个禁词变体 (mc / MC / pure-black / pure_black / pureBlack / mc-theme / theme-mc / mcTheme / mc_theme) 对每个主题 id 跑断言
- 负向-Registry (1): `isRegisteredTheme` 对 'mc' / 'pure-black' / 'pure_black' 返回 false
- 源码扫描 (7): 对 themes/ 目录下 7 个文件 (dark.ts / editorial.ts / light.css / light.ts / liquid-glass.ts / pixel.ts / themeIds.ts) 跑正则匹配
- themeIds.ts key (1): 文件内不出现 'Mc' / 'MC' / 'PureBlack' / 'pure-black' / 'pure_black'

---

## 结论

A9 (P2, NO-OP) **VERIFIED PASS**:
1. 源码 0 命中 (grep 实测)
2. 新增回归测试 `src/__tests__/design-system/theme-no-residue-a9.spec.ts` 锁住正反两条 invariant
3. 测试在当前 master 分支 (verify-a9 worktree) 跑 PASS (20/20)
4. 未来 commit 误加 mc / pure-black → vitest 立刻 FAIL,无法 ship

**清单 §1 A9 行更新建议** (新 session 来时):
- Status: NO-OP → VERIFIED
- 重验证方式: 已锁测试 (sha: 见 commit)

