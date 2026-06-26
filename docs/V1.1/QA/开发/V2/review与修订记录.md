# V2 设计 ultracode review 与修订记录（2026-06-18）

> 用户要求"开 ultracode review 三件套 + 3 ADR、考虑边界"，并在 review 后"全面修订 + **把修订记录和如何发现的记录下来，方便溯源**"。本文即溯源记录。
> review 完整 return 落在 workflow 输出（task `wossvwhj7` / run `wf_315505c0-8d5`）；修订涉及文件见文末清单。

## 一、review 怎么做的（方法）

- **方式**：ultracode 多 agent 编排 workflow——**6 维度并行审查 → 对抗验证（每条 blocker/major 独立复核 isReal）→ 综合报告**。
- **规模**：27 agent、约 227 万 tokens、~45 分钟。用 opus subagent（sonnet 在本环境 401 不可用）。
- **6 维度**：① local-vs-whole（核心议题）② requirements ③ detailed-vs-code（逐条对照真实代码核实）④ adr ⑤ boundaries（边界穷举）⑥ cross-consistency（三件套+任务卡一致性）。
- **审查对象**：第二轮三件套 + `设计决策记录.md` D-V2-01~03 + 任务卡 V2-0~V2-6。
- 全程"Read/Grep 实际读代码、不空想"，发现均带 `文件:行` 证据。

## 二、头号议题（用户钦点）：局部修改 vs 整篇全文 → 不改架构

- **用户原话**："我会在对话里**表明某一段要改、而非整篇改**"。
- **review 核实结论**：**本期可满足、不改路线/ADR/任务卡**。`propose_edit` 收整篇新全文 → `computeReplaceDiffBlocks` 行级 LCS（equal 段不产块，`pending-change-service.ts:143/149-152`）→ 用户端只看到/只确认**变化那一段**；`applyResolvedBlocks` 块级独立确认（单测 `:285/297/344` 证"mod 接受 + add 拒绝→只应用 mod"）。这正是 AFFiNE 开源真机制（模型吐整篇→后端内容 LCS），我们 LCS 同构、非弱替代。
  - 路线 B（op=patch 局部 edit）：全仓 grep 确认 `buildPatchPendingChange`/`computeEditDiffBlocks` 是**零生产引用的死代码**，`applyResolvedBlocks` 对 patch 抛 INVALID（无物化通路）→ 本期不做。路线 C（block_id）§6 已后置。
- **修订**：需求 §3 录用户原话 + "用户视角局部 / 实现整篇"对账；F3 写明"整篇是内部实现、用户端只确认变化块"；详设 §C V2-2 加 **description 硬约束**（newContent 必须完整新全文、未改段逐字保留）；V2-6 加正向（只改一段→仅 1 mod 块）+ 负向（残篇→大量 del 块）用例。

## 三、🟥 blocker（1，已对抗验证）

**受限工具集白名单漏提议工具名 → V2 闭环必断**
- **发现**：详设 V2-3 把白名单写 `["read","grep","find","ls"]`，但内核 `agent-session.js:1825-1831` 对 **customTools 同样按白名单名过滤**（名不在 `tools` 白名单则被滤掉、连注册都不到；`sdk.js:132` + P0 spike `harness.ts:24-25` 同机制）。漏 3 提议工具名 → agent 调不到 create/propose/list → 闭环断；V2-0 spike AC 也自相矛盾。需求 §F5 其实写对了（含工具名），是详设 V2-3 与需求矛盾。
- **修订**：白名单改 **7 项**（含 create_artifact/propose_edit/list_artifacts）；详设 V2-3/§B + 概要(V2-0/V2-3/范式/自检) + 需求 §F5/§8 + 任务卡 V2-0/V2-3 全部统一；补 **D-V2-04** ADR；V2-0 spike 改**双向**负对照（write/edit/bash 不可用 + 3 工具能调起）。

## 四、🟧 major（4，已对抗验证）

| # | 发现 | 修订 |
|---|------|------|
| 1 | 「局部修改」需求三件套无一处与"整篇+LCS"对账 → 用户易误判"每次整篇=没满足"，且 agent 回残篇致满屏删除噪声 | 同头号议题（§二修订） |
| 2 | **同一 artifact 并发 propose 静默覆盖**：每次 old=当前版快照、无锁，第二次确认基于陈旧快照覆盖第一次、`ifMatch` 永不 409 | **D-V2-05 拒绝并存**：propose 前 `listPendingChanges` 非空则拒；V2-2 加 AC、V2-6 加用例 |
| 3 | **外部编辑被静默覆盖=数据丢失**：propose 读 version 快照非真实文件，外部手改 crd.md 后确认覆盖、手改丢失（§6 原写"不进版本"低估了） | **D-V2-06 materialize 前比对**真实文件 vs 快照、不一致抛 `EXTERNAL_MODIFIED`(409) 拒绝；需求 §6/详设 §E 据实改写；V2-1 加 AC、V2-6 加用例 |
| 4 | **V2-4 spread 两个 `tools` 键碰撞**：`{...options,...docOptions}` 中 profile.tools 与 docOptions.tools 相撞，受限集安全全靠"docOptions 排后覆盖"隐式事实、文档没点明（wiring.ts:125 旧注释"顺序无关"不适用本轮） | 详设 V2-4 + 任务卡 V2-4 点明 spread 顺序是支点 + 加**泄漏对照测**（profile.tools 含 write/edit/bash → 断言被覆盖）；并入 D-V2-04 |

## 五、🟨 minor（已验证，已处理）

- F5/§8.2/概要 与详设**工具集口径矛盾**（5 项 vs 含 grep/find/ls）→ 全统一为 7 项白名单、断言改"含且仅含 7 名 + 不含 write/edit/bash"。
- **空/无变化 propose** → 落空块 PendingChange 产幽灵版本污染历史 → V2-2「空块不 save」AC。
- **缺 delete/清理工具** → 项目根孤儿 .md 淤积、手删真实文件后侧车残留 → 登记后续（详设 §A / progress）。
- **sanitizeFileName 边界**（空/纯点/超长/保留名未定义）→ **复用 `lib/domain/orchestrator.ts` 既有实现**（已覆盖+5 单测）。
- 概要 line 66 把 `assembleProfileSessionOptions` 范式错记（noTools+customTools 实为 guard 范式）→ 改正。
- 收 id 与口语指代缺桥 → 3 工具 description 引导"先 list_artifacts 按 title 挑 id"（不动 schema）。

## 六、用户拍板（2026-06-18）

| 取舍 | 选项 | 最终 |
|------|------|------|
| 并发 propose | 拒绝并存 / 确认时 409 / 不管 | **拒绝并存**（D-V2-05） |
| 外部编辑保护 | 文档+代码比对 / 仅文档 / 不管 | **文档警示 + 代码比对**（D-V2-06） |
| 修订推进 | 现在全面修订 / 先看完整报告 / 只修 blocker | **现在全面修订 + 记录溯源**（本文） |

## 七、ADR 新增

`../../../设计决策记录.md` 追加 **D-V2-04**（白名单含全部 customTool 名·原 blocker）/ **D-V2-05**（并发拒绝并存）/ **D-V2-06**（外部编辑比对防覆盖）。

## 八、修订文件清单

- `../../../设计决策记录.md` —— +D-V2-04~06
- `../../../第二轮-V2提议工具/需求文档.md` —— §3 对账+原话 / F3 / F5 / §6 / §8 / 附
- `../../../第二轮-V2提议工具/概要设计.md` —— V2-0/V2-3 装配 / 范式 / 自检
- `../../../第二轮-V2提议工具/详细设计.md` —— §A(sanitize+delete) / §B(spike) / V2-1(外部保护) / V2-2(并发+空块+description) / V2-3(白名单) / V2-4(spread) / V2-6(用例) / §E
- `../../../../../tasks/V1.1/第二轮-V2提议工具/` —— V2-0/V2-1/V2-2/V2-3/V2-4/V2-6 + progress
