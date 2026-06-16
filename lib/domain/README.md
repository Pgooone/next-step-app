# lib/domain（Next-Step 领域层）

> 归属：Next-Step 新增。　规格：`../../next-step/docs/03`（数据模型）、`04`（API 契约）
> 任务卡：`../tasks/`

## 作用
项目 / Agent 档案 / 派发 / 产物的**纯领域逻辑**，框架无关、不依赖 Next.js。
API 路由（`app/api/**`）只做 HTTP 转换，调用这里。纯文件存储（无 DB）。

## 关键模块
- `project-registry.ts` — 项目注册表（`~/.pi/projects.json` 的 CRUD）
- `agent-profile-store.ts` — Agent 档案存储；档案随项目落 `<projectRoot>/.pi/agents/<id>/` 三件套（agent.json/agent.md/memory.md）的 CRUD
- `dispatch-store.ts` — 派发任务存储（C1）；`DispatchTask` 随项目落 `<projectRoot>/.pi/dispatch/<taskId>.json` 原子写。`create` 校验 goal 非空 + assignment 数量 2–3；`get(projectId,taskId)` 精确读、`findTask(taskId)` 跨项目扫描（契约 `GET /api/dispatch/[taskId]` 路径无 projectId）；`write` 整体替换供 orchestrator 驱动状态机。
- `orchestrator.ts` — 多 Agent **串行**派发编排（C1，§5.3）。`runDispatch(task, deps, signal?)`：逐个 assignment 起 worker（经 `lib/pi` 的 `runWorker`）→ 上游产物拼进下游首条 message（AC③）→ 产物落 `.pi/artifacts/<dispatchId>/<seq>-<agent>.md`（D-C-1 轻量普通文件，不版本化/不 Diff）→ 实时回写状态机 pending→running→done/failed。失败分中止后续（串行依赖）：闸门超时 / **worker 执行超时（默认 5min，runWorker 已 abort 会话）** / 被取消 / 产物为空 / 档案缺失，各写**明确**失败信息（据 `runWorker` 返回的 reason 区分）。起 worker 前过并发闸门 `acquireSlot`（AC⑤ ≤3）。依赖（runWorker/acquireSlot/store/registerInnerSession/workerTimeoutMs）可注入便于 faux 单测。
- `artifact-service.ts` — 受管 artifact 存储（D1）；随项目落 `<projectRoot>/.pi/artifacts/managed/<id>/`（`artifact.json` 元数据 + `versions/<n>.json` 单版快照），与 Iter C 派发产物 `<dispatchId>/` 同根隔离。`createArtifact` 校验 kind/title；`getArtifact` 合并当前版内容；`submitVersion`/`rollback` 经乐观锁（写盘前 `assertVersionMatch`，If-Match≠当前 `version`→VERSION_CONFLICT）追加新版（两计数 currentVersion/version 同步 +1，永不覆盖旧版）；`findArtifact` 跨项目仅扫 `managed/` 定位（契约 `GET /api/artifacts/[id]` 路径无 projectId）；`listArtifacts(projectId)` 扫 `managed/<id>/artifact.json` 列元数据（不含 content、按 title 升序，供 D3 打开入口）。
- `pending-change-service.ts` — 未确认块级变更（D2，§5.4/5.5）。`PendingChange`/`DiffBlock` 类型（权威见 docs/03）+ 手写行级切块纯函数（`computeReplaceDiffBlocks` 旧/新全文行级 LCS 聚 add/del/mod 块；`computeEditDiffBlocks` 按 edit 逐处切块）+ `buildReplacePendingChange`/`buildPatchPendingChange` 组装 + `PendingChangeStore` 落盘 `managed/<id>/pending/<id>.json`（与 D1 版本目录平级隔离，atomicWrite）、`listPendingChanges(projectId,artifactId)` 扫 `pending/*.json` 按 createdAt 升序列出（无变更→空数组，供 D3 面板只读渲染）。切块不依赖第三方库；拦截装配在 `lib/pi/artifact-guard.ts`。

## 约定 / 红线
- 领域错误抛带 `code` 的错误（如 `ProjectError`："NOT_FOUND" | "INVALID"）；
  HTTP 状态映射在 `lib/api/errors.ts`，本层**不碰 HTTP / NextResponse**。
- 写操作走「临时文件 + rename」原子落盘。
- 实体的权威 TS 类型在 `docs/03`，本层实现服从它。

## 改这个区前
先读 `docs/03` 数据模型（实体的权威类型）。
