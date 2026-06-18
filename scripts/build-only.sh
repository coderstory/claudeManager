#!/usr/bin/env bash
# scripts/build-only.sh — 仅编译（不复制、不冒烟）
#
# 用法：
#   ./scripts/build-only.sh            # cargo build（debug）
#   ./scripts/build-only.sh --release  # cargo build --release
#   ./scripts/build-only.sh --clean    # 先 cargo clean 再 build（强制全量重编）
#   ./scripts/build-only.sh --check    # 只跑 cargo check（不生成 exe）
#
# 用于：开发循环快速验证编译通过 / 全量重建 / 类型检查

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

MODE="debug"
ACTION="build"
EXTRA_ARGS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) MODE="release"; shift ;;
    --clean)   ACTION="clean-build"; shift ;;
    --check)   ACTION="check"; shift ;;
    *)         EXTRA_ARGS="$EXTRA_ARGS $1"; shift ;;
  esac
done

if [[ "$ACTION" == "clean-build" ]]; then
  echo ">>> cargo clean (release profile target)" >&2
  cargo clean --manifest-path src-tauri/Cargo.toml --release 2>&1 | tail -5 || true
  ACTION="build"
fi

START=$(date +%s)

case "$ACTION" in
  build)
    if [[ "$MODE" == "release" ]]; then
      echo ">>> cargo build --release" >&2
      cargo build --release --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
      OUTPUT_DIR="src-tauri/target/release"
    else
      echo ">>> cargo build (debug)" >&2
      cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
      OUTPUT_DIR="src-tauri/target/debug"
    fi
    EXE_PATH="$PROJECT_ROOT/$OUTPUT_DIR/claude-config-manager.exe"
    if [[ -f "$EXE_PATH" ]]; then
      SIZE=$(stat -c%s "$EXE_PATH" 2>/dev/null || stat -f%z "$EXE_PATH" 2>/dev/null || echo "?")
      SIZE_MB=$(awk "BEGIN {printf \"%.1f\", $SIZE/1024/1024}")
      echo "" >&2
      echo "OK: $EXE_PATH ($SIZE_MB MB)" >&2
    else
      echo "FAIL: exe not found at expected path" >&2
      exit 1
    fi
    ;;
  check)
    echo ">>> cargo check" >&2
    cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
    ;;
esac

END=$(date +%s)
echo ">>> Build took $((END - START))s" >&2