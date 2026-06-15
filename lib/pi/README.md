# lib/pi（pi 内核封装区）

> 归属：Next-Step 新增。　规格：`../../next-step/docs/05-features-功能清单.md` §5.2（B2）
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
  `app/` 的 route）以便 faux 集成测（vitest 仅覆盖 lib/**，D-B4-7）；三个依赖注入口生产省略，route 退薄壳。
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
