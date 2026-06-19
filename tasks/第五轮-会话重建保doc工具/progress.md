# 第五轮 · 会话 re-attach 重建受限 doc 工具集 —— 进度

详细设计 `docs/第五轮-会话重建保doc工具/详细设计.md` ｜ 任务卡 `任务卡.md`
范围：只修 profile 会话 re-attach（主对话/dispatch §A/§B 不在本轮）。

- [x] **设计评审**（ultracode，2026-06-20）—— 14 agent / 326 工具调用 / 6 维度核查 + 1 承重 spike + 对抗复核；结论 `ready_with_fixes`（无硬 blocker）。spike 推翻初版前提：systemPrompt=override（内核不持久化）；查出 4 major + 7 minor。详见详细设计 §〇 + `docs/QA/开发/第五轮设计评审与拍板.md`。
- [x] **文档订正**（2026-06-20）—— 4 major + spike 死分支 + 7 minor 全部回写详细设计 + 任务卡（用户拍板 Q1=并发去重方案A、Q2=仅订正文档暂停）。
- [x] **评审通过**（用户 2026-06-20 批准）→ 进实现 T1→T3（agent team `ns-r5-impl` 串行，lead 独立验收+细粒度 commit）。
- [x] **T1** · `reattachProfileSession` + 单测 —— ✅ 完成。`lib/pi/profile-session-wiring.ts` 新增；`ReattachInnerSession<S>` 泛型透传 session 类型、惰性 `import("../rpc-manager")` 破循环依赖；3 AC 全绿（getActiveToolNames 恰 7 受限名+不泄漏 write/edit/bash〔对抗性：profile.tools 故意含 write/edit/bash〕 / buildSessionContext 保留 jsonl 历史 / systemPrompt 含 `<agent_profile>`+角色+memory）；门禁 lint+tsc+test(345) 全绿、零回归。lead 独立验收通过。
- [x] **T2** · 抽 `startRpcSessionInner` + `withStartLock` 共享锁（方案A）+ 新建 `lib/pi/session-reattach.ts` `resolveOrReattachSession` + 单测 —— ✅ 完成。`withStartLock` 让 resolver 与 `startRpcSession` 共用同一把 `__piStartLocks`；`startRpcSessionInner` 原样提取、行为等价；resolver 三分支（活会话快路径/reattach/generic）统一返回型、容错只吞 NOT_FOUND；7 AC 全覆盖（gate 制造并发窗口验去重、诚实边界测试钉死 normalizeRoot 尾斜杠语义、容错分级 NOT_FOUND→generic vs INVALID→续抛）；门禁 lint+tsc+test(358) 全绿、零回归（rpc-manager.test 3 / profile-session-wiring 12 不破）。lead 独立验收通过。
- [ ] **T3** · 两路由接线 + 真机重启复现回归 + SSE(流式中)重连验证 + systemPrompt角色块断言 + 真浏览器闭环（防OOM/冷编译）
- [ ] 门禁全绿（lint+test+tsc）+ 零回归 + 回写文档/memory
