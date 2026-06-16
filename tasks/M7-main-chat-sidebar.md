# M7 · main-chat-and-sidebar（功能#5.2/5.3/5.4）

每项目固定「主对话」+ 按需起 agent 会话 + 左侧分组 & 标签。批次 2，**依赖 M5**。
详见 详细设计.md · M7。

- [ ] 读 `components/SessionSidebar.tsx` + `components/AppShell.tsx` + 起会话链路 `/api/projects/[id]/agents/[agentId]/session`（已存在）+ M5 的 `useSessionMapStore`
- [ ] 主对话（5.2）：进项目落到工作台；`SessionMap.mainSessionId` 为空则懒创建一个标 main 的会话（或把首个普通会话标 main）；没设 agent 默认聚焦主对话
- [ ] 按需起 agent 会话（5.3）：保持「先建档案、需要时再起会话」；起会话后写 `SessionMap.bySession[newSid]=agentId`（经 M5）；不自动冒空会话
- [ ] 左侧分组（5.4）：`SessionSidebar` 按归属分区——顶部「主对话」区（mainSessionId）/「各 Agent」分组（按 `bySession` 聚合、每组标 agent 名、会话条挂名标签或色点）/「其它会话」区（无归属）
- [ ] 复用现有会话树/cwd 过滤，只在渲染层加分组依据（读 `useSessionMapStore`）
- [ ] 写/补单测（懒创建主对话、起会话写映射、分组聚合渲染依据）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收（分段自检）：[5.2] 进项目落到主对话；[5.3] agent 起的会话归到其分组带标签；[5.4] 主对话区/各 Agent 区显性可分；现有切换/分叉不破（browser-e2e）
