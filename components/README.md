# components（前端组件）

> 归属：基座（pi-web）继承 + Next-Step 新增。　规格：`../../next-step-V1/docs/05-features-功能清单.md`

## 作用
React 函数式组件（全部 `"use client"` + hooks）。基座组件（`ChatWindow` / `FileViewer` /
`SessionSidebar` / `TabBar` …）提供会话 / 文件 / SSE UI；Next-Step 新增项目、Agent、派发、
**产物面板**等管理 UI。全局状态走 `lib/stores`，领域调用走 `app/api`。

## 产物面板区（Iter D·D3，§5.4）
- `ArtifactPanel.tsx` — 受管 artifact 的「Notion 式只改一段」**只读**视图：完整内容 + TOC（AC①）、
  pending 块行内高亮 add 绿 / del 红删除线 / mod 黄（AC②③）、块数 > 25 自动降级并排 Diff（AC④）、
  「查看 Diff」逐块视图（AC⑤）、划选「引用到对话框」写 `editTarget.quoteText`（AC⑥）。
  渲染纯函数在 `lib/artifact-view`；配色用基座 `var(--...)` 内联主题（同 `FileViewer`）。
- `ArtifactPicker.tsx` — 极简「打开产物」模态：列当前项目 artifact（`GET /api/projects/[id]/artifacts`）
  → 选中交 `AppShell` 在右侧面板用 `ArtifactPanel` 打开。
- 接线：`AppShell.tsx`（Artifacts 侧栏按钮 + 右侧面板产物视图，与文件视图互斥）、
  `ChatWindow.tsx`（`QuoteBar` 读 `editTarget.quoteText` 展示 / 清除，AC⑥ 读侧）。
- **红线**：D3 纯渲染，**不做** resolve / 逐块确认 / 版本切换 / rollback（D4 / §5.5 / §5.6）。

## 主对话 @agent 转交区（M8·V1.1，§5.5）
- `AgentTransferPopover.tsx` — 两阶段浮层：选该项目 agent → 勾选转交内容（默认勾「全主对话历史」+「已附文件」、可增减）→ 确认。
  载荷组装 / 勾选默认 / 历史序列化走 `lib/agent-transfer` 纯函数（保留 user/assistant/工具 角色标注、`<context source="主对话">` + `<file>` 内联）。
- 接线：`ChatInput.tsx`（主对话 textarea 输入 `@`（行首/空白后）唤起浮层，仅 `atAgents` 有值=主对话时启用）、
  `ChatWindow.tsx`（`isMainChat` 时 `extractTransferHistory(messages)` 透传 `transferHistory`）、
  `AppShell.tsx`（`atAgents`/`isMainChat`/`onAgentTransfer`——复用 `useAgentStore.startSession` 投递
  `POST /agents/[id]/session`、`handleAgentSessionStarted` 切会话接 SSE；决策 D-V1.1-03/04）。
- **红线**：跨会话异步转交（非同窗口实时 agent team）；与 Dispatch 并存、不复用 Dispatch。

## 约定 / 红线
- 函数式 + hooks；PascalCase 文件名；状态用 selector 订阅避免重渲染。
- 复用基座能力（会话 / SSE / 工具 / 技能 / 模型 UI），不另造轮子。
- SSR 安全：store 初始 state 不读 localStorage，恢复推迟到挂载后（防 hydration mismatch）。

## 改这个区前
先读对应功能规格 `docs/05` 的 AC；产物面板另读 `lib/artifact-view/README.md`。
