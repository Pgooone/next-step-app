# M8 · at-agent-transfer（功能#5.5）

主对话 `@agent` → 把「全主对话历史 + 附件 + 发送时勾选」转交到该 agent 单独会话。
批次 3，**依赖 M5 + M7 + M2 拼装函数**（复用 M2 文本→`<file>` 纯函数）。是新轻量功能，不复用 Dispatch（保留不动）。详见 详细设计.md · M8。

- [ ] 读 `components/ChatInput.tsx`（@ 触发落点）+ M5 映射接口 + M7 主对话/起会话链路 + 该项目 agent 档案来源
- [ ] 主对话输入框输入 `@` → 弹待选 agent 列表（读该项目 agent 档案）
- [ ] 选中 agent → 弹「转交内容勾选」：默认勾【当前主对话全部历史】+【已附文件】，可现场增减
- [ ] 组装载荷：历史序列化拼进目标会话首条消息 `<context source="主对话">...</context>`（保留角色标注 user/assistant/工具）；文件复用 M2 拼装纯函数的 `<file>` 内联格式（浏览器上传无绝对路径，`name` 用文件名；与内核 `@file` 的绝对路径语义不同、本功能可接受）
- [ ] 投递机制（D-V1.1-04）= 起新会话：`POST /api/projects/[id]/agents/[agentId]/session`，载荷作 `firstMessage`，复用 `handleAgentSessionStarted` 切会话 + 接 SSE，新会话经 M5 标记归属
- [ ] 可选：主对话留「已转交给 @X」回执
- [ ] 写/补单测（@ 唤起列表、勾选默认值、载荷组装、目标会话懒起+标记）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：主对话 `@` 唤出 agent；转交内容经 `POST /session` 进入该 agent 单独新会话；默认带全历史+附件、可勾选；**序列化保留角色标注（user/assistant/工具）且目标会话可见**；**确认 @agent 与 Dispatch 并存、互不干扰**（browser-e2e）
- [ ] 决策点：转交载荷 = 历史序列化为 `<context>` + 文件 `<file>` 内联、投递为目标会话首条消息（已定 D-V1.1-03）；投递机制 = 起新会话（已定 D-V1.1-04）。均见 `docs/设计决策记录.md` → 记入 `docs/设计决策记录.md`
- [ ] 备注（防滑坡）：本功能是**跨会话异步转交**，非北极星愿景的「同窗口实时 agent team」；若要演进成主对话里实时看/插话 agent，触愿景红线、须回找用户拍板
