# 第八轮 · 误杀根治（evict-by-sessionId）—— 进度

> 🆕 **新窗口开工先读 [`开工交接.md`](开工交接.md)**（一页自包含：现状 + 三步开工 + 关键事实 + 红线 + git 状态）。

> **状态：T1~T3 全收官、双层验收通过。** spec 复审 GO_WITH_FIXES + 订正(`a65a0fe`) → T1 承重 spike GO(`d090017`) → T2 实现(`5bdc0df`) → T3 双层验收 + 收尾(`eb059dc`)。**待 push。** 子流程 = spec-first（承重轮）。
> 权威设计 = 三件套（[需求](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/需求文档.md) / [概要](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/概要设计.md) / [详细](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/详细设计.md)）+ QA D-V1.2-50（轮次2）+ [方案B评审NO-GO记录](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/方案B设计评审-NO-GO记录.md)。

## 由来 + 选型经过
第七轮 T6 揪出「跨 run evict 误杀」（D-R7-07 决策2 留二期）→ 资源实测（ADR D-R7-09 证会话仅 ~1MB 进程内对象、0 进程）→ 误杀去风险调查 → **用户初拍方案 B**（计槽 size→in-flight）→ **ultracode 设计评审门 NO-GO**（承重命门 isStreaming 在 retry 退避窗口漏算、违 ≤3 红线，lead 亲核坐实）→ **用户改选 evict-by-sessionId**（D-V1.2-50 轮次2）。

## 核心机制（evict-by-sessionId）
保留 F16 每阶段 evict 释槽，**只把逐出粒度从「按 agentId 一锅端」收窄为「只逐本阶段 sessionId」**。前提（lead 亲核）：worker 工具集无 spawn + `__piSessions` 写入仅 2 点 → 一 worker=一 sessionId=一槽。误杀根除因为用户复活的同 agent 会话是另一个 sid、不被本阶段 evict 命中。**不动 concurrency-gate / 内核 / owner-map / 上限**。

## 任务清单（T1~T3 · 依赖序 · 每卡门禁绿即单独 commit）
- [x] **T1**（承重 spike）✅ **GO** —— `lib/pi/evict-session.spike.test.ts`（hermetic，8/8 绿，T3 删）：断言①只逐 sidA·同 agent sidB 仍活 + ②流式先 abort + ③owner-map 零碰（候选连 ownerBySession 都不接收）+ 负对照（destroy 不删 Map→size 不回落）+ 变异检查（退化回 by-agentId→sidB 被误删）。**lead 四重确认**：队员自跑 8/8 + lead 亲读断言 + lead 独立复跑 8/8 + lead 独立变异（抠 candidate destroy→4 断言变红）。候选实现与详设 §1.1 逐字一致。 → [`T1.md`](T1.md)
- [x] **T2**（实现，commit `5bdc0df`）✅ evictSession 落 evict-agent-sessions.ts + orchestrator :172/:193 收窄按 sessionId + DI 钩子改名 + 注释订正 + 4 处测试改造（evictSpy 内层换·删反查缝 / 正常路径第二参 sid / catch test⑥ 改 no-op / 加固 sidB 接管会话断言）+ evict-agent-sessions 单测追加。**lead 四重验收**：亲读 4 文件 diff + 独立复跑 tsc 0/lint 0/vitest 509 + 独立变异（:193 退回 agentId→4 红、还原 19/19 绿）+ 红线收口（只 4 文件、concurrency-gate/route.ts/HARD_CAP/内核零改、生产零碰 owner-map）。 → [`T2.md`](T2.md)
- [x] **T3**（双层验收 + 收尾，commit `eb059dc`）✅ **逻辑层**（独立 verifier 自写 fixture 9/9、未复用实现者 harness）：误杀根除判别对照（旧 evictAgentSessions(agentX) 删 sidA+sidB、新 evictSession(sidA) 只删 sidA）+ 真 runPipeline 释槽 + 负对照 + 红线审计净 + 门禁 509。**端到端（真实环境实跑·纯服务端零 UI）**：lead 亲跑真 __piSessions+真 registerInnerSession+真 evictSession 集成 smoke 3/3（evictSession 真删目标 sid/共存存活/流式真 abort/null no-op）。**残留 gap 合法收口**：全 UI 跨 run 误杀场景未真浏览器驱动（默认模型 faux、纯服务端边际置信低）→ 替代证据 = 逻辑层判别对照 + 真 registry smoke + 复审 premiseB 代码坐实「复活原 sid≠新 run 新 sid」+ rpc-manager 单测；AC-4 由 T6 cancel 承重块 + owner-map 零碰覆盖。详见 ADR D-R8-04。收尾删探针 + 回写 + ADR D-R8-01~04。 → [`T3.md`](T3.md)

## 验收结论（双层·全 PASS）
| 层 | 谁 | 结论 |
|---|---|---|
| 承重 spike（T1） | lead 四重确认 | GO：evictSession 逐出粒度正确、hermetic 8/8、独立变异坐实判别力 |
| 逻辑层（T3） | 独立 verifier 自写 fixture | PASS：9/9（误杀根除判别对照 + 释槽 + owner-map 零碰 + 负对照）+ 全量 509 |
| 端到端·真实环境实跑（T3） | lead 亲跑 | PASS：真 registry 集成 smoke 3/3（真 __piSessions/registerInnerSession/evictSession 接线） |
| 红线 | lead + verifier | 净：只 4 文件改、concurrency-gate/owner-map/HARD_CAP/内核/route.ts 零改、evictAgentSessions 本体未动 |

**残留 gap**：全 UI 跨 run 误杀场景未真浏览器驱动（合法收口，替代证据见 ADR D-R8-04）。
**踩坑（写给后人）**：① 方案 B（in-flight 计槽）被复审门 NO-GO——内核 isStreaming 在 retry 退避窗口为 false 漏算、违 ≤3 红线，承重前提「某内核信号恒成立」继承自调研必派专职反驳者证伪。② 详设 §1.2 控制流一度写反（catch 时 stage.sessionId 恒 null，:181 在 try 后）——复审 CP-1 揪出、否则 T2 照搬卡门禁。③ 承重 harness 加 survivor（sidB）须从 peak/activeCount 排除，否则 limit=1 与 survivor 死锁；survivors=0 时零扰动。④ 默认模型 faux（`~/.pi/agent/settings.json`），纯服务端改动端到端用真 registry smoke 而非真浏览器多会话驱动。

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
