# Phase 5: M3.4 资源市场重构 - Plan

**Status**: done (重构)
**Goal**: 三类 install API (builtin / third_party / npx) + 删除克隆源码 + superpowers + GSD 内置源 + GSD-* 合并 + 资源浏览过滤

## Key changes
- install_builtin / install_third_party / install_npx 三类统一
- 删除克隆源码分支
- superpowers: `/plugin install superpowers@claude-plugins-official`
- GSD: `npx @opengsd/gsd-core@latest`
- GSD-* 合并为 "Get Shit Done" 分类
- 资源浏览过滤 cache/ / node_modules/ / .git/
