# 通用多 Agent 配置 · 从 sf-mini 反推（设计调研与方案）— 已立项为 V1.2 第七轮

> 🧭 **状态更新（2026-06-27）**：本文是 2026-06-21 的调研留痕（当时「待拍板」）。其中「流水线 / 阶段看板 / 软件工厂蓝图（方案 D）」的机制层 **从未实现**——V1.2 第一轮「多 Agent 管理」只取了它的视觉/信息架构（agent 卡片）。机制层现已**正式立项为 `V1.2 第七轮 · 流水线与阶段看板`**（`next-step-V1.2/docs/V1.2/第七轮-流水线与阶段看板/`），并经 2026-06-27「sf-mini 13 阶段全流程实测（F1~F16）」校准、裁掉过度设计。本文作为**设计输入参考**保留；最新可开工方案以第七轮 `方案-流水线与阶段看板.md` 为准。
>
> 用户拍板留痕（**形态决策待定**，本文先固化调研结论 + 全部可选项，防 /tmp 易失）。
> 调研由 ultracode workflow 完成：10 agent（6 只读分析员深读 sf-mini 文档+重构后代码 → 3 套设计 → 1 综合），effort 调研 xhigh / 设计·综合 max，约 146 万 token。
> 原始全文（783 行）曾在 `/tmp/claude-1001/…/tasks/wejl265yx.output`（易失）；workflow 脚本 `…/workflows/scripts/nextstep-multiagent-from-sfmini-wf_15505339-9b8.js`。本文为**仓库内权威留痕**。

---

## 背景与目标

dispatch 派发「新手不友好」的优化，经用户澄清**升级为更大目标**：改造 **Next-Step**，使其能「**通用化地配置多 Agent**」，从而表达/复刻 sf-mini 那类**流程化的多 Agent 软件工厂**。

- **sf-mini = 真实标杆场景（"答案/需求"）**：一条「资料 → 需求三件套(ORD/CRD/PRD) → RTM → 自检 → 定稿」的 AI 软件工厂流水线，正重构为 13 阶段角色化协作（现仅资料/需求/设计 3 阶段真接通）。三大设计轴：协作模式 3 种（流水线+评审/层级/黑板）、自治度 4 档（全手动/低/中/高，逐阶段逐 Agent）、HITL 3 档（Auto/Semi/Manual）。
- **任务 = 从 sf-mini 反推 Next-Step 的多 Agent 设计**：落地宿主是 Next-Step（非 sf-mini 自身、非独立工具），须守 Next-Step 红线（不改 pi 内核 / 纯文件无 DB / 并发会话≤3 / artifact 改动经 propose_edit→PendingChange→按块确认 / 本地单用户）。

**关键洞察（让事情可行）**：sf-mini 的高级机器（Planner LLM 拆图 / Critic 自动返工 / 黑板 A2A / 设计真 Agent）**全藏在默认 `False` 的特性开关后**，默认路径仍是 stub 顺序生成、13 阶段仅 1–3 真接通、"角色化"目前只是几个硬编码字符串。所以"让 Next-Step 跑出 sf-mini 那样的流水线"，真正要复刻的是**当前激活层** = 角色化档案 + 顺序流水线 + HITL 按块确认 + 受管产物 + RTM——而这层 Next-Step 现有四件套（Agent 档案 / 串行 dispatch / propose_edit 按块确认 / 受管文档版本）**几乎 1:1 覆盖**。

---

## 一、sf-mini 概念模型（配置 → 工作 → 出结果）

**可配置项八类**：①角色 AgentDef（人设/工具集/默认自治档/可处理阶段/模型偏好）②13 阶段链（`frontend/src/lib/stages.ts` 权威，仅 1–3 真接通）③自治度 4 档 + 三作用域(project/stage/agent) + 5 类动作真值表(stage_advance/sensitive_tool/gate_check/critic_alert/normal_write) ④HITL 三档（与四档并存翻译：Auto↔high / Semi↔medium / Manual↔manual）⑤协作模式 3 种（流水线+评审/层级/黑板，分层共存）⑥提示词多版本 ⑦模型/端点/密钥 ⑧门限阈值与特性开关（RTM 覆盖率 0.85 硬门、Critic 0.7、rework≤2；planner/critic/rework/design_stage 默认 False）。

**运行生命周期**：默认硬编码状态机（意图路由 → 单 Agent 直跑 → 落库/HITL）OR `planner_enabled` 下 Planner→TaskGraph→ResumableScheduler（可暂停/单步/改输入重跑/节点 checkpoint 崩溃恢复）。

**结果形态**：Artifact+Version 版本化 / PendingChange `diff_blocks` 按块确认 / RTM 追溯矩阵 / AgentRun 一等观测 / SSE 12 事件 / 委派降级回落 stub。

**诚实边界**：高级能力默认全关、默认路径 stub 顺序生成、角色化是硬编码字符串、可复现止于 P3（设计阶段）。

---

## 二、反推核心：sf-mini 概念 → Next-Step 机制映射

| sf-mini 概念 | Next-Step 机制 | gap |
|---|---|---|
| **角色 AgentDef** | Agent 档案 `.pi/agents/<id>/`(agent.json+agent.md+memory.md)，AgentManager 即角色库 | ✅ **直接复用**（sf-mini 最大落差反被完整覆盖）；新增节点 promptOverride + 角色模板 |
| **13 阶段链** | 新增蓝图 `stages[]`(镜像 stages.ts)，可运行段编译成 dispatch | 🔶 **需新增**；只能真接通 1–3 阶段(同 sf-mini 现状) |
| **自治度 4 档** | 映射两杠杆：doc-session 受限 vs 自由 worker + 是否自动 advance | 🔶 **红线降维**(无内核真值表，压成两个二元开关) |
| **HITL 三档** | **天然零新增** = 红线②③本身(propose_edit→PendingChange→按块确认) | ✅ **最强匹配**(diff_blocks 与 DiffBlock 同构) |
| **协作 3 种** | 流水线=dispatch 串行+拼上游(原生)；层级=一次 2–3 assignment；黑板=共享受管文档 | 🔶 流水线✅，层级/黑板降维(无真子委派/无 A2A 总线) |
| **RTM 0.85 门** | rtm.md 受管文档 + 纯前端 RTM 视图(正则抽上溯链)+coverage 纯函数 | 🔶 可算可展示，无 DB 边表/非 422 硬门 |
| **产物/版本/Diff/定稿** | 受管文档三件套(版本/rollback/按块 Diff/物化/finalized) | ✅ **直接复用**(D3–D5 已验收) |
| **SSE 12 事件** | 2s 轮询 run.json + tail events.jsonl | 🔶 **红线降维**(纯文件无总线，实时性弱) |
| **运行时动态性** | 静态蓝图 + 逐段串行 dispatch + run.json 即 checkpoint | 🔶 **结构性差异**(无 Planner/并行/单步回放) |

---

## 三、推荐设计：「软件工厂蓝图」附加式薄壳

**一句话**：现有「Agent 档案 + 串行 dispatch + propose_edit 按块确认 + 受管文档版本」四件套之上，加一层纯文件 `pipeline.json`(蓝图) + 『工厂控制台』薄壳；蓝图把 13 阶段×角色×自治度×协作声明成阶段链，运行时把每段**静态展开成一次既有 dispatch**。

**信息架构**（左栏新增第 5 个『工厂(Factory)』入口，沿用 DispatchPanel/AgentManager 模态范式、无新路由、守单页二选一渲染）：
- **配置段** · Factory Console（4 Tab）：①角色库 = 直接挂现有 AgentManager（agent 档案即角色）+「一键导入 sf-mini 角色模板」；②流程蓝图矩阵 = 阶段链时间线(横向 13 段，可运行段实色/占位段灰显 Tooltip) + 每阶段配置卡(负责 agent 多选 + Critic agent + 4 档自治 Segmented(带真值表 tooltip) + 协作模式下拉 + promptOverride + 模型)；③提示词版本 = agent.md 纳管为受管文档复用版本/回滚/Diff；④设置 = RTM 门限/角色模板。
- **工作段** · Stage Board：13 阶段泳道 + 六态徽章(未开始○/进行中◐/已定稿✓/失败✗/暂停⏸/返工🔁，抄 stages.ts 字形/色) + 绑定 agent 头像 + HITL「N 处待确认」红点；复用 DispatchPanel 的 2s 轮询拉 run.json。
- **出结果段** · 右栏复用既有 FileViewer XOR ArtifactPanel 互斥槽：受管文档(CRD/PRD/设计/原型/RTM)走 ArtifactPanel(版本下拉/历史只读/rollback/**按块确认 Diff**，D3–D5 全复用) + 左栏受管文档按阶段分组(V3 受管入口已建) + 新增轻量 RTM 只读视图(上溯链 + 覆盖率%)。

主轴：选蓝图(配置) → 逐段跑 dispatch(工作) → 阶段产物入受管文档+按块确认(出结果)，三段同屏左中右流转、不跳页。

**纯文件数据形态**（全落项目 `.pi/`、无 DB、原子写）：
- `.pi/factory/blueprints/<id>.json` —— 蓝图：`{id,name,desc,source,stages:[{key,name,available,agentRefs,critic?,autonomy,collab,promptOverride?,subTaskTemplate}],edges?,gates?:{afterStage,kind:'coverage',threshold:0.85,artifactKind:'rtm'}}`。
- `.pi/factory/runs/<runId>.json` —— 一次运行的执行/checkpoint：把 sf-mini 的 **AgentRun/TaskGraphNode/StageGate 三表合一**成纯文件 run，软引用 id，崩溃重读续跑。
- `.pi/factory/runs/<runId>/events.jsonl` —— 追加式事件日志（替代 SSE 总线，观测台 tail 轮询）。
- **复用不改**：`.pi/agents/<id>/`、`.pi/dispatch/<taskId>.json`(每段一次)、`.pi/artifacts/managed/<id>/`、`.pi/ns-session-map.json`。RTM 边/覆盖率**不落盘**（从受管文档正文实时解析，避免双写不一致）。

> **dispatch-store / orchestrator / artifact-service / pi 内核一行不改**；新增 = `pipeline-store`(~150 行) + `factory-orchestrator`(只调既有 runDispatch/ArtifactService/PendingChangeStore) + 控制台三组件(FactoryConsole/StageBoard/PipelineMatrix) + RTM 解析纯函数+视图 + 角色模板常量 + 左栏第 5 按钮 + 受管文档按阶段分组。

---

## 四、可选设计形态（全列）

### A · 轻量 DAG 画布形态
- **一句话**：流水线即一份可视化编辑的 `pipeline.json`(受管 artifact)，节点=阶段绑 agent+产文档、边=依赖，运行时拓扑展开成串行 dispatch 链，同一画布编辑/运行双形。
- **范围**：PipelineCanvas 画布组件(编辑+运行双形) + DAG→串行 dispatch 编译器 + run.json/events.jsonl + RTM 视图+coverage + 节点 paused/resume 状态位与 run API。
- **优点**：最贴「DAG 画布」直觉、产品级通用化最强(任意多阶段 DAG，不止软件工厂)；编辑/运行同一画布双形、闭环最直观；pipeline.json 受管化→改流程也版本/按块确认/回滚。
- **缺点**：画布是最大新增工程量(拖拽/连线/检查器/双形/校验)；真并行 DAG 表达不了(红线串行+≤3)，「画了并行却串行跑」认知落差；DAG 编辑对新手反成门槛(与新手友好略张力)。
- **工程量/风险**：**大** / 画布组件复杂度高、真浏览器验收点多(拖拽/连线/双形/SSR)；并行边须明确标注「运行串行」。

### B · 结构化控制台形态（推荐主轴）
- **一句话**：不做画布，做「软件工厂控制台」四 Tab + 阶段看板，蓝图把动态状态机摊平成静态阶段×角色矩阵，运行时逐阶段调一次 dispatch。
- **范围**：pipeline-store(仿 dispatch-store ~150 行) + FactoryConsole/StageBoard/PipelineMatrix 三组件 + RTM 解析纯函数+RtmView + 「阶段→DispatchTask」薄编排函数 + 角色模板常量。
- **优点**：最大化复用、改动面最小(矩阵 vs 画布)、最贴现有面板风格、学习成本低；三段各落在已存在的 AgentManager/DispatchPanel/ArtifactPanel 上、心智连续；收敛 sf-mini 双轨认知债(三档 vs 四档)为单一自治度模型；工程量中、可分批真浏览器验收、契合本机串行约束。
- **缺点**：阶段链是静态摊平的串行 dispatch、无真动态 Planner/TaskGraph；无画布视觉、复杂分支表达力弱；无内核级逐动作自治门控(只 normal_write 一类真生效)。
- **工程量/风险**：**中** / **低**。矩阵 UI 与既有模态同构、编排器只调既有封装、零碰内核；主要风险是首次选蓝图批量 seed 角色致角色库变长(需轻分组)。

### C · 模板渐进形态
- **一句话**：把 sf-mini 全流水线封成「软件工厂蓝图」预设包，新手「选蓝图→改少量参数→一键运行」，高级用户才下钻逐阶段逐 Agent 自定义；模板驱动 + 渐进暴露复杂度。
- **范围**：BlueprintStore + FactoryOrchestrator(阶段链→多段串行 dispatch + 驱动 run 状态机 + 段产物入受管文档 ~250 行) + FactoryPanel/RunView/RTMView + 内置蓝图包(sf-mini-full / 需求三件套，纯 JSON+角色种子) + 左栏第 5 按钮。
- **优点**：最直击「冷启动断裂」痛点(内置蓝图一键起跑、新手不必懂三套机制)；蓝图开放→泛化成「任意阶段链文档工厂」(写作/调研流水线)，最贴「通用化配置多 Agent」落点；与既有 dispatch 模板化方向天然衔接；默认 hitl=semi 安全、渐进暴露不吓新手(同 sf-mini feature flag 哲学)。
- **缺点**：与 B 高度重叠(差异在「模板优先」产品姿态而非机制)；内置蓝图维护成本(角色人设需随 sf-mini 演进对齐)；批量 seed 5–10 个 agent 档案可能让角色库拥挤。
- **工程量/风险**：**中** / **低**。机制同 B；风险在模板内容质量与角色库轻管理。

### D · 组合渐进（B 主轴 + C 模板 + A 降维为轻量时间线、分期）— 推荐
- **一句话**：以 B 的结构化控制台 + 四 Tab 信息架构为骨架，融入 C 的模板一键起步与渐进自定义，把 A 的「阶段链可视化」降维成轻量阶段链时间线(非全功能 DAG 画布)，分期推进。
- **范围（分期）**：①第一期 = B 控制台骨架(蓝图 store+矩阵编辑+阶段看板+角色模板一键导入+受管产物按块确认，端到端跑通 material→requirement→design)；②第二期 = RTM 解析视图+覆盖率软门+提示词纳管复用版本；③第三期(可选/视用户反馈) = 阶段链时间线升级为可拖拽轻量 DAG 画布(并行边明确标注运行串行)。
- **优点**：每期独立可验、可走真浏览器、契合本机串行约束、风险可控；第一期就能复刻 sf-mini 1–3 阶段端到端、最快见效；保留画布升级路径但不一上来背全部画布工程量；三套之长全收(B 复用与信息架构 + C 模板渐进 + A 可视化路径)。
- **缺点**：分期意味着完整 DAG 画布要等第三期(若强求一次到位画布则不满足)；跨期需保持蓝图 schema 稳定(第三期画布消费同一份 pipeline.json)。
- **工程量/风险**：**中** / **低**。分期降低单次风险；唯一注意点是蓝图 schema 须第一期就设计成画布可消费(stages+可选 edges)，避免第三期返工。

---

## 五、sf-mini 流水线验收（拿"答案"套这套设计）

- ✅ **能完整表达（直接复用）**：角色(12 命名专家→12 个 agent 档案)、HITL 三档(按块确认 diff_blocks 与 DiffBlock 同构、零新增)、产物/版本/Diff/定稿(D3–D5 已验收)、流水线+评审协作、13 键+六态阶段链结构。
- 🔶 **能表达但降维（受红线简化，须诚实标注）**：13 阶段真接通仅 1–3(与 sf-mini 现状一致)、自治度 4 档压成「受限vs自由+是否自动advance」两杠杆(5 类动作真值表丢失)、层级/黑板协作降维、RTM 软门(无 DB 边表/非 422)、观测靠轮询非 SSE。
- ❌ **须新增（均不碰内核）**：pipeline-store、控制台三组件、RTM 解析+视图、factory-orchestrator、角色模板常量、左栏第 5 按钮、受管文档按阶段分组。
- ⚠️ **红线硬限制无法补齐**：真并行 DAG、Planner LLM 动态拆图、真事件总线 SSE、Critic 真评分阈值自动返工收敛、节点级单步/分叉回放、stage 门 422 硬归一。**但 sf-mini 这些机器本身默认全关、默认路径只是 stub 顺序生成**，故 Next-Step 红线内可表达的「可运行骨架」恰好覆盖 sf-mini 当前**真正激活**的能力面。

---

## 六、推荐 + 理由

**推荐 = 方案 D（组合渐进：B 控制台主轴 + C 模板一键起步 + A 阶段链可视化降维为轻量时间线、分期）。**

四条理由：
1. **sf-mini 反推的真实落点是「可运行骨架」而非「纸面全功能」**——高级能力默认全关、13 阶段仅 1–3 真接通、角色化只是硬编码字符串；要复刻的是当前激活层，而 Next-Step 四件套近 1:1 覆盖。D 第一期正好瞄准、最快见效、不为默认关闭的高级能力背工程债。
2. **纯 B 缺画布、纯 A 工程大且红线张力**——D 用轻量阶段链时间线先满足可视化直觉、把全功能画布留作可选第三期，既不背画布全量工程债、又保留升级路径。
3. **C 的模板渐进直击产品现实痛点**（兑现 dispatch 冷启动调研「方案 C 模板驱动」结论，把能力从「单次派发 2–3 agent」泛化成「任意阶段链文档工厂」= 用户要的"通用化配置多 Agent"）。
4. **分期契合本机现实**（串行 + 每卡双层真浏览器验收 + 单独 commit 的成熟节奏）。

**关键工程约束（先对齐、防返工）**：蓝图 schema 第一期即设计成画布可消费(`stages[]` + 可选 `edges[]`)；自治度 Semi/Manual 段产物**强制走 propose_edit→PendingChange→按块确认**(红线②③)，仅 high 档(用户显式选)才 auto 物化；编排器**同时只推进一段 dispatch**、段内复用 `acquireSlot` 保证活跃会话≤3(红线④)。

---

## 七、待用户拍板（开放问题 + lead 默认）

| # | 问题 | lead 默认建议 |
|---|------|--------------|
| 1 | 蓝图作用域：单蓝图 vs 多蓝图库 | 多蓝图库(`blueprints/<id>.json`，支撑「选蓝图」体验) |
| 2 | 自治度是否收敛为单一四档模型(Auto≈high/Semi≈medium/Manual≈manual) | 收敛(Next-Step 本就只有 propose 一条 HITL 路径) + tooltip |
| 3 | `pipeline.json` 是否纳管(改流程也版本/回滚) | 纳管(配置可追溯，统一收敛 sf-mini AgentPromptBinding 多版本) |
| 4 | RTM 覆盖率门：软提示 vs 硬阻断 | 软提示(<0.85 警示+不自动 advance、可手动继续) |
| 5 | 画布优先级：第一期就做画布 vs 留第三期可选 | 留第三期(先轻量时间线) |
| 6 | 占位阶段(develop~feedback 8 个无法真出代码)口径 | 灰显+tooltip(同 sf-mini 诚实边界)，允许配角色但产物只是文档草稿 |
| 7 | 角色模板是否需定期对齐 sf-mini 演进 | 一次性快照起步，演进对齐后置 |

---

## 决策状态

- **已定（用户）**：①dispatch 优化目标**升级**为「通用多 Agent 配置」，sf-mini 为标杆"答案"反推 Next-Step 设计；②入口改名「多 Agent 协作」；③goal 下发为总纲上下文(修实现偏离)；④模板由 lead 提全套候选用户再删(已并入本设计的角色模板/蓝图，不再单做 T1–T6)。
- **待拍板**：设计形态（A / B / C / **D 推荐** / 先写完整设计文档再定）+ 上表 7 个开放问题。
- **谁拍**：用户。
- **最终选择**：_待定_。

> 形态拍定后：lead 按项目 vibe-coding 流程出 `docs/第七轮-通用多Agent配置（软件工厂蓝图）/`（需求/概要/详细设计）+ `tasks/第七轮.../` 任务卡，逐卡门禁+双层验收+单独 commit；lead 实现级取舍记 `../设计决策记录.md`。
>
> （轮次归类：**做完的往前、未做的顺延**——第六轮已被已实现的「Agent 模式 / bash 能力」占用，本设计待拍板后为**第七轮**。）
