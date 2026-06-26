# BF·BUG-05 · §C 引用注入（⚠️ 高回归风险，最后做）

`handleSend` 接入 `editTarget.quoteText` + 乐观清除防重复。**触核心发送链路**，本轮**序 5、最后做、单独 commit**。
依赖：前 4 项稳定后再动。详见 `../../../docs/V1.1/BUG修复记录-v1.1.md` · BUG-05。

- [ ] 读 `useAgentSession.ts:334-402`（handleSend + steer/followUp）+ ChatWindow QuoteBar + `useArtifactStore` 的 `editTarget`/`setEditTarget`
- [ ] handleSend 入口：有 `editTarget.quoteText` 则拼进 message（格式「【引用：…】\n\n{userMessage}」）
- [ ] 乐观清除：入口立即 `setEditTarget(null)` 防连点/steer 重复注入
- [ ] steer / follow-up 两条路径同样接（**三条发送路径都读/清 editTarget**）
- [ ] 边界：空引用跳过注入；引用+正文拼接（引用在前）；引用+附件不影响图片块；发送失败的清除策略（简化：失败不强求恢复）
- [ ] 写/补单测（注入格式 + 乐观清除 + 三路径）
- [ ] 跑门禁全绿
- [ ] 真浏览器验收：三条发送路径（普通/steer/follow-up）均正确注入+清除；附件并存；空引用不误注（browser-e2e）
- [ ] 单独 commit

**AC**：引用真正到达 Agent、不重复注入、不破坏普通/steer/follow-up 发送与附件。
