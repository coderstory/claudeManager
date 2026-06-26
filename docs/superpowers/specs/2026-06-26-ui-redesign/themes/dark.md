# dark · 深色高级

## 1. 设计理念 (3 句)

终端 + 编辑器 + IDE 用户的视觉语言. 深炭避免纯黑刺眼, 青色发光暗示"在控制什么". 等宽字体覆盖 UI 强化开发者身份与 light 的"文档"感形成对比. 灵感: Warp 终端 + Helix 编辑器 + GitHub Dark Dimmed.

## 2. 色系

| 类别 | 值 | WCAG |
|---|---|---|
| 背景 primary | #0A0A0B 深炭 (避纯黑) | — |
| 背景 elevated | #18181B 炭灰 | — |
| 背景 overlay | rgba(255,255,255,0.04) | — |
| 背景 sunken | #09090B 凹陷 | — |
| 文字 primary | #E4E4E7 浅灰 | 14.5:1 AAA |
| 文字 secondary | #A1A1AA 中灰 | 6.8:1 AAA |
| 文字 muted | #71717A 暗灰 | 3.5:1 (辅助) |
| 品牌 accent | #06B6D4 青色 | — |
| 品牌 accent-glow | rgba(6,182,212,0.4) 发光外环 | — |
| 品牌 accent-soft | rgba(6,182,212,0.10) | — |
| 品牌 accent-strong | #22D3EE 亮青 | — |
| 品牌 fg-on | #0A0A0B | — |
| 状态 success | #10B981 翠绿 | 5.2:1 AA |
| 状态 warning | #FBBF24 琥珀 | 8.6:1 AAA |
| 状态 danger | #F87171 浅红 | 5.4:1 AA |
| 状态 info | #3B82F6 蓝 | — |
| 边框 | rgba(255,255,255,0.08) | — |

## 3. 字体 (核心特色)

| 类型 | 栈 |
|---|---|
| UI | **JetBrains Mono**, "SF Mono", "Cascadia Code", Menlo (UI 也用等宽!) |
| 等宽 | JetBrains Mono |
| Heading | 16px 等宽 + 大写 + letter-spacing: 0.1em (终端命令风格) |
| Body | 13px 等宽 (略小, 等宽可读性强) |

## 4. 间距与圆角

| 元素 | 值 |
|---|---|
| 卡片 | 6px (锐利) |
| 按钮 | 4px (锐角, 终端感) |
| 弹窗 | 8px |
| Badge | 3px |

## 5. 阴影 (青色发光 + 暗影)

| 档 | 值 |
|---|---|
| sm | 0 1px 2px rgba(0,0,0,0.4) |
| md | 0 0 12px rgba(6,182,212,0.15), 0 4px 16px rgba(0,0,0,0.4) |
| lg | 0 0 24px rgba(6,182,212,0.2), 0 8px 32px rgba(0,0,0,0.6) |

## 6. 动效 (快速响应)

| 属性 | 值 |
|---|---|
| 缓动 | cubic-bezier(0.4, 0, 0.2, 1) Material |
| Fast | 80ms |
| Normal | 120ms |
| Slow | 180ms |
| 页面切换 | 80ms fade (无 translateY, 接近 instant) |

**特色动效 (字符故障 + 发光)**:
- hover: 边框 rgba(255,255,255,0.08) → rgba(6,182,212,0.3) 80ms, box-shadow 出现 12px 青色发光
- active: scale(1) → scale(0.97) → scale(1) 80ms
- focus: 2px 外环 #06B6D4 + 6px outer glow rgba(6,182,212,0.4)
- 主按钮: hover filter brightness(1.2) + 发光加强
- **错误态字符故障** (独有): danger 文本触发 `glitch` 动画, 80ms 内 3 次 RGB 偏移, 100ms 内完成
- 加载: 等宽字体 ▎ 光标闪烁 1s 循环

## 7. 边界

| 状态 | 值 |
|---|---|
| macOS 按钮 | 红/黄/绿 + 6px 同色发光 |
| 卡片激活 | 2px 青色 border-left + 12px 青色外发光 |
| 终端窗口 | 0F0F11 更深 (与主背景区分) |

## 8. 灵感来源

| 来源 | 借鉴 |
|---|---|
| [Warp](https://warp.dev) | 终端渐变高亮 + 青色发光 |
| [Helix](https://helix-editor.com) | 编辑器极简 + 等宽 |
| [GitHub Dark Dimmed](https://primer.style/foundations/color) | 暗色可读性 |

## 9. 反模式

- ❌ 纯黑 #000 — 必须用 #0A0A0B
- ❌ 高饱和青色滥用 — accent 用 #06B6D4, hover 才到 #22D3EE 亮青
- ❌ 阴影/光晕到处都是 — 仅用于激活态和浮层
- ❌ 字符故障用得太频繁 — 仅 error 状态触发
- ❌ Light 主题直接反色 — 必须重新调色 (暗底文字饱和度不同)