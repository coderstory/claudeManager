#!/usr/bin/env bash
# scripts/test-verify.sh — Tauri unit test 编译验证 + WebView2Loader.dll 复制
#
# 重要: Tauri v2 项目因 webview2-com 静态链接 + 160KB WebView2Loader.dll fake stub,
# `cargo test` 实际跑必撞 0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND。
# 正确做法: 用 `cargo build --tests` 验证编译 (纯编译, never invoke test executable),
# 功能验证走 scripts/build-and-ship.sh + scripts/smoke-test.sh (CLAUDE.md §9.4 7/7)。
#
# 用法: scripts/test-verify.sh [extra cargo build args]
#   无参数 = 编译全部 test executables
#   带参数 = 转发给 `cargo build --tests`
#
# 退出码: 0 = 编译过 / 1 = 失败 / 124 = 超时

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Note: Windows windres PATH auto-fix is in build-and-ship.sh / build-only.sh.
# This script (test-verify) doesn't call cargo, so it doesn't need windres.

cd "${PROJECT_ROOT}/src-tauri"

echo "=== test-verify: Tauri unit test 编译验证 ==="
echo "策略: cargo build --tests (纯编译, never invoke test executable)"
echo "原因: Tauri v2 静态链接 webview2-com + 160KB WebView2Loader.dll fake stub"
echo "      实际跑 cargo test 必撞 0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND"
echo ""

# 1 行 cp: 把 WebView2Loader.dll 复制到 test exe 同目录
# (target/debug/deps/ 是 cargo build --tests 输出 test exe 的目录)
DLL_SRC="target/debug/WebView2Loader.dll"
DLL_DST="target/debug/deps/WebView2Loader.dll"
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "MSYS"* ]]; then
  cp -f "$DLL_SRC" "$DLL_DST" 2>/dev/null || true
  echo "[1/2] WebView2Loader.dll 已 cp 到 deps/ (no-op if already exists)"
else
  echo "[1/2] Skipped WebView2Loader.dll copy (macOS/Linux — no DLL needed)"
fi

# 编译验证 (cargo build --tests 是纯编译, never invoke)
timeout 180 cargo build --tests "$@" 2>&1

echo ""
echo "=== test-verify 编译结果 ==="
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "MSYS"* ]]; then
  EXE_COUNT=$(find target/debug/deps -maxdepth 1 -name "*.exe" 2>/dev/null | wc -l | tr -d ' ')
  echo "编译通过"
  echo "   生成 test executables: ${EXE_COUNT}"
  echo "   列表 (前 20):"
  find target/debug/deps -maxdepth 1 -name "*.exe" 2>/dev/null | head -20
else
  EXE_COUNT=$(find target/debug/deps -maxdepth 1 -type f -executable 2>/dev/null | wc -l | tr -d ' ')
  echo "编译通过"
  echo "   生成 test executables: ${EXE_COUNT}"
  echo "   列表 (前 20):"
  find target/debug/deps -maxdepth 1 -type f -executable 2>/dev/null | head -20
fi
echo ""
echo "   注意: 不要 cargo test 实际跑 (Tauri 已知限制)"
echo "   功能验证走: scripts/build-and-ship.sh + scripts/smoke-test.sh (7/7)"
exit 0
