# light · 极简卡片

## 1. 设计理念 (3 句)

Linear / Vercel / GitHub Primer 三家混合: 大量留白让信息呼吸, 微细边框代替阴影, 黑灰主色保持克制, 单一品牌色突出关键操作. 默认主题, 适合日常长时间使用.

## 2. 色系

| 类别 | 值 | WCAG |
|---|---|---|
| 背景 primary | #FAFAF7 瓷白 | — |
| 背景 elevated | #FFFFFF 纯白 | — |
| 背景 overlay | rgba(0,0,0,0.04) | — |
| 文字 primary | #1F2328 深炭 | 14.5:1 AAA |
| 文字 secondary | #656D76 灰 | 4.7:1 AA |
| 文字 muted | #8B949E 浅灰 | 3.0:1 (辅助) |
| 品牌 accent | #0969DA 蓝 | 5.9:1 AA |
| 品牌 accent-soft | #DDF4FF 浅蓝 | — |
| 品牌 accent-strong | #0860C7 深蓝 | — |
| 品牌 fg-on | #FFFFFF | — |
| 状态 success | #388E3C 绿 | 5.0:1 AA |
| 状态 warning | #F57C00 橙 | 4.6:1 AA |
| 状态 danger | #D32F2F 红 | 5.9:1 AA |
| 状态 info | #0969DA 蓝 | — |
| 边框 | #E1E4E8 灰 1px | — |

## 3. 字体

| 类型 | 栈 |
|---|---|
| UI | -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif |
| 等宽 | "Cascadia Code", "SF Mono", Menlo, Consolas, monospace |
| Heading | 18px / 600 |
| Body | 14px / 400 |
| Caption | 12px / 400 |

## 4. 间距与圆角

| 元素 | 值 |
|---|---|
| 卡片 | 8px |
| 按钮 | 6px |
| 弹窗 | 12px |
| Badge | 3px |
| 4px 网格 | space-1..12 = 4/8/12/16/24/32/48 |

## 5. 阴影与发光

| 档 | 值 |
|---|---|
| sm | 0 1px 2px rgba(0,0,0,0.04) |
| md | 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04) |
| lg | 0 4px 16px rgba(0,0,0,0.08), 0 16px 48px rgba(0,0,0,0.12) |

## 6. 动效

| 属性 | 值 |
|---|---|
| 缓动 | cubic-bezier(0.16, 1, 0.3, 1) 微弹簧 (Vercel) |
| Fast | 120ms |
| Normal | 180ms |
| Slow | 280ms |
| 页面切换 | 180ms fade + translateY(4px) 反弹 |

**特色动效**:
- hover: 边框 0.5px → 1.5px (色更深), 80ms
- active: 卡片 scale(0.99) → scale(1) 120ms 弹性
- focus: 2px 外环 #0969DA, 偏移 2px, 80ms
- 无 backdrop-blur / 无渐变 / 无水墨

## 7. 边界 (状态色具体值)

| 状态 | 应用 | 颜色 |
|---|---|---|
| 禁用 | opacity 0.4 | rgba(0,0,0,0.4) |
| 错误 | danger | #D32F2F |
| 警告 | warning | #F57C00 |
| 成功 | success | #388E3C |

## 8. 灵感来源

| 来源 | 借鉴 |
|---|---|
| [Linear](https://linear.app) | 卡片节奏 + 微细边框 |
| [Vercel](https://vercel.com) | 中性灰体系 + 蓝色焦点环 |
| [GitHub Primer](https://primer.style) | 字号梯度 + 可访问性 |

## 9. 反模式

- ❌ 渐变背景 / 阴影满天飞 / 圆胖 20px+ (AI 味来源)
- ❌ emoji 当图标 (应使用单色 1.5px 描边 lucide)
- ❌ 鲜艳状态色 (荧光绿/荧光红) — 应保持工具感