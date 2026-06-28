# V1.2 文档（`docs/V1.2/`）

> **V1.2 是从 V1.1 收官状态（commit `e5f97d4`）精简拷贝出的新工作区**：保留完整 git 历史、分支 `v1.2`、沿用远端 `Pgooone/next-step-app`；剔除验收截图 / 构建产物等臃肿物（V1.1 因这些"过于臃肿"，故另起 V1.2）。
>
> **轮次编号在 V1.2 重新从「第一轮」起。** 本目录 `docs/V1.2/` 承载 V1.2 自身的迭代轮次文档。

## 目录约定

- `docs/V1.2/` —— **V1.2 自身轮次文档**（当前活跃，在这里新增）。
- `docs/V1.1/第一轮-基础迭代/ … 第七轮-*/`、`docs/V1.1/QA/`、`docs/V1.1/设计决策记录.md` —— **继承自 V1.1 的祖先设计史**：解释现有代码（= V1.1 收官代码）的由来，**保留作参考、不再新增**。读它们是为了理解既有实现，不是 V1.2 的待办。

## V1.2 轮次

### 第一轮 · 多 Agent 管理（`第一轮-多Agent管理/`）

主题：重构 dispatch / 构建「发起多 Agent 派发」能力。执行上**先做视觉方向**——增量一 = 重构 agent 管理卡片样式（参照 `../../ui原型参考/`〔sf-mini 原型 index.html / board.html〕的玻璃拟态，**主题自适应玻璃**方向）。

- 先读 `第一轮-多Agent管理/需求文档.md`（vibe-coding 第 1 步 · proposal）
- → `概要设计.md`（第 2 步 · 模块划分）
- → `详细设计.md`（第 2 步 · 模块详细设计）
- 任务卡与进度：`../../tasks/V1.2/第一轮-多Agent管理/`（第 3 步）
- 用户拍板 QA：`QA/`（本目录下，第 1/2 步全程留痕）

> ⚠️ **本轮只落地了「视觉」**（agent 卡片玻璃→Swiss，git 实证仅动 3 个纯前端文件、机制零改）。当年明确 deferred 的「流水线 / 阶段编排 / 阶段看板」**机制层从未实现** → 见 **第七轮**（基于 sf-mini 13 阶段全流程实测重新立项）。

### 第二轮 · 版本 diff 与历史（`第二轮-版本diff与历史/`）

主题：让受管文档的「版本演进」可视化、可回看。两功能——①**版本间行内 diff**（file panel 选历史版即看该版相对上一版改了什么，只读、无 ☑️❌）；②**Diff 历史**时间线（ArtifactPanel 内 Tab、铺满主体区覆盖正文、手风琴就地展开）。**零新增存储、纯只读重算、不碰红线**（每版全量快照永不覆盖，相邻两版 diff 可重算）。

- 先读 `第二轮-版本diff与历史/需求文档.md` → `概要设计.md` → `详细设计.md`（含任务拆分 T1~T4 + 风险护栏）
- 任务卡与进度：`../../tasks/V1.2/第二轮-版本diff与历史/progress.md`
- 用户拍板 QA：`QA/第二轮-版本diff与历史决策.md`（D-V1.2-10~14）；lead ADR `设计决策记录.md`（D-R2-01~07）
- 调研留痕：ultracode 工作流 `next-step-v1.2-r2-investigate`（5 路精读 → 综合 → 对抗式核实，verdict GO）

### 第三轮 · TOC diff 与文档性能（`第三轮-TOC-diff与文档性能/`）

主题：①**TOC 体现版本 diff**（版本对比时左侧目录用「改动章节下方纯色细实线」标出增/删/改，无圆点·留间距，删除章节红线暗色占位）；②**file panel 大文档性能优化**（实测瓶颈是 ~600ms react-markdown 渲染、滚动已流畅、实例数非放大器 → **仅 memo 化**，不虚拟化）。

- 先读 `第三轮-TOC-diff与文档性能/需求文档.md` → `概要设计.md` → `详细设计.md`（含算法 + chrome-devtools 性能 baseline + 任务 T0~T4）
- 任务卡与进度：`../../tasks/V1.2/第三轮-TOC-diff与文档性能/progress.md`
- 用户拍板 QA：`QA/第三轮-TOC-diff与文档性能决策.md`（D-V1.2-15~18）；lead ADR `设计决策记录.md`（D-R3-01~08）
- 调研留痕：ultracode 工作流 `next-step-v1.2-r3-investigate`（4 路精读 → 综合 → 对抗式核实 GO·需修正 4 处，已纳入）+ lead chrome-devtools 实测 baseline

### 第四轮 · 让文档型派发也能产受管文档（`第四轮-派发产受管文档/`）

主题：补「多 Agent 派发」与「受管产物」两支柱的断点——**文档型（mode=doc）派发 worker 产不出受管文档（只落 `.pi/artifacts` 纯文本、掉出受管体系）**。根因 = dispatch-runner 建会话从不挂 doc 提议工具（有意分期 D-C-1 + V2 没回接，非主动屏蔽）；本轮兑现第五轮 §A。方案 B（接线 + create_artifact 闭环对账 + **dispatch 禁 propose_edit**，分两轮）：dispatch doc worker 装受限集（含 create_artifact/list_artifacts）、产受管文档、id 回填 assignment、进度链接 by-id 开 ArtifactPanel、完成刷新受管分组。

- 先读 `第四轮-派发产受管文档/需求文档.md` → `概要设计.md` → `详细设计.md`（含 T1~T6 落地 + 双层验收结果）
- 任务卡与进度：`../../tasks/V1.2/第四轮-派发产受管文档/progress.md`
- 用户拍板 QA：`QA/第四轮-派发产受管文档决策.md`（D-V1.2-19~20）；lead ADR `设计决策记录.md`（D-R4-01~08）
- 调研留痕：ultracode 工作流 `dispatch-managed-doc-fix-investigation`（`wf_778dac19`，5 路精读 → Option B → 3 视角对抗式核实全 holds=True）+ 承重墙 T1 spike（lead 复跑）+ T6 真浏览器端到端（lead 亲验）
- commits：T2 `3d1077b` / T4 `dc0b4a6` / T5 `3c3d4c8` / 收尾 `209d1d3`（分支 v1.2，未 push）

### 第五轮 · 会话分组与主会话（`第五轮-会话分组与主会话/`）

主题：修两缺陷——**Bug1** dispatch 各 agent 会话没按 agent 分组、全堆「其它会话」（根因 = `orchestrator.ts` 派完只写 `assignment.sessionId`、**从不调 `setOwner`** 写 `bySession`；分组 UI 早完备）；**Bug2** 进项目不恢复主会话、停空态（根因 = `AppShell` 进项目只 refresh map、不读 `mainSessionId` 恢复，唯一恢复源 URL `?session=` 从项目墙进入被清）。修法：T1 orchestrator 补 `setOwner`（completed/timeout/aborted 都写）；T2 DispatchPanel 终态独立回调（**不被 artifact 门控**）+ AppShell 有界重试刷新分组；T3 SessionSidebar 恢复 effect 下沉重写（URL > mainSessionId > 新建态，含 map 就绪 wait-gate）；T4 新建态由既有 cwd 链天然成立（无代码）。

- 先读 `第五轮-会话分组与主会话/需求文档.md` → `概要设计.md` → `详细设计.md`（含 T1~T4 落地 + 真浏览器统一验收结果）；开工交接 `第五轮-会话分组与主会话/开工交接.md`
- 任务卡与进度：`../../tasks/V1.2/第五轮-会话分组与主会话/`
- 用户拍板 QA：`QA/第五轮-会话分组与主会话决策.md`（D-V1.2-21~23）；lead ADR `设计决策记录.md`（D-R5-01~07）
- 调研留痕：ultracode 已调查 + 三视角对抗 holds=True + lead 复核根因 + 用户拍板（A/A/A）
- commits：T1 `bae6a95` / T2 `c44e282` / T3 `b06e447` / 收尾 `5bb4641`（T4 无代码，分支 v1.2）

### 第六轮 · 版本治理与上游对齐（`第六轮-版本治理与上游对齐/`）

主题：**轻量 chore 轮**（无承重改动）。用户两问 ——①让首页 `web v…` 随版本迭代更新、记录原始 pi-web 基线版本以便对照上游升级基座；②pi 有更新在哪、怎么提醒。结论：首页版本机制本就完好（next.config 构建期自动读），缺口只是 version 从未 bump → 方案 B（`1.2.<已收官轮次>`，本轮第六轮→首页 `web v1.2.6`）+ 补 tag；基线记录 = `package.json.upstream` 字段 + app 根 `UPSTREAM.md`；内核升 0.79.10（白捡、^0.79.0 范围内）。两条「上游回合并」经 M4 承重 spike 对抗式核实判 **no-op（rpc）/ 可选功能（markdown）→ 跳过留 TODO**；问题二（提醒机制）用户选**暂不做**。

- 先读 `第六轮-版本治理与上游对齐/进度与收官.md`（chore 轮、不出三件套）；对照上游手册见 app 根 `UPSTREAM.md`
- 用户拍板 QA：`QA/第六轮-版本治理与上游对齐决策.md`（D-V1.2-24~27，含 spike 后订正轮次2）；lead ADR `设计决策记录.md`（D-R6-01~06）
- 调研留痕：ultracode 工作流 `wf_4539e50b`（8 agent·版本机制+上游 delta+skeptic 复核）+ M4 承重 spike `wf_6db0eb67`（7 agent 对抗式·测绘+怀疑者+裁决）+ lead npm pack/file:line/真浏览器复验
- commits：M1 `e204c9f` / M2 `cf82425` / M3 `7fb6fdb` / M4-M5 TODO `d4be136` / docs `5365e05` / 版本订正→1.2.6（+ tag v1.2.1~v1.2.6，第六轮=`v1.2.6`）（分支 v1.2，未 push）

### 第七轮 · 流水线与阶段看板（`第七轮-流水线与阶段看板/`）— ✅ T1~T8 收官并 push（`0a877da`）

主题：把多 Agent 派发从「一次 ≤3 子任务、一锤子串行」升级为「**可保存的 N 阶段流水线 + 自动按序编排（上游自动喂下游、跑完即释放并发槽）+ 阶段看板**」，即把「多阶段标准软件工程流水线」做成**一等公民**。这是**第一轮「多 Agent 管理」当年明确 deferred 的机制层**，也是 sf-mini 反推蓝图（方案 D）从纸面落地的第一步。

- **需求依据 = 真实实测**：2026-06-27 用 Next-Step 网页版真实跑完 sf-mini 13 阶段全流程（CS2 项目），暴露 F1~F16，🔴 硬伤（F9 无流水线 / F16 多轮撞 ≤3 并发墙 / F14 无全局进度 / F6 顺序错位 / F15 重新发起预填）即本轮要根治的。
- 先读 `第七轮-流水线与阶段看板/README.md` → `方案-流水线与阶段看板.md`（主方案）+ `sf-mini全流程实测-心得与卡点.md`（F1~F16 实测）
- 任务卡：`../../tasks/V1.2/第七轮-流水线与阶段看板/progress.md`（待需求细化后填充）
- 调研留痕：ultracode 工作流 `pipeline-stageboard-plan`（7 agent：4 路采集→综合→对抗评审 REVISE→定稿）+ lead 亲核 file:line（尤其纠偏 F16 真根因 = completed 会话占槽 10min，非「撞墙报错」）
- **状态**：✅ **T1~T8 全收官并 push**（蓝图/编排器/阶段看板 + 进会话/cancel/失败态 + 合并入口·两 tab + 收尾；15 commit `f430d95`→`0a877da`，origin/v1.2=origin/master 同步）。三承重卡 T1/T3/T6 全绿、真浏览器 AC-8~13 全 PASS。lead ADR `设计决策记录.md`（D-R7-01~09）。

### 第八轮 · 计槽语义重构与误杀根治（`第八轮-计槽语义重构与误杀根治/`）— spec 待批准

主题：把并发「占槽」判据从「registry **在册**会话数」改为「同时**在跑回合**数（in-flight）」——**根治第七轮 T6 揪出的「跨 run evict 误杀」**（D-R7-07 决策2 留二期），顺带根治 legacy dispatch 完成态占槽。

- **由来链**：第七轮 T6「进入完整对话」复活 worker 会话 → 揪出 evict 按 agentId 一锅端误杀用户复活的同 agent 会话 → 收官后资源实测（ADR D-R7-09 证活会话仅 ~1MB 进程内对象、0 进程，「占槽」是逻辑计数非资源）→ 误杀去风险调查（ultracode 7-agent）→ **用户拍板方案 B**（改计槽语义，D-V1.2-50）。
- 先读 `第八轮-计槽语义重构与误杀根治/README.md` → `需求文档.md` → `概要设计.md` → `详细设计.md`
- 任务卡：`../../tasks/V1.2/第八轮-计槽语义重构与误杀根治/progress.md`（T1 承重 spike → T2 实现 → T3 双层验收）
- 用户拍板 QA：`QA/第八轮-计槽语义重构决策.md`（D-V1.2-50）；lead ADR `设计决策记录.md`（D-R8-* 待开工填）
- 调研留痕：误杀去风险 ultracode 工作流（7 agent：机制核实 → 方案设计+对抗 → 定稿）+ 资源实测工作流（5 agent，ADR D-R7-09）
- **状态**：三件套 + QA + 任务卡 spec **草拟完成、待用户复审批准后开 T1**（承重 spike）。

> ⚠️ **本（V1.2）第八轮 ≠ 下方 V1.1 时期的「第八轮·通用多 Agent 配置」**（那个已拆为 V1.2 第一轮 + 第七轮、见下节）。本第八轮是第七轮收官后新立的误杀根治轮、编号顺延。

## 与 V1.1「第八轮」的关系

V1.1 时期规划的「**第八轮·通用多 Agent 配置（软件工厂蓝图）**」（当时调研完成、形态待拍板、未开工）整体迁移至 V1.2。落地时**拆成两步**：
- **第一轮「多 Agent 管理」= 只做了视觉**（agent 卡片信息架构，参照 sf-mini 原型；机制层明确不动）。
- **第七轮「流水线与阶段看板」= 做机制层**（蓝图 + 编排 + 看板，即方案 D 真正的「软件工厂」骨架）——经 2026-06-27 全流程实测校准、待开工。

V1.1 侧（根 `CLAUDE.md`、`next-step-V1.1/README.md`、`next-step-V1.1/docs/QA/00-索引.md`）已标注「已迁至 V1.2」，不再承接。调研留痕原文随工作副本复制在 `../V1.1/QA/开发/通用多Agent配置-sf-mini反推.md`（V1.1 时期产物，作设计输入参考）。
