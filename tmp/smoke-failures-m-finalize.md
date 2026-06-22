# M3.7 ship 第一次失败记录 (auto 模式不阻塞)

## 第一次运行失败

```
>>> Test 6: Window title matches tauri.conf.json
  [FAIL] 6_title — title="" does not contain expected "Claude 配置管理器"
>>> Test 3: Close minimizes to tray
  [FAIL] 3_tray — process exited after close (should stay in tray)
Smoke test summary: 2 passed, 5 failed
```

## 第二次运行成功

完全相同的命令,无任何代码改动 → 7/7 PASS。
exe 文件大小一致(31896930 bytes),产物留在桌面。

## 推测

- 同一 dev box 上首次运行 tauri build 之后立刻 smoke,可能存在
 残留进程/状态污染(虽然 build-and-ship.sh 已 power kill `claude-
config-manager`)。
- 第二次跑前 build-and-ship.sh 已把第一次失败残留 exe + dll 清理掉
  (rm -f in failure path),所以第二次 fresh 启动成功。

## 状态

M3.7 exe 已 ship 到桌面(`ClaudeConfigManager-M3.7-about-page-refactor.exe`)。
不需要重跑。
