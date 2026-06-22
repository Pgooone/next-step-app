# 浏览器 E2E 踩坑速查 + 选择器参考

> 本机（无 root）实测过的细节。`setup-browser.sh` 已自动处理大部分，但 debug 时看这里。

## 必看坑
1. **必须显式 `executablePath`，且现在指向包装脚本而非裸二进制**：`~/.cache/ms-playwright` 的 chromium build 与 npm `playwright` 自带默认 build 不一致（版本+目录布局都不符），不设 `executablePath`/`PW_EXECUTABLE` 会报 `Executable doesn't exist …`。→ `setup-browser.sh`/`ns-browser-env.sh` 把 `PW_EXECUTABLE` 指向 **`~/.local/bin/chrome-shared`**：一个 bash 包装，先 `export LD_LIBRARY_PATH(~/.cache/chrome-deps/root)/FONTCONFIG_FILE` 再 `exec` 真二进制 `~/.cache/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell`（Chrome for Testing 149）；playwright/puppeteer 的 executablePath 指向 shell 包装可行（参数透传、exec 保留 fd）。**⚠ 验库齐全别直接 `ldd` 裸二进制**：不经包装设的 LD_LIBRARY_PATH，裸 `ldd` 会假阳性报 ~14 个 `not found`（libnss3/libgbm1/libasound2…），**并非环境坏**——经包装跑 `"$PW_EXECUTABLE" --version` 出 `Google Chrome for Testing 149.x` 才是真证据（或先手动 `export LD_LIBRARY_PATH=~/.cache/chrome-deps/root/usr/lib/x86_64-linux-gnu:~/.cache/chrome-deps/root/lib/x86_64-linux-gnu` 再 `ldd`，应 0 not found）。
2. **`page.goto` 用 `waitUntil:"domcontentloaded"`**，**绝不要 `networkidle`**：Next/SSE 的轮询永不静默，networkidle 必 timeout。配 `waitForTimeout(4000+)` 等 SPA 渲染（`PW_WAIT` 可调）。
3. **chromium 关沙箱**：`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`（沙箱内无 user namespace）。
4. **中文渲染成方块** → 没设 `FONTCONFIG_FILE` 或没装 wqy-zenhei；`setup-browser.sh` 已处理。
5. **403/404 资源错误**：`/api/files` 对未进 allowed-roots 缓存的临时项目根目录会 403、文件浏览器空——与被测功能无关，可忽略（除非你测的就是文件浏览器）。

## 选「当前项目」的两种方式
- **写持久化 key（快，模板用的）**：`localStorage["next-step:current-project-id"] = <projectId>` 后 `reload`。注意：早期有 hydration bug（init 时读 localStorage 致 SSR 不一致），已在 B3 修复（init null + 挂载后 hydrate），此路现可用。
- **驱动 ProjectSwitcher UI（更真实）**：ProjectSwitcher 无 data-testid，按可见文本点：触发钮含「选择项目…」或当前项目名 → 下拉里「新建项目…」按钮 / 项目名按钮 / 「移除项目」(title) → 确认条「移除」。新建表单 placeholder：「项目名称」「/path/to/project」，按钮「创建」。

## 已有选择器清单（B3 AgentManager，参考其命名风格给新控件加 testid）
- 入口：`[data-testid="open-agents-btn"]`（同款 `open-models-btn`/`open-skills-btn`；**无当前项目时 disabled**）
- 模态根：`[data-testid="agent-manager"]`
- 列表：`[data-testid="agent-new-btn"]`、`[data-testid="agent-item"]`（带 `data-agent-name`）、项内 `agent-edit-btn` / `agent-delete-btn`
- 内联删除确认：点 delete 后出 `[data-testid="agent-delete-confirm"]`
- 表单：`agent-form-name` / `agent-form-role` / `agent-form-model`(select) / `agent-form-skill`(多个) / `agent-form-tool`(7 个内置) / `agent-form-thinking`(off|low|medium|high) / `agent-save-btn` / `agent-form-error`
- A3 凭证 banner CTA：`getByRole("button",{name:"去配置"})` → 打开 Models 配置模态（标题 `Models ~/.pi/agent/models.json`）

## 系统库 / 字体 —— 已持久化，重建配方（Debian 11，2026-06-21）
**正常无需关心**：库已持久化在 `~/.cache/chrome-deps/root`（171M）、字体在 `~/.fonts`，`chrome-shared` 已把它们接好、`setup-browser.sh` 快路径直接复用。**仅当持久化资产丢失（整容器重建）才需重建**：
- **库**：Debian 11 容器默认 `apt-get download` 报「Unable to locate package」（无 root、无 apt index）→ 须**自定义目录建索引**：`APT="-o Dir::State::Lists=/tmp/apt/lists -o Dir::Cache=/tmp/apt/cache -o Dir::State::status=/tmp/apt/status"; mkdir -p /tmp/apt/lists/partial /tmp/apt/cache/archives/partial; touch /tmp/apt/status; apt-get $APT update`，再 `apt-cache $APT depends --recurse … <libs>` 取包名、`apt-get $APT download`、`dpkg -x *.deb` 到目标根（recurse 后约 116 deb，`ldd` not found 应为 0）。库清单≈ `libnss3 libnspr4 libgbm1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libasound2 libatspi2.0-0 libatk1.0-0 libatk-bridge2.0-0 libcups2 libpango-1.0-0 libcairo2 libdrm2 libxshmfence1 …`。
- **二进制**：`playwright install` 与 npmmirror builds 对新 Chrome 多半 404 → 从 **npmmirror chrome-for-testing 直链**下：`curl -L https://cdn.npmmirror.com/binaries/chrome-for-testing/<版本>/linux64/chrome-headless-shell-linux64.zip`（版本取 `playwright install` 日志里「Chrome for Testing X.Y.Z」），`unzip` 进 `~/.cache/ms-playwright/`。
- **字体**：同自定义索引法 download `fonts-wqy-zenhei fonts-dejavu-core`，`dpkg -x` 后 copy `.ttc/.ttf` 进 `~/.fonts`、`fc-cache -f`（否则中文渲染空白）。
- 重建后把库/字体落到**持久**目录（`~/.cache/chrome-deps`、`~/.fonts`）并重建 `~/.local/bin/chrome-shared` + `ns-browser-env.sh`，下次才不必重来。完整原始记录见记忆 `next-step-browser-e2e`。

## 易腐提醒（持久 vs 易丢）
- **持久（重启仍在，2026-06-21 起）**：`~/.cache/ms-playwright`（二进制）、`~/.cache/chrome-deps`（库）、`~/.fonts`（字体）、`~/.local/bin/{chrome-shared,ns-browser-env.sh}`（入口/env）。跑 E2E 只要 `source ~/.local/bin/ns-browser-env.sh` 或 `setup-browser.sh` 快路径。
- **易丢（/tmp 资产，重启/清理会丢）**：`/tmp/pw`（playwright node module + 截图）、旧 `/tmp/cdeps`、`/tmp/fc-fonts.conf`。`/tmp/pw` 的 playwright 丢了 `setup-browser.sh` 会自动 `npm i` 重装（秒级）；旧 `/tmp/cdeps`、`/tmp/fc-fonts.conf` 已被持久化路径取代、不再需要。
- **若 `~/.cache/*` 持久资产也丢了**（整容器重建）→ 见上「系统库 / 字体重建配方」。

## 跨项目复用（run-e2e.sh 已通用化）
`run-e2e.sh` 不写死仓库路径/端口，靠环境变量 + 自动探测适配任意项目，故**用户级（`~/.claude/skills`）这份也能跑别的项目**：
- `APP_ROOT`：① 显式环境变量 > ② `$PWD`（在项目目录里跑）> ③ 从脚本上层向上找 `package.json`（排除 `$HOME`）。都没有则报错提示显式指定。
- `PORT`（默认 30141）、`DEV_CMD`（默认 `npm run dev`）：环境变量覆盖；`E2E_URL` 自动设为 `http://localhost:$PORT` 传给驱动脚本。
- 例：`APP_ROOT=/path/to/app PORT=3000 bash ~/.claude/skills/browser-e2e/scripts/run-e2e.sh drive.mjs`。
- ⚠ `templates/drive.mjs` 的建/选项目段是 Next-Step 专属（`/api/projects`、AgentManager 选择器），换应用要改成你的前置。
