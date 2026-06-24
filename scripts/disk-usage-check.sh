#!/usr/bin/env bash
# scripts/disk-usage-check.sh — target/ 磁盘使用监控
#
# 用法:
#   ./scripts/disk-usage-check.sh                    # 默认 src-tauri/target
#   ./scripts/disk-usage-check.sh /path/to/target    # 自定义路径
#
# 退出码:
#   0 — OK (低于警告阈值)
#   1 — 警告 (超 10GB, 建议 cargo clean -p <crate>)
#   2 — 超限 (超 15GB, 必须 cargo clean)
#
# 设计:
#   - 不删任何东西, 只诊断 + 报警
#   - 10/15GB 阈值基于 M3.0.3 实测: profile 调优后预期 ~4.5GB
#     (debug 3.5G + release 1.0G), 涨到 10GB = 涨了一倍, 提示有人忘 clean
#   - CI cron 每月 1 号跑 (见 .github/workflows/disk-monitor.yml)
#   - 本机开发: 自己手动跑或加到 dev workflow

set -euo pipefail

TARGET_DIR="${1:-src-tauri/target}"
WARN_GB=10
HARD_GB=15

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "target 目录不存在: $TARGET_DIR"
  exit 0
fi

# du -sb → bytes, awk 转 GB (1 decimal)
SIZE_BYTES=$(du -sb "$TARGET_DIR" 2>/dev/null | awk '{print $1}')
if [[ -z "$SIZE_BYTES" || "$SIZE_BYTES" == "0" ]]; then
  echo "无法读取 $TARGET_DIR 大小"
  exit 0
fi
SIZE_GB=$(awk "BEGIN {printf \"%.1f\", $SIZE_BYTES/1024/1024/1024}")

# 详细分类 (debug / release / deps / incremental / build)
echo "=== target/ 磁盘使用 ==="
echo "总计: ${SIZE_GB} GB"
for sub in debug release; do
  if [[ -d "$TARGET_DIR/$sub" ]]; then
    SUB_MB=$(du -sm "$TARGET_DIR/$sub" 2>/dev/null | awk '{print $1}')
    echo "  $sub/: ${SUB_MB} MB"
  fi
done
echo ""
echo "阈值: warn=${WARN_GB}GB, hard=${HARD_GB}GB"
echo ""

# 判断 (用 awk 比较浮点, bc 不一定装了)
if awk "BEGIN {exit !($SIZE_GB > $HARD_GB)}"; then
  echo "❌ 超 ${HARD_GB}GB 硬上限. 必须执行:"
  echo "   cargo clean --manifest-path src-tauri/Cargo.toml"
  echo "   (会清掉 ship exe + WebView2Loader.dll, 之后需重 build)"
  exit 2
elif awk "BEGIN {exit !($SIZE_GB > $WARN_GB)}"; then
  echo "⚠️  超 ${WARN_GB}GB 警告. 建议执行 (保留 ship exe + WebView2.dll):"
  echo "   cargo clean -p claude-config-manager-lib --manifest-path src-tauri/Cargo.toml"
  echo "   # 或释放目标 crates 的旧 artifact:"
  echo "   find src-tauri/target/{debug,release}/incremental -mindepth 1 -maxdepth 1 -type d | sort | head -n -1 | xargs rm -rf"
  exit 1
fi

echo "✓ OK (低于 ${WARN_GB}GB 警告阈值)"
exit 0
