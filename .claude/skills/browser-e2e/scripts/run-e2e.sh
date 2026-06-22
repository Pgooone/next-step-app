#!/usr/bin/env bash
# 编排一次浏览器 E2E：source 浏览器 env → 起 dev server → 跑驱动脚本 → 杀 dev server。
# 用法：  [APP_ROOT=/path] [PORT=xxxx] [DEV_CMD='npm run dev'] bash run-e2e.sh /abs/path/to/your-drive.mjs
#   APP_ROOT 不传则自动探测（$PWD 或脚本上层的 package.json）；PORT 默认 30141；DEV_CMD 默认 npm run dev。
# 驱动脚本在 /tmp/pw 下用 node 跑（那里有 playwright；脚本里 import "playwright" 即可解析）。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-30141}"                 # 端口（默认 Next-Step 的 30141；别的项目设 PORT=xxxx 覆盖）
DEV_CMD="${DEV_CMD:-npm run dev}"     # 起 dev server 的命令（默认 npm run dev；可设 DEV_CMD='pnpm dev' 等）
DRIVE="${1:?用法: [APP_ROOT=/path] [PORT=xxxx] [DEV_CMD='npm run dev'] run-e2e.sh <驱动脚本.mjs 绝对路径>}"

# APP_ROOT 解析（通用化，不再写死仓库深度）：
#   ① 显式环境变量 APP_ROOT 最优先（跨项目 / 用户级 skill 用这个）
#   ② 否则当前工作目录 $PWD（在项目目录里直接跑，最符合直觉）
#   ③ 否则从脚本所在处向上找最近含 package.json 的目录（仓库内 vendored 场景，排除 $HOME）
if [ -n "${APP_ROOT:-}" ]; then :
elif [ -f "$PWD/package.json" ]; then APP_ROOT="$PWD"
else
  d="$HERE"
  while [ "$d" != "/" ] && [ "$d" != "$HOME" ]; do
    [ -f "$d/package.json" ] && { APP_ROOT="$d"; break; }
    d="$(dirname "$d")"
  done
fi
[ -n "${APP_ROOT:-}" ] && [ -f "$APP_ROOT/package.json" ] || {
  echo "✗ 无法确定 APP_ROOT（未设环境变量、\$PWD 与脚本上层都无 package.json）。请显式：APP_ROOT=/path/to/app bash $0 <drive.mjs>"; exit 1; }
echo "[run-e2e] APP_ROOT=$APP_ROOT  PORT=$PORT  DEV_CMD=$DEV_CMD"
[ -f "$DRIVE" ] || { echo "找不到驱动脚本: $DRIVE"; exit 1; }
DRIVE="$(cd "$(dirname "$DRIVE")" && pwd)/$(basename "$DRIVE")"

# 1) 浏览器 env
eval "$(bash "$HERE/setup-browser.sh")" || { echo "浏览器环境搭建失败"; exit 1; }
export E2E_URL="${E2E_URL:-http://localhost:$PORT}"   # 传给驱动脚本（drive.mjs 默认读它，自动跟随 PORT）

# 2) 起 dev server（若已在跑则复用）
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:$PORT/ 2>/dev/null)" != "200" ]; then
  echo "[run-e2e] 起 dev server ..."
  ( cd "$APP_ROOT" && setsid nohup $DEV_CMD >/tmp/e2e-dev.log 2>&1 & )
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
