# Next-Step（基于 pi-web 打造的多 Agent 软件工厂）

> ### 👉 第一次用 Next-Step？从 **[《新手引导与使用指南》](./docs/V1.1/新手引导.md)** 开始
>
> 一个跑在你自己电脑上的**多 Agent 软件工厂**：建项目 → 调教多个 AI Agent → 让它们产出需求 / 设计 / 分析类文档，而文档的每一处改动都经过 **Word 修订式的逐块人工确认**才落盘。本地纯文件、无数据库、无登录。新手引导约 15 分钟带你跑通完整工作流，并讲清它凭什么值得用。

> 🔗 **溯源**：**Next-Step 是基于开源项目 [pi-web] 打造的「多 Agent 软件工厂」本地工具** —— 在 pi-web 现成的「真 Agent 内核 + 聊天 / 工具 / 技能 / 模型 UI」之上，叠加「项目 / 多 Agent 档案 / 派发编排 / 文档型产物的块级 Diff·版本·按块确认」领域层；**pi 内核不 fork**。
>
> 当前为 **V1.2 迭代版**（活跃开发，GitHub: `Pgooone/next-step-app`，分支 `v1.2` / `master`，当前 `web v1.2.6`、HEAD `54904e5`）：在 V1.1 全部已收官能力之上做了八轮迭代——多 Agent 管理界面专业重做、版本 diff 与历史、TOC diff 与文档性能、派发产受管文档、会话分组与主会话、版本治理与上游对齐，以及 V1.2 最大功能增量「**流水线与阶段看板**」和随后的「计槽语义重构与误杀根治」。**V1.1 为历史基线、V1 已发布。**
> - 仓库总览：`../README.md`
> - V1（已发布，含规格文档 + 源码 `next-step-app/`）：`../next-step-V1/`

## 怎么跑

```bash
npm install
npm run dev     # 端口 30141
npm run build
npm run test    # vitest
npm run lint
```

## 更新计划（Roadmap）

> 当前活跃 = **V1.2（`web v1.2.6`，HEAD `54904e5`，分支 `v1.2` / `master`）**。**V1.2 八轮已全部收官**；下面列「已完成」与「明确没做 / 已砍」。

### ✅ 已完成（V1.2 八轮全收官）
- **V1.1 四大支柱 + 多轮**（已收官、历史基线）：项目即工作区 / 多 Agent 档案可定义 / 多 Agent 协作派发 / 产物**块级 Diff·版本·HITL 按块确认** + V2「提议工具」模型 + 受管文档入口·删除 + 会话 re-attach 保 doc 工具 + Agent 模式（doc/coding，编码型放开 bash）。详见 `docs/V1.1/`（祖先设计史，只读参考）。
- **第一轮·多 Agent 管理（界面专业重做）**：agent 卡片 / Dispatch 派发 / Agent 管理三处界面**专业重做**（Swiss 极简，ui-ux-pro-max 驱动）—— 6 字段信息卡（头像 + 模式徽章 + 模型 + 角色 + 技能/工具/思考计数）+ 三处统一视觉语言 + 亮/暗双主题。（本轮只落「视觉」；当年 deferred 的「流水线 / 阶段编排 / 看板」机制层 = 第七轮。）
- **第二轮·版本 diff 与历史**：受管文档「版本演进」可视化——①版本间行内 diff（file panel 选历史版即看该版相对上一版改了什么，只读）；②Diff 历史时间线 Tab（手风琴就地展开）。**零新增存储、纯只读重算**（每版全量快照永不覆盖，相邻两版 diff 可重算）。
- **第三轮·TOC diff 与文档性能**：①TOC 体现版本 diff（改动章节标记增/删/改、色盲可辨、归属最内层精确不冒泡）；②大文档性能优化（实测瓶颈为 react-markdown 渲染 → **仅 memo 化**，longtask 循环 16→0）。
- **第四轮·让文档型派发也能产受管文档**：补「多 Agent 派发」与「受管产物」两支柱的断点——文档型（mode=doc）派发 worker 装受限提议工具集（含 `create_artifact`/`list_artifacts`），产出**受管文档**、id 回填 assignment、完成刷新受管分组（dispatch 仍禁 `propose_edit`）。
- **第五轮·会话分组与主会话**：修两缺陷——dispatch 各 agent 会话按 agent 分组（orchestrator 补 `setOwner` 写 owner-map）；进项目恢复主会话（SessionSidebar 恢复 effect：URL > `mainSessionId` > 新建态）。
- **第六轮·版本治理与上游对齐**（轻量 chore）：首页 `web v…` 随版本迭代（→ `web v1.2.6`）+ 记录原始 pi-web 基线（`UPSTREAM.md`）+ 内核升 `0.79.10`（^0.79.0 范围内）。两条上游回合并经承重 spike 判 no-op / 可选功能 → 跳过留 TODO。
- **★ 第七轮·流水线与阶段看板**（**V1.2 最大功能增量**）：把多 Agent 派发从「一次 ≤3 子任务、一锤子串行」升级为「**可保存的 N 阶段流水线 + 自动按序编排（上游自动喂下游、跑完即释放并发槽）+ 阶段看板**」，把多阶段标准软件工程流水线做成**一等公民**——即第一轮 deferred 的机制层、sf-mini 反推蓝图（方案 D）从纸面落地的第一步。落地：纯文件 `pipeline.json` 蓝图 + 编排器 `pipeline-orchestrator`（串行起 worker、冻结模型每阶段 evict 释槽）+ 阶段看板 UI + run cancel + 进会话二级菜单 + 合并派发入口（快速派发 / 流水线两 Tab）+ 并发上限可配。需求依据 = 2026-06-27 用 Next-Step 真跑完 sf-mini 13 阶段全流程暴露的 F1~F16。
- **第八轮·计槽语义重构与误杀根治**：根治第七轮 T6 揪出的「跨 run evict 误杀」——把编排器每阶段 evict 从「按 agentId 一锅端」收窄为「**只逐本阶段 sessionId**」（evict-by-sessionId）。保留 F16 释槽机制、不动并发计量语义 / owner-map / 内核。

### 🚫 明确没做 / 已砍（第七轮 MVP 范围外，暂不做）
- **自治度 4 档**（全手动 / 低 / 中 / 高）—— sf-mini 蓝图的高级机器，MVP 砍。
- **Critic 评审 + 返工环** —— 撞 `propose_edit` 按块确认红线，MVP 砍。
- **黑板 A2A（agent 间共享黑板通信）** —— MVP 砍。
- **RTM 需求追溯矩阵** —— MVP 砍。
- 跨 run evict 误杀的「方案 B（计槽语义改 in-flight）」—— 经设计评审门 NO-GO（retry 退避窗口漏算、违 ≤3 并发红线），改走第八轮 evict-by-sessionId；方案 B 作回溯备选保留。
- 设计调研留痕详见 `docs/V1.1/QA/开发/通用多Agent配置-sf-mini反推.md`（V1.1 时期产物）。

### 🔧 已知技术债 / 环境
- [ ] **本机 `npm run build` 受 Google Fonts 网络环境限制**（非代码回归）：`app/layout.tsx` 用 `next/font/google` 取 Noto Sans Mono、本机离线环境取不到字体导致 build 失败（dev 不受影响、非功能问题）。
- [ ] V1.1 遗留：主对话 / dispatch 会话 re-attach 重建 doc 工具（§B）。

## V1.1 历史基线（已收官、历史基线）

V1.1 七轮全收官（第一轮 M1~M8 基础迭代 + bug-fix + P0 + V2「提议工具」模型 + 受管入口并入 / 删除受管 / re-attach 保 doc 工具 / Agent 模式 / UI 优化），是 V1.2 的祖先设计史与代码由来。详见 **`docs/V1.1/`**（各 `第N轮-*/` + `新手引导.md` + `QA/` + `设计决策记录.md`，只读参考、不再新增）。

## 文档导航（`docs/` + `tasks/`）

- **★ 新手必读（面向使用者）** [`新手引导.md`](./docs/V1.1/新手引导.md)（根目录）—— 完整上手指南：核心优势 + 从头到尾跑通工作流 + 界面截图。**第一次用从这里开始。**
- **工程视角交底** `docs/V1.1/第一轮-基础迭代/新手引导.md` + 同目录 `流程漏洞审查.md` —— 每个功能的实现原理、当前流程断点（2026-06-19 据 V2+bug-fix 重核），适合参与开发的人
- **第二轮·V2 提议工具** `docs/V1.1/第二轮-V2提议工具/{需求文档,概要设计,详细设计}.md` —— 文档实体 + 提议工具模型（V2-0~V2-6）
- `docs/V1.1/第一轮-基础迭代/需求文档.md` —— ★ 正式 V1.1 需求文档（现状→决策→落地→验收）
- `docs/V1.1/第一轮-基础迭代/前端界面深度解析报告.md` —— 前端逐控件深度解析（约 26000 字）
- `docs/V1.1/第一轮-基础迭代/概要设计.md` —— 模块划分（vibe-coding 第 2 步）
- `docs/V1.1/第一轮-基础迭代/详细设计.md` —— 各模块详细设计
- `docs/V1.1/设计决策记录.md` —— lead 机制决策（祖先 ADR：可选项 / 选定 / 对照北极星的理由）
- `docs/V1.1/第一轮-基础迭代/文档评审报告.md` —— 4-reviewer agent-team 评审报告（R1~R17 已回改）
- `docs/V1.1/第一轮-基础迭代/后续迭代清单.md` —— 本期先不做、留作后续的项（@转交续接旧会话、功能#4 档2 等）
- `tasks/` —— 任务清单与进度（vibe-coding 第 3 步；`tasks/V1.1/` 祖先 + `tasks/V1.2/` 活跃）
- `docs/V1.1/交接与指引/prompt.md` —— 监工起始指令（vibe-coding 第 4 步，停在实现前）
- `docs/V1.1/QA/` —— 祖先需求问答全记录 + 功能#3 验证截图
- **★ V1.2 各轮（活跃）** `docs/V1.2/README.md` —— V1.2 八轮总索引 + 每轮三件套（需求 / 概要 / 详细）；用户拍板 QA `docs/V1.2/QA/`、lead ADR `docs/V1.2/设计决策记录.md`

## 代码地图：pi-web 基座 vs Next-Step 新增

> 改代码前先判断它属于哪边。**基座** = 复用 pi-web，非必要不改；**新增** = Next-Step 自己的领域代码。

**pi-web 基座（复用，改前先确认）**
- `lib/` 根：`rpc-manager` / `session-reader` / `pi-types` / `agent-client` / `normalize` / `file-paths` 等
- `app/api/`：`agent` · `sessions` · `skills` · `models` · `auth` · `files` · `cwd` · `default-cwd` · `home`
- `components/`：`AppShell` · `ChatWindow` · `ChatInput` · `MessageView` · `SessionSidebar` · `TabBar` · `FileExplorer` · `FileViewer` · `SkillsConfig` · `ModelsConfig` · `BranchNavigator` · `ChatMinimap`
- `hooks/`：`useAgentSession` · `useTheme` · `useDragDrop` · `useAudio`

**Next-Step 新增**（每区有自己的薄 README）
- `lib/domain/`：`project-registry` / `agent-profile` / `orchestrator` / `artifact` 等领域逻辑 + **流水线层**（`pipeline-store` 蓝图 / `pipeline-run-store` run 记录 / `pipeline-orchestrator` 编排器 / `concurrency-gate` 并发槽 / `factory-config` 并发上限可配）
- `lib/pipeline/`：阶段看板纯渲染辅助（`dot-matrix` / `avatar` / `status-meta`）
- `lib/stores/`：`useProjectStore` / `useAgentStore` / `useDispatchStore` / `useArtifactStore` / `usePipelineStore`
- `lib/pi/`：内核封装（`profile-session-wiring`）+ **V2 提议工具层**（`doc-session` 受限工具集 / `doc-tools` 的 create_artifact·propose_edit·list_artifacts；旧 artifact-guard 拦截层 V2-5 已删）
- `app/api/`：`projects` · `health` · `projects/[id]/agents` · `dispatch` · `artifacts` · `pipeline-runs`
- `components/`：`ProjectSwitcher` · `ArtifactPanel` · `PendingChangeCard` · `AgentManager` · `DispatchPanel` · **流水线/看板** `PipelineBoard` · `PipelineEditor` · `PipelineModal` · `PipelineStageCard` · `StageSessionMenu` 等

> 区 README 约定：每个 Next-Step 新增「逻辑区」配一份**薄** README（定位 / 归属 / 红线 / spec 指针，20–40 行；`app/api/**` 路由目录除外）。V1 规格在 `../next-step-V1/docs/`，V1.1 需求 / 设计在本目录 `docs/`。

## V1 基线状态

最初基线 = V1 收官状态（commit `52313d2`）。V1 已完成 **Iter A（项目工作区）/ B（Agent 档案）/ C（派发协作）/ D（产物 Diff·版本·HITL）** 全部里程碑，详见 `../next-step-V1/README.md`。V1.1 在此基线上做了七轮迭代（历史基线 `e5f97d4`）；V1.2 又从 V1.1 收官状态精简拷贝、续做八轮（当前 `web v1.2.6`、HEAD `54904e5`）。

---

[pi-web]: 本项目的开源基座（多 Agent 编码内核 + Web UI）。源码快照见 `../next-step-V1/archive/pi-web-code/`，移植分析见 `../next-step-V1/archive/pi-web-analysis-源码解析与移植规划.md`。
