# Next-Step 进度看板（总体）

> 本目录是**工作进度跟踪器**；规格真相源在 `../../next-step/docs/`（先读 `00-overview`）。
> 每完成一张任务卡：勾选状态 → 按对应 AC 自检 → `npm run lint && npm run test` → **更新所在区 README** → 提交 commit → 回写本页。

## 里程碑

| 里程碑 | 模块文件 | 内容 | 状态 |
|---|---|---|---|
| 前置 | `spike/d2-intercept/` | D2 拦截可行性验证 | ✅ 已完成（11/11 PASS） |
| Iter A | [project-workspace.md](project-workspace.md) | 项目即工作区（A1/A2/A3） | 🔄 进行中（A1 ✅ A2 ✅，下一张 A3） |
| Iter B | [agent-profiles.md](agent-profiles.md) | 多 Agent 可定义（B1/B2/B3） | ⬜ 未开始 |
| Iter C | [dispatch.md](dispatch.md) | 多 Agent 协作派发（C1/C2） | ⬜ 未开始 |
| Iter D | [artifacts-diff-hitl.md](artifacts-diff-hitl.md) | 产物 Diff/版本/HITL（D1–D5，v2） | ⬜ 未开始（D2 机制已预验证） |

## 依赖图

```
A → B → C
A → D
C → D        （D 依赖 A 与 C）
```

## 底座决策

`next-step-app` **以 pi-web 基座为起点**：复制 `../../next-step/pi-web-code` 为应用底座，
在其上叠加领域层（`lib/domain/**`）、领域 API（`app/api/{projects,agents,dispatch,artifacts}`）、
领域 UI（`components/ProjectSwitcher` 等）。pi 内核不 fork，只在 `lib/pi/**` 封装。

## 已确认的关键技术结论（来自 spike）

- **D2 拦截可行**：`createAgentSession({ noTools:"builtin", customTools:[替身 write/edit] })`，
  替身 execute 不写盘、转 PendingChange。**必须用 `noTools:"builtin"`，不能用 `excludeTools`**
  （后者按名 denylist 会把同名替身一起剔除）。详见 `spike/d2-intercept/README.md`。

## 进展

- ✅ 仓库骨架；✅ D2 拦截 spike 验证通过；✅ 导入 pi-web 基座。
- ✅ A1 项目注册表与 API；✅ A2 项目选择器 + 起会话绑 cwd（test 20/20 + lint + build）。
- ✅ 区 README 约定落地（lib/domain·stores·api + 根 README 边界图）。
- 🔄 下一张：A3 环境自检（doctor + /api/health），收尾 Iter A。
