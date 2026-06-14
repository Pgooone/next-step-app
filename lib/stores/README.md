# lib/stores（Next-Step 状态层 · Zustand）

> 归属：Next-Step 新增。　规格：`../../next-step/docs/07`（开发约定）

## 作用
前端全局状态，用 **Zustand**。每个 store 单一职责、命名 `useXxxStore`；
组件用 selector 订阅，避免不必要重渲染。

## 关键模块
- `useProjectStore.ts` — 当前项目 + 项目列表 + 动作（refresh / select / create / remove）；
  `currentProjectId` 持久化到 localStorage；导出纯函数（持久化/解析）与 selector 便于单测。
- `useAgentStore.ts` — 当前项目下 Agent 档案的 CRUD（refresh / create / update / remove），
  带 `loadedProjectId` 维度（切项目重拉、不跨项目缓存脏数据）；导出 model 拆/拼、tools
  集合等纯函数与 `selectAgentsForProject` selector 便于单测。
- （后续）`useDispatchStore` / `useArtifactStore`

## 约定 / 红线
- 命名 `useXxxStore`，单一职责。
- 网络副作用放 action 内（调 `app/api` 领域路由）；纯逻辑（持久化 / 按 id 解析）抽成可导出纯函数以便单测（vitest 跑 `lib/**`）。
- localStorage key 用 `next-step:` 前缀。

## 改这个区前
先读 `docs/07` 开发约定（状态 / 命名）。
