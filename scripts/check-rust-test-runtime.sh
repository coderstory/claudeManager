#!/usr/bin/env bash
# CLAUDE.md §15.1 + E-1: 检查 cargo test 运行环境
set -euo pipefail

echo "=== Rust test runtime check ==="
echo ""

# 1. Check Rust toolchain
if ! command -v rustc &>/dev/null; then
  echo "❌ rustc not found. Install Rust: https://rustup.rs/"
  exit 1
fi
echo "✅ rustc: $(rustc --version)"

# 2. Check cargo
if ! command -v cargo &>/dev/null; then
  echo "❌ cargo not found."
  exit 1
fi
echo "✅ cargo: $(cargo --version)"

# 3. Windows-only: check vcruntime140_1.dll
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "MSYS"* ]]; then
  echo ""
  echo "=== Windows: check MSVC runtime ==="
  if command -v wine &>/dev/null; then
    if wine cmd /c "dir C:\\Windows\\System32\\vcruntime140_1.dll" &>/dev/null; then
      echo "✅ vcruntime140_1.dll found"
    else
      echo "❌ vcruntime140_1.dll NOT found"
      echo "   Install Visual C++ Redistributable 2015+:"
      echo "   https://aka.ms/vs/17/release/vc_redist.x64.exe"
      exit 1
    fi
  else
    echo "⚠️ wine not available, skip DLL check"
  fi
fi

# 4. Check cargo check --tests
echo ""
echo "=== cargo check --tests ==="
cd "$(dirname "$0")/../src-tauri"
if cargo check --tests 2>&1 | tail -3; then
  echo "✅ cargo check --tests PASS"
else
  echo "❌ cargo check --tests FAIL (see above)"
  exit 1
fi
