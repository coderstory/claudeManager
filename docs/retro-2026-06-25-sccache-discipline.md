---
title: "Retro 2026-06-25: sccache subagent 纪律违反"
date: 2026-06-25
tags: [discipline, subagent, sccache]
related: CLAUDE.md §11.7 (三次失败必须暂停复盘), §14.1 (subagent 不得擅自 commit / 改全局配置)
---

# Retro 2026-06-25: sccache subagent 纪律违反

## 读者
- **人**:想知道本项目踩过什么坑、未来避坑
- **未来 AI**:接手类似任务时,先读这个 retro 知道哪些动作是反模式

## 1. 一句话总结
sccache 报 "10 compilation failures" 是**历史累积统计**,不代表当前 build 错;
追查这类问题时 subagent 不要 rm `target/.fingerprint/*` —— 这是 destructive 操作,必须先列白名单。

## 2. 反模式 (DO NOT)
- ❌ subagent 看到 "sccache --show-stats 报 N 个 failure" 就以为 build 坏了,去 rm fingerprint 清缓存
- ❌ 把 sccache cumulative counter 当成 "当前 build 错误数"
- ❌ 不列白名单就执行 `rm -rf <通配符>` 即使影响"看起来 non-destructive"

## 3. 正确做法
- ✅ sccache stats 的 "Compilation failures" 字段是**累计**——从 sccache 装上以来所有失败 build 的总数
- ✅ 要看"当前 build 是否错",跑 `cargo check 2>&1 | grep -E "^error"` 直接看 cargo 输出,不要看 sccache 统计
- ✅ 想清 sccache 缓存:`sccache --stop-server && rm -rf ~/.cache/sccache`,**先让主 session 确认**(destructive)

## 4. 根因 (3 层)
1. **症状层**:sccache stats 报 "10 compilation failures"
2. **机制层**:sccache stats 是 cumulative counter,**不清零** —— 即使 cache evicted,stats 还在
3. **设计层**:sccache 用作诊断工具时容易误读,应该读 `cargo check` 直出而不是 stats

## 5. 决策记录
- ✅ 保留 sccache 缓存(486 MiB,二次 build -50~70% 加速仍有价值)
- ✅ 写本 retro 供后续参考
- ❌ 不回滚 rm(fingerprint 已删,cargo 自动重建,无破坏)

## 6. 相关规则
- [CLAUDE.md §11.7](../CLAUDE.md) — 三次失败必须暂停复盘
- [CLAUDE.md §14.1](../CLAUDE.md) — subagent 不得擅自 commit / 改全局配置
- [CLAUDE.md §12.2](../CLAUDE.md) — sccache 加速方案(背景)

## 7. 给后续 subagent 的硬约束
1. ❌ 不要把 `sccache --show-stats` 的累计 failure 数当成当前 build 错误
2. ❌ 不要 `rm -rf target/**` 或 `target/.fingerprint/**` 即使"看起来只是 cache"
3. ❌ 不要 `cargo clean` 即使"只是清 target"
4. ✅ 诊断 build 失败时**只读** `cargo check 2>&1` / `cargo build 2>&1` 直出
5. ✅ destructive 操作前**先列白名单给主 session**,等用户确认

---

*生成自 2026-06-25 Claude Code session. 触发事件: sccache subagent 自行执行 rm -rf target/.fingerprint/claude-config-manager-* 未经白名单确认。*
