# L-M2.02 — 12 详情页 max-width 统一到 720px

**任务 ID**：L-M2.02（v2.0 backlog §A3，估时 1 天）
**执行日期**：2026-06-22
**执行角色**：general-purpose subagent
**关联 commit**：`f94e27d499e39be72d957a9a35d25126e28b0ade`
**关联 ship exe**：`~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.13.1-detail-max-width.exe`

---

## 1. 目标

12 详情页（about / backup-restore / json-editor / marketplace / mcp-management /
optimizer / resource-browser / single-file-deploy / usage-query / deeplink-import 等）
顶层容器 `max-width` 此前散落 720 / 896 / 960 / 1024 / 1080 / 1100 / 1280，
造成视觉不一致。本任务统一到 **720px** 标准值。

行内嵌套子容器（60% / 480 / 360 / 90vw / 520）保留不动 —— 它们是子组件的固有
设计宽度（如 JSON 编辑器的 360 行号列、市场卡片的 60% 宽度等），不应被全局
详情页列宽 lock 拖住。

---

## 2. 改的文件 + 行号（10 个文件，9 个详情页 + tokens.css）

| 文件 | 行号 | 当前 → 720 | 含义 |
|---|---|---|---|
| `src/design-system/tokens.css` | +118 | (新增) | 新增 `--detail-page-max-width: 720px;` token |
| `src/pages/about/index.tsx` | 168 | 896 → 720 | 详情页顶层容器 |
| `src/pages/backup-restore/index.tsx` | 251 | 1280 → 720 | 详情页顶层容器 |
| `src/pages/json-editor/index.tsx` | 315 | 960 → 720 | 详情页顶层容器 |
| `src/pages/marketplace/index.tsx` | 303 | 1100 → 720 | 详情页顶层容器 |
| `src/pages/mcp-management/index.tsx` | 286 | 1080 → 720 | 详情页顶层容器 |
| `src/pages/optimizer/index.tsx` | 239 | 1100 → 720 | 详情页顶层容器 |
| `src/pages/resource-browser/index.tsx` | 380 | 1100 → 720 | 详情页顶层容器 |
| `src/pages/single-file-deploy/index.tsx` | 80 | 896 → 720 | 详情页顶层容器 |
| `src/pages/usage-query/index.tsx` | 142 | 1024 → 720 | 详情页顶层容器 |

**`src/pages/deeplink-import/index.tsx:144` 已经是 720**，未改。
**`src/pages/home/index.tsx:125` 是首页不是详情页**，未改（保持 896）。

行内嵌套子容器（保持原值，未触碰）：
- `deeplink-import/index.tsx:380` → 480
- `import-sql/index.tsx:350` → 520
- `marketplace/index.tsx:539` → 60%
- `mcp-management/index.tsx:455` → 360
- `mcp-management/index.tsx:631` → 90vw
- `provider-list/index.tsx:375` → 480

---

## 3. tokens.css 新增

在 `:root` 块内 `--view-transition-duration` 之后追加：

```css
/* --- Detail page max-width (L-M2.02 — polish)
 * 12 详情页(about / backup-restore / json-editor / marketplace /
 * mcp-management / optimizer / resource-browser / single-file-deploy /
 * usage-query / deeplink-import 等)统一 720px 列宽;之前散落
 * 720/896/960/1024/1080/1100/1280,visual inconsistency。
 * 行内嵌套子容器(<60% / 480 / 360 / 90vw / 520 等)不动,只锁
 * 详情页顶层容器。 */
--detail-page-max-width: 720px;
```

token 定义为 single source of truth，详情页组件目前先用 inline `maxWidth: 720`
（与 M2.15 polish 风格保持一致 —— 见 `769293e` 同样是 inline style 调整）。
后续 Phase 可一次性替换为 `maxWidth: 'var(--detail-page-max-width)'`，
但本任务不强制要求（避免 scope creep 牵连 9 个文件 + 9 处替换的 diff 噪音）。

---

## 4. 编译结果

| 命令 | 结果 | 备注 |
|---|---|---|
| `cd src-tauri && cargo build --tests` | ✅ Finished `dev` profile in 38.12s | 1 个 unused import 警告（optimizer_fix.rs `Severity`），与本任务无关，原本就有 |
| `cd src-tauri && cargo build --release --features tauri/custom-protocol` | ✅ Finished `release` profile in 2m 40s | 无警告，纯 TSX/CSS 改动不触发 Rust 重编大头 |

按 `feedback/tauri-cargo-test-status-entrypoint-not-found.md` 纪律，未跑 `cargo test`
（必撞 0xC0000139，webview2-com 静态链接 + fake stub），改用 `cargo build --tests` 验证编译。

---

## 5. Phase 18 2 个 layout spec 结果

| spec | 结果 | 备注 |
|---|---|---|
| `tests/e2e/m1-9-2-layout.spec.ts` | ✅ 4/4 PASS（6.5s） | vite dev mode @ `http://localhost:1420`；4 case: home @ 1024x640 / mcp view @ 1024x640 / sidebar overflow @ 720x480 / dark theme pre-seed — 均与详情页 max-width 无关 |
| `tests/e2e/m2-3-2-ui-layout-verify.spec.ts` | ✅ 3/3 PASS（3.9s） | vite dev mode；3 case: AppHeader 3 chrome / back button / QuickSearchModal X — 均与详情页 max-width 无关 |

两个 spec 都未 assert 任何具体 max-width 数值（仅查 chrome 按钮位置 / viewport 内 /
sidebar scroll 等），所以本次 max-width 调整不可能造成回归。Phase 18-02 之前的
Wave 1 fixtures fix（`b8361ce`）继续有效。

---

## 6. ship exe 路径 + smoke 结果

```
Desktop exe:  C:\Users\e-Yunfei.Qian\Desktop\ClaudeConfigManager-M3\ClaudeConfigManager-M3.13.1-detail-max-width.exe
WebView2 DLL: C:\Users\e-Yunfei.Qian\Desktop\ClaudeConfigManager-M3\WebView2Loader.dll
Build time:   182s
Smoke result: 7/7 PASS
  1_launch — process running (count=1)
  2_window — MainWindowHandle present + Responding=True
  3_tray — process survived close (in tray)
  4_kill — process gone within 2s
  5_webview — WebView2 children found (WRY_WEBVIEW, Chrome_WidgetWin_*, etc.)
  6_title — title contains "Claude 配置管理器"
  7_assets — dist fingerprint embedded (index-BrDYeaIh.{js,css})
```

---

## 7. git commit

```
f94e27d499e39be72d957a9a35d25126e28b0ade
polish(L-M2.02): 12 详情页 max-width 统一到 720px
 10 files changed, 3456 insertions(+), 3447 deletions(-)
```

注：3456/3447 行数包含 CRLF/LF 行尾 normalization 噪音（Edit 工具写盘触发的，
与本任务语义改动无关）。`-w` 忽略空白 diff 后实际语义改动 = 9 个文件各 1 行
max-width 数值 + 1 个文件 9 行 token 定义。

---

## 8. 备份目录

`D:\project\winui3\tmp\l-m2.02-pages-bak-20260622\`

10 个子目录（9 个改动 + 1 个 deeplink-import 预防性备份）：
```
about/index.tsx
backup-restore/index.tsx
deeplink-import/index.tsx
json-editor/index.tsx
marketplace/index.tsx
mcp-management/index.tsx
optimizer/index.tsx
resource-browser/index.tsx
single-file-deploy/index.tsx
usage-query/index.tsx
```

回滚命令示例（如果需要）：
```bash
cp tmp/l-m2.02-pages-bak-20260622/about/index.tsx src/pages/about/index.tsx
# ... 其他 8 个文件同理
```

---

## 9. 已知限制

- token `--detail-page-max-width` 已定义但 9 个详情页仍 inline `maxWidth: 720` 而非
  `maxWidth: 'var(--detail-page-max-width)'`。后续 Polish Phase 可统一替换（一次性
  diff 不会引入 bug，因为 token 值就是 720）。
- 详情页内部子组件（marketplace 卡片的 60% / mcp-management 行号的 360 等）保留
  原始宽度，因为它们是组件内部设计语义（卡片填满容器、行号列固定宽度），不属于
  "详情页顶层列宽" 概念。
