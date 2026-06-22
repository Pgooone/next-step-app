# Next-Step（基于 pi-web 打造的多 Agent 软件工厂）

> ### 👉 第一次用 Next-Step？从 **[《新手引导与使用指南》](./新手引导.md)** 开始
>
> 一个跑在你自己电脑上的**多 Agent 软件工厂**：建项目 → 调教多个 AI Agent → 让它们产出需求 / 设计 / 分析类文档，而文档的每一处改动都经过 **Word 修订式的逐块人工确认**才落盘。本地纯文件、无数据库、无登录。新手引导约 15 分钟带你跑通完整工作流，并讲清它凭什么值得用。

> 🔗 **溯源**：**Next-Step 是基于开源项目 [pi-web] 打造的「多 Agent 软件工厂」本地工具** —— 在 pi-web 现成的「真 Agent 内核 + 聊天 / 工具 / 技能 / 模型 UI」之上，叠加「项目 / 多 Agent 档案 / 派发编排 / 文档型产物的块级 Diff·版本·按块确认」领域层；**pi 内核不 fork**。
>
> 当前为 **V1.2 迭代版**（活跃开发，GitHub: `Pgooone/next-step-app`，分支 `v1.2` / `master`）：在 V1.1 全部已收官能力之上新增「多 Agent 管理」界面的专业重做等。**V1.1 为历史基线、V1 已发布。**
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

> 当前活跃 = **V1.2 第一轮·多 Agent 管理**。下面列「已完成」与「还没做」。

### ✅ 已完成
- **V1.1 四大支柱 + 多轮**（已收官、历史基线）：项目即工作区 / 多 Agent 档案可定义 / 多 Agent 协作派发 / 产物**块级 Diff·版本·HITL 按块确认** + V2「提议工具」模型 + 受管文档入口·删除 + 会话 re-attach 保 doc 工具 + Agent 模式（doc/coding，编码型放开 bash）。
- **V1.2 第一轮·多 Agent 管理（界面专业重做）**：agent 卡片 / Dispatch 派发 / Agent 管理三处界面**专业重做**（Swiss 极简，ui-ux-pro-max 驱动）—— 6 字段信息卡（头像 + 模式徽章 + 模型 + 角色 + 技能/工具/思考计数）+ 三处统一视觉语言 + 亮/暗双主题。

### 🚧 下一步（"多 Agent 管理"主题的其余增量，待拍板）
- [ ] **发起多 Agent 派发能力**：dispatch 重构 / 模板驱动 / 发起向导（降低冷启动门槛、当前硬要 ≥2 个 agent 易死胡同）。
- [ ] **事件流 / 进度实时呈现**：派发过程可视化（当前是 2s 轮询 + 静态状态徽章、无流式）。
- [ ] **Agent 详情观测台 / 二级菜单**：点 agent 看运行轨迹（输入工件 → 提示词 → 工具调用 → 产出 + diff）。

### 📋 规划中（软件工厂蓝图 · 以 sf-mini 为标杆反推）
- [ ] **流程蓝图**：纯文件 `pipeline.json` + 「工厂控制台」（配置 / 工作 / 出结果 三段）。
- [ ] **13 阶段流水线**：资料 → 需求 → 设计 → 开发 → … → 反馈，每段配角色化 Agent。
- [ ] **自治度 4 档**（全手动 / 低 / 中 / 高）、**Critic 评审 + 返工环**、**黑板 A2A**、**RTM 追溯**。
- 设计调研详见 `docs/QA/开发/通用多Agent配置-sf-mini反推.md`。

### 🔧 已知技术债 / 环境
- [ ] **本机 `npm run build` 受 Google Fonts 限制**：`app/layout.tsx` 用 `next/font/google` 取 Noto Sans Mono、离线环境取不到 → 计划换本地 / 系统字体让 build 离线可过（dev 不受影响）。
- [ ] V1.1 遗留：主对话 / dispatch 会话 re-attach 重建 doc 工具（§B）。

## V1.1 各轮（已完成）

V1.1 已完成多轮：**第一轮·基础迭代**（M1~M8，下表）+ **bug-fix 轮**（5 缺陷）+ **P0**（profile 会话接拦截）+ **第二轮·V2「提议工具」模型**（文档型 Agent 用 `create_artifact`/`propose_edit` 产文档 → 块级确认 → 物化真实 `.md`，取代旧 guard；已真模型 DeepSeek 端到端验证）+ **第三轮·受管文档入口并入 file panel** + **第四轮·删除受管文档** + **第五轮·会话 re-attach 重建保 doc 工具** + **第六轮·Agent 模式（doc/coding），编码型放开 bash 等内置工具**。详见各 `docs/第N轮-*/`（+ `docs/第一轮-基础迭代/新手引导.md`）。
> 后续迭代见上「**更新计划（Roadmap）**」；V1.2 自身轮次文档在 `docs/V1.2/`。

第一轮源自 `docs/第一轮-基础迭代/需求文档.md`，共 **1 bug + 5 功能 + 1 外观**：

| 编号 | 一句话 | 状态 / 决策 |
|---|---|---|
| 功能#1 | 前端界面深度解析报告 | ✅ 已交付 `docs/第一轮-基础迭代/前端界面深度解析报告.md` |
| 功能#3 | 识别项目 + 全局 skills | ✅ 已双层验证具备，零开发 |
| bug#1 | agent 落盘命名变 UUID | 非 bug；只做界面观感修复 |
| 功能#2 | file panel 整合 Iter D 按钮 | 维持现状 + 分工提示 |
| 功能#4 | 对话框上传文本类文件 | 让 Agent 读懂内容；先做纯文本（仅前端） |
| 功能#5 | 项目首页 + 主对话 @agent + Dispatch | 大改造，6 子需求，需先设计 |
| 外观#1 | agent 管理界面玻璃感重做 | 正方形玻璃卡片 + 卡片即菜单 |

## 文档导航（`docs/` + `tasks/`）

- **★ 新手必读（面向使用者）** [`新手引导.md`](./新手引导.md)（根目录）—— 完整上手指南：核心优势 + 从头到尾跑通工作流 + 界面截图。**第一次用从这里开始。**
- **工程视角交底** `docs/第一轮-基础迭代/新手引导.md` + 同目录 `流程漏洞审查.md` —— 每个功能的实现原理、当前流程断点（2026-06-19 据 V2+bug-fix 重核），适合参与开发的人
- **第二轮·V2 提议工具** `docs/第二轮-V2提议工具/{需求文档,概要设计,详细设计}.md` —— 文档实体 + 提议工具模型（V2-0~V2-6）
- `docs/第一轮-基础迭代/需求文档.md` —— ★ 正式 V1.1 需求文档（现状→决策→落地→验收）
- `docs/第一轮-基础迭代/前端界面深度解析报告.md` —— 前端逐控件深度解析（约 26000 字）
- `docs/第一轮-基础迭代/概要设计.md` —— 模块划分（vibe-coding 第 2 步）
- `docs/第一轮-基础迭代/详细设计.md` —— 各模块详细设计
- `docs/设计决策记录.md` —— lead 机制决策（ADR：可选项 / 选定 / 对照北极星的理由，D-V1.1-01~04）
- `docs/第一轮-基础迭代/文档评审报告.md` —— 4-reviewer agent-team 评审报告（R1~R17 已回改）
- `docs/第一轮-基础迭代/后续迭代清单.md` —— 本期先不做、留作后续的项（@转交续接旧会话、功能#4 档2 等）
- `tasks/` —— V1.1 任务清单与进度（vibe-coding 第 3 步）
- `prompt.md` —— 监工起始指令（vibe-coding 第 4 步，停在实现前）
- `docs/QA/` —— 需求问答全记录 + 功能#3 验证截图

## 代码地图：pi-web 基座 vs Next-Step 新增

> 改代码前先判断它属于哪边。**基座** = 复用 pi-web，非必要不改；**新增** = Next-Step 自己的领域代码。

**pi-web 基座（复用，改前先确认）**
- `lib/` 根：`rpc-manager` / `session-reader` / `pi-types` / `agent-client` / `normalize` / `file-paths` 等
- `app/api/`：`agent` · `sessions` · `skills` · `models` · `auth` · `files` · `cwd` · `default-cwd` · `home`
- `components/`：`AppShell` · `ChatWindow` · `ChatInput` · `MessageView` · `SessionSidebar` · `TabBar` · `FileExplorer` · `FileViewer` · `SkillsConfig` · `ModelsConfig` · `BranchNavigator` · `ChatMinimap`
- `hooks/`：`useAgentSession` · `useTheme` · `useDragDrop` · `useAudio`

**Next-Step 新增**（每区有自己的薄 README）
- `lib/domain/`：`project-registry` / `agent-profile` / `orchestrator` / `artifact` 等领域逻辑
- `lib/stores/`：`useProjectStore` / `useAgentStore` / `useDispatchStore` / `useArtifactStore`
- `lib/pi/`：内核封装（`profile-session-wiring`）+ **V2 提议工具层**（`doc-session` 受限工具集 / `doc-tools` 的 create_artifact·propose_edit·list_artifacts；旧 artifact-guard 拦截层 V2-5 已删）
- `app/api/`：`projects` · `health` · `projects/[id]/agents` · `dispatch` · `artifacts`
- `components/`：`ProjectSwitcher` · `ArtifactPanel` · `PendingChangeCard` · `AgentManager` · `DispatchPanel`

> 区 README 约定：每个 Next-Step 新增「逻辑区」配一份**薄** README（定位 / 归属 / 红线 / spec 指针，20–40 行；`app/api/**` 路由目录除外）。V1 规格在 `../next-step-V1/docs/`，V1.1 需求 / 设计在本目录 `docs/`。

## V1 基线状态

本副本 = V1 收官状态（commit `52313d2`）。V1 已完成 **Iter A（项目工作区）/ B（Agent 档案）/ C（派发协作）/ D（产物 Diff·版本·HITL）** 全部里程碑，详见 `../next-step-V1/README.md`。V1.1 在此基线上做本次 7 条迭代。

---

[pi-web]: 本项目的开源基座（多 Agent 编码内核 + Web UI）。源码快照见 `../next-step-V1/archive/pi-web-code/`，移植分析见 `../next-step-V1/archive/pi-web-analysis-源码解析与移植规划.md`。
