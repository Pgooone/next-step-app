# 第七轮 · 流水线与阶段看板 — 进度

> **状态：待需求细化后开工。** 调研 + 方案已成型（见 `../../../docs/V1.2/第七轮-流水线与阶段看板/方案-流水线与阶段看板.md`），任务卡待用户细化需求 + brainstorm 对齐 MVP 裁剪范围后填充。

## 预期任务（草拟，待细化）

第一期（MVP，详见方案 §2.6）：
- [ ] T1 `lib/domain/pipeline-store.ts` —— 蓝图 + run 存储（仿 dispatch-store 原子写）
- [ ] T2 `lib/domain/pipeline-orchestrator.ts` —— 编排器（复用 runWorker/acquireSlot/上游喂下游 + **每阶段后销毁 worker 释放槽**，承重墙 = F16 真药方）
- [ ] T3 `lib/stores/usePipelineStore.ts` + API 路由（fire-and-forget）
- [ ] T4 `components/PipelineBoard.tsx` 阶段看板 + `PipelineEditor.tsx` 蓝图编辑表单
- [ ] T5 旧 Dispatch 表单就地修补（F6 顺序号 / F15 新建空白 / F8 子任务提示）
- [ ] T6 双层验收（逻辑层 + 真浏览器；关键断言：≥4 阶段一键跑完不卡 10 分钟、不重启 dev）+ 文档回写 + push

第二期 / 第三期：见方案 §2.6（模板；可视化与可恢复，均不承诺、视反馈）。

## 承重墙

- **F16 真药方**（方案 §2.4 安全销毁）：每阶段 completed 后主动销毁 worker 会话释放槽，复用 `lib/pi/evict-agent-sessions.ts` 配方，**严守「只 destroy、不碰 bySession/removeOwner」红线**（否则 re-attach 的 getOwner 返 null、反塞 write/edit/bash，第五轮修过的 bug）。开工第一步应 spike 验证此点。
