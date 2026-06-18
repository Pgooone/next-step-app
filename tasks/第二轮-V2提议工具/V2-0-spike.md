# V2-0 · 工具机制 spike（命门，先做）

> 批次 0，无依赖。GO 才展开 V2-1~V2-6。详见 `../../docs/第二轮-V2提议工具/详细设计.md` §B。

## 目标
验证两个未确认命门，产出 GO/NO-GO + 确认的调用范式（记 ADR）。

## AC
- [ ] 跑通一个最小 `defineTool` 自定义工具（确认 `parameters` 是 zod 还是 JSON schema、`execute(args, ctx)` 签名）。
- [ ] 受限工具集组合起会话：`tools` 白名单 = **含该自定义工具名**（如 `["read","grep","find","ls","<tool>"]`）+ `customTools: [该自定义工具]`。⚠️ **命门 D-V2-04**：白名单**必须含 customTool 名**，否则内核 `agent-session.js:1831` 把它过滤掉、连注册都不到。
- [ ] **双向负对照**（关键）：① write/edit/bash 调用**失败/不可用**（无绕过）；② 白名单含的自定义工具**确能调起执行成功**（闭环通）。
- [ ] 产出 GO/NO-GO 结论 + 确认的 `defineTool` 范式 + 受限工具集确切 options 形态，记 `../../docs/设计决策记录.md` ADR。

## 关键提示
- 本地无模型凭证（401）→ 用 faux model 起会话（参照 `spike/p0-profile-guard/` + `spike/p0-wire-verify/`）。
- `defineTool` 由 pi 包导出（`node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:8`）。
- 工具范式可参照 `lib/pi/artifact-guard.ts` 的 `createWriteToolDefinition(cwd,{operations})` 等（但那是内核工厂改 operations；本工具是**全新** defineTool）。
- 风险（**D-V2-04 命门，review 已揪出原设计 blocker**）：P0 是"白名单含 write + customTools 同名覆盖"；本组合是"白名单含**全新工具名** + customTools 加新工具"——内核对 customTools **也按白名单名过滤**（`agent-session.js:1825-1831`），漏名则调不到、V2 闭环断。**必须实证：白名单含 3 工具名时它们能调起**。
