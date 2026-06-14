# D2 拦截可行性验证（spike）

## 要回答的问题

在「不 fork pi 内核」红线下，能否拦截 agent 的 `edit`/`write`，**让它不真的写盘**，
而是把改动转成可供 HITL 按块确认的数据？

## 判定标准（按层级）

- **Tier 1（不需要模型凭证，这是合格线）**：用 `@earendil-works/pi-coding-agent@0.79`
  的 `createAgentSession`，通过 `excludeTools` + `customTools` 用自定义 `write`/`edit`
  替换内置工具；确认：(a) 自定义工具确实出现在会话工具列表里、内置同名工具已被替换；
  (b) 直接调用自定义工具的 `execute(...)` 传入一个 patch，**磁盘上目标文件不被创建/修改**，
  且 patch 被我们捕获。→ 证明「机制可行」。
- **Tier 2（需要模型凭证，加分项）**：真正发一轮 prompt 让 agent 调 `write`，
  验证它确实走进我们的自定义工具且没写盘。无凭证则跳过，不阻塞结论。

## 关键事实（已查官方文档 main 分支，待 v0.79 实测确认）

- SDK：`createAgentSession({ tools?: string[], customTools?: ToolDefinition[], excludeTools? })`，
  自身无写盘前 veto 回调。
- 扩展层：`pi.on('tool_call')` 返回 `{ block: true }` 可在执行前否决；同名可覆盖内置 `edit`/`write`。
- 自定义工具用 `defineTool({ name, parameters, execute, renderCall, renderResult })`；
  覆盖内置时**结果 shape（含 `details` 类型）必须与内置一致**，否则 UI 渲染会坏。

## 结论

（由验证 agent 跑完后回填：机制是否成立、确切 API、踩到的坑、对 D2 实现的建议。）
