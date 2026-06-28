# 第七轮 · 流水线与阶段看板 — 进度

> 🆕 **新窗口续做 T4–T8 先读 [`续做交接-T4-T8.md`](续做交接-T4-T8.md)**（一页：现状表 + 三步开工方式 + 逐卡速查 + 红线踩坑）。

> **状态：设计收官、可开工。** 三件套齐备（需求 / 概要 / 详细设计）+ 对抗式审查通过（覆盖 20/20 决策 + 15/15 缺口、红线 8/8 守住、承重墙写清）+ 全部决策入 QA（D-V1.2-28~47）。
> 已 commit：`8cf8b16`（视觉定稿 / 决策 / 边界审计）、`6a3e504`（三件套 / 审查 / 交互精确化）、`2a7be36`（任务卡 / progress）。
> **T1 ✅ + T2 ✅ + T3 ✅ + T4 ✅ + T5 ✅ + T6 ✅ + T7 ✅ 收官（2026-06-27/28）。承重三卡(T1/T3/T6)全绿；T6 真浏览器 AC-8/9/11/12 + T7 真浏览器 AC-13（9 判据）全 PASS（全真实数据、pageErrors=0）+ 门禁 505。下一步 = T8（收尾·删 T1 探针 + 回填 ADR hash + 全量 registry 复位清测试产物 + push）。⚠️ T6 揪出已知限制（D-R7-07 决策2）：跨 run 复用同 agent 时，新 run 完成阶段会 evict 误杀用户「进入完整对话」复活的同 agent 会话（pre-existing 缺陷、单 run AC-12 不受影响、留二期专卡、已向用户披露）。T2 flaky 测试已于 T5 期修（D-R7-06）。**
>
> 权威设计 = 详细设计 §五任务表 + §四承重墙（`../../../docs/V1.2/第七轮-流水线与阶段看板/详细设计.md`）；本文是其进度镜像。

## 任务清单（T1~T8 · 依赖序 · 每卡门禁绿即单独 commit）

- [x] **T1**（✅ 承重·**GO**）承重墙 spike：A 冻结释槽 + B re-attach 续聊 —— AC-2/3/12 命门**双命门确定性 GO**；ultracode 10-agent 对抗去风险(GO_WITH_MITIGATION) + agent team 实现 + lead 独立复跑 vitest 9/9 + 全量 435/435 + tsc 0 + eslint 0 + 变异 sanity（destroy 不删 Map→A1/A4 FAIL，证非 vacuous）；T1-B 全绿、AC-12 无须降级；探针待 T8 收官删 → [`T1.md`](T1.md)
- [x] **T2** ✅ 数据层：pipeline-store + pipeline-run-store + 蓝图 API（GET/POST/PUT/DELETE）+ 校验（依赖 T1）—— AC-1 达成；ultracode 8-agent 调查（READY、揪 5 真坑）+ agent team 实现 + lead 亲读两 store diff + 独立复跑 vitest 40/40 + 全量 475/475 + tsc/eslint 0；校验拒 0 阶段/空模板/order 重复缺号/含0负/小数/乱序归一 + name 非空；reconcileOrphan 五分支 + pruneOld 保留 M 仅删终态；listRuns 仿 listArtifacts 跳坏文件 → [`T2.md`](T2.md)
- [x] **T3** ✅（承重）编排器 runPipeline：冻结模型 + 累积喂下游 + run checkpoint + 起 run/列 runs/读时对账 API + runControllers（依赖 T1-A, T2）—— AC-2~7 达成；ultracode 8-agent 承重调查（READY、揪头号 gap=runWorker 漏 try/catch）+ agent team 实现 + **lead 独立重跑承重 verify**（真实 runPipeline + faux Map 6 断言：evict 每阶段/size→0/peak≤1/顺序 setOwner 在 evict 前/负对照/catch 路径释槽）+ vitest 15/15 + 全量 490/490 + tsc/eslint 0 → [`T3.md`](T3.md)
- [x] **T4** ✅ 看板族 UI + AppShell 入口/模态 + dicebear 离线头像 + store + **补「一键起 run」触发疏漏（D-R7-04）**（依赖 T2, T3）—— AC-10 全 + AC-13(部分)；ultracode 7-agent 调查（GO，对抗把关揪 1 blocker B-1〔STATUS_META 未 export→抽 status-meta.ts〕+ M-1〔DispatchStatus 改从 useDispatchStore〕/M-3〔totalStages prop〕/m-1〔done 态进度条〕/m-2〔selectAgentsForProject〕）+ agent team 实现 + lead 亲读全 11 文件 diff + 独立复跑门禁 490/0/0 + **真浏览器 6/6 确定性 PASS + pageErrors=0/nodeFs=0**（D-R7B-07 红线坐实）+ 亲看 4 截图（运行/失败/暗主题/编辑器）。补疏漏：详细设计 §3.10 漏写发起 run 按钮、需求:19/AC-3 是硬需求→PipelineModal 加「蓝图 select + ▶运行」控制条、board 纯渲染。遗留：`⑂` 装饰符字体无覆盖（非 bug）；AC-3 端到端实跑留 T8 → [`T4.md`](T4.md)
- [x] **T5** ✅ 并发上限可配：factory-config + concurrency-gate + 外层 CLAUDE.md 红线 + PipelineModal 资源警示（无强依赖）—— AC-14（🚩 红线变更 D-V1.2-41；用户拍板 D-V1.2-48 配置文件 MVP/无 GUI setter）；ultracode 6-agent 调查（GO 无 blocker）+ ns-impl-t5 实现 + lead 亲读 5 处 diff + 独立复跑门禁（tsc 0/lint 0/test 502 = 490+12 新）+ 真浏览器警示亮暗可读 + pageErrors=0/nodeFs=0。落点 `~/.pi/factory-config.json`（全局非 per-project）、HARD_CAP=8、警示落 Modal（记 ADR D-R7-05）。红线在外层非 git 文件、改动不入 commit。**发现 T2 预存 flaky 测试**（pipeline-store「list 按 updatedAt 倒序」毫秒打平、与 T5 无关，留下一窗口修）→ [`T5.md`](T5.md)
- [x] **T6** ✅（承重·依赖 T1-B）进会话悬浮二级菜单 + 底部切换条 + run cancel + 失败态 —— AC-8/9/11/12 全达成；ultracode 10-agent 调查（GO，lead file:line 复核纠正多处幻觉：findRun 是 store 实例方法 / AC-11 复用现成 `/api/sessions/[id]/context`+`MessageView` 不必新建路由 / AC-9 释放 T3 已覆盖 cancel 零改 orchestrator）+ agent team(ns-impl-t6) 实现 + lead 亲读 7 文件 diff + 独立复跑门禁（lint 0 / tsc 0 / **test 505 = 502 + 3 cancel 承重**〔faux mid-flight abort：`failedReason==='已取消'` + evict + size 回落 + 负对照 + 变异检查〕）+ node:fs smoke 净 + 红线 7 文件零改动 + **真浏览器 AC-8/9/11/12 全 PASS（全真实数据：真 3 阶段 run，stage1 done 喂 AC-11/12、stop→真 failRun `failedReason='已取消'` 喂 AC-9/8；pageErrors=0/nodeFs=0；lead 亲看 3 截图）**。改动面 5 改 + 2 新（cancel route + StageSessionMenu）。决策 D-R7-07（deleteRunController `.finally` 清理 / 跨 run evict 误杀复活会话=已知限制留二期 / 切换条全枚举置灰 / cancel verify 逻辑层为权威 / 幂等门）→ [`T6.md`](T6.md)
- [x] **T7** ✅ 合并入口（一个入口·两 tab）+ 旧 DispatchForm 小修 F6/F8/F15（依赖 T4）—— AC-13 达成；ultracode 7-agent 调查（GO，补 2 个 lead 漏掉的透传缺口：projectRoot blocker + onArtifactsChanged/onSessionsChanged 签名未解构）+ agent team(ns-impl-t7) 实现 + lead 亲读 3 文件 diff + 独立复跑门禁（lint 0 / tsc 0 / **test 505 未变**、零回归 grep 净〔AppShell 残留空、handleDispatch/assignments/MAX/MIN 一字未改〕）+ node:fs smoke 净 + **真浏览器 AC-13 全 9 判据 PASS（单一入口 open-dispatch-btn=0 / 两 tab / 快速派发渲 DispatchForm / F8 引导 / F6 顺序号=勾选序`["2","1"]`非档案序 / 旧 dispatch 真发 POST 201+assignment / F15 两按钮重跑保预填+新建空白清空 / tab 切换非崩溃；pageErrors=0；lead 亲看 3 截图）**。3 文件：DispatchPanel 提取 DispatchContent+删壳+F6/8/15 / PipelineModal props+解构+接入 / AppShell 删入口 4 处+补 2 props。决策 D-R7-08（删壳/F6 纯数字+selectedIds.indexOf/F15 testid/tab 切换取舍/F8 引导行/历史脚本废弃）→ [`T7.md`](T7.md)
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
