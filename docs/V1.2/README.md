# V1.2 文档（`docs/V1.2/`）

> **V1.2 是从 V1.1 收官状态（commit `e5f97d4`）精简拷贝出的新工作区**：保留完整 git 历史、分支 `v1.2`、沿用远端 `Pgooone/next-step-app`；剔除验收截图 / 构建产物等臃肿物（V1.1 因这些"过于臃肿"，故另起 V1.2）。
>
> **轮次编号在 V1.2 重新从「第一轮」起。** 本目录 `docs/V1.2/` 承载 V1.2 自身的迭代轮次文档。

## 目录约定

- `docs/V1.2/` —— **V1.2 自身轮次文档**（当前活跃，在这里新增）。
- `docs/第一轮-基础迭代/ … 第七轮-*/`、`docs/QA/`、`docs/设计决策记录.md` —— **继承自 V1.1 的祖先设计史**：解释现有代码（= V1.1 收官代码）的由来，**保留作参考、不再新增**。读它们是为了理解既有实现，不是 V1.2 的待办。

## V1.2 轮次

### 第一轮 · 多 Agent 管理（`第一轮-多Agent管理/`）

主题：重构 dispatch / 构建「发起多 Agent 派发」能力。执行上**先做视觉方向**——增量一 = 重构 agent 管理卡片样式（参照 `../../ui原型参考/`〔sf-mini 原型 index.html / board.html〕的玻璃拟态，**主题自适应玻璃**方向）。

- 先读 `第一轮-多Agent管理/需求文档.md`（vibe-coding 第 1 步 · proposal）
- → `概要设计.md`（第 2 步 · 模块划分）
- → `详细设计.md`（第 2 步 · 模块详细设计）
- 任务卡与进度：`../../tasks/V1.2/第一轮-多Agent管理/`（第 3 步）
- 用户拍板 QA：`QA/`（本目录下，第 1/2 步全程留痕）

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

## 与 V1.1「第八轮」的关系

本轮 = V1.1 时期规划的「**第八轮·通用多 Agent 配置（软件工厂蓝图）**」（当时调研完成、形态待拍板、未开工）整体迁移至 V1.2、**重新立项为「第一轮」**。V1.1 侧（根 `CLAUDE.md`、`next-step-V1.1/README.md`、`next-step-V1.1/docs/QA/00-索引.md`）已标注「已迁至 V1.2」，不再承接。调研留痕原文随工作副本复制在 `../QA/开发/通用多Agent配置-sf-mini反推.md`（V1.1 时期产物，作设计输入参考）。
