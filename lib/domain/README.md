# lib/domain（Next-Step 领域层）

> 归属：Next-Step 新增。　规格：`../../next-step-V1/docs/03`（数据模型）、`04`（API 契约）
> 任务卡：`../tasks/`

## 作用
项目 / Agent 档案 / 派发 / 产物的**纯领域逻辑**，框架无关、不依赖 Next.js。
API 路由（`app/api/**`）只做 HTTP 转换，调用这里。纯文件存储（无 DB）。

## 关键模块
- `project-registry.ts` — 项目注册表（`~/.pi/projects.json` 的 CRUD）
- `agent-profile-store.ts` — Agent 档案存储；档案随项目落 `<projectRoot>/.pi/agents/<id>/` 三件套（agent.json/agent.md/memory.md）的 CRUD
- `dispatch-store.ts` — 派发任务存储（C1）；`DispatchTask` 随项目落 `<projectRoot>/.pi/dispatch/<taskId>.json` 原子写。`create` 校验 goal 非空 + assignment 数量 2–3；`get(projectId,taskId)` 精确读、`findTask(taskId)` 跨项目扫描（契约 `GET /api/dispatch/[taskId]` 路径无 projectId）；`write` 整体替换供 orchestrator 驱动状态机。
- `orchestrator.ts` — 多 Agent **串行**派发编排（C1，§5.3）。`runDispatch(task, deps, signal?)`：逐个 assignment 起 worker（经 `lib/pi` 的 `runWorker`）→ 上游产物拼进下游首条 message（AC③）→ 产物落 `.pi/artifacts/<dispatchId>/<seq>-<agent>.md`（D-C-1 轻量普通文件，不版本化/不 Diff）→ 实时回写状态机 pending→running→done/failed。失败分中止后续（串行依赖）：闸门超时 / **worker 执行超时（默认 5min，runWorker 已 abort 会话）** / 被取消 / 产物为空 / 档案缺失，各写**明确**失败信息（据 `runWorker` 返回的 reason 区分）。起 worker 前过并发闸门 `acquireSlot`（AC⑤ ≤3）。依赖（runWorker/acquireSlot/store/registerInnerSession/workerTimeoutMs）可注入便于 faux 单测。
- `artifact-service.ts` — 受管 artifact 存储（D1）；随项目落 `<projectRoot>/.pi/artifacts/managed/<id>/`（`artifact.json` 元数据 + `versions/<n>.json` 单版快照），与 Iter C 派发产物 `<dispatchId>/` 同根隔离。`createArtifact` 校验 kind/title；`getArtifact` 合并当前版内容；`submitVersion`/`rollback` 经乐观锁（写盘前 `assertVersionMatch`，If-Match≠当前 `version`→VERSION_CONFLICT）追加新版（两计数 currentVersion/version 同步 +1，永不覆盖旧版）；`findArtifact` 跨项目仅扫 `managed/` 定位（契约 `GET /api/artifacts/[id]` 路径无 projectId）；`listArtifacts(projectId)` 扫 `managed/<id>/artifact.json` 列元数据（不含 content、按 title 升序，供 D3 打开入口）。**D5 新增** `getVersion(projectId,id,version)`：取某版完整 `ArtifactVersion`（content+meta），供版本下拉查看历史版（artifact/版本不存在→NOT_FOUND）；路由 `GET /api/artifacts/[id]/versions/[version]`（version 非整数→422）。**V2-1 物化层**：`Artifact` 增 `filePath?`（物化真实文件相对 projectRoot，create 时由 title 经 `file-name.ts` 生成、落 artifact.json、之后不随 title 漂移）；`createArtifact`/`submitVersion`/`rollback` 在版本落盘后把当前版 content 原子物化成项目根真实 `.md`（取舍2：物化到 `<projectRoot>/<sanitize(title)>.md`，类 Notion 一眼可见）。**外部编辑保护（D-V2-06）**：submit/rollback 物化前先比对真实文件现状 vs「上一当前版」content，被外部手改 → 抛 `EXTERNAL_MODIFIED`(→409) **干净拒绝**（不写新版、不覆盖），防 AI 确认静默覆盖丢失外部改动（首版 create 无上一版不比对）。已知 gap（本期不做、登记后续）：无 delete/清理工具 → create 错一篇或手删真实文件后侧车残留致列表不一致。
- `file-name.ts` — 文件名清洗 / 物化文件名生成的共享纯函数（V2-1，无 pi/框架依赖）。`sanitizeFileName(name)` 由 `orchestrator.ts` 迁出至此共享（orchestrator 改 re-export，避免 artifact-service 经 `orchestrator → ../pi/*` 链把 pi 内核拖进领域存储层）：仅替换文件系统非法字符 `/ \ : * ? " < > |` 与控制字符 U+0000–U+001F、去首尾空白与点、全空兜底 `agent`（保留中文/Unicode）。`buildArtifactFileName(title, dir)`：清洗 → 截断基名到 80 字符（防 ENAMETOOLONG）→ 与 `dir` 已有同名 `.md` 避让（`-2`/`-3`…），返回含 `.md` 的文件名。
- `session-agent-map.ts` — 「会话 ↔ agent / 主对话」归属映射（M5 承重墙，功能#5 地基，M7/M8 依赖）。会话结构无 `agentId` 且不可改内核会话文件，故领域层另存附加元数据，落项目本地 `<cwd>/.pi/ns-session-map.json`（D-V1.1-01，原子写）。`SessionMap{mainSessionId, bySession}`；接口 `getOwner/setOwner/removeOwner` + `getMain/setMain` + `readMap`（文件不存在/损坏均回退空映射，不抛）。**惰性清理**实现为纯函数 `pruneMissing(map, liveSessionIds)`（丢弃已不存在的会话项、main 失活清 null），由 GET 路由注入存活集合——领域层据此保持内核无关、可单测；不挂 DELETE 链路。路由 `GET/PATCH /api/projects/[id]/session-map`（PATCH 按字段分流：`mainSessionId` 设/清主对话、`{sessionId, agentId|null}` 增/删归属）。
- `pending-change-service.ts` — 未确认块级变更（D2 切块/落盘 + D4 逐块确认/重建，§5.4/5.5）。`PendingChange`/`DiffBlock` 类型（权威见 docs/03）+ 手写行级切块纯函数（`computeReplaceDiffBlocks` 旧/新全文行级 LCS 聚 add/del/mod 块；`computeEditDiffBlocks` 按 edit 逐处切块）+ `buildReplacePendingChange`/`buildPatchPendingChange` 组装 + `PendingChangeStore` 落盘 `managed/<id>/pending/<id>.json`（与 D1 版本目录平级隔离，atomicWrite）、`listPendingChanges` 扫 `pending/*.json` 按 createdAt 升序列出（无变更→空数组）。**D4 新增**：`applyResolvedBlocks(change)→newContent` 纯函数——重放 lcsDiff+聚块、按各块 state 取舍重建内容（confirmed 取新行 / rejected·pending 留旧行；全 confirmed=newContent、全 rejected=oldContent；仅 op=replace，patch 抛 INVALID；编辑组数与 diffBlocks 失配抛 INVALID）；`PendingChangeStore.resolveBlock(...,{blockId?,action})` 翻块 state 原子落盘（省略 blockId=全 pending 块统一置态、幂等不回退已决）；`resolveAndMaterialize(...)` = resolveBlock + 「该条全块非 pending 则 `applyResolvedBlocks` 重建 → 注入的 `ArtifactService.submitVersion`(If-Match=当前 version) 出新版 → `remove` 删 pending」，返回 `{change, materialized, artifact?}`；`remove(...)` 删 pending 文件。**写盘红线**（D-D4-5）：「全决才出新版」的写盘逻辑落在**本 service 的 `resolveAndMaterialize`**（注入 ArtifactService、可单测），`POST .../resolve` 路由退成薄调用；构造期 `PendingChangeStore` 默认 new 一个与自身共用 registry 的 ArtifactService。切块不依赖第三方库；PendingChange 的产生源在 `lib/pi/doc-tools.ts` 的 `propose_edit` 提议工具（V2，取代 V1 时期已删的 `artifact-guard` 写盘拦截）。

## 约定 / 红线
- 领域错误抛带 `code` 的错误（如 `ProjectError`："NOT_FOUND" | "INVALID"）；
  HTTP 状态映射在 `lib/api/errors.ts`，本层**不碰 HTTP / NextResponse**。
- 写操作走「临时文件 + rename」原子落盘。
- 实体的权威 TS 类型在 `docs/03`，本层实现服从它。

## 改这个区前
先读 `docs/03` 数据模型（实体的权威类型）。
