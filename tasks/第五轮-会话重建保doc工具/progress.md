# 第五轮 · 会话 re-attach 重建受限 doc 工具集 —— 进度

详细设计 `docs/第五轮-会话重建保doc工具/详细设计.md` ｜ 任务卡 `任务卡.md`
范围：只修 profile 会话 re-attach（主对话/dispatch §A/§B 不在本轮）。

- [ ] **设计评审**（用户）—— 详细设计 + 任务卡，评审通过才进实现
- [ ] **T1** · `reattachProfileSession` + 单测（含 systemPrompt 覆盖/叠加 spike）
- [ ] **T2** · `resolveOrReattachSession` 解析器 + 单测（判定/反查/容错）
- [ ] **T3** · 两路由接线 + 真机重启复现回归 + SSE 重连验证 + 真浏览器闭环
- [ ] 门禁全绿（lint+test+tsc）+ 零回归 + 回写文档/memory
