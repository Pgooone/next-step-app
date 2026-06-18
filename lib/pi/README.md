# lib/pi（pi 内核封装区）

> 归属：Next-Step 新增。　规格：`../../next-step-V1/docs/05-features-功能清单.md` §5.2（B2）
> 决策：`../tasks/decisions.md` D-24~D-28（B2）、D-B4-1~8（B4）　任务卡：`../tasks/agent-profiles.md`

## 作用
对 `@earendil-works/pi-coding-agent` / `pi-ai` 内核做**封装**（只封装、**不 fork 内核源码**，红线）。
把 Next-Step 的领域概念（Agent 档案）翻译成内核 `createAgentSession` 能消费的装配与运行时调整。

> 注意：本目录是「逻辑封装区」。既有的内核交互债 `lib/rpc-manager.ts`、`lib/pi-types.ts`
> 等当前落在 `lib/` 根下（基座沿用）；本区新增 B2 起会话封装与 B4 起会话接线（`profile-session-wiring.ts`），
> 不迁移、不重构它们（B4 仅给 `rpc-manager.ts` 加 `registerInnerSession` 这一最小 export，D-B4-1）。

## 关键模块
- `agent-profile-session.ts` — **B2 按档案注入起会话**。对外函数：
  - `assembleProfileSessionOptions(...)` — 读档案正文 → 拼注入块 → 装
    `DefaultResourceLoader`（注入 + 技能过滤）→ 返回可展开进 `createAgentSession(...)` 的
    options（**调用方负责真正 new 会话**，见 D-27）。
  - `applyProfileRuntime(session, profile, deps?)` — 会话建好后做模型查找/降级 + 设模型 +
    设 thinkingLevel，返回 `{ modelFallback }`。
  - 纯 helpers：`readProfileDocs` / `buildInjectionBlock` / `resolveModelSelector` /
    `buildProfileResourceLoader`。
- `profile-session-wiring.ts` — **B4 按档案起会话接线**。`startProfileSession(...)` 组合
  `assembleProfileSessionOptions` → `createAgentSession` → `applyProfileRuntime` →
  `registerInnerSession` → 发首条 message，返回 `{ sessionId, diagnostics }`。逻辑放此（而非
  `app/` 的 route）以便 faux 集成测（vitest 仅覆盖 lib/**，D-B4-7）；依赖注入口生产省略，route 退薄壳。
  - **V2（文档实体 + 提议工具）：profile 会话装受限工具集**（V2-4，替代 P0 的 artifact-guard）。建会话时
    无条件合并 `assembleDocSessionOptions({ projectId, sourceActor: profile.name, cwd }).options`——
    白名单只给只读内置 + 3 提议工具、**无 write/edit/bash**，AI 结构性无直接写盘路径（改文档只能走
    提议 → PendingChange → 按块确认 → 才写盘）。`sourceActor=profile.name`（`PendingChangeCard` 渲染
    「变更来自 <name>」，人类可读，非 UUID agentId）。需 `projectId`（提议工具闭包定位项目）——由 route 的
    `[id]` 透传（`startProfileSession` 入参新增 `projectId`）。
  - **⚠️ spread 顺序 = 受限集生效的唯一支点（D-V2-04 / major4）**：`createAgentSession({ ...options,
    ...docOptions, ...createOptionsOverride })`——`options`(=assembleProfileSessionOptions) 含
    `tools: profile.tools`、`docOptions` 也含 `tools`(7 项受限白名单)，两键相撞，**docOptions 必须排
    `options` 之后**覆盖 profile.tools，否则 profile.tools 若含 write/edit/bash 会泄漏、受限集当场失效。
    （P0 guard 走 `noTools` 无 tools 键、顺序无关；本轮不同，顺序不可调——有泄漏对照测守住。）
  - **仅 profile 会话这一处**：不碰主对话 `/api/agent/new`、`dispatch-runner.ts`、idle 重建/`rpc-manager`
    原生路径——idle 重建路径无受限工具集属已登记 gap，本卡不修。文档型 vs coding 型 profile 区分=登记后续。
  - `docDepsOverride?` 是**测试专用**注入口（指向 hermetic 临时 service/store），生产省略 → 提议工具默认其
    文件后端（`buildDocTools` 内 `new ProjectRegistry()` 读默认 `~/.pi/projects.json`），与 resolve/pending
    路由指向同一批文件，UI 读得到。
- `dispatch-runner.ts` — **C1 单 worker 会话「起 + 等回合结束 + 取产物」**。`runWorker(...)` 与 B4 的区别：
  B4 fire-and-forget 即返回；派发需**等 worker 跑完并取回产物文本**，故自己组合那 5 步，并在
  `registerInnerSession` 之后、`send` 之前挂 `agent_end` 监听（包成 Promise，resolve 于
  `agent_end && willRetry===false`）。返回 `{ sessionId, output, reason }`，`reason ∈ completed|timeout|aborted`。
  **执行超时兜底（D-C1-1）**：worker 起会话发 prompt 后若 `timeoutMs` 内无 agent_end（卡住/异常），
  按超时结束并**主动 `send({type:"abort"})` 停掉该会话**释放并发槽；中途 abort 信号同理。超时/取消皆
  resolve（不 reject），由 orchestrator 据 reason 写明确失败信息。`extractAssistantText(messages)` 抽末条
  assistant 的 `type:"text"` 文本作产物。复用 B2 注入装配，不重写。
- `concurrency-gate.ts` — **C1 全局并发闸门（AC⑤ ≤3，D-C1-1）**。`acquireSlot(...)` 起 worker 前**等待**
  到活跃会话数 < limit 才放行（轮询，默认 60s 超时兜底防饿死，超时抛「活跃会话已达上限 N，请关闭部分
  会话后重试」由 orchestrator 判该 worker 失败）。计数源默认 `globalThis.__piSessions.size`（含前端聊天
  会话 + 派发 worker），可注入桩计数器便于测。TOCTOU 窗口（gate 通过→会话真正注册间的 async 间隙）在
  串行+单用户下可接受，仅注释不引并发池。
- `artifact-intercept.ts` — **D2 受管 artifact 写盘路径识别（D-D2-2）**。`resolveManagedTarget(absPath, registry)`
  运行时反查（不建索引）：词法归一 `resolve`（**不** realpath，目标文件可能尚不存在）→ 命中某项目
  `<root>/.pi/artifacts/managed/<id>/` 前缀且 `<id>/artifact.json` 存在 → 返回 `{projectId,artifactId}`，
  否则 `null`（放行正常写）。Iter C 派发产物在 managed 父级，`relative` 以 `..` 开头自然不误命中。
- `artifact-guard.ts` — **D2 拦截编辑工具 → PendingChange（D-D2-1 选 C / D-D2-4/5）**。`assembleArtifactGuardOptions(deps)`
  产出可展开进 `createAgentSession` 的 options（`noTools:"builtin"` + 注入了守卫 operations 的内核 write/edit
  + 重建 read/bash/grep/find/ls，零工具漂移）。守卫 operations「自分流」：受管路径→读 `readCurrentContent`
  当旧内容、`buildReplacePendingChange` 切块、落 PendingChange、**不写盘**；非受管→委托真实 fs 正常写。
  `sourceActor` 由 deps 闭包注入（execute 的 ctx 不带 agent 身份）。沿用 B2「只产 options、调用方 new 会话」边界。
- `doc-tools.ts` — **V2-2 文档「提议工具」工厂（`defineTool` 自定义工具）**。`buildDocTools(deps)` 返回
  3 个工具：`create_artifact({kind,title,content})`→`ArtifactService.createArtifact`（直接落 v1 + 物化，
  author=sourceActor）；`propose_edit({id,newContent})`→**①查未决**（`listPendingChanges` 非空则拒绝、
  引导先处理，D-V2-05）**②**`computeReplaceDiffBlocks` 空块（无变化）不 save、返回 changeId:null
  **③**`buildReplacePendingChange`+`pendingStore.save`（**不写盘**，落的 PendingChange 与既有 resolve
  路由/PendingChangeCard 兼容、确认流水线零新增）；`list_artifacts({})`→`listArtifacts`。`projectId`/
  `sourceActor` 由 deps 闭包注入（execute 的 ctx 不带）；`artifactService`/`pendingStore` 可注入、生产
  走默认文件后端。**与 guard 的根本区别**：guard 靠「拦 write/edit」防直接写盘；提议工具让 AI **结构性
  无直接写盘路径**（只能调这 3 个工具），是 V2「文档实体+提议工具」模型取代「逐路装 guard」的核心。
  **description 硬约束（模型唯一真读通道）**：`propose_edit` 描述写明「newContent 必须是完整新全文、
  未改段落逐字保留」——用户「只改一段」的体验由 LCS 只切变化块 + 按块确认交付，agent 内部仍回整篇；
  回残篇会被判删除致满屏噪声。白名单须含这 3 工具名（D-V2-04，否则内核按名过滤掉、调不到），由 V2-3
  装配负责。execute 内 `try/catch` 把 ArtifactError（如 id 不存在=NOT_FOUND）转成给模型看的错误文本、
  不让未捕获异常炸会话（引导 agent 改正/先 list_artifacts 核对 id）。`DocToolDef`（= `ToolDefinition<any,any>`，
  方差规避）一并 export 供 V2-3 复用。
- `doc-session.ts` — **V2-3 文档会话装配（替 artifact-guard 装配位）**。`assembleDocSessionOptions(deps)`
  产出受限工具集 options `{ tools, customTools }`（同 guard 的「只产 options、调用方 new 会话」边界）：
  `tools`（白名单）= 导出常量 `DOC_SESSION_TOOLS` 7 项 `["read","grep","find","ls","create_artifact",
  "propose_edit","list_artifacts"]`——**含全部 3 个 customTool 名（D-V2-04 命门：内核对 customTools 也按
  白名单名过滤、漏名则 agent 调不到、闭环断）、且不含 write/edit/bash**；`customTools` = `buildDocTools(deps)`。
  **比 guard 更简**：不要 write/edit/bash → 白名单直接排除、customTools 只加 3 新工具，**无需重建任何内核
  工具 operations**。安全（依赖 V2-0 spike 双向实证）：白名单无 write/edit/bash → 内置写盘工具不激活；
  customTools 只加只读提议工具 → **结构性无绕过**。deps 含 `cwd` 仅为对齐 guard 装配契约 + V2-4 调用点，
  本模块自身不消费（doc-session 不重建 cwd 级工具 operations，cwd 由 wiring 直接传 createAgentSession）。
  V2-4 wiring 把 `assembleArtifactGuardOptions` 换成它时，**docOptions 须 spread 在 profileOptions 之后**
  覆盖 profile.tools（两者都含 tools 键，防 profile.tools 的 write/edit/bash 泄漏）。

## 约定 / 红线
- **只封装不 fork 内核**：所有持久注入走内核原生钩子
  （`DefaultResourceLoader.appendSystemPromptOverride` / `skillsOverride`），
  **不**事后改 `session.state.systemPrompt`（会被内核 `_rebuildSystemPrompt` 从 loader 重读覆盖，D-24）。
- **注入位置**：注入块排在 system prompt 的 append 段最前——基座说明之后、`<project_context>` /
  技能之前（由内核 `system-prompt.js` 拼接顺序决定）。
- **记忆只读**：memory.md 仅作只读上下文注入（`<agent_memory readonly>` 标签），本区从不写回；
  文件缺失按空串。
- **空 tools 语义（D-28）**：profile.tools 为空数组 = 「无编码工具但保留档案 prompt」，
  **不**走 `rpc-manager.ts` 那条「空工具→清空 systemPrompt」旧分支（那条归 B3 集成时回避）。
- **model 降级（D-25）**：档案 model 空/格式非法/registry 查不到 → 用内核默认 +
  `modelFallback:true`，**不抛错**（本地单用户工具，档案模型失效不该整体失败）。

## 与 B3 的边界
B2 **不加任何 API 端点、不碰 `/api/agent/new`、不碰 `rpc-manager.ts`**。
`createAgentSession` 调用本身（绑会话生命周期/registry）留给调用方：B3 集成 + 本区单测用 faux 驱动。

给 B3 的备注：
- `applyProfileRuntime` 是 **async**（命中分支 `await session.setModel`），集成时记得 `await`。
- **tools 白名单未校验合法性**：B2 把 `profile.tools` 原样作为 `tools` 白名单传给
  `createAgentSession`，不校验工具名是否存在（§5.2 未要求、工具校验后置见 D-22）。非法名传给内核的
  行为由 B3 在集成时按需处理。

## 改这个区前
先读 `../tasks/decisions.md` 的 D-24~D-28（承重内核机制已由 lead 核验为真），不要重设计注入方案。
