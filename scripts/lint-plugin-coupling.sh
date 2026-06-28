#!/usr/bin/env bash
# scripts/lint-plugin-coupling.sh — Phase 43 MenuRegistry 强验收
#
# 跑法: bash scripts/lint-plugin-coupling.sh
# 退出码: 0 = 通过 / 1 = 违反任一规则
#
# 4 项强验收:
#   1. lib.rs 0 行 MenuItem::with_id / on_menu_event
#   2. platform/{macos,windows}/app_menu.rs 不存在
#   3. src-tauri/src/ 不含 IPlatformAppMenu / MacAppMenu /
#      WindowsAppMenu / app_menu_build_dispatch
#   4. core 必须 plugins/mod.rs 第一行 register

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/src-tauri/src"
FAIL=0

# 规则 1: lib.rs 0 行 MenuItem::with_id / on_menu_event
# (允许注释行,毕竟 Phase 43 删除时需要留指针)
if grep -nE 'MenuItem::with_id|on_menu_event' "$SRC/lib.rs" \
    | grep -vE '^[0-9]+:\s*//'; then
    echo "[FAIL] lib.rs 仍含 MenuItem::with_id / on_menu_event (非注释行)"
    FAIL=1
fi

# 规则 2: platform/{macos,windows}/app_menu.rs 不存在
for p in macos windows; do
    if test -f "$SRC/platform/$p/app_menu.rs"; then
        echo "[FAIL] platform/$p/app_menu.rs 仍存在"
        FAIL=1
    fi
done

# 规则 3: src-tauri/src/ 不含 IPlatformAppMenu / MacAppMenu /
# WindowsAppMenu / app_menu_build_dispatch
if grep -rn 'IPlatformAppMenu\|MacAppMenu\|WindowsAppMenu\|app_menu_build_dispatch' "$SRC/"; then
    echo "[FAIL] IPlatformAppMenu / MacAppMenu / WindowsAppMenu / app_menu_build_dispatch 残留"
    FAIL=1
fi

# 规则 4: core 必须 plugins/mod.rs 第一行 register
FIRST_REGISTER=$(grep -n 'host.register' "$SRC/plugins/mod.rs" | head -1)
if ! echo "$FIRST_REGISTER" | grep -q 'CorePlugin'; then
    echo "[FAIL] plugins/mod.rs 第一行 register 不是 CorePlugin: $FIRST_REGISTER"
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "[PASS] Phase 43 MenuRegistry 强验收 4/4 通过"
fi
exit $FAIL