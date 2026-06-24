# M3.4 smoke 失败记录 (D-槽 2)

> **生成时间**: 2026-06-22
> **状态**: auto 模式,失败不阻塞,记录留痕
> **不阻塞**: D-槽 1 修复其范围内文件后,本 subagent 可重跑 ship

---

## §1 smoke 失败根因

`scripts/build-and-ship.sh --milestone M3 --task 4 --slug marketplace-refactor` 在 `npm run build` (TypeScript) 阶段失败,2 处错误:

### §1.1 App.tsx (D-槽 1 范围)

```
src/App.tsx(55,10): error TS2614: Module '"./pages/home"' has no exported member 'HomeView'.
Did you mean to use 'import HomeView from "./pages/home"' instead?
```

**结论**: `src/pages/home/index.tsx` 当前导出**不是** `HomeView` 命名导出 (默认导出或别的东西)。这是 D-槽 1 WIP 范围,**本 subagent 不应触碰**。

### §1.2 home/index.tsx (D-槽 1 范围)

```
src/pages/home/index.tsx(28,36): error TS2307: Cannot find module '@tauri-apps/plugin-dialog' or its corresponding type declarations.
```

**结论**: `@tauri-apps/plugin-dialog` 类型声明缺失。这跟 Rust 侧 `src-tauri/Cargo.toml` 的 dialog plugin 注册有关,D-槽 1 范围内。本 subagent 不应触碰。

---

## §2 本 subagent 修复的 2 个 TS 错误

```
src/pages/marketplace/index.tsx(30,34): error TS6133: 'useMemo' is declared but its value is never read.
src/pages/marketplace/index.tsx(219,11): error TS6133: 'url' is declared but its value is never read.
```

✅ **已修复**:
- 移除 `useMemo` import (未用)
- 移除 `handleBatchInstall` 里未用的 `url` 局部变量

---

## §3 修复路径 (D-槽 1 解决后会自动通过)

D-槽 1 修复 `App.tsx` + `pages/home/index.tsx` 的 2 处 TS 错误后,本 subagent 的 marketplace 重构可单独 ship:

```bash
PATH="/c/msys64/mingw64/bin:$PATH" bash scripts/build-and-ship.sh --milestone M3 --task 4 --slug marketplace-refactor
```

预期产出: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.4-marketplace-refactor.exe`

---

*本文件由 D-槽 2 auto 模式记录,2026-06-22。*