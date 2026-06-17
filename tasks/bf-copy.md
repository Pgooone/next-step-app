# BF·BUG-03 · 文案/空状态（P2.1/2.3/2.5）

纯文案替换、零逻辑改动。本轮**序 1**（最低风险，先热身）。无依赖。
详见 `../BUG修复记录-v1.1.md` · BUG-03。

- [ ] 读 6 处站点：`AppShell.tsx:893-896` / `ChatInput.tsx:535` / `ArtifactPicker.tsx:95` / `AgentManager.tsx:401-447` / `SessionSidebar.tsx:722-725`
- [ ] Get Started：改全中文 V1.1 语境（建 Agent → 起会话/主对话 → @转交 → 产物按块确认）
- [ ] 流式 placeholder + @ 提示：空闲态「输入消息，或用 @ 转交给 Agent」；运行态统一中文
- [ ] 产物加载文案「加载中…」；会话空态「该项目暂无会话」
- [ ] Agent 列表空态加「暂无 Agent，点『新建 Agent』开始」（参考 `ProjectHome:187-195`）
- [ ] 边界：i18n 一致（不再中英混杂）；改短文案不致布局收缩破裂
- [ ] 跑门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：6 站点显示新文案、无英文残留、布局正常（browser-e2e）
- [ ] 单独 commit

**AC**：所有站点中文一致、空状态有「这是什么 + 下一步点哪」、布局不裂。
