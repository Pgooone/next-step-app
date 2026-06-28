# 第八轮 · 方案 B 设计评审门 NO-GO 记录（留痕·供回溯/讨论）

> **用途**：方案 B（计槽 size→in-flight）经 ultracode 设计评审门判 **NO-GO**（承重命门被证伪），用户改选 **evict-by-sessionId**。本文完整保留方案 B 的分析与评审发现，供日后回溯/讨论（若将来仍想要「在跑回合≤3」语义，见末尾「方案 B 修正版」）。
> 评审：ultracode 7-agent（4 维对抗审查 → 命门反驳者 + 综合 → critic 裁决），2026-06-28。run `wf_155fd3d4`，完整结果 `/tmp/.../tasks/w17yxheaj.output`（会过期）。

## 一、裁决

**verdict = NO_GO（bearing_gate_confidence = high）**。承重命门「计量改 in-flight 后真正在跑的会话绝不被漏算」被独立逐行复核**证伪**——方案 B 用 `inner.isStreaming` 作 in-flight 判据在 **retry 退避窗口漏算**，命门不成立。

## 二、致命 blocker：retry 退避窗口 isStreaming===false 而 worker 真在 in-flight（lead 亲核坐实）

**机制（4 处源码，lead 已 file:line 亲验）**：
1. `dispatch-runner.ts:247`：worker 只在 `agent_end && willRetry===false` 才 finish（`:219` 注释「重试中的 agent_end 不算结束」）→ retry 期间 `await ended`(:157) 仍挂起 = **worker 真在 in-flight**。
2. 内核 `agent-session.js:663-667` `_runAgentPrompt`：在 `await agent.prompt()`（run #1，返回时 isStreaming 已 finally→false）与 `agent.continue()`（run #2）之间跑 `_handlePostAgentRun`（:674）。
3. `:680 _prepareRetry` → `:2022 await sleep(delayMs)`（指数退避 2/4/8s，settings retry 默认开/maxRetries 3/baseDelayMs 2000）。**这段 sleep 全程 `isStreaming===false`**（run #1 结束、run #2 未起）。
4. `:511 isStreaming` 委托 `agent.state.isStreaming`——单个内核 run 结束即 false。
5. 可重试错误集（`:1989` 正则）= overloaded / 429 / rate limit / timeout / network / connection reset / fetch failed —— **DeepSeek 真实高发项**（资源调查实测时段性全 fail）。

**并发可达性（坐实违 ≤3）**：`runs/route.ts:80 void runPipeline` fire-and-forget、全仓无 run 级单飞守卫、gate 进程全局共享 → 3 worker 满 + 1 退避 → `inFlightSessionCount` 读 2 → `pipeline-orchestrator.ts:127 acquireSlot({timeoutMs:Infinity})` 放行第 4 → 退避结束 `continue()` 恢复 → **4 worker 真并发违 ≤3 红线**。且专挑限流时犯（越忙越多放、雪上加霜）；`timeoutMs:Infinity` 排队堵则死等不退、无超时兜底。

**为何无内核字段可救**：retry 退避用独立 `_retryAbortController`、不反映在任何 getter。

## 三、第二漏算源：auto-compaction 窗口 isStreaming===false（可救、但救不了 retry）

`compact()`（agent-session.js:1562，settings 默认开）跑在 prompt 返回（isStreaming=false）之后、continue 之前。**与 retry 不同**：compaction 期 `isCompacting` getter（:566 检 `_autoCompactionAbortController`）为 true、且 `AgentSessionLike` 已暴露 `isCompacting`（pi-types.ts:29）→ compaction 漏算可由 filter 加 `inner.isCompacting` 修掉；**retry 用独立 controller、isCompacting 也盖不住，是真死穴**。二者都证明「只用 isStreaming 的 filter 不够」。

## 四、3 条 major（均 real，独立复核）

1. **T1 spike 场景清单遗漏 retry/compaction → 会「假 GO」放行真漏算方案**（元级原因）：原 spike 清单没列 retry 退避 / auto-compaction 两场景，照写会假绿。**教训**：承重 spike 的场景清单本身要先被对抗审查，漏掉 unhappy 路径 = 假 GO 制造机。
2. **spec 三处「不再有任何 evict-by-agentId 被触发」是事实错误**（过度声称）：全仓 evict-by-agentId 生产触发点**恰两条**——`pipeline-orchestrator.ts:167/187`〔本轮删〕+ **`app/api/projects/[id]/agents/[agentId]/route.ts:63`**（第六轮改 mode 用、gated on `before.mode!==updated.mode`、不在 run 完成误杀链上、本轮不动）。需求:17/概要:13/概要:20 的全称命题为假（虽不影响本轮目标 bug 的根除）。
3. **承重测试重写范围被低估**：evict 断言散布远超 spec 点名的两段——承重块 `98-261`（spec 上界 227 漏 :253 catch 路径）+ T6 块 `603-775`（spec 716-757 漏 :753）+ 失败分支 `:386` 起也注入 evict spy。漏改会让 T2 门禁编译/断言失败卡死。

## 五、6 条 minor spec 订正（评审顺带揪出，对 evict-by-sessionId 仍部分适用）

1. 详设 §1.2「:80 doEvict」→ 实为 **:82**（:80 是 doAcquireSlot）；rpc-manager 路径是 `lib/rpc-manager.ts`（非 `lib/pi/`）。
2. `lib/pi/concurrency-gate.test.ts` **已存在**（含 3 个 acquireSlot 桩单测）——spec 误标「新增」，应「向现有文件追加、保留 3 测」防 Write 覆盖丢测。
3. AC-5「keys() 集合不变」措辞——安全源于「只读 currentStageIndex 当前阶段(`pipeline-run-store.ts:136`)而非集合恒等」，liveSet 只会更全、绝不漏真活会话。
4. spike 验①措辞：GO 判据从「send 后立即恒 true」→「首 message_start 之后至 agent_end 无 false 窗口；send→首事件启动窗口 false 属预期保守」（`prompt` agent-session.js:716/:727 抵达置 true 前有多个 await）。
5. spike 验③：abort 非同步落 false（`agent.js:197` 仅 abort 控制器、false 由 finally 异步落）→「abort 后 await 到 run settle 再断言 false」。
6. `concurrency-gate.ts:48` 超时文案「请关闭部分会话后重试」——新语义下完成态/idle 已不计槽、关闭无效，应改「请等待部分会话回合结束后重试」（仅方案 B 适用）。

## 六、已坐实「成立、无需改」的（排除噪声）

- completed 路径：isStreaming 在单个内核 runWithLifecycle 跨度内恒 true、agent_end 半拍保守不漏放（agent.js:316/:347/:397）。
- 改动面完整：size 消费者仅 `concurrency-gate.ts:22`、keys() 仅 `pipeline-runs/[runId]/route.ts:15`、acquireSlot 仅 legacy `orchestrator.ts:117` + `pipeline-orchestrator.ts:127`。
- 红线全 holds（owner-map / 上限来源 / evict-agent-sessions.ts / 内核零改）；成对铁律正确；D-V1.2-50 与三件套一致。
- **方案 B 不成立的风险全部集中在 retry 漏算，不在改动面/红线/completed 半拍。**

## 七、处置：改选 evict-by-sessionId（用户拍板 D-V1.2-50 轮次2）

retry 是生死线、无内核字段可救。两条出路：
- **evict-by-sessionId（用户选·本轮落地）**：保持「在册≤3」语义，只把每阶段 evict 从「按 agentId 一锅端」收窄为「只逐本阶段 sessionId」。**完全规避 isStreaming 时序问题**（命门 = 单会话逐出粒度、纯应用层、零内核时序依赖）。前提已 lead 亲核：worker 工具集无 spawn + 一 worker=一 sessionId=一槽。
- **方案 B 修正版（回溯备选，若将来仍想要「在跑回合≤3」语义）**：不读内核 isStreaming，改由 **worker 生命周期层自报占槽**——计量与 `runWorker` 的「send → `agent_end && !willRetry`」对齐（这正是 dispatch-runner 已有的「真结束」判据），**天然覆盖 retry + compaction**。代价：dispatch-runner 自维护一份 in-flight 计数 + 前端聊天会话另需处理，改动面比纯改 filter 大、须活进程 spike。本轮不做、留此备选。

**教训沉淀**：承重前提若是「某内核信号恒成立」，且该前提继承自前序调研（未亲自证伪），必在设计评审门派专职反驳者死磕 unhappy 路径（错误/重试/超时/compaction）——本案就是它救的场（已固化进 cc-multi-agent-dev-flow / vibe-coding skill）。
