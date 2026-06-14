# Next-Step 进度看板（总体）

> 本目录是**工作进度跟踪器**；规格真相源在 `../../next-step/docs/`（先读 `00-overview`）。
> 每完成一张任务卡：勾选状态 → 按对应 AC 自检 → `npm run lint && npm run test` → **更新所在区 README** → 提交 commit → 回写本页。
> 凡有「选项+取舍」的拍板 → 追加一行到 [decisions.md](decisions.md)（回溯找 bug 用）。

## 里程碑

| 里程碑 | 模块文件 | 内容 | 状态 |
|---|---|---|---|
| 前置 | `spike/d2-intercept/` | D2 拦截可行性验证 | ✅ 已完成（11/11 PASS） |
| Iter A | [project-workspace.md](project-workspace.md) | 项目即工作区（A1/A2/A3） | ✅ 完成（A1 ✅ A2 ✅ A3 ✅） |
| Iter B | [agent-profiles.md](agent-profiles.md) | 多 Agent 可定义（B1/B2/B3） | 🔄 进行中（B1 ✅ B2 ✅，下一张 B3） |
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
- ✅ A1 项目注册表；✅ A2 项目选择器 + 绑 cwd；✅ A3 环境自检（doctor + /api/health + 凭证 banner）。
- ✅ **Iter A 项目即工作区 完成**（test 29/29 + lint + build + doctor exit 0）。
- ✅ B1 Agent 档案存储与三件套落盘（2c7187c，test 37/37）。
- ✅ Iter A 实地验证（dev server，API 链路全绿）；✅ 流程约定：区 README + 决策表；✅ 推送 GitHub 私有仓库。
- ✅ B2 按档案注入起会话（`lib/pi/agent-profile-session.ts`，test 50/50）：`DefaultResourceLoader` +
  `appendSystemPromptOverride` 注入 agent.md+memory（记忆只读、实测扛 rebuild）、`skillsOverride` 过滤技能、
  model 单串解析+降级、thinkingLevel 直传；`assembleProfileSessionOptions` + `applyProfileRuntime` 两函数，
  createAgentSession 留给调用方（D-24~D-28）。
- ✅ B3 Agent 管理 UI（纯 CRUD，test 66/66）：`AgentManager.tsx`（模态：列表/新建/编辑/内联删除确认）+ `useAgentStore`；
  表单 model 下拉(/api/models)、skills 多选(/api/skills)、tools 勾选内置集、删除文案强调删整个目录（D-30/31）。
  **真浏览器 E2E 验收**（Playwright + 缓存 chromium）：建→改→删全程跑通、三件套真落盘、删除真清目录、中文正常。
  E2E 发现并修复 SSR hydration 真 bug（useProjectStore 以 localStorage 作初始 state → Agents 按钮刷新后卡死禁用；改 init null + 挂载后 hydrate）。决策 D-29~D-33。
- 🔄 下一张：B4 按档案起会话接线（wiring：新会话端点 + 起会话入口；首步 spike E1 rpc-manager 注册）。之后 Iter C / Iter D。
