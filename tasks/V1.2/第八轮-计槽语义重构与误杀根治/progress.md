# 第八轮 · 计槽语义重构与误杀根治 —— 进度

> **状态：spec 草拟完成、待用户复审批准后开工。** 子流程 = spec-first（承重轮）。
> 权威设计 = 三件套（[需求](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/需求文档.md) / [概要](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/概要设计.md) / [详细](../../../docs/V1.2/第八轮-计槽语义重构与误杀根治/详细设计.md)）+ QA D-V1.2-50。

## 由来
第七轮 T6 揪出「跨 run evict 误杀」（D-R7-07 决策2 留二期）→ 收官后资源实测（ADR D-R7-09 证会话仅 ~1MB 进程内对象、0 进程）→ 误杀去风险调查（ultracode 7-agent）→ **用户拍板方案 B**（改计槽语义为「在跑回合≤3」，D-V1.2-50）。

## 任务清单（T1~T3 · 依赖序 · 每卡门禁绿即单独 commit）

- [ ] **T1**（承重 spike）in-flight 计量「绝不漏算」命门——活进程打点验 `isStreaming` 全生命周期 + 半拍保守 + 非 completed 路径 + N 阶段串行 + 负对照 + 变异检查；**未 GO 不开 T2** → [`T1.md`](T1.md)
- [ ] **T2**（实现，依赖 T1 GO）改动1 计量 size→in-flight + 改动2 删每阶段 evict（**成对**）+ concurrency-gate 单测 + orchestrator 承重 verify 重写 → [`T2.md`](T2.md)
- [ ] **T3**（双层验收 + 收尾，依赖 T1/T2）逻辑层 + 真浏览器（AC-1 误杀根除核心场景 + AC-2 长流水线 + AC-4 cancel/re-attach 零回归）+ 删探针 + 回写 + push → [`T3.md`](T3.md)

## 承重墙（开工第一步 T1 必先验）
**计量改 in-flight 后真正在跑的会话绝不被漏算**（致命路径 `pipeline-orchestrator.ts:127` timeoutMs:Infinity 排队）。`isStreaming` 的「半拍偏保守」恰好规避漏算——T1 活进程打点坐实后才开 T2。

## 红线（务必带走）
- 两改成对（缺一 F16 复发）；**filter-size 不 move-out-of-Map**（保 `reconcileOrphan` keys/re-attach 快路径）；不碰 owner-map（第五轮）；不改默认上限来源（HARD_CAP 等）；不改内核、纯文件无 DB。
- 承重网重写后须变异检查证非 vacuous；lead 独立复跑 + 亲核 isStreaming 时序（不照搬调查）。

## 关联
- 误杀由来 / 资源实测：`../../../docs/V1.2/设计决策记录.md` D-R7-07 决策2 + D-R7-09。
- 用户拍板：`../../../docs/V1.2/QA/第八轮-计槽语义重构决策.md` D-V1.2-50。
