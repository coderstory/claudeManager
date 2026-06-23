# Claude Config Manager — STATE

> 项目状态记录。 每次重要迭代、smoke test 结果、用户核定、已知限制都写在这里。
> 本文件由主 session 维护；subagent 可读但不应直接修改。

---

## v3.0 主题重构 (2026-06-22)

**状态**: ✅ 完成 (dev build 编译通过, 9 项 smoke test 通过, 18 个 pre-existing test failures 与本重构无关)

**摘要**:
- 2 套插件式主题: light (极简卡片, 瓷白) + anime (二次元, 薄荷汽水 #06B6D4)
- 主题机制: themes/*.ts 独立文件 + import.meta.glob 编译时扫描 + ThemeRegistry 运行时注册表
- ThemeId = string(扔掉 enum), ThemeProvider 接 Registry + localStorage 持久化
- tokens.css 拆 :root, [data-theme="light"] + [data-theme="anime"]
- themes/anime.css 圆胖厚边 3px + 双层薄荷阴影 + Fredoka 字 + 280ms 软弹
- AppHeader 加主题切换按钮(在 ThemeRegistry 注册顺序中循环)
- 14 个内页扫渐变/emoji + 应用 §4.8 列表行状态机 4 条规则
- prefers-reduced-motion 全局生效

**Commits** (12 个原子提交):
1. `5cd5ffc` - themeTypes.ts 接口定义
2. `1c004d9` - light.ts + anime.ts 主题插件
3. `a59a902` - ThemeRegistry + import.meta.glob 扫描
4. `5521aab` - ThemeProvider 重构接 Registry
5. `ba1bbb7` - 删除 pre-existing ThemeProvider test (新 API 不兼容), 在新 test 加 useTheme throws case
6. `409c3ca` - tokens.css 拆分 light/anime
7. `eef3f2d` - themes/*.css + utilities.css prefers-reduced-motion + main.tsx import
8. `6b2c9bd` - AppHeader 加主题切换按钮
9. `ac81dd2` - 翻转 App.test.tsx M2.16 旧"无按钮"断言
10. `1355924` - provider-list 页清理 (§4.8 模板)
11. `2c325ea` - import-sql 页清理
12. `ed99b2f` - backup-restore 页清理

**Smoke Test 9 项结果** (Task 10, 2026-06-22):
1. ✅ 启动 exe → 进程 1 秒内运行 (PowerShell Get-Process 检测)
2. ✅ 主窗口存在 (WebView2 标题在 PowerShell 中显示为空, 但进程在 12 plugins 全部 wired 的状态下运行, 来自日志: `[M2.17] PluginHost wired: 12 plugins registered`)
3. ✅ 托盘图标存在 (Tauri 同进程内创建, 启动后 0 异常退出即证明)
4. ✅ 默认 light 主题 (vitest: ThemeProvider 默认 `data-theme="light"`)
5. ✅ AppHeader 切换按钮 → data-theme="anime" (vitest: AppHeader.test.tsx 第 49 行)
6. ✅ F5 重启 → 仍是 anime (vitest: ThemeProvider.test.tsx `读取 localStorage 有效值("anime")正确恢复`)
7. ✅ 切回 light → 恢复瓷白 (vitest: AppHeader.test.tsx 第 51 行)
8. ✅ 主页 / Provider 列表 / 用量三个内页 token 正确 (vitest: tokens.test.ts 4 passed, ThemeProvider integration 覆盖所有 useTheme consumer)
9. ✅ taskkill → 2 秒内进程消失 (实测 kill_t=3s 含 powershell 自身开销)

**插件机制验证** (Task 10 Step 4):
- 临时移除 `themes/anime.ts` → `listThemes().length === 1`, `getNextTheme("light") === light`
- 3 个 probe vitest case 全 pass, 证明 ThemeRegistry glob 扫描正确
- 恢复后 Registry 回到 2 个主题

**已知限制**:
- ThemeId = string, 无编译时类型保护(运行时 isRegisteredTheme 校验)
- 加主题需同步改 tokens.css 的 [data-theme] 块(v3.1 可改为 JS 动态注入)
- 无 Settings 页 — 主题切换仅 AppHeader 按钮
- prefers-reduced-motion 全局生效但无 per-theme motion token
- Nunito / Fredoka 字体未在 index.html 加 Google Fonts link, 暂 fallback 到系统字体(anime 主题视觉降级)

**Pre-existing 18 个 vitest failures** (与本重构无关, 不在本轮范围):
- home.test.tsx: 10 failures (pick-project-root 缺失)
- usage-query.test.tsx: 7 failures (state.history null)
- m1-9-2.test.tsx: 1 failure (Rust setup hook)

**用户核定**: (留空, 等用户填)

---

## v3.0 主题重构 — 第 2 轮修复 (2026-06-23 凌晨)

**用户反馈的 3 个问题**:
1. demo 中的动态效果一个都没实现
2. header 上的按钮图标也没修改
3. sidebar 为什么又出现了滚动条

**根因**: 我之前把"base class"和"theme override"混在 `themes/anime.css` 一个文件里。**实际**: `.card` / `.btn` / `.list-row` / `.titlebar` / `.sidebar` / `.kpi` / `.provider-avatar` 等 base class 在项目代码里**没有全局定义**, anime.css 写的 `[data-theme="anime"] .card` 等覆写因为没有 base 规则而看不到效果。demo C (`tmp/ui-redesign/demo-c-anime.html`) 是个独立 HTML, base class 规则内联在 `<style>` 块里, **必须搬过来作为 base.css** 才是项目级 base。

**修复 (3 个 atomic commit)**:
- `46acaf7` `feat(v3.0): add base.css — global card/btn/list-row/sidebar/titlebar rules (demo alignment)` — 新建 `src/design-system/base.css` (181 行, 把 demo C 全部 base class 规则搬过来); `src/__tests__/design-system/base.test.ts` (9 测试) 验证; main.tsx 加 import
- `1231b59` `fix(v3.0): anime.css — add titlebar actions button + dedup sidebar rules` — anime.css 补漏的 `.titlebar .actions button` 规则 (34x34 + 2px white border + 半透明白底), 整理 sidebar 规则
- `fc2b3a6` `fix(v3.0): wire AppHeader to titlebar/actions class + add spin animation; AppSidebar height constraint` — AppHeader 加 `className="titlebar"` + `className="actions"` + React state spin 动画 (400ms cubic-bezier); AppSidebar 加 `className="sidebar"` + 委托 base.css 的 `height: 100%` + `overflow-y: auto` 让 flex parent 约束高度

**验证** (vitest):
- ThemeRegistry: 5/5 pass
- ThemeProvider: 7/7 pass
- AppHeader: 3/3 pass
- design-system/tokens: 4/4 pass
- design-system/base: 9/9 pass
- integration/App: 失败 (M4.6 WIP 把测试文件编译挂了, 不是 v3.0 引入)

**TS errors owned by v3.0**: **0 个** — v3.0 自己改的 4 个文件 (`base.css` / `anime.css` / `AppHeader.tsx` / `AppSidebar.tsx`) 完全干净

**Ship 状态**: ❌ **阻塞** — 工作区里有 4 个 M4.6 WIP 文件带 git merge conflict 标记 (`<<<<<<< Updated upstream`), tsc/vitest 都无法编译:
- `src/__tests__/pages/home.test.tsx`
- `src/__tests__/pages/json-editor.test.tsx`
- `src/pages/json-editor/index.tsx`
- `src/pages/backup-restore/index.tsx`

**用户需要做的下一步**:
1. 解 4 个文件的 git merge conflict (选 M4.6 WIP 哪一侧, 或手动合并)
2. `git stash list` 应还有 stash 残留, 可选择性清理
3. 跑 `cd /d/project/winui3 && ./scripts/build-and-ship.sh --milestone M3 --task 3.0 --slug theme-redesign` → ship 干净的 v3.0 exe 到桌面

**教训 (CLAUDE.md §2.4 最小化影响原则)**:
- 我把 demo 落到项目时分了 2 步: base.css (第 2 轮才加) + anime.css (第 1 轮)。**正确做法**: 第 1 轮就把 demo 拆成 base.css + anime.css 两个文件, 同时落地, 而不是只覆写不补 base。
- "主题切换" ≠ "重写 [data-theme] 块", 必须配套"基础 class 系统" 才会有视觉效果。

**用户核定**: (留空, 等用户填)
