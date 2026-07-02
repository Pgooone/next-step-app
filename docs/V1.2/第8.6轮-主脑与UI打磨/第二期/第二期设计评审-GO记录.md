# 第 8.6 轮第二期 · 设计评审记录（GO_WITH_MITIGATIONS）

> **性质**：实现前证伪承重前提的**设计评审**（读码 + 对抗反驳，非 spike——守用户校正的评审 vs spike 边界，本期唯一 spike 是 M7）。
> **执行**：2026-07-02，ultracode workflow `wf_14c177a5-30d`（7 证伪 probe 并行〔对抗融进每个 probe·自带 refutationAttempts；命门 M1-P1 / M3-P1 / §10-⑧ 用 max effort〕 + final 9 条 falseGoTraps 亲读审计；agent 全 opus）。7/7 probe 全产出、无占位失效。
> **lead 亲核**：9 条最承重 file:line 全过、无翻盘（含一处 lead 加强发现，见下）。
> **决策落点**：ADR D-R8.6-15（`../../设计决策记录.md`）+ QA D-V1.2-87（`../../QA/第8.6轮-主脑决策.md`）；详设已回填（§1.2/§1.3/§3.2/§6.2/§10/§12.1）。

## 一、总裁决

**GO_WITH_MITIGATIONS**。两命门（M1-P1 会话活性 / M3-P1 Portal token 白屏）均不倒；但评审揪出**详设 2 处 REFUTED + 1 处遗漏命门**——若照原详设字面实现：M1 的 nudge 会全部静默丢失（九成参与感泡汤）、看板内浮框会被 modal 盖住失效。均有明确修正方向、已回填详设，故 GO 而非 NO_GO。

## 二、逐前提裁决

| 前提 | 裁决 | 一句话关键证据 |
|---|---|---|
| M1-P1 会话活性 | HOLDS_WITH_CONDITIONS | 切会话必 remount（`AppShell.tsx:1043 key={sessionKey}` + :280/298/317/442/461 五处 bump）；idle 后命令送达链走 re-attach、sid 复用（jsonl header 读回）。条件=驱动器挂 ChatWindow 作用域 |
| **M1-P2 不打断/口子方向** | **REFUTED** | 内核 `followUp()` idle 态纯入队（`pi-agent-core/dist/agent.js:171-173`）、AgentSession 无人 drain（Next-Step 非 AgentHarness）；`rpc-manager.ts:194-196` 直通。T6 解耦下 run 期主脑恒 idle → **详设 §1.2 的 handleFollowUp 方案 = nudge 全丢**。修正：统一 `handleSend`（:346-348 自带 agentRunning guard） |
| **M1-P3 去重判据** | **REFUTED** | present-state 判据（`done && !set.has`）在「remount 归空 useRef × module store（`useMastermindStore:59`）满载历史 done」不对称下，F5/切回把历史 done 整串重放成真回合。修正：baseline-first prev 快照（首挂只建基线）+ `__final__` 边沿判据 + firedFinal 双保险 |
| M1-P4 时序 | HOLDS_WITH_CONDITIONS | user 纯文本 nudge 结构上不可能被 derive-run-ids 误当 plan（只认 assistant submit_plan toolCall）。条件=措辞反诱导 + effect 依赖钉 status 摘要 |
| M3-P1 token 白屏 | HOLDS_WITH_CONDITIONS | `PipelineBoardStyles.tsx:16` 纯 `<style>` 非 styled-jsx scoped → body 级 `.pipeline-board.t-kimi-{theme}` wrapper 命中选择器、token 有值。**评审补遗漏命门：z-index 倒挂**（`PipelineModal:108` z:1000 > 浮框 z:50/60、详设全漏）→ Portal 取 1001~1099 |
| M3-P2 事件冒泡 | HOLDS | 外点关 `menuRef.contains`（ref 指菜单本体、Portal 后仍真）；React 合成事件沿 React 树冒泡、stopPropagation 仍拦；hover 维持靠 140ms scheduleHide + 浮框 onMouseEnter（8.5 轮 N2 修法）、Portal 原样保留无退化 |
| M3-P3 波及看板 | HOLDS_WITH_CONDITIONS | 两浮层是共用组件（`PipelineStageCard:154-179`）、Portal 同时作用两处；gsap 只在 MastermindTeammateCards:62（看板本无 bug）；条件=真浏览器两宿主都验 |
| M6-P1/P2 + §10-⑧ | 原详设倾向 REFUTED | `mastermind-orchestrator.ts` 纯串行（:107 for/:169/:193/:228、`Promise.all`=0）→「只调 limit」对单 run 并行度**零效果**、与 D-V1.2-86 根本 gap → 用户拍**档 2 真并行扇出**（QA D-V1.2-87） |
| §10-⑤ role 缺口 | 比预期小 | role 在 submit_plan schema（`orchestrator-session.ts:102`）必填早就在；真缺口仅 `approve/route.ts:38-50` 建 stage 11 字段独漏 role + 两类型未声明；readRun 无校验、旧数据零迁移 |

## 三、lead 亲核记录（9 条全过 + 1 处加强发现）

1. ✅ `agent.js:171-173` followUp 纯入队；`:217-219` prompt 有 activeRun 抛错；`:225-247` continue() 才 drain 队列。
2. ✅ `agent-session.js:663-668` while 排空只在 `_runAgentPrompt` 内；`:913` 注释；`:918-959` 链。**➕ lead 加强发现**：`:697 _handlePostAgentRun` 返回 `hasQueuedMessages()` → idle 入队的 followUp **不是永远吞掉、而是潜伏到用户下一次任意真回合结束时被连环 drain**（过期小结延迟轰炸，比静默丢更糟）→「绝不用 followUp 做 nudge 排队」写进红线。
3. ✅ `AppShell.tsx:1043` + 五处 `setSessionKey`（grep 坐实，注意大小写：搜 `setSessionKey` 非 `sessionKey`）。
4. ✅ 编排器纯串行 + `Promise.all` 计数 0。
5. ✅ z-index：`PipelineModal:108`=1000、`StageHoverPreview:112`=50、`StageSessionMenu:172`=60。
6. ✅ `approve/route.ts:38-50` 映 11 字段独漏 role（agentId/agentName 为占位空串、编排器起阶段才填——role 从 plan 来、比 agentName 更早有值）。
7. ✅ `PipelineBoardStyles.tsx:16` 纯 `<style>`；`:17-18` token 复合选择器；`:20` `.board` 才有 background。
8. ✅ `mastermind-run-store.ts:244` `tmp-${process.pid}`（同进程并发写撞路径）。
9. ✅ `useMastermindStore.ts:59` module create；`handleSend:346-348` guard；`handleFollowUp:522+` 无 guard、sid 调用时读；`rpc-manager.ts:194-196` follow_up case。

## 四、实现必修清单（mustFix，已分配进任务卡 AC）

1. 【T1·最高优先】nudge 统一 `handleSend`（禁 handleFollowUp/followUp 排队）+ `!agentRunning` gate、忙时下轮补发。
2. 【T1】baseline-first：首挂只建基线不发；只对本地观察到的 `pending/running→done`（stage）与 `running→done/partial`（run）翻转 nudge。
3. 【T1】prev 快照/seen 用 useRef（remount 重置=有意）；`__final__` 边沿 + firedFinal 双保险；覆盖 transcript 派生的所有 runId（filter 禁 find）。
4. 【T1】驱动器挂 ChatWindow 作用域；effect 依赖钉 status 翻转摘要非 messages 长度。
5. 【T1】措辞反诱导（阶段：只文字汇报/不调工具/不提新计划；终态：汇总收尾/不再 submit_plan/带 runId）；paused nudge 一句提醒、failed（用户主动）不 nudge。
6. 【T3】Portal wrapper/浮框 z-index 1001~1099；真浏览器板内 modal + 主脑内联两宿主都验。
7. 【T3】wrapper=`pipeline-board t-kimi-{theme}`（绝不含 board）、static、无 transform/filter/contain；每实例自建自毁；mounted 守卫；popover-position.ts 不动。
8. 【T4】专属类 `mastermind-board`、background var(--container)/透明绝不铺 var(--bg)；样式进 PipelineBoardStyles 共享 `<style>`；fork SVG 复制勿抽组件；计数 done/total 用 run.stages。
9. 【T3】role 3 处纯增量 + friendlyAgentName 补 4 位置（`StageHoverPreview:156`、`StageSessionMenu:190/280/293`）。
10. 【T2】等待条独立 data-testid + t-kimi token。
11. 【T6】档 2 形态见 ADR D-R8.6-15（execution 声明默认 serial / 批内并行全 settle 统一判定 / tmp 竞态修 / clampConcurrent 共用禁裸传 0/负）。

## 五、方法论备注

- 第一期教训（D-R8.6-06：专职 adversary 占位失效）的落地闭环首次全绿：对抗融进 probe + final falseGoTraps + lead 亲核三层，7/7 无占位。
- 本期全程读码评审、未搭任何 spike（M1/M3/M6 全是分析型前提）；M7 才是唯一 spike。
- 完整 probe JSON 在 workflow transcript（会话目录，未入 git）；本记录为可溯精华。
