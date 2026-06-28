# 第八轮 · 误杀根治（evict-by-sessionId）—— 进度

> 🆕 **新窗口开工先读 [`开工交接.md`](开工交接.md)**（一页自包含：现状 + 三步开工 + 关键事实 + 红线 + git 状态）。

> **状态：spec 经 ultracode 复审门 GO_WITH_FIXES（承重前提 holds·高置信、0 真 blocker）→ punch-list 订正已 applied（commit `a65a0fe`，含用户拍板 CP-2① 加固承重 harness）→ T1 承重 spike GO（lead 四重确认）→ 进 T2。** 子流程 = spec-first（承重轮）。
> 权威设计 = 三件套（[需求](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/需求文档.md) / [概要](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/概要设计.md) / [详细](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/详细设计.md)）+ QA D-V1.2-50（轮次2）+ [方案B评审NO-GO记录](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/方案B设计评审-NO-GO记录.md)。

## 由来 + 选型经过
第七轮 T6 揪出「跨 run evict 误杀」（D-R7-07 决策2 留二期）→ 资源实测（ADR D-R7-09 证会话仅 ~1MB 进程内对象、0 进程）→ 误杀去风险调查 → **用户初拍方案 B**（计槽 size→in-flight）→ **ultracode 设计评审门 NO-GO**（承重命门 isStreaming 在 retry 退避窗口漏算、违 ≤3 红线，lead 亲核坐实）→ **用户改选 evict-by-sessionId**（D-V1.2-50 轮次2）。

## 核心机制（evict-by-sessionId）
保留 F16 每阶段 evict 释槽，**只把逐出粒度从「按 agentId 一锅端」收窄为「只逐本阶段 sessionId」**。前提（lead 亲核）：worker 工具集无 spawn + `__piSessions` 写入仅 2 点 → 一 worker=一 sessionId=一槽。误杀根除因为用户复活的同 agent 会话是另一个 sid、不被本阶段 evict 命中。**不动 concurrency-gate / 内核 / owner-map / 上限**。

## 任务清单（T1~T3 · 依赖序 · 每卡门禁绿即单独 commit）
- [x] **T1**（承重 spike）✅ **GO** —— `lib/pi/evict-session.spike.test.ts`（hermetic，8/8 绿，T3 删）：断言①只逐 sidA·同 agent sidB 仍活 + ②流式先 abort + ③owner-map 零碰（候选连 ownerBySession 都不接收）+ 负对照（destroy 不删 Map→size 不回落）+ 变异检查（退化回 by-agentId→sidB 被误删）。**lead 四重确认**：队员自跑 8/8 + lead 亲读断言 + lead 独立复跑 8/8 + lead 独立变异（抠 candidate destroy→4 断言变红）。候选实现与详设 §1.1 逐字一致。 → [`T1.md`](T1.md)
- [ ] **T2**（实现，依赖 T1 GO）evictSession + orchestrator :167/:187 收窄为 sessionId + evict-agent-sessions 单测追加 + orchestrator 承重断言 agentId→sessionId（按 describe 块枚举改全） → [`T2.md`](T2.md)
- [ ] **T3**（双层验收 + 收尾）逻辑层 + 真浏览器（AC-1 误杀根除核心场景 + AC-2 长流水线释槽不变 + AC-4 cancel/re-attach 零回归）+ 删探针 + 回写 + push → [`T3.md`](T3.md)

## 承重墙（开工第一步 T1 必先验）
**by-sessionId 逐出粒度正确**（纯应用层 hermetic spike、零内核时序依赖）。比方案 B 的「in-flight 不漏算」命门轻——后者被设计评审门证伪（retry 退避漏算），正是改选 evict-by-sessionId 的原因。

## 红线（务必带走）
- 只**新增** `evictSession`、不动 `evictAgentSessions` 本体 / `concurrency-gate` 计量 / owner-map（`bySession`/`removeOwner`，第五轮）/ `HARD_CAP` / 内核。
- 第二条 evict-by-agentId（`agents/[agentId]/route.ts:63` 改 mode）**不动**（不在 run 完成误杀链上）。
- 承重测试改断言后须变异检查（误写回 by-agentId→断言红）证非 vacuous；lead 独立复跑。

## 关联
- 误杀由来 / 资源实测：`../../../docs/V1.2/设计决策记录.md` D-R7-07 决策2 + D-R7-09。
- 用户拍板（含轮次2 改选）：`../../../docs/V1.2/QA/第八轮-计槽语义重构决策.md` D-V1.2-50。
- 方案 B 评审 NO-GO 全记录（回溯/讨论用）：`../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/方案B设计评审-NO-GO记录.md`。
