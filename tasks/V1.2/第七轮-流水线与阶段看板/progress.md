# 第七轮 · 流水线与阶段看板 — 进度

> **状态：设计收官、可开工。** 三件套齐备（需求 / 概要 / 详细设计）+ 对抗式审查通过（覆盖 20/20 决策 + 15/15 缺口、红线 8/8 守住、承重墙写清）+ 全部决策入 QA（D-V1.2-28~47）。
> 已 commit：`8cf8b16`（视觉定稿 / 决策 / 边界审计）、`6a3e504`（三件套 / 审查 / 交互精确化）、`2a7be36`（任务卡 / progress）。
> **T1 承重墙 spike 已 ✅ GO（2026-06-27）——双命门确定性绿，T3/T6 解锁。下一步 = T2（数据层）→ T3（编排器，依赖 T1-A）。**
>
> 权威设计 = 详细设计 §五任务表 + §四承重墙（`../../../docs/V1.2/第七轮-流水线与阶段看板/详细设计.md`）；本文是其进度镜像。

## 任务清单（T1~T8 · 依赖序 · 每卡门禁绿即单独 commit）

- [x] **T1**（✅ 承重·**GO**）承重墙 spike：A 冻结释槽 + B re-attach 续聊 —— AC-2/3/12 命门**双命门确定性 GO**；ultracode 10-agent 对抗去风险(GO_WITH_MITIGATION) + agent team 实现 + lead 独立复跑 vitest 9/9 + 全量 435/435 + tsc 0 + eslint 0 + 变异 sanity（destroy 不删 Map→A1/A4 FAIL，证非 vacuous）；T1-B 全绿、AC-12 无须降级；探针待 T8 收官删 → [`T1.md`](T1.md)
- [ ] **T2** 数据层：pipeline-store + pipeline-run-store + 蓝图 API + 校验（依赖 T1）—— AC-1；原子写 + 校验拒 0 阶段/空模板/order 重复缺号 → [`T2.md`](T2.md)
- [ ] **T3**（✅ 承重）编排器 runPipeline：冻结模型 + 累积喂下游 + run checkpoint + 起 run API（依赖 T1-A, T2）—— AC-2/3/4/5/6/7 → [`T3.md`](T3.md)
- [ ] **T4** 看板族 UI + AppShell 入口/模态 + dicebear 离线头像 + store（依赖 T2, T3）—— AC-10/13(部分)；**真浏览器 pageErrors=0 + node:fs 不入 bundle** → [`T4.md`](T4.md)
- [ ] **T5** 并发上限可配：factory-config + concurrency-gate + 根 CLAUDE.md + UI 警示（无强依赖）—— AC-14（🚩 红线变更 D-V1.2-41） → [`T5.md`](T5.md)
- [ ] **T6**（✅ 承重·依赖 T1-B）进会话悬浮二级菜单 + 底部切换条 + run cancel + 失败态（依赖 T1-B, T3, T4）—— AC-8/9/11/12；**真浏览器**（含故意失败流水线 + cancel） → [`T6.md`](T6.md)
- [ ] **T7** 合并入口（一个入口·两 tab）+ 旧 DispatchForm 小修 F6/F8/F15（依赖 T4）—— AC-13；旧 dispatch 零回归 → [`T7.md`](T7.md)
- [ ] **T8** 双层验收 + 收尾 + 回写 docs + 残留清理（依赖全部）—— AC-15 → [`T8.md`](T8.md)

## 承重墙（开工第一步 T1 必先验）—— ✅ 已验 GO（2026-06-27）

- **T1-A 冻结释槽**（F16 真药方 · D-V1.2-41 冻结模型）：每阶段 completed 后主动 evict worker 会话**释放并发槽**（复用 `lib/pi/evict-agent-sessions.ts` 的 isStreaming→abort→destroy；**严守「只 destroy、不碰 bySession/removeOwner」红线**，否则 re-attach getOwner 返 null 反塞 write/edit/bash，第五轮修过的 bug）。验：≥4 阶段一键跑完、活会话恒 ≤1、不卡 ~10min idle、不重启 dev。
  - **✅ GO**：`lib/pi/pipeline-evict-release.spike.test.ts`（4 测）证 evict→fauxMap.size 确定性回落 0、≤1 不变式、精确命中本阶段 sid、流式先 abort 再 destroy；负对照 N1（不 evict→acquireSlot `{timeoutMs:30}` 抛 /上限/）+ N2 sanity（喂另一空 Map 证耦合）+ 变异检查（destroy 改成只翻 alive 不删 Map→size 断言 FAIL）三重证非 vacuous。
- **T1-B re-attach 续聊**（D-V1.2-42）：被 evict 销毁过的 dispatch worker 会话能经 `resolveOrReattachSession` 重建**受限 doc 工具集**（人在场合法、含 propose_edit）而非 generic；不绿则「进入完整对话」降级只读、AC-12 改判须用户确认。
  - **✅ GO（AC-12 无须降级）**：`lib/pi/pipeline-reattach.spike.test.ts`（5 测）。第一半（真 setOwner/getOwner/sessionsForAgent + 真 evict + tmpdir map）证 B2 真 evict 后 owner-map 仍在（getOwner 仍返 agentId，坐实 evict 不碰 bySession）→ B3 resolve 走 reattach 分支；负对照 B4（removeOwner→走 generic）。第二半（真 reattachProfileSession + 真 createAgentSession + faux 模型）证工具集恰 = DOC_SESSION_TOOLS（7 项）、含 propose_edit、不含 write/edit/bash（对抗输入 profile.tools=[read,write,edit,bash] 不泄漏）。

### T3/T6 承重契约（spike 已坐实，实现须照此）

- **runPipeline 每阶段顺序**（T3）：`acquireSlot({timeoutMs:Infinity})` → `runWorker` → `setOwner`（在 evict 之前）→ **每阶段（含 completed）跑完调 `evictAgentSessions(projectRoot, agentId, deps?)`**。evict 经既有 `evict-agent-sessions.ts` DI 缝、**只 destroy、绝不碰 owner map**。
- **生产语义已核**（写 T3 须知）：acquireSlot 数的是 `globalThis.__piSessions` 的 `Map.size`（非 isAlive）；会话出 registry 唯一靠 `wrapper.destroy()`→`onDestroy`→`registry.delete`（`rpc-manager.ts:290`）；`{timeoutMs:Infinity}` 走现有轮询天然永不超时（零改 acquireSlot 本体）。
- **T6 进会话**：`resolveOrReattachSession` 对「被 evict 销毁过 + setOwner 写过归属」的 doc worker 会话走 reattach、装回 7 项含 propose_edit——**仅复用、勿改** `session-reattach.ts`/`reattachProfileSession`/`doc-session.ts`。
- **探针去留**：两 spike 文件是开工门禁、不进长期测试集，**待 T8 收官删**（命门事实已写入本契约 + ADR D-R7-01，删前确保已迁入 T3/T6 设计与任务卡）。

## 开工方式（cc-multi-agent-dev-flow）

agent team 串行实现：lead 每卡亲读 diff + 复跑门禁（lint / test / tsc）+ 单独 commit；**双层验收**（逻辑层 verifier + 真浏览器；UI 卡必走真浏览器）；承重处 lead file:line 复核、不信 agent 自证。

## 关联文档

- 三件套 / 审查报告 / 边界审计 / 看板视觉定稿-kimi-v11.html：`../../../docs/V1.2/第七轮-流水线与阶段看板/`
- 决策 QA（D-V1.2-28~47）：`../../../docs/V1.2/QA/第七轮-流水线与阶段看板决策.md`
