# 第 8.6 轮 · 主脑（主会话即总管）+ UI 打磨 · 任务卡 / progress

> 三件套：[需求文档](../../../docs/V1.2/第8.6轮-主脑与UI打磨/需求文档.md) / [概要设计](../../../docs/V1.2/第8.6轮-主脑与UI打磨/概要设计.md) / [详细设计](../../../docs/V1.2/第8.6轮-主脑与UI打磨/详细设计.md)。决策 QA D-V1.2-74~84 / ADR D-R8.6-01~06。

## 流程状态（vibe-coding）

| 步骤 | 状态 |
|---|---|
| 第一步 确定需求 | ✅ 需求文档（含 7 要素 + 9 缺口） |
| 第二步 设计 | ✅ 概要设计 + 详细设计 + **设计评审**（spike-1 去风险 GO + 完整性 self-review，详设 §12） |
| 第三步 划分任务（本文档）| ✅ |
| 第四步 实现 | ✅ **T1 spike-1 GO** + ✅ **T2 收官** + ✅ **T3+T4 编排核心批次收官**（各去风险 workflow GO → agent team 实现 → lead 三重复验 → 独立 verifier → 端到端 smoke 全 PASS）；T5/T6/T7 用户定留后续会话 |

## 任务卡（承重优先 · 串行 · OOM 安全）

### T1 · spike-1 命门（派活工具注入）[🔴承重命门 · ✅GO]
- **目标**：验「给主会话装总管 resourceLoader + 派活工具 customTools」可行。
- **AC**：A1 注入不覆盖 / A2 命门正(execute calls 非空) / A3 命门负对照(漏名调不到) / A4 编码+派活并存 / A5 独立函数 —— 5 断言全绿。
- **落点**：lib/pi/orchestrator-session.ts（M1 雏形）+ orchestrator-session.spike.test.ts（spike 后删、迁正式单测）。
- **依赖**：无。**状态**：✅ **GO**——去风险（whyfwemtj）→ ns-spike1 实现（orchestrator-session.ts M1 雏形 + spike.test 5 断言 A1~A5）→ lead 三重复验（独立复跑 5/5 + 亲读非 vacuous + 变异命门 A2/A3 即红即绿）。子路线倾向 A（独立装配函数、不硬塞 startRpcSessionInner）。spike.test 待 T2 迁正式单测后删——迁时**加固 A3**：加「回合正常结束·stopReason 非 timeout」断言（adversary 捞回的有效质疑、防超时致 calls 空假绿；现 A3 靠 (a)active 无名 +(b)getToolDefinition undefined 兜底已非 vacuous、非 blocker）。

### T2 · 主脑会话装配 + 起会话链分支（M1+M2）[🔴承重 · ✅收官]
- **目标**：/api/agent/new 加「主脑模式」分支装 orchestrator 装配；**处理 idle 重建 gap**（详设 §12②，纳入 re-attach 分流，ADR D-R8.6-07）。
- **AC**：主脑模式起会话带派活工具+总管 prompt / 普通主会话零回归（强变异对照）/ idle 重建不丢能力。
- **依赖**：T1 GO。**承重**：A 路线不硬塞 startRpcSessionInner（撞 :380-382/:361-375）→ 走独立装配函数。
- **状态**：✅ **收官**。去风险 workflow `wrtzcbbd0`（4 probe 自带证伪 + final falseGoTraps）GO，**lead file:line 亲核**揪定承重命门：marker **不可复用 getMain**（`main-session.ts:18` 只认首个会话为 main、多会话/关总管都漏判）→ 专属 `mastermindSessions` 字段（ADR **D-R8.6-09/10**）。
  - **落点**：M1 加 `ORCHESTRATOR_SYSTEM_PROMPT` 常量 + `buildMastermindTools(calls?)` 可选；新建 `lib/pi/orchestrator-session-wiring.ts`（startOrchestratorSession + reattachOrchestratorSession，惰性 import 避环、绝不调 setActiveToolsByName 绕三坑）；`session-agent-map.ts` 加 marker 字段 + `markMastermind/isMastermind` + **readMap/emptyMap/pruneMissing 三处同步保留**（头号坑）；`/api/agent/new` `mastermind===true` 分支 + 服务端写 marker（普通分支字节级零回归）；`session-reattach.ts` resolver 主脑分支（profile 后、generic 前）+ DI 缝；hooks 透传 `mastermind:true`；迁 spike A1~A5 → `orchestrator-session.test.ts` + A3 加固（endFired/stopReason 三连）。
  - **双层验收全 PASS**：①lead 三重复验（独立门禁 lint0/tsc0/**test534→536** + 亲读非 vacuous + 变异两命门〔字段保留 / resolver 分流〕即红即绿）②独立 verifier ns-t2-verify（干净门禁 + 红线 grep 逐条 + 自写 fixture 交叉验、未发现真问题）③真浏览器 smoke `scripts/verify-r86-t2-smoke.mjs`（pageErrors=0 + 主脑路由 200+sessionId + **marker 落盘 `mastermindSessions` 只含主脑会话不含普通会话**确定性区分判据 + `bySession:{}` 不碰 owner-map）。
  - **lead 亲读揪修**：主脑分支首条消息丢 images（mastermind 默认开→零回归缺口）→ 已加 `images?` 透传 + 2 测试。
  - commit：本卡单独提交（`feat(core): 第8.6轮 T2 …`，本地 v1.2、未 push）。

### T3 · 计划确认闸（M3）[🔴承重 · spike-3 · ✅收官]
- **目标**：submit_plan 落 awaiting_approval + 暂停 → 确认/否决/打回路由 → 计划卡（**含成本感知：显示派 N 个队员**，详设 §12③）。
- **AC**：产计划暂停(acquireSlot 零调用) / 确认放行 fire / 否决打回 / 计划卡渲队员+验收点+成本信号 / 不与 run-controllers globalThis 时序纠缠。
- **依赖**：T2。**注**：计划卡 UI 留 T5（本批次只机制层，Q6）；submit_plan 真落盘 + approve/reject/revise 路由已实现。

### T4 · 主脑编排器 · 失败处理（M4）[🔴承重 · spike-2 · ✅收官]
- **目标**：mastermind-orchestrator（仿 pipeline-orchestrator）+ 失败处理（重试1次→暂停→选项）+ 动态 run + 终态扩展(paused/partial)。
- **AC**：队员失败→暂停非 fail-fast / 选项(重试/换人/跳过/中止)各分支 / 暂停期 evict 释槽 / 只走 pipeline 族(否决 dispatch)。
- **依赖**：T2。

### T3+T4 收官（编排核心批次，用户拍板一起做）
- **去风险**：workflow `wpjrwmijy`（3 probe 自带证伪 + final GO），lead file:line 亲核 spike-2/spike-3 两承重 HOLDS；6 决策 + 4 承重命门（idle 闭包重注入 / approve 幂等门 / resume 重建 controller / 临时造 agentId）+ projectId 缺口（cwd 反查 helper）→ **ADR D-R8.6-11**。
- **落点**：新建 `mastermind-run-store.ts`（6 态 + reconcileOrphan 对 awaiting/paused early-return + pruneOld terminal=done/failed/partial）/ `mastermind-orchestrator.ts`（runMastermind 仿 runPipeline：resume 跳 done+从 artifactId 回读 cache / 临时造 agentId Q2 / retry attempt 小循环每 attempt 尾部 evict / 失败 pauseRun 非 fail-fast / partial-done 判定）/ `resolve-project-id.ts`（cwd→projectId）；submit_plan 真落 awaiting（dispatch_task 移除 Q1、teammate schema 加 mode Q3、prompt 改）；wiring 两处注入 {projectId,runStore}（含 reattach 反查、堵 idle gap 延伸）；6 路由（approve 幂等门→409 / reject / revise / resume 重建 controller + reassign 换池内 agent Q4 / mastermind-runs GET+cancel paused 分支）。**MVP 串行队员**（并行留二期）。
- **双层验收全 PASS**：①lead 三重复验（独立门禁 lint0/tsc0/**test536→563** + 亲读全部承重文件非 vacuous + 变异 spike-2 evict 命门即红即绿）②独立 verifier ns-t3t4-verify（干净门禁 + 红线 grep 逐条〔否决 dispatch/owner-map/acquireSlot Infinity/D-R7B-07/spike-3 结构封死〕+ 自写 fixture〔approve 幂等门/reconcileOrphan/spike-2 负对照〕、未发现真问题）③路由集成 smoke `scripts/verify-r86-t3t4-routes-smoke.sh`（curl 真运行时 6/6：approve 幂等门 200→409 + 拒非 awaiting + cancel-paused→failed + GET reconcile 不翻 awaiting/paused）。**spike-2**（真 runMastermind + faux 三闭包 fauxMap + destroy 真删 + sizeAtEnter===1 证回落非本就 0 + AC-2.2 负对照）**spike-3**（submit_plan faux spy acquireSlot/setRunController 调 0 次 + 源码 grep 结构封死）均确定性坐实。
- commit：本批次单独提交（本地 v1.2、未 push）。

### T5 · 队员卡片内联·乙 + 计划卡 + 临时造角色（M5+M6）[🔴UI承重 · ✅收官]
- **目标**：队员卡片内联 ChatWindow（乙·对标 Kimi、冒回复下）+ 计划卡 UI + GSAP 动效 + 临时造角色。
- **AC**：卡片冒主脑回复下 + 实时状态 + 点进详情 + 底部切换条 / 临时造避重名(uuid) / 动效克制(reduced-motion) / 守 D-R7B-07（真浏览器验收兜底）。
- **依赖**：T2~T4。**状态**：✅ **收官**（commit `0536aa6`，本地 v1.2、未 push）。去风险 workflow `w0kbl3j1m`（7 agent、9 falseGoTraps）GO_WITH_MITIGATION → ns-t5-impl 实现（8 新 + 7 改）→ **lead 三重复验**（亲读非 vacuous 9 traps 逐条 / 独立门禁 lint0/tsc0/test596=563+33 / 变异命门：收窄 StageCardStage→tsc 红 3 处、删 STATUS_META.skipped→TS2741）→ **独立 verifier ns-t5-verify 双层验收全 PASS**（干净门禁 + 红线 grep + 真浏览器亮暗双主题 6 态全渲 + skipped hover 不崩 + pageErrors=0，hybrid fixture）→ lead 亲读 4 截图。
  - **两大待设计点终裁**（ADR D-R8.6-12）：①entryId→runId=否决独立 store、按 runId 从 transcript 就地派生（`derive-run-ids.ts` filter 非 find、卡片主键 runId 非 entryIds）②卡片族吃超集=新建 `stage-card-stage.ts` StageCardStage（详设「extends」措辞与代码不符、status 实际更宽）+ status-meta 补 skipped 键。
  - **落点**：新建 useMastermindStore/MastermindPlanCard/PollDriver/TeammateCards/PipelineBoardStyles + lib/pipeline/stage-card-stage + lib/mastermind/{derive-run-ids,friendly-name}；改 ChatWindow/AppShell/PipelineBoard/PipelineStageCard/StageHoverPreview/StageSessionMenu/status-meta。

### T6 · 长上下文 + spike-4 真模型（M7）[🔴承重 · spike-4]
- **目标**：长上下文策略（队员短命会话 + 主脑轻读汇总）+ 真模型端到端验。
- **AC**：compaction 真触发不崩 / context% 可控 / **sf-mini 标杆场景产「好看好用可运行 UI 原型」**。
- **依赖**：T2~T5（编排骨架就位）。

### T7 · UI 打磨（M8）[与 T5 卡片交汇]
- **目标**：.btn 四型六态 token/类 + 修流水线卡片真 bug + 补 a11y（需求 §三）。
- **AC**：按钮亮暗六态正确 / 卡片 queued 一致 + hover 过渡 + 键盘可达 + Esc + reduced-motion / pageErrors=0。
- **依赖**：T5 先 commit（同改 PipelineStageCard、避两次改同文件）。

### 双层验收
- 机制层确定性测试（vitest）+ 真浏览器（UI 卡）+ **sf-mini 标杆场景**（主脑端到端·产可运行 UI 原型）。

---

> **进度**：T1 spike-1 GO + **T2 收官** + **T3+T4 编排核心批次收官**（均双层验收全 PASS，本地 v1.2 未 push）。**本会话范围到此（用户拍板 T3+T4 批次）**。**下一步（后续会话）= T5 队员卡片内联·乙 + 临时造角色 UI**（计划卡 UI 也并入 T5、同锚点 ChatWindow messages.map），然后 T6 长上下文真模型 + T7 UI 打磨。机制层地基（主脑装配 + 起会话链 + idle gap + 计划确认闸 + 编排器失败处理）已全部就位，T5 起接 UI 可视化。
