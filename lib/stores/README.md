# lib/stores（Next-Step 状态层 · Zustand）

> 归属：Next-Step 新增。　规格：`../../next-step-V1/docs/07`（开发约定）

## 作用
前端全局状态，用 **Zustand**。每个 store 单一职责、命名 `useXxxStore`；
组件用 selector 订阅，避免不必要重渲染。

## 关键模块
- `useProjectStore.ts` — 当前项目 + 项目列表 + 动作（refresh / select / create / remove）；
  `currentProjectId` 持久化到 localStorage；导出纯函数（持久化/解析）与 selector 便于单测。
- `useAgentStore.ts` — 当前项目下 Agent 档案的 CRUD（refresh / create / update / remove），
  带 `loadedProjectId` 维度（切项目重拉、不跨项目缓存脏数据）；导出 model 拆/拼、tools
  集合等纯函数与 `selectAgentsForProject` selector 便于单测。
- `useDispatchStore.ts` — 多 Agent 派发任务的数据层（dispatch / pollOnce / reset），同样带
  `loadedProjectId` 维度（切项目不串显）；只做数据，**轮询定时器放组件**（便于 unmount 清理、
  单一职责）；导出 `selectTaskForProject` / `selectIsActive`（终态判定）纯函数与 `DispatchTask`/
  `Assignment` 类型（按 `docs/03` 定义，C1 后端导出共享 domain 类型后可平替）。
- `useArtifactStore.ts` — ArtifactPanel 的前端状态（D3，§5.4）：当前打开的 artifact（元数据 +
  当前版本 content）+ 其 pending 变更 + 视图模式（inline / diff）+ `editTarget`（划选引用到对话框，
  AC⑥）；`open(id)` 并行拉 `GET /api/artifacts/[id]` 与 `.../pending`、`setViewMode` / `setEditTarget`；
  导出 `selectPendingBlocks`（扁平化并过滤 state==="pending" 的 DiffBlock）便于组件订阅。
  **D5 版本管理**（§5.6）：`versions`（版本元数据列表）+ `selectedVersion`（null=跟随最新 / 非 null=只读看历史快照）
  + `historyContent`；`listVersions()` 拉 `GET .../versions`、`selectVersion(v|null)`（选历史版拉 `.../versions/[v]`、
  null 或选回当前版回到跟随最新）、`rollback(toVersion)`（带 `If-Match`=当前 version 乐观锁、成功后 `refresh()` 并复位
  selectedVersion=null、409 写 `rollbackError`）。无 SSE（D-D5-2 选 A：自己触发的操作后直接 refresh）。
  **第四轮删除**：`delete(id?)`（target=`id ?? selectedArtifactId`，删当前打开项带 `If-Match`=version 乐观锁、
  `DELETE /api/artifacts/[id]`；成功**仅当 target===selectedArtifactId 才 `close()`**、返回 boolean 供入口决定刷新、
  409/404/失败走 toast）。结构操作、不走 propose（D-V4-02）。
  **刻意不持久化**（全是会话内瞬态、刷新归零合理），故无 `hydrate`、天然无 SSR hydration 问题。
  渲染仍只读：不引入手动编辑器 / 绕过 PendingChange 的写路径（D-D5-1）。

## 约定 / 红线
- 命名 `useXxxStore`，单一职责。
- 网络副作用放 action 内（调 `app/api` 领域路由）；纯逻辑（持久化 / 按 id 解析）抽成可导出纯函数以便单测（vitest 跑 `lib/**`）。
- localStorage key 用 `next-step:` 前缀。

## 改这个区前
先读 `docs/07` 开发约定（状态 / 命名）。
