# V1.2 第八轮 · 误杀根治（evict 收窄为 by-sessionId）

> **状态：spec 重写完成（方案 B 经设计评审门 NO-GO、改选 evict-by-sessionId）、待用户复审批准后开工。** 承重轮（spec-first）。
> 文件夹名沿用「计槽语义重构与误杀根治」（立项时按方案 B 命名；最终落 evict-by-sessionId、不改计槽语义，仅收窄 evict 粒度）。

## 一句话
根治第七轮 T6 揪出的「跨 run evict 误杀」（D-R7-07 决策2 留二期）——把流水线编排器每阶段的 evict 从「按 agentId 一锅端」收窄为「只逐本阶段那个 sessionId」。保留 F16 释槽机制、不动并发计量语义。

## 由来 + 选型经过（含一次设计评审门救场）
1. **第七轮 T6** 加「进入完整对话」（复活 worker 会话续聊）→ 揪出 evict 按 agentId 一锅端会误杀用户复活的同 agent 会话（单 run 测不出、留二期）。
2. **资源实测**（ADR D-R7-09）：活会话 = Next 进程内 ~1MB JS 对象、0 进程 → 「占槽」是逻辑计数非资源。
3. **误杀去风险调查**（ultracode 7-agent）：两条修法 evict-by-sessionId / 方案 B → **用户初拍方案 B**（改计槽语义、更彻底）。
4. **🚨 设计评审门 NO-GO**（ultracode 7-agent，含承重前提反驳者）：方案 B 承重命门「in-flight 不漏算」被证伪——`isStreaming` 在 worker retry 退避窗口为 false 而 worker 真在跑 → 漏算 → 超额放行违 ≤3 红线（DeepSeek 限流时高发、无内核字段可救）。lead 亲核坐实 → **用户改选 evict-by-sessionId**（D-V1.2-50 轮次2）。**这是「写代码前先证伪承重前提」的活案例**（已固化进 cc-multi-agent-dev-flow / vibe-coding skill）。

## 文档
- [需求文档](需求文档.md) —— bug + evict-by-sessionId 决策 + AC-1~6 + 红线。
- [概要设计](概要设计.md) —— 收窄逐出粒度机制 + 误杀根除因果链 + 改动文件总表。
- [详细设计](详细设计.md) —— 逐文件 file:line + hermetic 承重 spike + 风险 + 红线核对。
- **[方案B设计评审-NO-GO记录](方案B设计评审-NO-GO记录.md)** —— 方案 B 完整分析 + 评审 NO-GO 发现（retry 漏算等）+ 回溯备选「方案 B 修正版」。供日后讨论/回溯。
- QA：[`../QA/第八轮-计槽语义重构决策.md`](../QA/第八轮-计槽语义重构决策.md)（D-V1.2-50 含轮次2 改选）。
- 任务卡：[`../../../tasks/V1.2/第八轮-计槽语义重构与误杀根治/progress.md`](../../../tasks/V1.2/第八轮-计槽语义重构与误杀根治/progress.md)（T1 hermetic spike → T2 实现 → T3 双层验收）。

## 核心机制（evict-by-sessionId）
`pipeline-orchestrator.ts:187/167` 的 `evictAgentSessions(stage.agentId)` → `evictSession(stage.sessionId)`（新增于 `evict-agent-sessions.ts`、复用 abort-then-destroy 配方）。前提（lead 亲核）：worker 工具集无 spawn + 一 worker=一 sessionId=一槽 → 按 sid 逐出不漏槽、不碰用户复活的同 agent 其他 sid。**不动 concurrency-gate / 内核 / owner-map / 上限。**

## 承重墙
**by-sessionId 逐出粒度正确**（纯应用层 hermetic spike、零内核时序依赖）——T1 坐实「只逐目标 sid、不误删同 agent 其他会话、owner-map 零碰」。
