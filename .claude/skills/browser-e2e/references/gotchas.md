# 浏览器 E2E 踩坑速查 + 选择器参考

> 本机（无 root）实测过的细节。`setup-browser.sh` 已自动处理大部分，但 debug 时看这里。

## 必看坑
1. **必须显式 `executablePath`**：`~/.cache/ms-playwright` 里的 chromium 是较新 build（如 1223，目录 `chromium_headless_shell-XXXX/chrome-headless-shell-linux64/chrome-headless-shell`），而 npm 的 `playwright` 默认找它自带的旧 build（如 1169，旧目录 `chrome-linux/headless_shell`）。版本+布局都不符，不设 `executablePath`/`PW_EXECUTABLE` 会报 `Executable doesn't exist …`。→ `setup-browser.sh` 用 `find … -name chrome-headless-shell` 自动探测、经 `PW_EXECUTABLE` 给出（适配任意 build，不写死版本号）。1.52 内核驱动 1223 CDP 兼容、实测正常。
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

## 所需系统库（无 root，apt-get download → dpkg -x 到 /tmp/cdeps/root）
headless shell 直接缺约 10 个：`libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libgbm1 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2`。连传递依赖共 ~41 个 deb。`setup-browser.sh` 用 `apt-cache depends --recurse` 递归取依赖；若 `ldd <shell> | grep "not found"` 仍有残缺，把缺的 .so 对应包名加进脚本里的 `BASE` 再跑一次。

## 易腐提醒
`/tmp/pw`、`/tmp/cdeps`、`/tmp/fc-fonts.conf` 是 /tmp 资产，**重启/清理会丢**——丢了重跑 `setup-browser.sh` 即可（几分钟、无需 root）。`~/.cache/ms-playwright` 的 chromium 较持久。
