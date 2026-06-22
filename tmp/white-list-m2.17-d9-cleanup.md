# White-list — M2.17 D9 桌面清理

**任务**: D9 决策 (STATE.md 附录) — M2.16 系列 ship exe 桌面清理
**决策依据**: D9 选 A (清空到归档) + M2.16 ship exe mv 到 `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`
**日期**: 2026-06-21
**subagent**: B (D9 cleanup)

## 操作白名单 (逐字路径,无 glob)

### mkdir (1)
- `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`

### mv 源 (2 个,逐字)
1. `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.16-mica-porcelain-fallback.exe` (31,566,446 bytes, 2026-06-21 20:54)
2. `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.16-theme-trim-porcelain.exe` (31,562,054 bytes, 2026-06-21 21:40)

### mv 目标 (统一)
- `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`

## 禁止操作 (auto 模式最小化原则)

- ❌ mv `ClaudeConfigManager-M2.17-ci-strict.exe` (M2.17,保留)
- ❌ mv `ClaudeConfigManager-M2.17-f15-batch3.exe` (M2.17,保留)
- ❌ mv `WebView2Loader.dll` (D9 决策:不动)
- ❌ mv 任何 `~/.archive/` 或其他目录的 M2.16 exe (本任务只动桌面)
- ❌ rm (用 mv,可恢复)
- ❌ cp (用 mv 转移,不是复制)
- ❌ 修改 git (本任务不动 git 工作树)

## 影响范围审计

- **桌面 `~/Desktop/ClaudeConfigManager-M2/`**:
  - 移走 2 个文件
  - 剩余 3 个文件 (2 M2.17 exe + 1 WebView2Loader.dll)
- **归档目录 `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`**:
  - 新建,获得 2 个文件
- **其他目录**: 0 影响

## 校验项

- [x] 2 个 mv 目标**逐字写明** (无 glob) — 满足"批量操作必须有白名单"全局纪律
- [x] 0 个 M2.17 exe 被列入白名单 — 满足"最小化影响原则"
- [x] 0 个 WebView2Loader.dll 被列入白名单 — 满足 D9 决策保留
- [x] 0 个 glob pattern — auto 模式禁止
