# V2 实现监工起始指令（第二轮·提议工具模型）

> 新窗口开工：你当**监工**。先读三件套（`../../docs/第二轮-V2提议工具/{需求文档,概要设计,详细设计}.md`）+ 本文，再按批次用 **agent team** 串行实现。

## 角色与目标
1. 实现 V2「文档实体 + 提议工具」模型：删 guard、加 `create_artifact` / `propose_edit` / `list_artifacts` + 受限工具集 + 物化真实 `crd.md`。
2. 按批次 0~5 **串行**推进；每批过质量门禁再下一批。
3. 端到端验收：文档会话 agent `create` → `propose` → 按块确认 → 新版本 + 真实文件更新。

## 开工方式：agent team（**不是** fire-and-forget subagent）
- **用 `TeamCreate` 建实现团队**（如 `v2-impl`），队员**可寻址**：用 `SendMessage` 点对点交派任务 + 收回成果，能来回追问/纠偏——**而非派出去就不管的 subagent**。
- 监工只协调 + 亲验关键 diff + 复跑门禁 + 亲跑 harness；**队员一次只做一个模块、串行**（本机 3.4G 无 swap，并行重活会硬崩——见记忆 `next-step-local-oom-constraint`）。
- 用 `addBlockedBy` 锁批次顺序：V2-0 → V2-1 → V2-2 → V2-3 → V2-4 → V2-5 → V2-6。

## ⚠️ 前置：模型凭证（必读）
- 本地 `~/.pi/auth.json` 不存在 = **无模型凭证（401）**。**实现前用户须先 `/login`**，否则 agent team 队员起不来（本轮拆任务时 Explore agent 已实测 401 失败、0 token）。
- 所有"agent 真做事"的 E2E 仍可能须 faux 驱动（既有 d3~m8 / P0 全用 fixture，无一真起 agent 调模型）。

## 批次（串行，逐批过门禁）
- 批次 0：**V2-0 spike**（命门：defineTool 签名 + 受限工具集组合行为 + 负对照；GO 才继续）
- 批次 1：V2-1 文档物化层
- 批次 2：V2-2 提议工具
- 批次 3：V2-3 会话装配 → V2-4 接线
- 批次 4：V2-5 删 guard
- 批次 5：V2-6 端到端验证（含真浏览器）

## 质量门禁（每批全绿再下一批）
`npm run test` + `node_modules/.bin/tsc --noEmit` + `npm run lint`；UI/集成相关**走真浏览器验收**（repo-vendored browser-e2e，非全局 run-e2e）。

## 红线（北极星不变量）
- 不改 pi 内核；提议工具用 `defineTool` 写 **next-step 代码**（`lib/pi/*` 只封装）。
- 文档会话受限工具集**无 write/edit/bash**；artifact 改动必经 propose → 按块确认 → 才落版 + 物化。
- 纯文件无 DB；单用户、不上 CRDT。
- 新机制决策记 `../../docs/设计决策记录.md`（沿 `D-V1.1-NN`）；用户拍板记 `../../docs/QA/开发/`。
- 每完成一模块即细粒度提交（`next-step-commit-per-task`）。
