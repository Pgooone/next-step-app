#!/usr/bin/env bash
# 幂等搭建「无 root」Playwright + chromium 浏览器环境，并把 env 导出语句打到 stdout。
# 用法：  eval "$(bash setup-browser.sh)"     # 设好 PW_EXECUTABLE/LD_LIBRARY_PATH/FONTCONFIG_FILE 等
# 日志走 stderr，stdout 只有 export 语句，便于 eval。
# 背景见项目记忆 next-step-browser-e2e。已搭好（/tmp 资产还在）则秒过、只复用。
set -uo pipefail

PW_DIR=/tmp/pw
CDEPS=/tmp/cdeps/root
FONTCONF=/tmp/fc-fonts.conf
CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
CHROME_SHARED="$HOME/.local/bin/chrome-shared"   # 持久化的共用 Chrome 入口（自带库/字体 env 解析，Playwright 与 chrome-devtools MCP 共用）
log(){ echo "[setup-browser] $*" >&2; }

# playwright 驱动库（装在 /tmp/pw，run-e2e.sh 在那 node 驱动脚本；/tmp 资产、重启重装）
if [ ! -d "$PW_DIR/node_modules/playwright" ]; then
  log "installing playwright into $PW_DIR ..."
  mkdir -p "$PW_DIR"; ( cd "$PW_DIR" && npm i playwright >/dev/null 2>&1 ) || log "npm i playwright 失败（可能已离线缓存）"
fi

# ★★ 最优先（2026-06-28 起）：系统 Google Chrome（库与字体系统自带，免 chrome-shared 手工 bundle）。
#   容器已装完整 google-chrome（依赖自解析）+ 系统 Noto CJK；默认 fontconfig 同时覆盖系统 Noto + ~/.fonts(wqy)，
#   故系统 Chrome 在时直接用、不设 LD_LIBRARY_PATH/FONTCONFIG override（字体覆盖是旧法超集）。
#   缺失/不可用（或 NS_SKIP_SYSTEM_CHROME=1 强制）则落到下方 chrome-shared 持久化复用 → 再到重建 fallback。
#   注：仍需 --no-sandbox/--disable-dev-shm-usage（容器沙箱限制，由驱动脚本传）。
if [ -z "${NS_SKIP_SYSTEM_CHROME:-}" ]; then
  for SYS_CHROME in /usr/bin/google-chrome /usr/bin/google-chrome-stable /opt/google/chrome/chrome; do
    if [ -x "$SYS_CHROME" ] && "$SYS_CHROME" --version >/dev/null 2>&1; then
      log "用系统 Chrome：$SYS_CHROME（$("$SYS_CHROME" --version 2>/dev/null)）"
      echo "export PLAYWRIGHT_BROWSERS_PATH='$CACHE'"
      echo "export PW_EXECUTABLE='$SYS_CHROME'"
      exit 0
    fi
  done
  log "未找到可用系统 Chrome → 回退 chrome-shared 持久化复用"
fi

# ★ 持久化快路径（2026-06-21 起，容器=Debian 11 / Chrome for Testing 149）：
#   持久 env 脚本 ~/.local/bin/ns-browser-env.sh + 包装脚本 chrome-shared 都在 → 直接复用、秒过。
#   chrome-shared 内部已 export LD_LIBRARY_PATH(~/.cache/chrome-deps/root)/FONTCONFIG_FILE 再 exec
#   ~/.cache/ms-playwright 下的 headless-shell，故这里只需给出 PW_EXECUTABLE，无需再设库/字体 env。
#   （持久化资产丢失才落到下方 fallback 重建。）
if [ -x "$CHROME_SHARED" ] && "$CHROME_SHARED" --version >/dev/null 2>&1; then
  log "持久化就绪，复用 $CHROME_SHARED（$("$CHROME_SHARED" --version 2>/dev/null)）"
  echo "export PLAYWRIGHT_BROWSERS_PATH='$CACHE'"
  echo "export PW_EXECUTABLE='$CHROME_SHARED'"
  exit 0
fi
log "⚠ 未找到持久化 chrome-shared → 进入重建 fallback（⚠ Debian 11 下默认 apt 取不到库，完整重建配方见 references/gotchas.md 与记忆 next-step-browser-e2e）"

# 1) 定位缓存里的 chromium headless shell（自动适配任意 build，不写死 1223）
find_shell(){ find "$CACHE" -type f -name chrome-headless-shell 2>/dev/null | head -1; }
SHELL_BIN="$(find_shell || true)"

# chromium 二进制：缓存没有就 playwright install（会联网下载）
if [ -z "$SHELL_BIN" ]; then
  log "缓存无 chromium，尝试 playwright install chromium ..."
  ( cd "$PW_DIR" && PLAYWRIGHT_BROWSERS_PATH="$CACHE" ./node_modules/.bin/playwright install chromium >/dev/null 2>&1 ) || true
  SHELL_BIN="$(find_shell || true)"
fi
[ -n "$SHELL_BIN" ] || { log "ERROR: 找不到 chromium headless shell（缓存与下载都失败）"; exit 1; }

# 4) 系统库（无 root）：仅当 chromium 加载报缺库时才补
export LD_LIBRARY_PATH="$CDEPS/usr/lib/x86_64-linux-gnu:$CDEPS/lib/x86_64-linux-gnu"
if ldd "$SHELL_BIN" 2>/dev/null | grep -q "not found"; then
  log "解析缺失系统库（apt-get download，无 root，递归取依赖）..."
  mkdir -p "$CDEPS" /tmp/cdeps
  BASE="libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libgbm1 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libnss3 libcups2 libpango-1.0-0 libxcb1"
  ( cd /tmp/cdeps
    PKGS="$(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances $BASE 2>/dev/null | grep '^[a-z0-9]' | sort -u)"
    apt-get download $PKGS >/dev/null 2>&1 || true
    for d in *.deb; do [ -f "$d" ] && dpkg -x "$d" "$CDEPS" >/dev/null 2>&1; done )
  ldd "$SHELL_BIN" 2>/dev/null | grep "not found" >&2 && log "⚠ 仍有缺库（见上），按名补到 BASE 再跑一次"
fi

# 5) 中文字体（否则中文渲染成方块）
if [ ! -f "$HOME/.fonts/wqy-zenhei.ttc" ]; then
  log "装中文字体 wqy-zenhei ..."
  mkdir -p "$HOME/.fonts" /tmp/fc-cache
  ( cd /tmp && apt-get download fonts-wqy-zenhei >/dev/null 2>&1 && dpkg -x fonts-wqy-zenhei*.deb /tmp/wqy >/dev/null 2>&1 \
    && cp /tmp/wqy/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc "$HOME/.fonts/" 2>/dev/null ) || log "字体装失败（中文可能显示方块，非阻断）"
fi
printf '<fontconfig><dir>%s/.fonts</dir><cachedir>/tmp/fc-cache</cachedir></fontconfig>\n' "$HOME" > "$FONTCONF"

# 6) 输出 env（stdout）
echo "export PLAYWRIGHT_BROWSERS_PATH='$CACHE'"
echo "export LD_LIBRARY_PATH='$CDEPS/usr/lib/x86_64-linux-gnu:$CDEPS/lib/x86_64-linux-gnu'"
echo "export FONTCONFIG_FILE='$FONTCONF'"
echo "export PW_EXECUTABLE='$SHELL_BIN'"
log "ready ✓  PW_EXECUTABLE=$SHELL_BIN"
