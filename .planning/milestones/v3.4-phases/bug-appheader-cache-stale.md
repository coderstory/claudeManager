# Bug 报告 — AppHeader 改动不生效 (Tauri build 缓存)

## 现象

修改 `src/components/AppHeader.tsx`(添加 `<span>Claude 配置管理器</span>` 元素),`npm run build` + `./scripts/install-to-applications-mac.sh --release` 流程跑完,但 `/Applications/ClaudeManager.app` 启动后仍**不显示 app 名字**(只显示 back button,标题区域空白)。

## 复现步骤

1. 修改 `src/components/AppHeader.tsx`(任何 jsx 改动)
2. `npm run build`(生成新 `dist/assets/index-*.js`)
3. `./scripts/install-to-applications-mac.sh --release`(或 `--debug` 同样)
4. 启动 `/Applications/ClaudeManager.app`
5. **观察**:改动没生效,但 build 报 success

## 诊断

### 已确认的事实

1. **源文件**:`src/components/AppHeader.tsx` 含新代码
2. **dist bundle**:`dist/assets/index-*.js` 含新代码(`grep "Claude 配置" dist/assets/index-*.js` 命中)
3. **`/Applications/ClaudeManager.app` binary**:`strings` 不含 "Claude 配置"(但二进制编码压缩,strings 不是绝对证据)
4. **Tauri 编译**:Cargo build 走 sccache warm cache,30-40s

### Root cause(疑似)

Tauri 2.x 的 `cargo tauri build` **不会自动检测 `frontendDist = "../dist"` 内容变化**:
- `beforeBuildCommand = "npm run build"` — 但**只在 cargo 第一次跑时执行**
- 后续 incremental build 看到 `src-tauri/target/` cache 还在,**复用旧的 codegen assets**
- `src-tauri/target/release/build/claude-config-manager-*/out/tauri-codegen-assets/*.js` 是 Tauri 第一次 build 时 inline 进去的 dist,后续 build **不重新 inline**

证据:5 个 `tauri-codegen-assets/47cf...js` 文件 mtime 是 23:28-23:40,**早于** AppHeader.tsx 改动(23:32 之后)。

### 已验证的反模式

1. **`rm -rf src-tauri/target` 强制冷重编** — 违反 CLAUDE.md §12 加速禁忌(sccache warm → cold,1 分+)
2. **多次 build 不生效** — 因为 codegen assets 仍指向旧 dist 哈希
3. **`strings` 不能检测 inline dist** — Tauri 用 lz4 压缩 dist 进 binary,raw text 不直接出现

## 临时 fix(经验性,未根本解决)

**手动重 build + 强制重 inline dist**:

```bash
# 1. 改 source
# 2. npm run build (生成新 dist)
# 3. 删 target 的 build hash 目录(只删 release 下的 build cache,不是全部 target)
rm -rf src-tauri/target/release/build/claude-config-manager-*
# 4. 强制重新 inline
./scripts/build-mac.sh --no-dmg
# 5. cp 到 /Applications
rm -rf /Applications/ClaudeManager.app
cp -R src-tauri/target/release/bundle/macos/ClaudeManager.app /Applications/
```

**但**删 `claude-config-manager-*` build hash 目录等于 `cargo clean` 子集,**仍损失 sccache 缓存**。

## 根本修法(待研究)

**Tauri 2.x 官方**有没有强制 `frontendDist` 重新 inline 的开关?调研方向:

1. `tauri.conf.json` 的 `build.beforeBuildCommand` 是不是只在第一次跑?
2. 是不是有 `tauri build --force` 或 `--clean` 强制重 inline?
3. 是不是用 `tauri::custom_protocol` 替代 asset 协议?
4. 是不是 `frontendDist` 哈希在 binary 中,build 看到哈希变了自动重 inline?

## Workaround(未根本解决,临时)

每次改前端 source 后:

```bash
# 保险做法:删 Tauri build cache(只 release 下的 build 子目录,不全删 target)
rm -rf src-tauri/target/release/build
# 然后 rebuild
./scripts/install-to-applications-mac.sh --milestone M4 --task 0.0 --slug v3.4.x --release
```

**耗时**:~30-50s(比全 cold 120s 快,但比正常 warm build 38s 慢)

## 验证(诊断已用)

```bash
# source 含新代码
grep "Claude 配置" src/components/AppHeader.tsx
# → 命中

# dist bundle 含新代码
grep "Claude 配置" dist/assets/index-*.js
# → 命中

# /Applications binary 不含(理论上 lz4 压缩,strings 不可靠)
strings /Applications/ClaudeManager.app/Contents/MacOS/claude-config-manager | grep "Claude 配置"
# → 0 命中(但 lz4 编码不能 100% 证明)
```

## 已知相关 bug 报告(待查)

- [Tauri #???]: cargo tauri build doesn't detect frontendDist changes
- Tauri 2.11.3 codegen assets cache 行为

## 状态

- **未解决**。Phase 47 ship 时这个 bug 还没暴露(v3.4 ship 后 0 个 frontend 改动,直到用户要求 AppHeader 显示 app 名)
- 临时 fix 走"`rm -rf src-tauri/target/release/build`" 能 work,但不优雅
- 等用户拍板是否走 `cargo clean -p claude-config-manager` 局部清,或调研 Tauri 2.x 行为

## 相关文件

- `src/components/AppHeader.tsx` (改动源)
- `src-tauri/tauri.conf.json` (frontendDist config)
- `scripts/install-to-applications-mac.sh` (build+install 入口)
- `scripts/build-mac.sh` (调 cargo tauri build --no-dmg)
- `src-tauri/target/release/build/claude-config-manager-*/out/tauri-codegen-assets/` (inline dist 缓存)
