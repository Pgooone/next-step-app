# 第 8.6 轮 · 主脑（主会话即总管）+ UI 打磨 · 任务卡 / progress

> 三件套：[需求文档](../../../docs/V1.2/第8.6轮-主脑与UI打磨/需求文档.md) / [概要设计](../../../docs/V1.2/第8.6轮-主脑与UI打磨/概要设计.md) / [详细设计](../../../docs/V1.2/第8.6轮-主脑与UI打磨/详细设计.md)。决策 QA D-V1.2-74~84 / ADR D-R8.6-01~06。

## 流程状态（vibe-coding）

| 步骤 | 状态 |
|---|---|
| 第一步 确定需求 | ✅ 需求文档（含 7 要素 + 9 缺口） |
| 第二步 设计 | ✅ 概要设计 + 详细设计 + **设计评审**（spike-1 去风险 GO + 完整性 self-review，详设 §12） |
| 第三步 划分任务（本文档）| ✅ |
| 第四步 实现 | ✅ **T1 spike-1 GO** + ✅ **T2 收官**（去风险 workflow `wrtzcbbd0` GO → agent team 实现 → lead 三重复验 → 独立 verifier → 真浏览器 smoke 全 PASS）；T3~T7 后续 |

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

### T3 · 计划确认闸（M3）[🔴承重 · spike-3]
- **目标**：submit_plan 落 awaiting_approval + 暂停 → 确认/否决/打回路由 → 计划卡（**含成本感知：显示派 N 个队员**，详设 §12③）。
- **AC**：产计划暂停(acquireSlot 零调用) / 确认放行 fire / 否决打回 / 计划卡渲队员+验收点+成本信号 / 不与 run-controllers globalThis 时序纠缠。
- **依赖**：T2。

### T4 · 主脑编排器 · 失败处理（M4）[🔴承重 · spike-2]
- **目标**：mastermind-orchestrator（仿 pipeline-orchestrator）+ 失败处理（重试1次→暂停→选项）+ 动态 run + 终态扩展(paused/partial)。
- **AC**：队员失败→暂停非 fail-fast / 选项(重试/换人/跳过/中止)各分支 / 暂停期 evict 释槽 / 只走 pipeline 族(否决 dispatch)。
- **依赖**：T2。

### T5 · 队员卡片内联·乙 + 临时造角色（M5+M6）[🔴UI承重]
- **目标**：队员卡片内联 ChatWindow（乙·对标 Kimi、冒回复下）+ GSAP 动效 + 临时造角色。
- **AC**：卡片冒主脑回复下 + 实时状态 + 点进详情 + 底部切换条 / 临时造避重名(uuid) / 动效克制(reduced-motion) / 守 D-R7B-07（真浏览器验收兜底）。
- **依赖**：T2~T4。

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

> **进度**：T1 spike-1 GO + **T2 收官**（双层验收全 PASS）。下一步 **T3 计划确认闸**（依赖 T2 已满足）。T2~T7 已建 task 跟踪。
