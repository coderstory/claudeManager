#!/usr/bin/env bash
# scripts/lint-plugin-coupling.sh — Phase 47 强验收: 5 phase grep lint 总扫
#
# 跑法: bash scripts/lint-plugin-coupling.sh
# 退出码: 0 = 14/14 PASS / 1 = 任一 FAIL
#
# 14 条规则 (Phase 42/43/44/45/46 DECISIONS §强验收 聚合):
#   Phase 42 (4):  inventory::submit! IPC dispatch 派生收敛
#     1. lib.rs 0 行 generate_handler!
#     2. lib.rs 0 行 inventory::iter 手工枚举
#   Phase 43 (5):  MenuRegistry + core-plugin
#     3. lib.rs 0 行 MenuItem::with_id / on_menu_event (排除注释行)
#     4. platform/macos/app_menu.rs 不存在
#     5. platform/windows/app_menu.rs 不存在
#     6. plugins/mod.rs 第一行 register 是 CorePlugin
#     7. src-tauri 不含 IPlatformAppMenu / MacAppMenu / WindowsAppMenu / app_menu_build_dispatch
#   Phase 44 (3):  前端 route 派生
#     8. App.tsx 0 行 view === 'x' 三元链 (排除注释)
#     9. useViewState.tsx 0 行 ALL_VIEWS = [ 手写
#    10. AppSidebar.tsx 0 行 VIEW_META = { 手写
#   Phase 45 (1):  service plugin 派生
#    11. app_state.rs 0 行 Arc<crate::services> (ServiceRegistry 单源)
#   Phase 46 (3):  stale-route 迁移 + 删 mcp-management
#    12. mcp-management.tsx stub 不存在
#    13. plugin-registry.test.ts 含 'length).toBe(8)' 断言 (8 stub)
#    14. fromViewId 字段唯一性 (migrateFrom destinations 必须唯一)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/src-tauri/src"
FE="$REPO_ROOT/src"
FAIL=0
PASS=0

# helper: increment counters and print label
check() {
  local id="$1" desc="$2" ok="$3"
  if [ "$ok" = "1" ]; then
    echo "[PASS] rule $id: $desc"
    PASS=$((PASS+1))
  else
    echo "[FAIL] rule $id: $desc"
    FAIL=$((FAIL+1))
  fi
}

# --- Phase 42 rules ---

# 规则 1: lib.rs 0 行 generate_handler! (允许注释)
R1_HITS=$(grep -nE 'generate_handler!' "$SRC/lib.rs" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' || true)
if [ -z "$R1_HITS" ]; then check 1 "lib.rs 无 generate_handler!" 1; else
  echo "  hits: $R1_HITS"; check 1 "lib.rs 无 generate_handler!" 0
fi

# 规则 2: lib.rs 0 行 inventory::iter 手工枚举 (允许注释)
R2_HITS=$(grep -nE 'inventory::iter\(\)' "$SRC/lib.rs" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' || true)
if [ -z "$R2_HITS" ]; then check 2 "lib.rs 无 inventory::iter 手工枚举" 1; else
  echo "  hits: $R2_HITS"; check 2 "lib.rs 无 inventory::iter 手工枚举" 0
fi

# --- Phase 43 rules ---

# 规则 3: lib.rs 0 行 MenuItem::with_id / on_menu_event (排除注释)
R3_HITS=$(grep -nE 'MenuItem::with_id|on_menu_event' "$SRC/lib.rs" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' || true)
if [ -z "$R3_HITS" ]; then check 3 "lib.rs 无 MenuItem::with_id / on_menu_event (非注释)" 1; else
  echo "  hits: $R3_HITS"; check 3 "lib.rs 无 MenuItem::with_id / on_menu_event (非注释)" 0
fi

# 规则 4: platform/macos/app_menu.rs 不存在
if [ ! -f "$SRC/platform/macos/app_menu.rs" ]; then
  check 4 "platform/macos/app_menu.rs 不存在" 1
else
  check 4 "platform/macos/app_menu.rs 不存在" 0
fi

# 规则 5: platform/windows/app_menu.rs 不存在
if [ ! -f "$SRC/platform/windows/app_menu.rs" ]; then
  check 5 "platform/windows/app_menu.rs 不存在" 1
else
  check 5 "platform/windows/app_menu.rs 不存在" 0
fi

# 规则 6: plugins/mod.rs 第一行 register 是 CorePlugin
R6_FIRST=$(grep -n 'host.register' "$SRC/plugins/mod.rs" 2>/dev/null | head -1 || true)
if echo "$R6_FIRST" | grep -q 'CorePlugin'; then
  check 6 "plugins/mod.rs 第一行 register 是 CorePlugin" 1
else
  echo "  first register: $R6_FIRST"
  check 6 "plugins/mod.rs 第一行 register 是 CorePlugin" 0
fi

# 规则 7: src-tauri 不含 IPlatformAppMenu / MacAppMenu / WindowsAppMenu / app_menu_build_dispatch
R7_HITS=$(grep -rn 'IPlatformAppMenu\|MacAppMenu\|WindowsAppMenu\|app_menu_build_dispatch' "$SRC/" 2>/dev/null || true)
if [ -z "$R7_HITS" ]; then check 7 "src-tauri 无 legacy AppMenu 残留" 1; else
  echo "  hits: $R7_HITS"; check 7 "src-tauri 无 legacy AppMenu 残留" 0
fi

# --- Phase 44 rules ---

# 规则 8: App.tsx 0 行 view === 'x' 三元链 (排除注释 / 注释 JSDoc)
R8_HITS=$(grep -nE "view === '[a-z-]+'" "$FE/App.tsx" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' \
  | grep -vE '^[0-9]+:\s*\*' || true)
if [ -z "$R8_HITS" ]; then check 8 "App.tsx 无 view === 'x' 三元链 (非注释)" 1; else
  echo "  hits: $R8_HITS"; check 8 "App.tsx 无 view === 'x' 三元链 (非注释)" 0
fi

# 规则 9: useViewState.tsx 0 行 ALL_VIEWS = [ 手写
R9_HITS=$(grep -nE 'ALL_VIEWS.*=.*\[' "$FE/hooks/useViewState.tsx" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' \
  | grep -vE '^[0-9]+:\s*\*' \
  | grep -vE 'ALL_VIEWS:' || true)
if [ -z "$R9_HITS" ]; then check 9 "useViewState.tsx 无 ALL_VIEWS 手写 (派生收敛)" 1; else
  echo "  hits: $R9_HITS"; check 9 "useViewState.tsx 无 ALL_VIEWS 手写 (派生收敛)" 0
fi

# 规则 10: AppSidebar.tsx 0 行 VIEW_META = { 手写
R10_HITS=$(grep -nE 'VIEW_META.*=.*\{' "$FE/components/AppSidebar.tsx" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' \
  | grep -vE '^[0-9]+:\s*\*' \
  | grep -vE 'VIEW_META:' || true)
if [ -z "$R10_HITS" ]; then check 10 "AppSidebar.tsx 无 VIEW_META 手写 (派生收敛)" 1; else
  echo "  hits: $R10_HITS"; check 10 "AppSidebar.tsx 无 VIEW_META 手写 (派生收敛)" 0
fi

# --- Phase 45 rules ---

# 规则 11: app_state.rs 0 行 Arc<crate::services> 单字段 (ServiceRegistry 是单源)
R11_HITS=$(grep -nE 'Arc<crate::services::' "$SRC/app_state.rs" 2>/dev/null \
  | grep -vE '^[0-9]+:\s*//' \
  | grep -vE '^[0-9]+:\s*\*' || true)
if [ -z "$R11_HITS" ]; then check 11 "app_state.rs 无 Arc<crate::services::*> 单字段 (ServiceRegistry 单源)" 1; else
  echo "  hits: $R11_HITS"; check 11 "app_state.rs 无 Arc<crate::services::*> 单字段 (ServiceRegistry 单源)" 0
fi

# --- Phase 46 rules ---

# 规则 12: mcp-management.tsx stub 不存在
if [ ! -f "$FE/plugins/stubs/mcp-management.tsx" ]; then
  check 12 "mcp-management.tsx stub 不存在 (Phase 46 D-44-A 关闭)" 1
else
  check 12 "mcp-management.tsx stub 不存在 (Phase 46 D-44-A 关闭)" 0
fi

# 规则 13: plugin-registry.test.ts 含 'length).toBe(8)' 断言
if grep -q "length).toBe(8)" "$FE/__tests__/plugin-registry.test.ts" 2>/dev/null; then
  check 13 "plugin-registry.test.ts 断言 8 stub (D-44-A)" 1
else
  check 13 "plugin-registry.test.ts 断言 8 stub (D-44-A)" 0
fi

# 规则 14: fromViewId 字段唯一性 (migrateFrom destinations 必须唯一)
# 收集所有 stubs/*.{tsx,ts} 中 migrateFrom.fromViewId 的字面值,duplicates 即 FAIL
R14_DUPES=$(
  grep -rE "fromViewId:" "$FE/plugins/stubs/" 2>/dev/null \
    | grep -oE "fromViewId:[[:space:]]*['\"][^'\"]+['\"]" \
    | sed -E "s/fromViewId:[[:space:]]*['\"]([^'\"]+)['\"].*/\1/" \
    | sort \
    | uniq -d || true
)
if [ -z "$R14_DUPES" ]; then check 14 "fromViewId 字段值唯一 (无冲突)" 1; else
  echo "  duplicates: $R14_DUPES"
  check 14 "fromViewId 字段值唯一 (无冲突)" 0
fi

# --- Summary ---

echo ""
echo "============================================="
echo "  Phase 47 lint-plugin-coupling.sh"
echo "  PASS: $PASS / 14"
echo "  FAIL: $FAIL / 14"
echo "============================================="
exit $FAIL
