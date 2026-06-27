#!/usr/bin/env bash
# render-url.sh — 用 msedge headless 渲染动态网页,输出截图或文本
#
# 用法:
#   render-url.sh <URL> <output> --mode [screenshot|text|html] [options]
#
# 输出:
#   --mode screenshot  → PNG 截图(默认,沿用旧行为)
#   --mode text        → 纯文本(SPA 渲染后,剥 script/style/nav,保留正文)
#   --mode html        → 渲染后的完整 HTML 源码(JS 跑完后的 DOM)
#
# 通用选项:
#   --wait MS          虚拟时间预算 ms(默认 1500),SPA / 字体加载慢的页面调到 3000-5000
#   --viewport WxH     浏览器窗口尺寸(默认 1280,800)
#   --user-agent UA    自定义 UA
#   --text-max-chars N 文本模式截断到 N 字符(默认 50000,0 = 不截断)
#
# 截图专属:
#   --full-page        截整页而非首屏
#
# 退出码:
#   0 成功
#   1 参数错误
#   2 msedge / python3 未找到
#   3 渲染失败

set -euo pipefail

if [[ $# -lt 2 ]]; then
  cat >&2 <<EOF
用法: render-url.sh <URL> <output> --mode [screenshot|text|html] [options]

  --mode screenshot   输出 PNG 截图(默认)
  --mode text         输出纯文本(SPA 渲染后)
  --mode html         输出渲染后的 HTML 源码

通用:
  --wait MS           虚拟时间预算(默认 1500)
  --viewport WxH      视口(默认 1280,800)
  --user-agent UA     自定义 UA
  --text-max-chars N  文本模式截断(默认 50000,0=不限)
  --full-page         (截图)截整页
EOF
  exit 1
fi

URL="$1"; shift
OUT="$1"; shift

MODE="screenshot"
WAIT_MS=1500
FULL_PAGE=false
VIEWPORT="1280,800"
USER_AGENT=""
TEXT_MAX_CHARS=50000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)           MODE="$2"; shift 2 ;;
    --wait)           WAIT_MS="$2"; shift 2 ;;
    --full-page)      FULL_PAGE=true; shift ;;
    --viewport)       VIEWPORT="$2"; shift 2 ;;
    --user-agent)     USER_AGENT="$2"; shift 2 ;;
    --text-max-chars) TEXT_MAX_CHARS="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

case "$MODE" in
  screenshot|text|html) ;;
  *) echo "❌ --mode 必须是 screenshot / text / html" >&2; exit 1 ;;
esac

# ---- 找 msedge ----
find_msedge() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      if [[ -x "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]]; then
        echo "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; return 0
      fi
      if [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
        echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; return 0
      fi
      ;;
    Linux)
      for c in microsoft-edge msedge google-chrome chromium chromium-browser; do
        if command -v "$c" >/dev/null 2>&1; then echo "$c"; return 0; fi
      done
      ;;
    MINGW*|CYGWIN*|MSYS*)
      local paths=(
        "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
        "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
        "/c/Program Files/Google/Chrome/Application/chrome.exe"
        "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
      )
      for p in "${paths[@]}"; do [[ -x "$p" ]] && { echo "$p"; return 0; }; done
      ;;
  esac
  return 1
}

EDGE_BIN="$(find_msedge || true)"
if [[ -z "$EDGE_BIN" ]]; then
  echo "❌ 找不到 msedge / chrome(已查 macOS / Windows / Linux 常见路径)" >&2
  exit 2
fi

# text / html 模式需要 python3 做 HTML 解析(screenshot 模式不需要)
if [[ "$MODE" != "screenshot" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ --mode $MODE 需要 python3,但未找到" >&2
    exit 2
  fi
fi

echo "ℹ️  浏览器: $EDGE_BIN  |  模式: $MODE"

# 准备临时目录
TMPDIR_RENDER="$(mktemp -d -t render-url-XXXXXX)"
EDGE_PID=""
cleanup() {
  if [[ -n "$EDGE_PID" ]] && kill -0 "$EDGE_PID" 2>/dev/null; then
    kill -TERM "-$EDGE_PID" 2>/dev/null || true
    sleep 0.3
    kill -KILL "-$EDGE_PID" 2>/dev/null || true
  fi
  rm -rf "$TMPDIR_RENDER"
}
trap cleanup EXIT INT TERM
set -m   # job control,让 Edge 进独立 process group

mkdir -p "$(dirname "$OUT")"

# 构造 Edge 参数
if [[ "$MODE" == "screenshot" ]]; then
  ARGS=(
    --headless=new
    --disable-gpu
    --no-sandbox
    --hide-scrollbars
    --user-data-dir="$TMPDIR_RENDER"
    --window-size="$VIEWPORT"
    --screenshot="$OUT"
    --virtual-time-budget="$WAIT_MS"
  )
  $FULL_PAGE && ARGS+=(--full-page)
else
  # text / html 都用 --dump-dom 拿 SPA 渲染后的 DOM
  ARGS=(
    --headless=new
    --disable-gpu
    --no-sandbox
    --user-data-dir="$TMPDIR_RENDER"
    --virtual-time-budget="$WAIT_MS"
    --dump-dom
  )
fi

[[ -n "$USER_AGENT" ]] && ARGS+=(--user-agent="$USER_AGENT")
ARGS+=("$URL")

# ---- 找 timeout(优先 GNU timeout,跨平台一致地强杀 Edge 进程组) ----
TIMEOUT_BIN=""
for t in timeout gtimeout; do
  if command -v "$t" >/dev/null 2>&1; then TIMEOUT_BIN="$t"; break; fi
done
# 都没装 → 警告(macOS 默认不带 GNU coreutils,用户 brew install coreutils 即可)
if [[ -z "$TIMEOUT_BIN" ]]; then
  echo "⚠️  找不到 timeout 命令,Edge 可能不自动退出导致脚本卡住。" >&2
  echo "   macOS: brew install coreutils  ;  Linux: apt install coreutils  ;  Windows: Git Bash 自带" >&2
fi

EDGE_TIMEOUT=${EDGE_TIMEOUT:-30}

# 启动 Edge(用 timeout 包一层,自动强杀整组子进程)
if [[ "$MODE" == "screenshot" ]]; then
  TARGET_FILE="$OUT"
  # screenshot:产物直接写到 $OUT(由 --screenshot 选项指定)
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" --foreground --kill-after=5 "${EDGE_TIMEOUT}" \
      "$EDGE_BIN" "${ARGS[@]}" 2>"$TMPDIR_RENDER/stderr.log" &
  else
    "$EDGE_BIN" "${ARGS[@]}" 2>"$TMPDIR_RENDER/stderr.log" &
  fi
else
  TARGET_FILE="$TMPDIR_RENDER/dump.html"
  # text/html:stdout 是 DOM → 重定向到 dump.html
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" --foreground --kill-after=5 "${EDGE_TIMEOUT}" \
      "$EDGE_BIN" "${ARGS[@]}" >"$TARGET_FILE" 2>"$TMPDIR_RENDER/stderr.log" &
  else
    "$EDGE_BIN" "${ARGS[@]}" >"$TARGET_FILE" 2>"$TMPDIR_RENDER/stderr.log" &
  fi
fi

EDGE_PID=$!
disown "$EDGE_PID" 2>/dev/null || true

# 轮询"产物" + Edge 状态
elapsed=0
last_size=-1
stable_count=0

while true; do
  if [[ -s "$TARGET_FILE" ]]; then
    cur_size=$(wc -c <"$TARGET_FILE" | tr -d ' ')

    # screenshot:文件出现就认为 OK
    if [[ "$MODE" == "screenshot" ]]; then
      break
    fi

    # text/html:大小稳定 3 次(600ms)认为 Edge 写完 stdout 了
    if [[ "$cur_size" == "$last_size" ]]; then
      stable_count=$((stable_count + 1))
      if [[ $stable_count -ge 3 ]]; then
        break
      fi
    else
      stable_count=0
      last_size=$cur_size
    fi
  fi

  # Edge 进程已死但产物没出来 → 真的失败
  if ! kill -0 "$EDGE_PID" 2>/dev/null; then
    if [[ -s "$TARGET_FILE" ]]; then
      break
    fi
    echo "❌ msedge 渲染失败(进程已退出但未生成产物)" >&2
    cat "$TMPDIR_RENDER/stderr.log" >&2 || true
    exit 3
  fi

  sleep 0.2
  elapsed=$((elapsed + 1))
  # 给 timeout 多 6s 余量(timeout 命令自身收尾时间)
  if [[ $elapsed -gt $(( (EDGE_TIMEOUT + 6) * 5 )) ]]; then
    echo "❌ Edge 超时 ($EDGE_TIMEOUT s),可能 URL 太慢或反爬" >&2
    cat "$TMPDIR_RENDER/stderr.log" >&2 || true
    exit 3
  fi
done

# 产物已就位 → 兜底杀 Edge 进程组(timeout 已处理大部分,但保险)
kill -TERM "-$EDGE_PID" 2>/dev/null || true
kill -KILL "-$EDGE_PID" 2>/dev/null || true
wait "$EDGE_PID" 2>/dev/null || true
EDGE_PID=""

# ---- screenshot 模式:文件直接在 OUT ----
if [[ "$MODE" == "screenshot" ]]; then
  if [[ ! -s "$OUT" ]]; then
    echo "❌ 截图未生成:$OUT" >&2
    cat "$TMPDIR_RENDER/stderr.log" >&2 || true
    exit 3
  fi
  ABS_OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
  SIZE_BYTES="$(wc -c <"$OUT" | tr -d ' ')"
  echo "✅ 截图已保存: $ABS_OUT ($SIZE_BYTES bytes, viewport=$VIEWPORT, wait=${WAIT_MS}ms)"
  echo "$ABS_OUT"
  exit 0
fi

# ---- text / html 模式:从 dump-dom 抓的 dump.html ----
EDGE_HTML="$TMPDIR_RENDER/dump.html"

# 等待 Edge 退出(用 dump.html 文件是否非空 + Edge 进程是否还在)
elapsed=0
while kill -0 "$EDGE_PID" 2>/dev/null; do
  # 如果文件已经有内容且大小稳定 1s,Edge 可能已经死了但我们没收到信号?dump-dom 模式 Edge 通常会自然退出
  sleep 0.2
  elapsed=$((elapsed + 1))
  if [[ $elapsed -gt $((EDGE_TIMEOUT * 5)) ]]; then
    echo "❌ Edge 超时 ($EDGE_TIMEOUT s)" >&2
    cat "$TMPDIR_RENDER/stderr.log" >&2 || true
    exit 3
  fi
done
wait "$EDGE_PID" 2>/dev/null || true
EDGE_PID=""

if [[ ! -s "$EDGE_HTML" ]]; then
  echo "❌ --dump-dom 返回空(URL 无法访问?或被反爬?)" >&2
  cat "$TMPDIR_RENDER/stderr.log" >&2 || true
  exit 3
fi

# html 模式:直接保存
if [[ "$MODE" == "html" ]]; then
  cp "$EDGE_HTML" "$OUT"
  ABS_OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
  SIZE_BYTES="$(wc -c <"$OUT" | tr -d ' ')"
  echo "✅ HTML 已保存: $ABS_OUT ($SIZE_BYTES bytes, wait=${WAIT_MS}ms)"
  echo "$ABS_OUT"
  exit 0
fi

# text 模式:用 python3 解析 HTML → 纯文本
python3 - "$EDGE_HTML" "$OUT" "$TEXT_MAX_CHARS" <<'PYEOF'
import sys, re, html
from html.parser import HTMLParser

src_path, out_path, max_chars = sys.argv[1], sys.argv[2], int(sys.argv[3])

with open(src_path, encoding="utf-8", errors="replace") as f:
    raw = f.read()

# 浏览器 dump 出来的 HTML 经常会有 "<html><head></head><body>...</body></html>" 完整结构
# 用 html.parser 走一遍,把 text/structure 抽出来

SKIP_TAGS = {"script", "style", "noscript", "svg", "iframe", "link", "meta", "head"}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

# void elements (HTML5 自闭合,parser 不会触发 endtag) — 不进 skip_stack,直接视为 skip
VOID_TAGS = {"meta", "link", "br", "hr", "img", "input", "source", "track", "wbr", "area", "base", "col", "embed", "param"}

class TextExtractor(HTMLParser):
    """
    skip 用栈跟踪(SKIP_TAGS 嵌套时,只有匹配的 endtag 才 pop),
    避免 <head><title>...<title> 这种情况下 </title> 错误 pop head 的深度。
    """
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_stack = []     # 当前正在 skip 的 SKIP_TAGS 标签栈
        self.in_anchor = False
        self.anchor_href = None
        self.anchor_text_buf = []

    def _skipping(self):
        return bool(self.skip_stack)

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            # void element:无 endtag,不进栈(否则会卡在栈里永不释放)
            return
        if tag in SKIP_TAGS:
            self.skip_stack.append(tag)
            return
        if self._skipping():
            return
        if tag in HEADING_TAGS:
            level = int(tag[1])
            self.parts.append("\n" + "#" * level + " ")
        elif tag == "p":
            self.parts.append("\n\n")
        elif tag in ("div", "section", "article", "header", "footer", "main", "blockquote", "pre"):
            self.parts.append("\n\n")
        elif tag == "li":
            self.parts.append("\n• ")
        elif tag == "a":
            self.in_anchor = True
            self.anchor_text_buf = []
            for k, v in attrs:
                if k == "href" and v:
                    self.anchor_href = v

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        if tag in SKIP_TAGS:
            # 只 pop 栈顶匹配的,避免嵌套错位
            if self.skip_stack and self.skip_stack[-1] == tag:
                self.skip_stack.pop()
            return
        if self._skipping():
            return
        if tag in HEADING_TAGS or tag in ("p", "div", "section", "article", "header", "footer", "main", "blockquote"):
            self.parts.append("\n")
        elif tag == "a":
            text = "".join(self.anchor_text_buf).strip()
            if text and self.anchor_href:
                self.parts.append(f"{text} ({self.anchor_href})")
            elif text:
                self.parts.append(text)
            self.in_anchor = False
            self.anchor_href = None
            self.anchor_text_buf = []

    def handle_data(self, data):
        if self._skipping():
            return
        if self.in_anchor:
            self.anchor_text_buf.append(data)
        else:
            self.parts.append(data)

p = TextExtractor()
p.feed(raw)
text = "".join(p.parts)
text = re.sub(r"[ \t]+", " ", text)
text = re.sub(r"\n{3,}", "\n\n", text)
text = re.sub(r" *\n *", "\n", text)
text = text.strip()

# 截断
if max_chars > 0 and len(text) > max_chars:
    text = text[:max_chars] + f"\n\n[...truncated, total {len(text)}+ chars]"

with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)
PYEOF

ABS_OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
SIZE_BYTES="$(wc -c <"$OUT" | tr -d ' ')"
LINES="$(wc -l <"$OUT" | tr -d ' ')"
echo "✅ 文本已保存: $ABS_OUT ($SIZE_BYTES bytes, $LINES lines, wait=${WAIT_MS}ms, max_chars=$TEXT_MAX_CHARS)"
echo "$ABS_OUT"
