# M7「全 Kimi·主脑 run 期服务端实时旁白」· 可行性调查（结论 do-not-build → 用户定留三期 backlog）

> **性质**：M7 是第 8.6 轮第二期详设 §7 定的「本期最后一步、唯一可能需 spike、可留三期」项。M1~M6 收官后 lead 跑 ultracode **可行性调查（读码为主的设计评审、不搭 spike、不改代码）** 评估要不要做/要不要 spike。
> **执行**：2026-07-02，ultracode workflow `wf_63e502b5-93a`（4 读码 probe〔推送通道 / 并发安全 / M7-vs-M1 边际价值 / 前提分类〕+ final 综合 + lead 亲核）。
> **结论**：**do-not-build**（四 probe 一致 + lead 亲核三点坐实）。**用户拍板（D-V1.2-88）= 留三期 backlog**（本期不做、不关档；重启条件见 §五）。
> **决策落点**：QA D-V1.2-88（`../../QA/第8.6轮-主脑决策.md`）+ ADR D-R8.6-17（`../../设计决策记录.md`）。

## 一、要评估的目标（M7 vs 已实现的 M1）

- **M1 中间路 nudge（第二期已实现 + 真浏览器端到端验证通过）**：前端轮询 run 进度，队员干完/全完时在主脑空闲（`!agentRunning`）用 `handleSend` 往主脑会话发隐式消息、触发主脑真回合吐阶段小结/汇总。**已拿到「主脑 run 期边跑边旁白」九成观感**（真 DeepSeek 2 队员实测主脑自动冒两条小结 + 汇总）。纯前端、不碰 T6 解耦。
- **M7「全 Kimi」**：让 run **服务端内部**主动实时驱动主脑会话起回合（子步骤级即时旁白），触碰 T6 刻意解耦（approve `void runMastermind` fire-and-forget + run 与主脑会话解耦）。

## 二、结论：do-not-build（边际价值 << 代价）

**M7 相对 M1 的唯一实质增量 = 两个边角**：
1. **子步骤级实时粒度**（M1 是阶段翻转粒度 + 2s 轮询延迟；M7 服务端推送理论到子步骤即时）——用户对 2s 轮询延迟基本无感。
2. **用户切走会话后主脑仍在后台旁白**（M1 driver 随 ChatWindow 卸载做不到）——**伪需求**：用户切走本就看不到主脑对话，旁白冒出来也无人看，切回时 PollDriver 重挂从 server 补齐进度即够。

**M7 的代价（远大于增量）**：
- 破 T6 刻意解耦（第二期反复守的红线、有意设计）。
- **run→主脑会话反查链当前根本不存在、须新建**（lead 亲核 `mastermind-run-store.ts:108-123`：`MastermindRun` 全 12 字段无任何回指主脑 sessionId）。
- 服务端手写 mutex + 挂起队列 + 忙闲 gate（M1 靠单前端 driver + detector + React tick **免费**拿到；M6 真并行下多队员 `Promise.allSettled` 同刻完成 → 多个驱动请求并发到同一主脑会话须串行化）。
- 并发半拍坑（见 §三）。

「第三条路」option D（把 M1 driver 改挂全局补边角 2）**也不干净**（须连 PollDriver 一起搬全局 + handleSend 绑当前会话须造独立定位主脑会话的机制 + baseline/去重靠 remount 归空全局常驻须重设，D-R8.6-16 刚踩过坑），且补的效果本身价值就低。

## 三、并发半拍坑（lead 亲核坐实·四 probe 冲突的裁决）

probe 间对「run 能否用 `isStreaming` 判主脑忙闲当 gate（复刻 M1）」有正面冲突。**lead 亲读内核裁定：`isStreaming` 退避期翻 `false`、不能直接当 gate**（与第二期方案 B NO-GO 同源半拍坑）。证据链（lead 亲核）：
- `agent-loop.js:107-110`：内层流式循环遇 `stopReason==="error"/"aborted"` 直接 emit `agent_end` 并 return——**零内层 retry/backoff**。
- `agent.js:315-316/326/346-347`：`runWithLifecycle` 入口置 `activeRun`+`isStreaming=true`，`finally{finishRun()}` 在 `agent.prompt()` 返回**前**置 `isStreaming=false` 并清 `activeRun`。
- `agent-session.js:663-668/2020-2022/88`：`_runAgentPrompt` 先 `await agent.prompt()`（此后 isStreaming=false），再在 while 循环里 retry 退避 `await sleep`、用独立 `_retryAbortController`。
- ⇒ 退避 sleep 全程 `isStreaming=false`，但 Next-Step 视角「一个 handleSend 逻辑回合」未结束。DeepSeek 429/overloaded 高发下真实存在。
- **但此坑仅在 M7 用 `prompt` 立即触发时才成命门**；改用 `follow_up` 入队（`agent.js:171-173` 纯 enqueue 永不抛错）可纯分析型绕开——代价 = nudge 潜伏到主脑下次真回合才 drain（= M1 当初弃用 followUp 的「延迟轰炸」原因）。

## 四、方法论·前提分类（本次调查核心产出）

| 前提 | 类型 | 结论 |
|---|---|---|
| P1 run 内拿主脑句柄 + 触发回合 | 分析型·读码可定 | `getRpcSession` 从 `globalThis.__piSessions` 进程级单例按 id 取（`rpc-manager.ts:264-266`）、run 与主脑同进程；唯一 gap = 补 `mastermindSessionId` 字段（确定性数据流改动） |
| P2 破不破 T6 解耦 | 分析型·架构决策 | 是「愿不愿破/怎么破」的设计决策、非 runtime 未知 |
| P3 主脑长期在场 compaction 撑得住 | 分析型·算术可定 + 本地 spike 无效 | `shouldCompact` 死算式（`compaction.js:152`、reserveTokens=16384）；N×百千 token 远不触 DeepSeek 大窗口；compaction 纯反应式、本地无凭证 faux 产生不了真 overflow → **spike 在此「无效」（跑了也证不出真触发）、非「需要但做不了」** |
| P4 并发 isStreaming gate 语义够用 | **经验型·需 spike**（唯一）| 见 §三半拍坑；但仅在 prompt 立即触发分支成命门、可用 follow_up 绕开 |

**方法论纠偏**：某 probe 把 P3 compaction 标「empirical-needs-spike」被 lead 纠回「analytic」——**被第一期 spike 惯性污染**，正是本次要防的「别把能读码/算术 settle 的前提也推给 spike」（呼应 [[cc-multi-agent-dev-flow-review-vs-spike]]）。**M7 没有「决定能否动工」的经验型命门**：唯一经验型点（P4 半拍）可被 follow_up 设计消解、或仅是「能否更进一步做即时旁白版」的可选去风险。

## 五、若三期重启的最小方案预案 + 重启条件

**重启触发条件**：产品定位转向「**无人值守后台跑完自动产汇总并主动通知**」——届时 M1「用户切走会话/关 tab 期间主脑不旁白、切回靠轮询补终态」的局限会重新变痛。**重启时先 spike 那个窄点（isStreaming 退避真值）、而非直接破 T6**。

**最小 hermetic spike（三期若做）**：真进程起一个主脑 `AgentSession`（faux SessionManager/modelRegistry 无凭证起）+ 注入稳定抛 429/overloaded 的 faux streamFn 触发 retry 退避 → 在退避 sleep 窗口读 `session.isStreaming`，断言 `isStreaming===false` 且 `agent.activeRun` 仍非空（即 prompt 会抛）；结论 NO 则退回 M1 式驱动或改 follow_up、不必破 T6。

**破 T6 最小方案（architectureSketch，仅预案）**：① 数据层 `MastermindRun` 加 `mastermindSessionId`（`mastermind-run-store.ts:108-123`），submit_plan 落 run 或 `startOrchestratorSession` 建会话后回填主脑 realSessionId（**须从 `mastermindSessions`/`markMastermind` 取、绝不用 `getMain(cwd)`**——同项目多主脑会污染）；② 推送通道 runMastermind 每阶段 done/终态 `getRpcSession(run.mastermindSessionId)`、取不到（idle 回收）静默 no-op；③ 触发二选一：路 A follow_up 入队（纯分析型零风险、延迟退化）/ 路 B prompt 立即触发（即时旁白、须先 spike 半拍 + 精确 gate）；④ 并发防护进程内 mutex 串行化 + 每次驱动前读 isStreaming 躲用户回合 + 挂起队列（纯服务端逻辑层、vitest hermetic 可覆盖）。**ADR 须记**：仿 D-R8.6-05 记打破 T6 决策；触发方式取舍；反查链新建；「主脑 run 期常驻钉死 1 并发槽」（叠加 M6 真并行压缩队员槽）；P3 compaction 承压属本地测不出、留 prod 观测。

## 六、lead 亲核记录（3 点坐实、结论保守可逆故聚焦支柱）

1. ✅ `mastermind-run-store.ts:108-123` — `MastermindRun` 全 12 字段无回指主脑 sessionId（M7 代价支柱：反查链须新建）。
2. ✅ `agent-loop.js:107-110` — 内层遇 error/aborted 直接 return、零内层 retry（冲突裁决根：坐实半拍坑真实、concurrency 派对 push-channel P2 错、非幻觉）。
3. ✅ M1 已达成（lead 本会话端到端亲验：主脑真冒两条小结 + 汇总）——边际价值对比基线。

> do-not-build 是「不做」结论（保守、可逆、不改代码），故亲核聚焦两支柱（M7 代价高 + M1 已够）+ 冲突最高杠杆点，未穷尽 checklist 全部 6 条（其余为佐证、不改结论）。完整 4 probe JSON 在 workflow transcript（会话目录、未入 git）。
