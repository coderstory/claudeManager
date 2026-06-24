# M-reship White-list — D-槽2 marketplace ship 重跑

> 任务: 重跑 ship 命令 (D-槽2 marketplace-refactor)
> 原则: §2.4 "每次文件修改必须有充分证据 + 禁止'既然要改顺便把 X 也改了'"

## 本次任务改动文件清单

**零文件改动**。

本任务范围 = 纯 ship:
- Step 1: `cargo check` + `npm run build` (只读检查)
- Step 2: `scripts/build-and-ship.sh` (编译 + 拷贝 + smoke)
- Step 3: `ls` 验证产物

未触碰任何源码 / 配置 / 文档 / 规划文件:
- ❌ 未触碰 src-tauri/src/** (包括 marketplace.rs / project.rs / project_service.rs — D-槽2 / D-槽1 改的范围)
- ❌ 未触碰 src/** (前端)
- ❌ 未触碰 scripts/** (脚本)
- ❌ 未触碰 .planning/ / CLAUDE.md / SPEC.md / PROJECT.md / ROADMAP.md / STATE.md / HANDOFF.json
- ❌ 未触碰 Cargo.toml / package.json / tauri.conf.json
- ✅ 仅产出日志文件 (tmp/reviews/m-reship-self.md, tmp/white-list-m-reship.md)

## 产物 (非源码改动, 允许)

- `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.4-marketplace-refactor.exe` (31.8 MB, 由 ship 脚本 cp, 不是我手动生成)
- `~/Desktop/ClaudeConfigManager-M3/WebView2Loader.dll` (由 ship 脚本 cp)

## 结论

白名单文件数 = **0**。完全符合 §2.4 纪律。
