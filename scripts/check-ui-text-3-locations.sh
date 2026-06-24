#!/usr/bin/env bash
# CLAUDE.md §6.4 反事故: UI 文案 3 处同步验证
# 确保 tauri.conf.json productName / app.rs PRODUCT_NAME / about.test.tsx sampleMetadata.product_name 三者一致
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/src-tauri/tauri.conf.json"
APP="$ROOT/src-tauri/src/commands/app.rs"
TEST="$ROOT/src/__tests__/pages/about.test.tsx"

# 1. tauri.conf.json productName
#    JSON: "productName": "ClaudeManager",
CONF_NAME=$(grep '"productName"' "$CONF" | head -1 | grep -o '"productName"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)

# 2. app.rs PRODUCT_NAME
#    Rust: const PRODUCT_NAME: &str = "ClaudeManager";
APP_NAME=$(grep 'const PRODUCT_NAME' "$APP" | head -1 | grep -o '= *"[^"]*"' | cut -d'"' -f2 | tr -d ' ')

# 3. about.test.tsx sampleMetadata.product_name
#    TS: product_name: 'ClaudeManager',
TEST_NAME=$(grep "product_name:" "$TEST" | head -1 | grep -o ": *'[^']*'" | cut -d"'" -f2)

if [ -z "$CONF_NAME" ]; then
  echo "FAIL: could not extract productName from tauri.conf.json"
  exit 1
fi
if [ -z "$APP_NAME" ]; then
  echo "FAIL: could not extract PRODUCT_NAME from app.rs"
  exit 1
fi
if [ -z "$TEST_NAME" ]; then
  echo "FAIL: could not extract product_name from about.test.tsx"
  exit 1
fi
if [ "$CONF_NAME" != "$APP_NAME" ]; then
  echo "FAIL: tauri.conf.json productName ($CONF_NAME) != app.rs PRODUCT_NAME ($APP_NAME)"
  exit 1
fi
if [ "$APP_NAME" != "$TEST_NAME" ]; then
  echo "FAIL: app.rs PRODUCT_NAME ($APP_NAME) != about.test.tsx product_name ($TEST_NAME)"
  exit 1
fi
echo "PASS: UI 文案 3 处一致 ($CONF_NAME)"
