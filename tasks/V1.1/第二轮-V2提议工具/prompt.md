# V2 实现监工起始指令（第二轮·提议工具模型）

> 新窗口开工：你当**监工**。先读三件套（`../../docs/第二轮-V2提议工具/{需求文档,概要设计,详细设计}.md`）+ 本文，再按批次用 **agent team** 串行实现。
>
> **三件套已经过 ultracode review 加固**（2026-06-18，commit `c5792b6`）：含 1 blocker + 4 major 的修订，新增 ADR **D-V2-04~06**。**直接按修订后的任务卡/详设做**、无须再 review；完整发现与修订映射见 `../../docs/QA/开发/V2/review与修订记录.md`。

## 角色与目标
1. 实现 V2「文档实体 + 提议工具」模型：删 guard、加 `create_artifact` / `propose_edit` / `list_artifacts` + 受限工具集 + 物化真实 `crd.md`。
2. 按批次 0~5 **串行**推进；每批过质量门禁再下一批。
3. 端到端验收：文档会话 agent `create` → `propose` → 按块确认 → 新版本 + 真实文件更新。

## 开工方式：agent team（**不是** fire-and-forget subagent）
- **用 `TeamCreate` 建实现团队**（如 `v2-impl`），队员**可寻址**：用 `SendMessage` 点对点交派任务 + 收回成果，能来回追问/纠偏——**而非派出去就不管的 subagent**。
- 监工只协调 + 亲验关键 diff + 复跑门禁 + 亲跑 harness；**队员一次只做一个模块、串行**（本机 3.4G 无 swap，并行重活会硬崩——见记忆 `next-step-local-oom-constraint`）。
- 用 `addBlockedBy` 锁批次顺序：V2-0 → V2-1 → V2-2 → V2-3 → V2-4 → V2-5 → V2-6。

## ✅ 前置：模型凭证（已配，区分两层别混）
- **pi 运行时**（Next-Step app 内 agent 真做事）= **已配 DeepSeek**（`~/.pi/agent/`：auth.json 有效 key + models.json provider + settings default `deepseek-v4-flash`；直连 + pi 端到端验证 OK）→ V2-6 验证 / 真实使用**可真调模型、不必全靠 faux**。
- **Claude Code 实现 team**（你 `TeamCreate` 的队员）= 用 **Claude 凭证**，与 DeepSeek 无关：**用默认 opus、别指定 sonnet**（sonnet 在本环境 401；opus 已跑通本轮 review 的 27 agent）。
- faux 驱动仍作 hermetic 单测（既有 d3~m8 / P0 fixture 范式）。

## 批次（串行，逐批过门禁）
- 批次 0：**V2-0 spike**（命门：defineTool 签名 + 受限工具集组合——**白名单须含全部 customTool 名 D-V2-04**，否则内核 `agent-session.js:1831` 过滤掉 customTool、agent 调不到；**双向负对照**=write/edit/bash 不可用 & 3 提议工具能调起；GO 才继续）
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
- 新机制决策记 `../../docs/设计决策记录.md`（V2 用 `D-V2-NN`，现已到 D-V2-06）；用户拍板记 `../../docs/QA/开发/`。
- 每完成一模块即细粒度提交（`next-step-commit-per-task`）。
