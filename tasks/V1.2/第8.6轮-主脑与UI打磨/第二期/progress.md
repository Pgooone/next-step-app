# 第 8.6 轮第二期 · 主脑对话流与 UI 打磨 · 任务卡 / progress

> 三件套：[需求文档](../../../../docs/V1.2/第8.6轮-主脑与UI打磨/第二期/需求文档.md) / [概要设计](../../../../docs/V1.2/第8.6轮-主脑与UI打磨/第二期/概要设计.md) / [详细设计](../../../../docs/V1.2/第8.6轮-主脑与UI打磨/第二期/详细设计.md)（§10 已回填 + §12.1 评审结果）。
> 决策：QA D-V1.2-85/86/**87** / ADR **D-R8.6-15**；评审留痕 [第二期设计评审-GO记录](../../../../docs/V1.2/第8.6轮-主脑与UI打磨/第二期/第二期设计评审-GO记录.md)。
> **⚠️ 评审 vs spike 边界**：本期全程读码评审（已执行 GO_WITH_MITIGATIONS）、**只 T7(M7) 才 spike**。

## 流程状态（vibe-coding）

| 步骤 | 状态 |
|---|---|
| 第一步 确定需求 | ✅ 需求文档（4 需求 + P0/P1/P2 + 评审边界） |
| 第二步 设计 | ✅ 概要（M1~M7）+ 详细 + **设计评审 GO_WITH_MITIGATIONS**（`wf_14c177a5-30d` 7 probe + final 9 traps + lead 亲核 9 条；揪 2 REFUTED + 1 遗漏命门、已回填详设；§10 九问全拍） |
| 第三步 划分任务（本文档）| ✅ |
| 第四步 实现 | ⬜ T1 起（agent team 串行 + lead 三重复验 + 独立 verifier） |

## 任务卡（承重优先 · 串行 · 同文件交汇卡先 commit 再改）

### T1 · M1 中间路 nudge 驱动器 [🔴承重·本期主体 · ✅收官（逻辑层）]
> **✅ 实现+lead 三重复验完成**：ns-r2-t1 实现（4 新建：`lib/mastermind/nudge-detector.ts` 纯函数核 + 21 测试 / `hooks/useMastermindNudge.ts` 薄封装 / `MastermindNudgeDriver.tsx` 挂载宿主；3 修改：ChatWindow 挂载 + `deriveAllRunIds` 扩展 + 4 测试）。lead 亲读全量 diff + 独立门禁（lint0/tsc0/**test 599→624**）+ 变异命门（废 baseline-first→21/21 红、废一 tick 一发→3 专属红、恢复即绿）+ 红线 grep（零 followUp 调用、approve/orchestrator/内核零改动）。**队员超出预期的两处正确设计**：①「一 tick 至多一发」（同帧多发会撞 stale agentRunning + 单会话回合冲突→每 tick 只发首条、快照单 key 推进、余下下轮补发）②「首次进入终态」判据替代「prev===running」（后者会让 paused→resume→done 的汇总永久漏发）+ agentRunning 落回触发补发 held nudge（run 终态后 store 冻结、靠 statusSummary 永不再变）。**真浏览器端到端（DeepSeek 真跑多队员 run 看小结/汇总/F5 零重放）留批量验收**。
- **目标**：run 期主脑退场，前端观察 run 进度，每个队员干完自动 nudge 主脑吐阶段小结、全干完自动 nudge 产总汇总受管文档（模拟 Kimi 边跑边旁白、纯前端不碰 T6 解耦）。
- **AC（评审 mustFix 1-5 全进）**：
  1. 🔴 nudge 统一走 `handleSend`（`useAgentSession.ts:346`）+ `!agentRunning` gate、忙时本轮跳过下轮补发；**禁 handleFollowUp/followUp**（idle 纯入队黑洞 + 潜伏延迟轰炸，D-R8.6-15）。
  2. 🔴 baseline-first 去重：首挂只建 prev 快照基线不发；只对本地观察到的 `pending/running→done`（stage）与 `running→done/partial`（run）翻转各 nudge 一次。F5/切回/StrictMode 双挂载/run 早已终态四场景零重放（逻辑层单测覆盖）。
  3. prev/seen 用 useRef（remount 重置=有意）；`__final__` 边沿判据 + firedFinal 双保险（防 resume 重发汇总）；覆盖 transcript 派生的**所有** runId（filter 禁 find）。
  4. 驱动器挂 ChatWindow 作用域（同 PollDriver）；effect 依赖钉 `stages[].status` 翻转摘要非 messages 长度；切走会话即卸载不跨会话 nudge。
  5. 措辞反诱导：阶段小结「只用文字简要汇报、不要调用任何工具、不要提交新计划」；终态「这是汇总收尾、不要再 submit_plan」+ 带 runId；run 翻 `paused` nudge 一句「有队员失败、请到卡片上处理」、翻 `failed`（用户主动）不 nudge。
  6. 不改 `approve/route.ts` / `runMastermind` / 内核（红线 grep 验）。
- **落点**：新建 `hooks/useMastermindNudge.ts`（或组件）+ ChatWindow 挂载；复用 useMastermindStore 轮询 + handleSend + T6 汇总工具（零新增服务端）。
- **验收**：逻辑层（去重矩阵单测）+ **真浏览器端到端**（DeepSeek 真凭证跑多队员 run：阶段完主脑真冒小结 → 全干完自动产汇总受管文档 → F5 中途刷新零重放，pageErrors=0）。
- **依赖**：无。

### T2 · M2 计划卡等待态 [🟢UI · ✅收官（commit `158fdcd`）]
> ns-r2-t2 实现（仅 MastermindPlanCard.tsx +24：awaiting 分支顶部等待条 ⏳ + t-kimi token + 独立 testid、静态无动画）；lead 亲读 diff + 分支结构亲核（等待条仅 awaiting 分支、三按钮未动）+ 独立门禁（lint0/test599 零回归、warnings 经 stash 对照确认既有）。真浏览器随 T3/T4 批量。
- **目标**：awaiting 分支渲「⏳ 等你确认放行」等待条——用户一眼看出「在等我」非「对话结束」。确认闸三按钮不动。
- **AC**：等待条独立 data-testid（`mastermind-plan-waiting`，勿复用既有 5 个）+ t-kimi token（var(--sub)/var(--run-accent)）；prompt 不改（§10-① 纯 UI 承载）；真浏览器 awaiting 态渲出 + 亮暗双主题 + pageErrors=0。
- **落点**：`components/MastermindPlanCard.tsx:36-88` awaiting 分支顶部。
- **依赖**：无（可与 T1 并批实现、不同文件）。

### T3 · M3 hover Portal 修 + M5a role/uuid8/验收点 [🟢回归+P1 · ✅收官（逻辑层）]
> ns-r2-t3 实现（7 文件：新建 `lib/pipeline/use-popover-portal-host.ts` 共享 Portal 宿主 hook〔自建自毁 + theme 跟手 + 绝不含 board + 无 transform + SSR 守卫〕；两浮框 createPortal + z 1050/1060〔评审遗漏命门、保相对序〕+ scheduleHide/外点关/Esc 原样保留 + popover-position 零改动；role 3 处纯增量〔store/approve/StageCardStage〕+ friendlyAgentName 补 4 位置 + 验收清单渲真值 + 41 行 role 兼容测试）。lead 三重复验：亲读全量 diff + useTheme 形态命门亲核（Theme="light"|"dark" 与既有消费方一致）+ 独立门禁（lint0/tsc0/**test 624→625**）+ 变异（删 StageCardStage.role → 5 消费点 + 2 断言红、恢复绿）。**⚠️ lead 操作教训：变异恢复对「已跟踪但未 commit」文件误用 git checkout 抹掉队员改动（幸有 diff 在手逐字恢复）——变异一律 cp 备份法、任何未 commit 状态禁 git checkout**。hover 贴卡 6px/token 不白屏/板内盖 modal = 真浏览器批量验。
- **目标**：修 T5 GSAP transform 包含块回归（浮框飞 +320px→贴卡 6px）+ hover 内容对齐 Kimi（职衔 + 验收点 + 剥 uuid8）。
- **AC（mustFix 6/7/9 全进）**：
  1. 🔴 `StageHoverPreview` + `StageSessionMenu` createPortal 到 body 级 wrapper：`pipeline-board t-kimi-{theme}`（**绝不含 board**）、static、无 transform/filter/contain；每实例自建自毁 + theme 跟手 + mounted 守卫；`popover-position.ts` 一字不动。
  2. 🔴 **z-index 1001~1099**（评审遗漏命门：modal z:1000 > 浮框 50/60）；真浏览器**两宿主都验**（看板 modal 内 + 主脑内联）：贴卡 gap=6px getBoundingClientRect 实测 + token 不白屏 + 板内浮框盖住 modal 可见。
  3. hover 维持不退化（140ms scheduleHide + 浮框 onMouseEnter 原样保留）；外点关/Esc/stopPropagation 仍工作。
  4. role 3 处纯增量：`MastermindStage`/`StageCardStage` 加 `role?:string` + `approve/route.ts:38-50` 补 `role: t.role`；hover 显职衔（fallback friendlyAgentName）+ 验收清单区渲 `stage.acceptanceCriteria` 真值。
  5. friendlyAgentName 补 4 位置：`StageHoverPreview:156` + `StageSessionMenu:190/280/293`（不再露 role-uuid8）。
- **依赖**：无；**先于 T4 commit**（同轮多卡改 PipelineBoardStyles/卡片族，串行防冲突）。

### T4 · M4 集群框 + queued 态 [🟢视觉 · ✅收官（逻辑层）]
> ns-r2-t4 实现（2 文件 +64-14：外层加专属类 `mastermind-board`〔PipelineBoardStyles 新增一条规则：圆角 14px + 1px var(--line) 边框 + var(--container) 底、绝不铺 var(--bg)、不碰 .board 既有规则〕+ running 分支渲 .hd 集群头〔fork SVG 复制 + 「主脑派活」+ .cnt「已完成 done/total」〕；PipelineStageCard 映射/gsap/queued badgeFor 一字未动）。lead 亲读全量 diff + 独立门禁（lint0/tsc0/test625 零回归）。**队员自报取舍待真浏览器判**：外框恒在最外层（awaiting 计划卡态也带框=与计划卡自框双层嵌套），若视觉冗余再一行收窄。框/集群头/双态/双主题 = 真浏览器批量验。
- **目标**：内联队员卡片加限定框（对标 Kimi「⑂ Agent 集群」）+ 集群头 + queued 灰态呈现。
- **AC（mustFix 8 进）**：专属类 `mastermind-board`（`MastermindTeammateCards.tsx:80` 加类 + `PipelineBoardStyles` 补 `.pipeline-board.mastermind-board{圆角/padding/border/background:var(--container) 或透明}`、**绝不铺 var(--bg)**）；渲 `.hd` 集群头（fork SVG 复制 `PipelineBoard.tsx:137-153` + 「主脑派活」+ `.cnt`「已完成 {done}/{total}」）；running 亮绿点阵 + queued「排队中」双态同框（链路已通、评审坐实）；看板 modal 视觉零回归；真浏览器亮暗双主题 + pageErrors=0 + **顺带确认 M5c 下钻可用**（点队员→StageSessionMenu transcript/产物，零新增）。
- **依赖**：T3 先 commit（同改 PipelineBoardStyles/卡片族）。

### ~~T5 · M5 其余细节~~ [已砍]
- §10-⑥⑦ 全砍（中文人名池/走马灯/创建角色卡/全局进度头条）；M5a 并入 T3、M5c 零新增并入 T4 验收。**本卡取消**。

### T6 · M6 并发档 2·真并行扇出 [🔴承重（评审升格）· ⬜]
- **目标**：「并发按每次任务调整」落地为**批内真并行**（D-V1.2-87 档 2）——确认放行后 N 个队员同时亮绿并行跑。
- **AC（mustFix 11 + ADR D-R8.6-15(5) 全进）**：
  1. submit_plan schema 加 `execution?: "parallel"|"serial"`（主脑按任务声明；**默认 serial 完整保留累积喂下游、既有 run 零回归**——强对照测试）。
  2. parallel：批内并行发起 + acquireSlot 排队兜底（超 limit 自然 queued、卡片呈现现成）+ **全 settle 统一判定**（任一失败→整批 settle 后 pauseRun；partial 语义沿用）；批内无累积喂下游（每队员独立 upstream）；evict-by-sessionId 每 worker settle 即逐出（守第五轮 owner-map 红线 + F16 释槽）。
  3. 🔴 修 `mastermind-run-store.ts:244` atomicWrite tmp 竞态（加唯一后缀；并行多 worker 同进程写同 run JSON 的原子性单测）。
  4. clamp 抽 `clampConcurrent`（factory-config 导出）两处共用、禁裸传 0/负（`timeoutMs:Infinity` 永久挂起防线）；limit 语义=进程级活会话总上限（含主脑、计划卡注明）。
  5. 逻辑层 vitest 重点：并行 settle 判定矩阵（全成/部分败/全败）/ tmp 竞态 / serial 零回归 / clamp 边界。**非 spike**（自家代码逻辑层）。
- **落点**：`orchestrator-session.ts`（schema）+ `mastermind-orchestrator.ts`（并行分支）+ `mastermind-run-store.ts`（tmp）+ `factory-config.ts`（clamp 导出）+ approve 路由/计划卡（并行数展示）。
- **依赖**：T1 先收官（nudge 与并行 run 时序交互：多 stage 同帧翻 done→逐条 nudge 或合并，实现时定）。

### T7 · M7 全 Kimi 末步 [🔴唯一 spike · 最后一步 · 可留三期 · ⬜]
- **目标**：主脑 run 期实时旁白（run→主脑会话推送、碰 T6 解耦）。
- **流程**：M1~M6 全收官后 → hermetic spike 验可行性 + compaction 扛得住 → GO 才实现；风险过大留三期（本期以中间路收官=九成参与感）。
- **依赖**：T1~T6 全收官。

### 双层验收（每卡 + 收官）
- 每卡：lead 三重复验（亲读全量 diff〔git status 全量看、勿 grep 过滤〕+ 独立门禁 lint/tsc/test + 变异命门即红即绿）→ 独立 verifier。
- 收官端到端（对标 Kimi 回放）：说需求 → 计划卡「⏳等确认」→ 确认 → 集群框内 N 队员**并行**跑（running 亮绿 + queued 灰）→ 每队员完主脑自动冒小结 → 全完自动产汇总受管文档 → hover 贴卡 6px 显职衔+验收点 → pageErrors=0。

---

> **进度**：设计评审 GO（2026-07-02）+ §10 全拍 + 详设回填完毕。**下一步 = T1 实现**（agent team）。
