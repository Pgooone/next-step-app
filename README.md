# next-step-app

Next-Step 的**实现仓库**（实际代码）。

- 规格 / 文档（真相源）：`../next-step/docs/`（先读 `00-overview-总览.md`）
- pi-web 上游基座（改造参考，不直接改）：`../next-step/pi-web-code/`

## 当前进度

按 `docs/06-roadmap` 的任务卡推进，每完成一步提交一次 commit。

- [ ] **D2 拦截可行性验证（spike）** — 进行中，见 `spike/d2-intercept/`
- [ ] A1 项目注册表与 `/api/projects`
- [ ] …（A2 → … → D5）

## 为什么先做 spike

整条 v2 主线（块级 Diff / 版本 / HITL）依赖在「不 fork pi 内核」红线下拦截
`edit`/`write` 的写盘。动工前先用最小试验坐实这条机制在 `@earendil-works/pi-coding-agent@0.79`
上确实可行，避免做完 Artifact 抽象才发现拦截无解。
