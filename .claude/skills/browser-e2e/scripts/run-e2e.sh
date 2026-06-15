#!/usr/bin/env bash
# 编排一次浏览器 E2E：source 浏览器 env → 起 dev server(30141) → 跑驱动脚本 → 杀 dev server。
# 用法：  bash run-e2e.sh /abs/path/to/your-drive.mjs
# 驱动脚本在 /tmp/pw 下用 node 跑（那里有 playwright；脚本里 import "playwright" 即可解析）。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$HERE/../../../.." && pwd)"   # .claude/skills/browser-e2e/scripts -> 仓库根
PORT=30141
DRIVE="${1:?用法: run-e2e.sh <驱动脚本.mjs 绝对路径>}"
[ -f "$DRIVE" ] || { echo "找不到驱动脚本: $DRIVE"; exit 1; }
DRIVE="$(cd "$(dirname "$DRIVE")" && pwd)/$(basename "$DRIVE")"

# 1) 浏览器 env
eval "$(bash "$HERE/setup-browser.sh")" || { echo "浏览器环境搭建失败"; exit 1; }

# 2) 起 dev server（若已在跑则复用）
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:$PORT/ 2>/dev/null)" != "200" ]; then
  echo "[run-e2e] 起 dev server ..."
  ( cd "$APP_ROOT" && setsid nohup npm run dev >/tmp/e2e-dev.log 2>&1 & )
  STARTED=1
  for i in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:$PORT/ 2>/dev/null)" = "200" ] && { echo "[run-e2e] dev ready (~${i}s)"; break; }
    sleep 1
  done
else
  echo "[run-e2e] dev server 已在跑，复用"; STARTED=0
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:$PORT/ 2>/dev/null)" = "200" ] || { echo "DEV 未就绪"; tail -20 /tmp/e2e-dev.log; [ "${STARTED:-0}" = 1 ] && fuser -k $PORT/tcp 2>/dev/null; exit 1; }

# 3) 跑驱动脚本：拷进 /tmp/pw 再跑，否则 ESM 的 `import "playwright"` 按脚本所在目录找
#    node_modules（不看 cwd），在仓库目录下解析不到 /tmp/pw/node_modules。
echo "[run-e2e] 跑 $DRIVE"
cp "$DRIVE" /tmp/pw/__drive.mjs
( cd /tmp/pw && node __drive.mjs ); rc=$?

# 4) 收尾：只杀「本脚本起的」dev server，复用的不动
if [ "${STARTED:-0}" = 1 ]; then echo "[run-e2e] 杀 dev server"; fuser -k $PORT/tcp 2>/dev/null || true; fi
echo "[run-e2e] 退出码 $rc。截图看 /tmp/pw/*.png。注意内存：dev server 约 1GB，验完记得 fuser -k $PORT/tcp。"
exit $rc
