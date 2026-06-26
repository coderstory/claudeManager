# liquid-glass · 液态玻璃

## 1. 设计理念 (3 句)

macOS Sonoma+ 的 Liquid Glass 设计语言: 背景多层渐变, 卡片玻璃质感半透叠加, 紫蓝主色营造高级感. 灵感: Raycast 启动台 + Apple Notes + macOS 控制中心 frosted glass. 适合展示/演讲场景.

## 2. 色系

| 类别 | 值 |
|---|---|
| 背景 primary | linear-gradient(135deg, #C7D2FE 0%, #E0E7FF 25%, #FCE7F3 50%, #FED7AA 100%) |
| 背景 elevated | rgba(255,255,255,0.5) |
| 背景 overlay | rgba(255,255,255,0.7) |
| 文字 primary | #1E1B4B 深靛 14.8:1 AAA |
| 文字 secondary | #4338CA 紫蓝 7.2:1 AAA |
| 文字 muted | #6366F1 (opacity 0.7) |
| 品牌 accent | #6366F1 紫蓝 |
| 品牌 accent-gradient | linear-gradient(135deg, #6366F1, #8B5CF6) |
| 品牌 accent-soft | rgba(99,102,241,0.15) |
| 品牌 accent-strong | #4F46E5 |
| 品牌 fg-on | #FFFFFF |
| 状态 success | #10B981 翠绿 4.6:1 AA |
| 状态 warning | #F59E0B 琥珀 3.4:1 (大字号 OK) |
| 状态 danger | #EF4444 红 4.8:1 AA |
| 状态 info | #3B82F6 蓝 |
| 边框 | rgba(255,255,255,0.6) |

## 3. 字体

| 类型 | 栈 |
|---|---|
| UI | "SF Pro Display", -apple-system, "PingFang SC", system-ui |
| 等宽 | "SF Mono", "Cascadia Code", Menlo |
| Heading | 22px / 600 (展示感) |
| Body | 14px |

## 4. 间距与圆角

| 元素 | 值 |
|---|---|
| 卡片 | 14px (圆润) |
| 按钮 | 10px |
| 弹窗 | 16px |
| Badge | 6px |

## 5. 阴影 (紫调柔光)

| 档 | 值 |
|---|---|
| sm | 0 1px 2px rgba(99,102,241,0.08) |
| md | 0 4px 16px rgba(99,102,241,0.12), 0 8px 32px rgba(99,102,241,0.08) |
| lg | 0 8px 32px rgba(99,102,241,0.15), 0 16px 64px rgba(99,102,241,0.10) |

## 6. 动效

| 属性 | 值 |
|---|---|
| 缓动 | cubic-bezier(0.34, 1.56, 0.64, 1) 弹性 |
| Fast | 180ms |
| Normal | 280ms |
| Slow | 420ms |

**特色动效 (玻璃折射)**:
- hover: 卡片 backdrop-blur 10px → 20px 200ms 渐变
- active: scale(1) → scale(0.98) → scale(1) 280ms bounce
- focus: 1px 外环 #6366F1 + 4px outer glow
- 页面切换: 整页 fade + scale(0.96) → scale(1) 280ms 玻璃折射
- 主按钮: gradient bg + hover brightness(1.1) saturate(1.2)

**磨砂 3 档**: blur(10/20/30px) saturate(180%)

## 7. 边界

| 状态 | 值 |
|---|---|
| 弹窗遮罩 | rgba(99,102,241,0.18) + blur(3px) |
| 弹窗背景 | rgba(255,255,255,0.78) + blur(40px) saturate(200%) |
| 弹窗内按钮 | linear-gradient(135deg, #6366F1, #8B5CF6) |

## 8. 灵感来源

| 来源 | 借鉴 |
|---|---|
| [Raycast](https://raycast.com) | 启动台玻璃质感 |
| [macOS Sonoma](https://apple.com/macos/sonoma) | Liquid Glass 系统材质 |
| [Figma](https://figma.com) | 工具栏 backdrop-blur |

## 9. 反模式

- ❌ Windows 10 上 backdrop-filter 性能差 — 用 `@supports` 检查, 降级为不透明白底
- ❌ 玻璃卡片叠玻璃卡片 3 层以上 — 限制最多 2 层
- ❌ 渐变背景 4 色相以上 — 3 色封顶
- ❌ backdrop-blur 用在 button / badge 等小元素 — 只用于大容器