# Claude 配置管理器 — UI 重设计 Spec

> 设计稿 · 2026-06-26 · brainstorming 产出
> 演示地址: `docs/superpowers/specs/2026-06-26-ui-redesign/demo/index.html`
> 状态: 5 主题定型, 等待实装到 Tauri 项目

## 1. 项目背景

| 项目 | 内容 |
|---|---|
| 项目名 | Claude 配置管理器 (Claude Config Manager) |
| 技术栈 | Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust |
| 目标平台 | Windows 11 (开发主) + macOS 26 (Tahoe) |
| 设计目标 | "5 主题 100% 切换零混搭, 100% 覆盖所有场景" |
| 当前版本 | v3.2 M6 |

## 2. 5 主题一览

| ID | 名称 | 主色 | 字体 | 圆角 | 动效 | 灵感来源 |
|---|---|---|---|---|---|---|
| `light` | 极简卡片 | #0969DA 蓝 | 系统默认 | 8px | 150ms 微弹簧 | Linear / Vercel |
| `liquid-glass` | 液态玻璃 | #6366F1 紫蓝 | SF Pro Display | 14px | 280ms 弹性 | Raycast / macOS Sonoma |
| `dark` | 深色高级 | #06B6D4 青 | JetBrains Mono | 6px | 80ms 快速 | Warp / Helix |
| `editorial` | 瑞士网格 | #000000 黑 | Inter 800-900 | 0px | 0ms 硬切 | Notion / Bloomberg |
| `pixel` | 像素黑白 (MC) | #5BAA3F 草绿 | Press Start 2P + ZCOOL KuaiLe | 0px | 0ms | Minecraft |

## 3. 架构 (三层 token)

### 3.1 L1 系统基线 — `tokens.css`

5 主题共享, 写在 `:where(:root)` (零特异性, 可被主题覆盖):

| Token | 值 |
|---|---|
| `--space-1..12` | 4/8/12/16/24/32/48 |
| `--radius-sm` / `--radius-xs` | 3px / 2px |
| `--blur-sm/md/lg` | 10/20/30px |
| `--glass-bg*` | 半透叠加色 |

### 3.2 L2 主题调色板 — `theme-{id}.css`

每主题独立 CSS 文件, 用 `[data-theme="id"]` 限定:

| Token 类别 | 数量 |
|---|---|
| Backgrounds | 4 个 (primary / elevated / overlay / sunken) |
| Text | 3 个 (primary / secondary / muted) |
| Brand | 4 个 (accent / accent-soft / accent-strong / accent-fg-on) |
| Status | 4 个 (success / warning / danger / info) |
| Border / Shadow | 3+3 个 (sm/md/lg) |
| Radius | 4 个 (card / button / modal / badge) |
| Typography | 2 个 (heading / body) + 2 个字体栈 |
| Layout | 2 个 (header-height / sidebar-width) |
| Motion | 4 个 (ease + 3 duration) |

每主题 ~30 个 L2 token, 5 主题共 ~150 token.

### 3.3 L3 组件规则 — `app.css`

通用 `.card / .btn / .modal / .nav-item / .input / .toggle / .kpi / .data-table / .usage-bar` 等,
全部用 `var(--xxx)` 引用 L1 + L2, **永不写死颜色**.

### 3.4 主题切换机制

```
themes/*.ts (元数据)
  → ThemeRegistry (import.meta.glob 编译时扫描)
  → ThemeProvider (React Context + localStorage 持久化)
  → document.documentElement.dataset.theme = "xxx"
  → CSS 引擎按 [data-theme="xxx"] 自动应用
```

**当前 demo** 用纯 JS 等价实现 (`app.js`):
```js
document.documentElement.dataset.theme = theme;
localStorage.setItem('demo-theme', theme);
```

## 4. 主题隔离与 100% 切换 (约束 4 + 7)

**3 个关键约束**:
1. ✅ **5 主题独立 CSS 文件** — `vite/esbuild` 自动隔离
2. ✅ **禁用 `:root, [data-theme="x"]` 合并** — 改用 `:where(:root)` (零特异性) + 单独 `[data-theme="light"]`
3. ✅ **组件规则只在 base.css** — themes/*.css 写组件规则会导致切换时叠加

**实证**: pixel 主题下头像 = 朱红印章, editorial 主题下头像 = 白底黑边, dark 主题下头像 = 青色发光——5 主题完全独立.

## 5. macOS 风格窗体 chrome

| 元素 | 实现 |
|---|---|
| 窗口按钮 | 左上角, 圆形 12px, 红 #FF5F57 / 黄 #FEBC2E / 绿 #28C840 |
| hover | 显示符号 (× / − / +), 默认只显色 |
| App 名 | 顶部居中 (topbar-center, absolute + transform: translateX(-50%)) |
| 拖动 | `-webkit-app-region: drag` on topbar |
| 主题适配 | dark 主题加 6px 同色发光 + 内嵌高光; editorial 主题改为黑白灰 (白 / 浅灰 / 黑) |

## 6. 设计约束 (用户原始要求)

| # | 约束 | 实现 |
|---|---|---|
| 1 | 重新审视架构 | 三层 token (L1/L2/L3) 分离 |
| 2 | 100% 覆盖 | 5 主题各自 30+ token, 无 fallback |
| 3 | 特色动效 | liquid-glass 玻璃折射 / dark 字符故障 / editorial 打字机 / chinese 水墨晕染 / pixel 硬切 |
| 4 | 主题独立 | 独立 CSS 文件, 禁止跨主题合并选择器 |
| 5 | 窗口/控件大小 | 1440×900 viewport, 未验证 800×600 / 1920+ |
| 6 | 主题设计文档 | 见 `themes/*.md` 5 份独立文档 |
| 7 | 100% 切换零混搭 | 3 个漏洞全部修补 (见 §3.4) |

## 7. 文件清单

```
docs/superpowers/specs/2026-06-26-ui-redesign/
├── design.md                        # 本文档
├── themes/
│   ├── light.md                     # 极简卡片
│   ├── liquid-glass.md              # 液态玻璃
│   ├── dark.md                      # 深色高级
│   ├── editorial.md                 # 瑞士网格
│   └── pixel.md                     # 像素黑白
└── demo/
    ├── index.html                   # 入口
    ├── app.css                      # 通用布局 + 组件规则 (L3)
    ├── app.js                       # 主题切换 + 路由 + 弹窗
    ├── pages.js                     # 12 页内容
    ├── tokens.css                   # L1 系统基线
    ├── fonts.css                    # @font-face 4 个本地字体
    ├── fonts/                       # woff2 字体文件
    │   ├── PressStart2P.woff2
    │   ├── ZCOOLKuaiLe.woff2
    │   ├── Inter-400.woff2
    │   └── JetBrainsMono-400.woff2
    ├── theme-light.css              # L2 调色板
    ├── theme-liquid-glass.css
    ├── theme-dark.css
    ├── theme-editorial.css
    └── theme-pixel.css              # 含 base64 16x16 MC 贴图
```

## 8. demo 测试覆盖

| 测试维度 | 方法 | 状态 |
|---|---|---|
| 5 主题切换 | Edge headless 截图 + URL `?theme=xxx` | ✅ |
| 12 页内容渲染 | Edge headless 截图 (后续自动化) | ⚠️ 60 组合待跑 |
| 8 弹窗交互 | Edge headless 截图 | ⚠️ 部分 |
| macOS 按钮 hover | CSS `:hover::after` 验证 | ✅ |
| 字体本地化 | fonts.css @font-face + 4 woff2 | ✅ 离线可用 |
| 主题独立 | 5 主题独立文件, 无跨主题选择器 | ✅ |
| pixel 背景贴图 | base64 16x16 PNG × 4 | ✅ 草方块/石头/木板/羊皮纸 |

## 9. 下一步 (writing-plans)

将 demo 设计稿实装到 Tauri 项目:
1. 拆分 demo CSS 到 `src/design-system/{tokens,base,themes}/*.css`
2. 复制 4 个 woff2 字体到 `src/design-system/themes/fonts/`
3. 重构 ThemeProvider 接受 URL param `?theme=xxx`
4. 替换所有 pages/*.tsx 中硬编码的颜色 → var()
5. vitest 单元测试 (token 完整性 / 主题隔离 / 切换逻辑)
6. Playwright e2e 测试 (5 主题 × 12 页 × 8 弹窗)

## 10. 决策日志

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-06-26 | 5 主题平级 | 用户确认 "全做" |
| 2026-06-26 | 取消 chinese 主题 | 用户改为 MC 像素风 |
| 2026-06-26 | 字体全部本地化 | 用户要求内置 |
| 2026-06-26 | 窗体 macOS 风格 | 用户要求 |
| 2026-06-26 | 像素背景用 base64 PNG | 纯 CSS gradient 不像像素 |
| 2026-06-26 | macOS 按钮主题适配 | dark 加发光, editorial 改黑白 |

## 11. 已知限制

| 项 | 限制 |
|---|---|
| 窗口尺寸 800×600 / 1920+ | 未验证 |
| pixel 主题 1px 渲染 | 浏览器抗锯齿可能糊, 已用 `image-rendering: pixelated` 兜底 |
| demo 字体加载 | 首次加载 woff2 需要 ~100ms, `font-display: swap` 兜底 |
| topbar-center 居中 | 用 absolute 定位, 在极窄窗口可能与 left 重叠 |