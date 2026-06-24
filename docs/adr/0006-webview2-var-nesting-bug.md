# ADR 0006: WebView2 var() 嵌套 bug workaround

## 状态
Accepted (2026-06-24)

## 背景
WebView2 Runtime < 102.0.1245.146 不解析 CSS `var()` 嵌套 (如 `var(--modal-confirm-bg, var(--bg-primary))`).
导致 anime 主题弹窗 token 无法继承基础 token.

## 决策
6+2 个 --modal-* token 直接写死颜色值, 注释标注 TODO 升级 WebView2 版本号.

## 后果
- ✅ 弹窗颜色一致
- ❌ 基础 token 变更时需同步更新 modal token

## TODO
- 升级 WebView2 Runtime ≥ 102.0.1245.146
- 改回 var() 嵌套
- 删除 ADR
