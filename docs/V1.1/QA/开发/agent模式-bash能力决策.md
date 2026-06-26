# Agent 模式（文档型 / 编码型）—— 放开 bash 能力决策

> 2026-06-21。用户报缺陷：「我真正需要 agent 有 bash 能力的时候无法开启 bash」，并提议「编辑 agent 工具（内置编码工具）时，加入选择『专门写文档的工具』，让用户按需求选择工具」。

## 背景（调查 + 复现）

- **复现**：ultracode workflow（8 agent 对抗校验）+ 真浏览器 + DeepSeek 真实对话双跑确认。用户在 AgentManager 勾选 bash → 存入 `agent.json` 的 `tools` → 但起 profile 会话时，`lib/pi/profile-session-wiring.ts` 用 `docOptions`（`doc-session.ts` 的 7 项受限白名单 read/grep/find/ls + 3 提议工具，**无 bash**）经对象 spread **整体覆盖** `profile.tools`，无任何开关可让 bash 透传。会话里 agent 调 bash → 内核返回 `Tool bash not found`，agent 自述「我没有 bash 工具」并列出那 7 项。
- **性质**：是 V2「文档会话用受限工具集、改受管文档只能经 propose_edit → 按块确认」**红线的 by-design 实现**，**不是代码 bug**；但叠加一个 **UX 沉默陷阱**——bash 在 UI 能勾、能存盘、回读仍显选中，起会话却被静默丢弃、全程无提示，给用户「已开启」的错觉。
- **对抗校验纠正直觉**：原以为「bash 全局开不了」错。**主对话（/api/agent/new）与派发 dispatch worker 本就带 bash**（只要勾进 agent.tools 即可，它们不套受限集）。缺口**仅在 profile 文档聊天会话这一处**。
- 路径矩阵：profile 会话 / re-attach = 无 bash；主对话 = 有；dispatch worker = 有（取决于 agent.tools）。

## 可选项（全列）

- **方案A**：`AgentProfile` 加 `mode: doc|coding` 字段，wiring 按 mode 决定是否套受限集。`doc` 维持现状（受限集、改文档经提议确认），`coding` 用 `profile.tools`（含 bash）。机制层零改、不碰内核、对红线零破坏（`coding` 等价 dispatch/主对话既有带 bash 会话）。约 3-4 文件。**精准命中用户「文档型 vs 编码型」提议**。
- 方案B：不引入 mode，受限会话里把 `profile.tools` 的 write/edit/bash 并入白名单。**削弱红线**（write 可直接覆盖受管 .md、bash 可 `echo>file` 绕过提议确认），不推荐作默认。
- 方案C：mode + `doc` 模式可选「仅解锁 bash」。折中，开关组合多、复杂度高。
- 方案D：不放开 bash，仅补 UX 防呆（置灰 + 诊断）。治标，**不满足**用户「真要 bash 时能开启」的核心诉求。

## 推荐 + 理由

**方案A，并叠加方案D 的 UX 防呆**。命中用户原始提议；不碰 pi 内核、不动 doc-session 受限白名单、对 V2 红线零破坏；存量 agent 默认 `doc` 行为不变。

## 谁拍 / 最终选择

用户（经 AskUserQuestion 四选一）拍板：**「方案A + UX防呆」**。

## 落地与验收

- 实现级取舍见 ADR `docs/设计决策记录.md` **D-MODE-01~03**。
- 双层验收全 PASS：逻辑层 365 单测（+7：store mode 5 + wiring coding 2；`doctor-checks` 内核包加载为环境性 flaky、单独跑 1s 过）+ lint 干净；真浏览器 PASS（模式切换 / bash 勾选 / doc 置灰禁用 / 持久化 mode=coding / **DeepSeek 真跑 bash `echo` 输出 `NEXTSTEP_BASH_OK`**，对比修复前 doc 模式的 `Tool bash not found`）。
