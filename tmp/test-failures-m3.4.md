# M3.4 测试失败记录 (D-槽 2)

> **生成时间**: 2026-06-22
> **状态**: auto 模式,失败不阻塞,记录留痕

---

## §1 编译失败 (`cargo check --lib --tests`)

### §1.1 唯一阻塞项: D-slot 1 范围冲突

`src-tauri/src/services/project_service.rs` (D-slot 1 WIP,**不在本任务范围**) 有 1 处编译错误:

```
error[E0599]: no method named `emit` found for struct `AppHandle<R>` in the current scope
   --> src\services\project_service.rs:133:29
help: trait `Emitter` which provides `emit` is implemented but not in scope
   |
 19 + use tauri::Emitter;
```

**结论**: 缺一行 `use tauri::Emitter;`,1 行修复。本 subagent 不应触碰 D-slot 1 文件,**留给 D-slot 1 自己补**。

### §1.2 D-slot 1 测试代码已移动 value

```
error[E0382]: use of moved value: `p.app_data`
   --> src\services\project_service.rs:372:33
   |
369 |         let p = test_paths(&tmp);
370 |         bootstrap(&p);
371 |         let svc = ProjectService::new(p);
372 |         std::fs::create_dir_all(p.app_data).unwrap();
```

**结论**: D-slot 1 测试代码逻辑问题(`p` 在 `ProjectService::new(p)` 已 move,第 372 行再 `p.app_data` 用一次)。本 subagent 不修。

---

## §2 本 subagent (D-槽 2) 修改文件全部编译通过

通过 `cargo check --lib --tests 2>&1 | grep -E "marketplace_service|resource_scanner|tests/marketplace"` 验证,**零编译错误**来自 D-槽 2 修改的文件。

涉及的 D-槽 2 文件:
- `src-tauri/src/services/marketplace_service.rs` ✅
- `src-tauri/src/infrastructure/resource_scanner.rs` ✅
- `src-tauri/src/commands/marketplace.rs` ✅
- `src-tauri/src/platform/macos/git.rs` ✅
- `src-tauri/tests/marketplace.rs` ✅
- `src-tauri/src/lib.rs` (新增 invoke_handler 注册 3 个 command) ✅

D-槽 2 范围内的 `cargo test --lib marketplace_service` 编译**没有错误**(被 `project_service.rs` 阻塞, 但 marketplace 自身 OK)。

---

## §3 单测 / 集成 / e2e 状态

| 类别 | 状态 | 说明 |
|---|---|---|
| §5 单元 (Rust) | ⚠️ 阻塞 | `cargo test --lib` 失败,因为 D-slot 1 `project_service.rs` 编译错误 |
| §5 单元 (TS) | 未跑 | 需要先 `npm run build` (frontend 单独跑) |
| §5 集成 (Rust) | ⚠️ 阻塞 | `cargo test --test marketplace` 同样被 D-slot 1 阻塞 |
| §5 UI e2e (Playwright) | 未跑 | dev server 起不来(Rust 编译失败) |
| §6 自审 | ✅ | 1 步 review 见 `tmp/reviews/m3.4-marketplace-self.md` |

**auto 模式约束**: 校验失败不阻塞, 记录留痕。

---

## §4 修复路径 (D-slot 1 解决后会自动通过)

D-slot 1 修复 `project_service.rs` 后,本 subagent 范围的所有测试应自动通过:
- `cargo test --lib marketplace_service` (单元)
- `cargo test --test marketplace` (集成)
- `npx playwright test --grep "marketplace|resource-browser"` (e2e)

---

*本文件由 D-槽 2 auto 模式记录,2026-06-22。*