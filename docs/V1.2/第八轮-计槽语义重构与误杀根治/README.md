# V1.2 第八轮 · 计槽语义重构与误杀根治

> **状态：spec 草拟完成、待用户复审批准后开工。** 承重轮（spec-first）。

## 一句话
把并发「占槽」判据从「registry 在册会话数」改为「同时在跑回合数（in-flight）」——**根治第七轮 T6 揪出的「跨 run evict 误杀」**（D-R7-07 决策2 留二期），顺带根治 legacy dispatch 完成态占槽。

## 由来链
1. **第七轮 T6** 加「进入完整对话」（复活 worker 会话续聊）→ 揪出 evict 按 agentId 一锅端会误杀用户复活的同 agent 会话（单 run 测不出、留二期，ADR D-R7-07 决策2）。
2. **收官后资源实测**（用户追问「一个活会话占多少」→ ultracode 实测 + lead 亲核，ADR D-R7-09）：推翻「会话很重→OOM」前提——活会话 = Next 进程内 ~1MB JS 对象、0 独立进程/子进程 → 「完成态占槽」是逻辑计数问题非资源。
3. **误杀去风险调查**（ultracode 7-agent）：两条修法（evict-by-sessionId 外科手术 / 方案 B 改计槽语义）→ 用户拍板**方案 B**（D-V1.2-50）。

## 文档
- [需求文档](需求文档.md) —— bug + 方案 B 决策 + AC-1~7 + 红线。
- [概要设计](概要设计.md) —— 两改成对机制 + 误杀根除因果链 + 改动文件总表。
- [详细设计](详细设计.md) —— 逐文件 file:line + 承重 spike 计划 + 风险 + 红线核对。
- QA：[`../QA/第八轮-计槽语义重构决策.md`](../QA/第八轮-计槽语义重构决策.md)（D-V1.2-50）。
- 任务卡：[`../../../tasks/V1.2/第八轮-计槽语义重构与误杀根治/progress.md`](../../../tasks/V1.2/第八轮-计槽语义重构与误杀根治/progress.md)（T1 spike → T2 实现 → T3 验收）。

## 核心机制（方案 B，两改成对）
1. `concurrency-gate.ts`：`size` 计量 → `inFlightSessionCount()`（只数 `isAlive() && inner.isStreaming` 的会话）。
2. `pipeline-orchestrator.ts`：删每阶段 `evict`——完成态不计槽即不必腾槽，误杀因果链从源头断；完成态靠 10min idle 自然回收。

## 承重墙
**in-flight 绝不漏算**（致命路径 timeoutMs:Infinity 排队，漏算→超额放行）。`isStreaming` 半拍偏保守恰好规避——T1 活进程打点 spike 坐实后才开工。
