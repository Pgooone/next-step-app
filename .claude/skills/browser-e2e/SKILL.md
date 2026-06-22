---
name: browser-e2e
description: >-
  用 Playwright + 缓存 chromium 对 Next-Step 应用做真浏览器端到端验证。**只要需要确认某个 UI 改动在浏览器里真的能用就用它**——验收一张卡（B3/B4/Iter D 等）、确认组件能渲染/点击/持久化、给运行中的应用截图、或 lint/test/build 都过但 GUI 行为还没在真浏览器里确认过时。本项目里 **UI 卡的验收必须走真浏览器**：SSR/hydration 与集成类 bug（例如「按钮刷新后卡死禁用」）只会在真浏览器里暴露，单测和 build 永远抓不到。本 skill 封装了本机（无 root）的环境搭建（缓存 chromium、系统库、中文字体、必须显式 executablePath 的坑），省得每次重新踩。
---

# Browser E2E（Next-Step 真浏览器验收）

把「UI 改动 → 真浏览器跑一遍 + 截图 + 核验落盘」变成一条可复用流程。本机无 root，环境搭建很 fiddly，本 skill 把它脚本化了，你只需写「驱动脚本」描述要点哪些、断言什么。

## 为什么必须真浏览器（别只信单测/build）
B3 的实践证明：`useProjectStore` 用 localStorage 作初始 state，导致 SSR/client 首屏不一致，按钮刷新后卡死禁用——**66 个单测全绿、build 全过，都没发现它**，只有真浏览器点一下才暴露。所以涉及渲染、hydration、跨组件集成的卡，验收一定要来这一趟。

## 三步流程
1. **搭环境**（幂等，**已持久化、秒过**）：`bash scripts/setup-browser.sh` —— 探测到持久化资产就直接复用、把 env 打到 stdout（见下「环境现状」）。也可直接 `source ~/.local/bin/ns-browser-env.sh` 自己设好 env。
2. **写驱动脚本**：复制 `templates/drive.mjs`，按你这张卡的流程填「点哪些选择器、断言什么、截哪几张图」。
3. **跑**：`bash scripts/run-e2e.sh <你的驱动脚本.mjs>` —— 它自动 source env + 起 dev server + 跑脚本 + 收尾杀 dev server。然后你 **Read 截图**逐张核对 + 看脚本打的落盘/断言日志。
   - **跨项目通用**：`run-e2e.sh` 不写死仓库路径/端口——`APP_ROOT` 不传则自动探测（优先 `$PWD`、否则脚本上层的 `package.json`）；`PORT`（默认 30141）、`DEV_CMD`（默认 `npm run dev`）可用环境变量覆盖。例：`APP_ROOT=/path/to/app PORT=3000 bash scripts/run-e2e.sh drive.mjs`。在 Next-Step 项目目录里直接跑则零配置。

> 也可手动：`eval "$(bash scripts/setup-browser.sh)"`（或 `source ~/.local/bin/ns-browser-env.sh`）设好 env，自己起 `npm run dev`，再 `cd /tmp/pw && node <脚本>`。

## 环境现状（2026-06-21 起，已持久化、重启不再重下）
容器是 **Debian 11**（无 root；`uname` 的 el7/3.10 是宿主机内核，别误判 CentOS），浏览器是 **Chrome for Testing 149.0.7827.55**（headless-shell）。持久化资产：
- **依赖库** `~/.cache/chrome-deps/root`（171M）、**中文字体** `~/.fonts`（wqy-zenhei + DejaVu）、**二进制** `~/.cache/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell`。
- **入口包装** `~/.local/bin/chrome-shared`：内部 `export LD_LIBRARY_PATH(~/.cache/chrome-deps/root)/FONTCONFIG_FILE` 后 `exec` 二进制，**Playwright 与 chrome-devtools MCP 共用**这一个入口。
- **持久 env 脚本** `~/.local/bin/ns-browser-env.sh`：`source` 它即设好 `PW_EXECUTABLE`（=chrome-shared）。`setup-browser.sh` 已优先探测并复用，搭环境秒过；只有持久化资产丢失才走重建（配方见 `references/gotchas.md`）。

> **交互式调试可选 chrome-devtools MCP**（已配 `--executablePath=chrome-shared --headless`，本环境工具已加载可用）：要 snapshot/click/抓网络·console·性能用它；要**确定性可复跑的验收 E2E** 用本 skill 的 Playwright 脚本。

## 关键约定（细节见 `references/gotchas.md`，踩坑前必读）
- **必须显式 `executablePath`，且现指向包装脚本**：playwright npm 包默认找的 build 与缓存的不一致，不指定会报 `Executable doesn't exist`。`setup-browser.sh` / `ns-browser-env.sh` 已把 `PW_EXECUTABLE` 指向**包装脚本 `chrome-shared`**（不是裸二进制——它代设库/字体 env 再 exec 真 chrome）。**验库齐全别直接 `ldd` 裸二进制**：不经包装会假阳性报一堆 `not found`；正确做法是经包装跑 `$PW_EXECUTABLE --version` 出版本号即 OK（细节见 gotchas）。
- **`goto` 用 `waitUntil:"domcontentloaded"`**，**不要 `networkidle`**（Next/SSE 轮询永不静默，必 timeout）+ `waitForTimeout` 等 SPA。
- **chromium 关沙箱**：`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`。
- **选项目**：很多 UI 门控在「已选当前项目」。helper `selectProjectById` 直接写持久化 key `next-step:current-project-id` + reload（hydration 修复后此路可用）；也可改驱动 ProjectSwitcher（按可见文本点「新建项目…」/项目名）。
- **给新控件留稳定选择器**：你要驱动的交互元素，加 `data-testid`（看现有 AgentManager 的命名风格，见 gotchas）。

## 收尾（别留垃圾）
- 删测试项目：`curl -XDELETE localhost:30141/api/projects/<id>`；`rm -rf` 临时根目录。
- 杀 dev server：`fuser -k 30141/tcp`（`run-e2e.sh` 已自动做）。
- 注意机器内存：dev server（Next）约占 1GB，验完即杀。

## 文件
- `scripts/setup-browser.sh` —— 幂等环境搭建（无 root 装库/字体、探测缓存 chromium），输出 env 导出语句。
- `scripts/run-e2e.sh` —— 编排：env + 起 dev + 跑驱动脚本 + 杀 dev。参数为驱动脚本路径。
- `templates/drive.mjs` —— 自包含驱动脚本模板（建临时项目 → 选中 → 操作 → 截图 → fs 核验落盘 → 清理），复制即用。
- `references/gotchas.md` —— 踩坑速查 + 现有 AgentManager 选择器清单 + 所需系统库列表。
