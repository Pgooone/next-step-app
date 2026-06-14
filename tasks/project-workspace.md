# Iter A · 项目即工作区

模块目标：项目注册表 + 选择器 + 起会话绑 cwd + 环境自检。
规格：`../../next-step/docs/05-features-功能清单.md` §5.1；路线图 `docs/06` Iter A。
状态：🔄 进行中（A1 ✅ 已完成，下一张 A2）

---

## A1 · 项目注册表与 API — ✅ 已完成（commit d0b002a）
- 依赖：无
- 涉及：`lib/domain/project-registry.ts`、`lib/api/errors.ts`、`app/api/projects/**`
- 完成定义：`projects.json` 读写 + CRUD 路由
- 验证：5.1 AC（新建/切换）；`npm run test` 9/9 PASS、`npm run lint` clean
- 子步骤：
  - [x] `ProjectRegistry`：`~/.pi/projects.json` 的 list/create/get/update/remove（纯 TS，可单测）
  - [x] 单元测试覆盖 CRUD 与边界（重复名、缺失文件、非法 root、损坏 json）
  - [x] `app/api/projects/route.ts`：GET 列表 / POST 新建
  - [x] `app/api/projects/[id]/route.ts`：GET / PATCH / DELETE（删除仅移注册项）
  - [x] 自检：`npm run lint && npm run test` 通过

## A2 · 项目选择器 UI + 起会话绑 cwd — ⬜ 未开始
- 依赖：A1
- 涉及：`components/ProjectSwitcher`、起会话调用处
- 完成定义：切换项目后新会话 cwd 正确
- 验证：5.1 AC（cwd / 隔离）

## A3 · 环境自检（doctor + /api/health）— ⬜ 未开始（可与 A1 并行）
- 依赖：无
- 涉及：`scripts/doctor.ts`（`npm run doctor`）、`app/api/health/route.ts`、首屏设置向导
- 完成定义：检测 ①Node 版本 ②pi 内核依赖可 `require.resolve` ③模型凭证（AuthStorage 有 provider）
  ④`~/.pi` 可写；①② 不满足时 `npm run doctor` 退出码非 0 阻断启动，③④ 仅 warning 并引导设置页
- 验证：缺凭证时 `GET /api/health` 返回 `credentials.ok=false` 且首屏弹向导；Node 过低时 doctor 退出码非 0
- 背景：见 `../../next-step/docs/refs/pi-web-analysis-源码解析与移植规划.md` 第 6.5 节
