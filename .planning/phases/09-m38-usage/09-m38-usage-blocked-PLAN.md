# Phase 9: M3.8 用量查询修 bug - Plan

**Status**: BLOCKED (D14)
**Goal**: 用量查询 (HTTP 客户端 + 错误处理 + 缓存 + UI)
**Depends on**: Phase 8 (M3.7) + **D14 用户拍板 (BLOCKED)**
**Requirements**: 清单 19 (P0)

## BLOCKER — D14 待问用户
根据 API key 来源 (用户手动 / OAuth / 本地代理) 决定技术路线。
需要用户回答才能开始实现。

## When unblocked
1. HTTP 客户端 (Anthropic / OpenAI / 第三方代理)
2. 错误处理 401/429/network/格式
3. 5-min in-memory + 磁盘 fallback 缓存
4. UI 表格
5. mock HTTP 4 场景测试
