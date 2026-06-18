# V2-0 · 工具机制 spike（命门，先做）

> 批次 0，无依赖。GO 才展开 V2-1~V2-6。详见 `../../docs/第二轮-V2提议工具/详细设计.md` §B。

## 目标
验证两个未确认命门，产出 GO/NO-GO + 确认的调用范式（记 ADR）。

## AC
- [ ] 跑通一个最小 `defineTool` 自定义工具（确认 `parameters` 是 zod 还是 JSON schema、`execute(args, ctx)` 签名）。
- [ ] 受限工具集组合起会话：`tools: ["read","grep","find","ls"]` + `customTools: [该自定义工具]`，断言 read/grep 可用、自定义工具可调。
- [ ] **负对照**（关键）：同会话里 write / edit / bash 调用**失败 / 不可用**（证明无绕过）。
- [ ] 产出 GO/NO-GO 结论 + 确认的 `defineTool` 范式 + 受限工具集确切 options 形态，记 `../../docs/设计决策记录.md` ADR。

## 关键提示
- 本地无模型凭证（401）→ 用 faux model 起会话（参照 `spike/p0-profile-guard/` + `spike/p0-wire-verify/`）。
- `defineTool` 由 pi 包导出（`node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:8`）。
- 工具范式可参照 `lib/pi/artifact-guard.ts` 的 `createWriteToolDefinition(cwd,{operations})` 等（但那是内核工厂改 operations；本工具是**全新** defineTool）。
- 风险：P0 命门是"白名单**含** write + customTools 覆盖"；本组合是"白名单**不含** write + customTools 加新工具"，**新组合必须实证**。
