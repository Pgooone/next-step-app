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
1. **搭环境**（幂等，已搭好就秒过）：`bash scripts/setup-browser.sh` —— 它把启动 chromium 需要的 env 打到 stdout。
2. **写驱动脚本**：复制 `templates/drive.mjs`，按你这张卡的流程填「点哪些选择器、断言什么、截哪几张图」。
3. **跑**：`bash scripts/run-e2e.sh <你的驱动脚本.mjs>` —— 它自动 source env + 起 dev server(30141) + 跑脚本 + 收尾杀 dev server。然后你 **Read 截图**逐张核对 + 看脚本打的落盘/断言日志。

> 也可手动：`eval "$(bash scripts/setup-browser.sh)"` 设好 env，自己起 `npm run dev`，再 `cd /tmp/pw && node <脚本>`。

## 关键约定（细节见 `references/gotchas.md`，踩坑前必读）
- **必须显式 `executablePath`**：缓存的 chromium 是较新 build（如 1223，新目录布局），playwright npm 包默认找旧 build，不指定会报 `Executable doesn't exist`。`setup-browser.sh` 已自动探测并通过 `PW_EXECUTABLE` 给出。
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
